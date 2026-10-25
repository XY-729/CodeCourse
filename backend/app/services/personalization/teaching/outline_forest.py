"""Outline-owned lesson forests. Selection is local; only outlines see the full tree."""
from __future__ import annotations

import copy
import json
import re

from .generation_context import build_generation_context
from .prompt_forest import expand_prompt_references, prompt_id


OUTLINE_FOREST_CONTRACT = """<outline_knowledge_contract>
本次是后续所有课件的知识范围规划。详细分析每课目标、前置基础、代码机制及应用所需的领域，完整列出大概念，不能只列项目名称或少数标题。
TeachingManifest 的 concepts 只创建后续课件涉及的大概念及其必要祖先，不提前创建细节次概念。coverage 只标大概念在总纲中的实际计划或解释。
在 TeachingManifest 中额外返回 outline_knowledge：{"major_refs":["本响应大概念ref"],"repeated_ids":["输入知识树中已讲过且本计划可能涉及的概念ID"]}。
major_refs 必须覆盖所有课件的知识领域，复用已有概念；必要祖先可列入 concepts，但不要把纯结构祖先当作大概念而扩大整门课程范围。
逐范围检查完整知识树的 coverage。repeated_ids 包括跨分支的前置知识和相同机制；仅 planned/mentioned 不表示已讲过。没有实际重复时返回空数组。
后续仅提供这些大概念下的知识森林和已讲范围清单。不要假设后续会再看到完整知识树；不得遗漏能预见的大概念。
总纲的 terms 只关联上述大概念，不为细节术语提前创建次概念。
</outline_knowledge_contract>"""


class OutlineUnavailable(ValueError):
    """No usable outline forest; QA may continue without knowledge input."""


def descendants(nodes, majors):
    children = {}
    for identity, node in nodes.items():
        children.setdefault(node.get('parent_id'), []).append(identity)
    selected, pending = set(), list(majors)
    while pending:
        identity = pending.pop()
        if identity in selected:
            continue
        selected.add(identity)
        pending.extend(children.get(identity, []))
    return selected


def ancestors(nodes, selected):
    result = set(selected)
    for identity in list(selected):
        cursor = nodes[identity].get('parent_id')
        while cursor is not None and cursor not in result:
            result.add(cursor)
            cursor = nodes[cursor].get('parent_id')
    return result


def prior_coverage(conn, identities, project_id, exclude_path):
    """Keep source bindings so later edits/deletions can remove obsolete entries."""
    rows = conn.execute("""SELECT p.concept_id,c.display_name AS name,p.aspect,p.dimension,p.kind,
        d.id AS document_id,d.project_id,d.source_type,d.source_path,d.content_hash
        FROM teaching_passages p JOIN teaching_documents d ON d.id=p.document_id
        JOIN concepts c ON c.id=p.concept_id
        WHERE p.active=1 AND p.kind IN ('brief','explained')
        AND d.index_status='complete' AND d.content_status='published'
        AND NOT (d.project_id=? AND d.source_type='course' AND d.source_path=?)
        ORDER BY p.concept_id,p.dimension,p.aspect,d.id""", (project_id, exclude_path))
    result, seen = [], set()
    for row in rows:
        if row['concept_id'] not in identities:
            continue
        value = dict(row)
        key = tuple(value.values())
        if key not in seen:
            result.append(value)
            seen.add(key)
    return result


def make_outline_scope(conn, project_id, source_path, manifest, applied):
    refs = applied['ref_to_id']
    declaration = manifest.get('outline_knowledge')
    if declaration is None:
        # Old v2 outlines: concrete planned/covered concepts are the safest
        # recoverable anchors. No guessing roots from names or an entire domain.
        major_refs = sorted({item['concept_ref'] for item in manifest['coverage']})
        repeated = []
    else:
        major_refs = declaration['major_refs']
        repeated = declaration.get('repeated_ids', [])
    majors = sorted({refs[ref] for ref in major_refs})
    if not majors:
        return None
    from app.services.knowledge_tree_service import _visible
    nodes = {row['concept_id']: dict(row) for row in conn.execute('SELECT * FROM concept_tree_nodes')
             if row['identity_status'] != 'archived' and _visible(row, project_id)}
    expanded = expand_prompt_references({'concepts': [{'existing_id': identity} for identity in repeated]}, nodes)
    repeated = {item['existing_id'] for item in expanded['concepts']}
    if not repeated <= nodes.keys():
        raise ValueError('总纲的已讲清单引用了不可访问的概念')
    selected = descendants(nodes, majors)
    history_ids = selected | repeated
    return {'version': 1, 'major_ids': majors, 'repeated_ids': sorted(repeated),
            'prior_coverage': prior_coverage(conn, history_ids, project_id, source_path)}


def _redirect(conn, identity):
    seen = set()
    while identity not in seen:
        seen.add(identity)
        row = conn.execute('SELECT target_id FROM concept_redirects WHERE source_id=?', (identity,)).fetchone()
        if row is None:
            return identity
        identity = row['target_id']
    raise ValueError('概念合并记录包含循环，请修复知识树')


def build_lesson_context(project_id, current_requirements='', *, outline_path='outline.md'):
    """A live descendant forest plus immutable outline selection and live history."""
    from app.services import teaching_index
    from app.services.storage import run_in_transaction
    outline_path = outline_path.replace('\\', '/')
    try:
        content = teaching_index._read_source(project_id, 'course', outline_path)
        teaching_index.index_document(project_id, 'course', outline_path, content, artifact_kind='outline')
    except FileNotFoundError as exc:
        raise OutlineUnavailable('请先生成总纲，再生成课件；课件需要总纲确定的大概念') from exc

    def read(conn):
        row = conn.execute("SELECT * FROM teaching_documents WHERE project_id=? AND source_type='course' AND source_path=?",
                           (project_id, outline_path)).fetchone()
        if row is None or row['index_status'] != 'complete' or not row['outline_scope_json']:
            raise OutlineUnavailable('总纲缺少可恢复的大概念清单，请补录或重新生成总纲后再生成课件')
        scope = json.loads(row['outline_scope_json'])
        # One transaction prevents a mix of tree versions, source history and scope.
        from app.services.knowledge_tree_service import get_tree_snapshot, list_requirements
        raw = get_tree_snapshot(project_id, conn=conn)
        raw['requirements'] = list_requirements(project_id, conn=conn)
        nodes = {node['id']: node for node in raw['nodes']}
        majors = {_redirect(conn, identity) for identity in scope['major_ids']}
        repeated = {_redirect(conn, identity) for identity in scope.get('repeated_ids', [])}
        if not majors <= nodes.keys():
            raise OutlineUnavailable('总纲的大概念已被删除或拆分，请补充总纲后再生成课件')
        selected = descendants(nodes, majors)
        included = ancestors(nodes, selected)
        raw['nodes'] = [copy.deepcopy(nodes[identity]) for identity in sorted(included)]
        for node in raw['nodes']:
            if node['id'] not in selected:
                # Connector ancestors carry identity/edges only, not sibling history.
                for field in ('ranges', 'coverage', 'range_catalog'):
                    node[field] = []
                node['familiarity'] = 'unrecorded'
        history = prior_coverage(conn, selected | (repeated & nodes.keys()), project_id, outline_path)
        constraint = {'version': 1, 'outline_path': outline_path, 'outline_hash': row['content_hash'],
                      'major_ids': sorted(majors), 'prior_coverage': history}
        raw['generation_scope'] = constraint
        return raw
    return build_generation_context(project_id, current_requirements, snapshot=run_in_transaction(read))


def question_outline_path(project_id, *, source_type=None, source_path=None, parent_qa_id=None):
    """Follow durable document bindings before graph links or the project outline."""
    from app.services.storage import _connect, GENERATED_ROOT
    root = (GENERATED_ROOT / str(project_id)).resolve()

    def exists(path):
        target = (root / path).resolve()
        return root in target.parents and target.is_file()

    def normalize(path):
        return str(path or '').replace('\\', '/')

    with _connect() as conn:
        visited = set()

        def document(kind, path):
            path = normalize(path)
            row = conn.execute('SELECT * FROM teaching_documents WHERE project_id=? AND source_type=? AND source_path=?',
                               (project_id, kind, path)).fetchone()
            bound = json.loads(row['lesson_scope_json']) if row and row['lesson_scope_json'] else {}
            bound_path = bound.get('outline_path')
            if bound_path and exists(bound_path):
                return bound_path
            if kind == 'course':
                if row and (row['outline_scope_json'] or row['artifact_kind'] == 'outline'):
                    return path
                links = conn.execute("""SELECT DISTINCT parent.ref_path FROM knowledge_nodes child
                    JOIN knowledge_edges edge ON edge.project_id=child.project_id AND edge.target_node_id=child.id
                    JOIN knowledge_nodes parent ON parent.project_id=edge.project_id AND parent.id=edge.source_node_id
                    WHERE child.project_id=? AND child.ref_type='course' AND child.ref_path=?
                    AND edge.relation_type='parent_of' AND parent.ref_type='course'""", (project_id, path)).fetchall()
                if len(links) == 1:
                    return links[0]['ref_path']
                if path == 'outline.md' or re.fullmatch(r'sub-outline-[0-9a-f]{8}\.md', path):
                    return path
                if exists(path):
                    from .manifest import parse_manifest
                    parsed = parse_manifest((root / path).read_text(encoding='utf-8'))
                    if parsed.manifest and parsed.manifest.get('outline_knowledge'):
                        return path
            return bound_path

        def answer(row):
            if row is None or row['id'] in visited:
                return None
            visited.add(row['id'])
            bound = document('qa', row['output_path']) if row['output_path'] else None
            if bound and exists(bound):
                return bound
            if row['parent_qa_id']:
                origin = answer(conn.execute('SELECT * FROM qa_records WHERE project_id=? AND id=?',
                                            (project_id, row['parent_qa_id'])).fetchone())
                if origin:
                    return origin
            if row['source_type'] in {'course', 'selection'} and row['source_path']:
                return document('course', row['source_path']) or bound
            if row['source_type'] == 'qa' and row['source_path']:
                origin = conn.execute("SELECT * FROM qa_records WHERE project_id=? AND replace(output_path,char(92),'/')=?",
                                      (project_id, normalize(row['source_path']))).fetchone()
                return answer(origin) or bound
            return bound

        if parent_qa_id:
            path = answer(conn.execute('SELECT * FROM qa_records WHERE project_id=? AND id=?',
                                      (project_id, parent_qa_id)).fetchone())
            if path:
                return path
        if source_type == 'qa' and source_path:
            path = answer(conn.execute("SELECT * FROM qa_records WHERE project_id=? AND replace(output_path,char(92),'/')=?",
                                      (project_id, normalize(source_path))).fetchone())
            if path:
                return path
        if source_type in {'course', 'selection'} and source_path:
            path = document('course', source_path)
            if path:
                return path
        if exists('outline.md'):
            return 'outline.md'
        candidates = [row['source_path'] for row in conn.execute("""SELECT source_path FROM teaching_documents
            WHERE project_id=? AND source_type='course' AND outline_scope_json IS NOT NULL
            AND source_path<>'project_map.md'""", (project_id,)) if exists(row['source_path'])]
        return candidates[0] if len(candidates) == 1 else None


def build_question_context(project_id, current_requirements='', *, source_type=None, source_path=None, parent_qa_id=None):
    path = question_outline_path(project_id, source_type=source_type, source_path=source_path, parent_qa_id=parent_qa_id)
    if path is not None:
        try:
            return build_lesson_context(project_id, current_requirements, outline_path=path)
        except OutlineUnavailable:
            pass
    from app.services.storage import run_in_transaction
    from app.services.knowledge_tree_service import _versions, list_requirements
    def read(conn):
        return {**_versions(conn), 'nodes': [], 'requirements': list_requirements(project_id, conn=conn),
                'generation_scope': {'mode': 'none'}}
    return build_generation_context(project_id, current_requirements, snapshot=run_in_transaction(read))


def build_related_context(project_id, current_requirements='', *, text='', source_type=None, source_path=None):
    """Question/annotation helpers select locally instead of sending the full tree."""
    from app.services.storage import _connect
    from .generation_context import get_full_tree_snapshot
    raw = get_full_tree_snapshot(project_id)
    nodes = {node['id']: node for node in raw['nodes']}
    selected = set()
    if source_path and source_type in {'course', 'qa'}:
        with _connect() as conn:
            selected.update(row[0] for row in conn.execute("""SELECT p.concept_id FROM teaching_passages p
                JOIN teaching_documents d ON d.id=p.document_id WHERE d.project_id=? AND d.source_type=?
                AND d.source_path=? AND p.active=1 AND d.index_status='complete'""",
                (project_id, source_type, source_path.replace('\\', '/'))) if row[0] in nodes)
    haystack = (current_requirements + '\n' + text).casefold()
    for identity, node in nodes.items():
        names = [identity, prompt_id(identity), node['name'], *node.get('aliases', [])]
        for name in names:
            name = name.strip().casefold()
            if len(name) < 2:
                continue
            if (re.search(r'(?<![a-z0-9_])' + re.escape(name) + r'(?![a-z0-9_])', haystack)
                    if name.isascii() else name in haystack):
                selected.add(identity)
                break
    included = ancestors(nodes, selected)
    raw['nodes'] = [nodes[identity] for identity in sorted(included)]
    return build_generation_context(project_id, current_requirements, snapshot=raw)


def scoped_instruction(scope):
    ids = [prompt_id(identity) for identity in scope['major_ids']]
    history = [{**item, 'concept_id': prompt_id(item['concept_id'])} for item in scope.get('prior_coverage', [])]
    return ("\n<lesson_knowledge_scope>\n" + json.dumps({'major_ids': ids}, ensure_ascii=False) +
            '\n仅能在这些大概念及其后代下追加次概念。祖先只用于连接；不得创建新根、改动已有父边或向其他分支追加。'
            '如内容需要新的领域大概念，明确提示补充总纲，不能猜测归属。\n</lesson_knowledge_scope>'
            '\n<previously_explained>\n' + json.dumps(history, ensure_ascii=False, separators=(',', ':')) +
            '\n</previously_explained>\n以上是已讲范围及来源，不代表已理解；相同概念的新范围、明确困惑和要求重讲仍应正常解释。'
            '清单中森林外的概念仅供引用历史，不能把它们作为本次概念或父节点。')


def validate_lesson_scope(conn, project_id, nodes, refs, new_ids, constraint):
    """Enforce ownership after canonical/alias binding, including hidden collisions."""
    row = conn.execute("SELECT content_hash FROM teaching_documents WHERE project_id=? AND source_type='course' AND source_path=?",
                       (project_id, constraint['outline_path'])).fetchone()
    if row is None or row['content_hash'] != constraint['outline_hash']:
        raise ValueError('总纲已变化，请根据新总纲重新生成内容')
    from app.services import teaching_index
    try:
        current = teaching_index._read_source(project_id, 'course', constraint['outline_path'])
    except FileNotFoundError as exc:
        raise ValueError('总纲已删除，请先恢复或重新生成总纲') from exc
    if teaching_index.fingerprint(current) != constraint['outline_hash']:
        raise ValueError('总纲已变化，请根据新总纲重新生成内容')
    majors = set(constraint['major_ids'])
    if not majors or not majors <= nodes.keys() or any(nodes[i]['identity_status'] == 'archived' for i in majors):
        raise ValueError('总纲大概念已失效，请补充总纲')
    selected = descendants(nodes, majors)
    allowed = ancestors(nodes, selected)
    if not set(refs.values()) <= allowed or not new_ids <= selected:
        raise ValueError('本次教学内容涉及总纲森林之外的概念，请补充总纲后重试；未创建孤立根节点')
    return selected
