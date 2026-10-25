"""Metadata-only extraction with durable checkpoints. Never regenerates prose."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
from threading import Lock, RLock

from app.services.personalization.teaching.generation_context import GenerationContext, apply_generation_context
from app.services.personalization.teaching.lesson_responsibility import (
    _responsibility_id, audit_section_manifest, audit_synthesis_manifest, freeze_responsibility_map,
)
from app.services.personalization.teaching.manifest import (
    MAX_METADATA_BYTES, locate_quote, merge_manifests, parse_manifest, validate_manifest,
)

CONTRACT_VERSION = 'metadata-only-v1'
OUTPUT_TOKENS = 16384
_locks: dict[str, RLock] = {}
_locks_guard = Lock()


def repair_lock(project: int, source_type: str, source_path: str):
    key = f'{project}:{source_type}:{source_path}'
    with _locks_guard:
        return _locks.setdefault(key, RLock())


def _digest(value) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def _save(path: Path, value: dict):
    from app.services.generation_service import _atomic_write
    _atomic_write(path, json.dumps(value, ensure_ascii=False))


def _read(path: Path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return None


def _units(project: int, body: str, existing: dict | None, generation_id: str | None):
    from app.services import storage
    if existing and existing.get('metadata_gaps'):
        # Gaps are tied to the exact paid response. Never guess chapter
        # boundaries or send the entire lesson because one anchor changed.
        match = re.fullmatch(r'task:(\d+)', generation_id or '')
        if not match:
            raise ValueError('缺口没有对应的生成记录；已停止补录，未调用模型')
        root = storage.GENERATED_ROOT / str(project)
        task = int(match[1])
        record = _read(root / '.lesson-plans' / f'task-{task}.json')
        if not record:
            raise ValueError('缺少原始冻结计划；已停止补录，未调用模型')
        original = GenerationContext(**record['context'])
        frozen = freeze_responsibility_map(record['plan'], original.tree_snapshot,
            available_ids={node['id'] for node in original.snapshot['nodes']})
        sections = record['plan']['sections']
        gap_ids = {gap['section_id'] for gap in existing['metadata_gaps']}
        result = []
        seen = set()
        for gap in existing['metadata_gaps']:
            section_id = gap['section_id']
            if section_id in seen:
                continue
            seen.add(section_id)
            number = next((n for n, section in enumerate(sections, 1) if section['section_id'] == section_id), None)
            key = f'section-{number}' if number is not None else 'synthesis' if section_id == 'synthesis' else None
            if key is None:
                raise ValueError('缺口不属于原始冻结计划；未调用模型')
            response = _read(root / '.lesson-results' / f'task-{task}' / f'{key}.json')
            if not response:
                raise ValueError(f'{section_id} 缺少原始响应；未调用模型')
            chunk = parse_manifest(response['response'].replace('\r\n', '\n').replace('\r', '\n')).body
            if not chunk.strip() or body.count(chunk) != 1:
                raise ValueError(f'{section_id} 的原始正文无法在当前文档唯一定位；未调用模型')
            unit = {'key': section_id, 'body': chunk,
                    'section': sections[number - 1] if number else None, 'frozen': frozen.plan_json}
            if number is None:
                # Chapters with their own gap are repaired and audited on their
                # own. The editor may fill only proven omissions elsewhere.
                owners = {c['ref']: c for c in existing['concepts']}
                unit['missing'] = [item for section in sections if section['section_id'] not in gap_ids
                    for item in section['items'] if not any(
                        row['kind'] in {'brief', 'explained'} and (
                            row.get('responsibility_id') == _responsibility_id(section['section_id'], item)
                            or (owners[row['concept_ref']].get('existing_id') == item.get('existing_id')
                                and (item.get('existing_id') is not None
                                     or owners[row['concept_ref']]['name'] == item['name'])
                                and row['aspect'] == item['aspect'] and row['dimension'] == item['dimension']))
                        for row in existing['coverage'])]
            result.append(unit)
        return result
    # Historical documents have no frozen ownership. Split without overlap,
    # keeping paragraph boundaries where possible and each source span exact.
    result, start = [], 0
    while start < len(body):
        end = min(start + 18000, len(body))
        if end < len(body):
            boundary = body.rfind('\n\n', start + 1000, end)
            if boundary >= 0:
                end = boundary + 2
        result.append({'key': f'part_{start}', 'body': body[start:end], 'section': None, 'frozen': None})
        start = end
    return result


def _messages(unit: dict, context: GenerationContext):
    from app.services.prompt_contracts import IMMUTABLE_SAFETY_RULES
    if unit['section']:
        slots = []
        nodes = {node['id']: node for node in context.snapshot['nodes']}
        for number, item in enumerate(unit['section']['items'], 1):
            if item.get('existing_id') and item['existing_id'] not in nodes:
                raise ValueError('冻结概念已不在当前知识树；请先核对身份，未调用模型')
            slots.append({'slot': f'r{number}', 'name': item['name'], 'aspect': item['aspect'],
                'dimension': item['dimension'], 'needs_definition': not bool(item.get('existing_id'))})
        contract = '''本任务仅提取给定章节已有的知识，不写或改写正文。只输出一个 JSON 对象：
{"repair_version":1,"concepts":[],"coverage":[{"slot":"r1","kind":"explained","core":true,"quote":"逐字复制原文"}],"terms":[{"concept_ref":"r1","text":"技术原词","quote":"包含原词的唯一原文"}]}。
coverage 只填给定 slot，不输出 UUID、aspect、dimension 或 responsibility_id，它们由软件绑定。
每个已实际讲解的 slot 提供 brief/explained；未讲到的不能伪造，缺项会如实报告。
已知 slot 的 concepts 定义由软件提供，不要回传。needs_definition=true 的 slot 必须在 concepts 中给出 {ref:slot,domain,scope,parent_ref,aliases}，其 name 由软件绑定；scope 为 global/project。
其他正文技术概念可放入 concepts，格式为 {ref,existing_id:null或树中编号,name,domain,scope,parent_ref,aliases}，terms 通过 concept_ref 引用。父引用只能引用本对象 concepts 或给定 slot，软件会补齐已有节点的祖先。
coverage 与 terms 独立；terms 应包含所给正文全部可标注技术概念，不因 coverage 已记录而省略。
只记录原文证实的内容，quote 必须能唯一定位，术语 text 在 quote 中只出现一次。不输出元数据缺口、熟悉度或父边变更。'''
        prompt = json.dumps({'slots': slots, 'document': unit['body']}, ensure_ascii=False)
    else:
        contract = '''本任务仅提取给定原文已有的知识，不输出正文、TEACHING 前缀或说明。只输出一个 JSON 对象：
{"schema_version":2,"concepts":[{"ref":"c1","existing_id":null,"name":"规范概念名","domain":"领域","scope":"global","parent_ref":null,"aliases":[]}],"coverage":[{"concept_ref":"c1","aspect":"实际范围","kind":"explained","dimension":"conceptual","core":true,"quote":"唯一原文"}],"terms":[{"concept_ref":"c1","text":"技术原词","quote":"包含原词的唯一原文"}],"placement_changes":[]}。
优先复用知识树编号和领域；新概念提供必要祖先，global 不能依赖 project 父节点。kind 为 planned/mentioned/brief/explained，dimension 为 conceptual/code_reading/implementation/debugging/transfer。
quote 逐字复制且唯一定位，术语原词在 quote 中只出现一次。完整记录所有可标注技术概念，不推断用户已理解，不提出父边变更。没有实际解释时 coverage 可为空，但有实际讲解时不能省略。'''
        prompt = json.dumps({'document': unit['body']}, ensure_ascii=False)
    return apply_generation_context([
        {'role': 'system', 'content': IMMUTABLE_SAFETY_RULES + '\n' + contract},
        {'role': 'user', 'content': prompt}], context)


def _decode(raw: str, unit: dict, context: GenerationContext):
    from app.services.generation_service import _repair_manifest_identity
    if len(raw.encode('utf-8')) > MAX_METADATA_BYTES:
        raise ValueError('清单超过解析资源限制')
    # Accept harmless transport formatting without requiring another request.
    text = raw.strip()
    if text.startswith('```') and text.endswith('```'):
        text = text.split('\n', 1)[1].rsplit('```', 1)[0].strip()
    if text.startswith('TEACHING:'):
        text = text.split(':', 1)[1].strip()
    if text.startswith('<!--'):
        value = parse_manifest(unit['body'] + '\n' + text).require_valid()
    else:
        value = json.loads(text)
    if not isinstance(value, dict):
        raise ValueError('清单必须为 JSON 对象')
    if value.get('metadata_gaps') or value.get('placement_changes'):
        raise ValueError('补录清单不能制造缺口或改变已有父边')
    if unit['section']:
        if value.get('repair_version') != 1 or any(not isinstance(value.get(k), list) for k in ('concepts', 'coverage', 'terms')):
            raise ValueError('章节补录必须返回 repair_version=1 和 concepts/coverage/terms 数组')
        items = {f'r{n}': item for n, item in enumerate(unit['section']['items'], 1)}
        if any(not isinstance(c, dict) for c in value['concepts']):
            raise ValueError('concepts 条目必须为对象')
        concepts = {c.get('ref'): deepcopy(c) for c in value['concepts']}
        if len(concepts) != len(value['concepts']):
            raise ValueError('concepts 引用重复')
        nodes = {n['id']: n for n in context.snapshot['nodes']}
        for slot, item in items.items():
            node = nodes.get(item.get('existing_id'))
            if node:
                concepts[slot] = {'ref': slot, 'existing_id': node['id'], 'name': node['name'],
                    'domain': node['domain'], 'scope': node['scope'], 'parent_ref': None, 'aliases': []}
            else:
                if slot not in concepts:
                    raise ValueError(f'{slot} 缺少新概念定义')
                concepts[slot].update(ref=slot, existing_id=None, name=item['name'])
        coverage = []
        for row in value['coverage']:
            if not isinstance(row, dict) or row.get('slot') not in items:
                raise ValueError('coverage 引用了本章之外的 slot')
            item = items[row['slot']]
            coverage.append({'concept_ref': row['slot'], 'aspect': item['aspect'], 'dimension': item['dimension'],
                'responsibility_id': _responsibility_id(unit['section']['section_id'], item),
                'kind': row.get('kind'), 'core': row.get('core'), 'quote': row.get('quote')})
        value = {'schema_version': 2, 'concepts': list(concepts.values()), 'coverage': coverage,
                 'terms': value['terms'], 'placement_changes': []}
    value = validate_manifest(value)
    value, _notes = _repair_manifest_identity(value, context)
    # Repair punctuation/unique spans deterministically; never silently drop a
    # bad coverage row and then declare a missing chapter's metadata complete.
    for field in ('coverage', 'terms'):
        for row in value[field]:
            quote = locate_quote(unit['body'], row['quote'], row.get('text') if field == 'terms' else None)
            if quote is None:
                raise ValueError(f'{field} quote 无法在本段原文唯一定位')
            row['quote'] = quote
    value = validate_manifest(value, unit['body'])
    if unit['section']:
        from app.services.personalization.teaching.lesson_responsibility import LessonResponsibilityMap
        frozen = LessonResponsibilityMap(unit['frozen'])
        missing = audit_section_manifest(frozen, unit['section']['section_id'], value,
            plan_version=frozen.version, tree_version=frozen.data['tree_version'])
        if missing:
            raise ValueError('原文未确认覆盖职责：' + '、'.join(item['name'] for item in missing))
    elif unit.get('frozen'):
        from app.services.personalization.teaching.lesson_responsibility import LessonResponsibilityMap
        audit_synthesis_manifest(LessonResponsibilityMap(unit['frozen']), value, unit.get('missing', []))
    return value


def extract(project: int, source_type: str, source_path: str, content: str,
            existing: dict | None, generation_id: str | None, context: GenerationContext,
            settings: dict, *, retry_invalid: bool = False, allow_requests: bool = True):
    from app.services import storage, llm_client
    body = parse_manifest(content).body
    key = _digest([source_type, source_path, _digest(content), CONTRACT_VERSION, settings['base_url'], settings['model']])
    directory = storage.GENERATED_ROOT / str(project) / '.teaching-backfills' / key
    plan_path = directory / 'job.json'
    job = _read(plan_path)
    if job:
        context = GenerationContext(**job['context'])
        units = job['units']
    else:
        units = _units(project, body, existing, generation_id)
        job = {'context': {name: getattr(context, name) for name in (
            'topology_json', 'state_json', 'requirements_json', 'learning_preferences_json')}, 'units': units}
    messages = [_messages(unit, context) for unit in units]
    # Preflight every request before spending anything on the first segment.
    for number, (unit, message) in enumerate(zip(units, messages), 1):
        cached = _read(directory / f'part-{number}.json')
        if cached:
            if not retry_invalid:
                continue  # either locally accepted or a local error; no request
            if cached.get('response') is not None:
                try:
                    _decode(cached['response'], unit, context)
                except (ValueError, TypeError, KeyError):
                    pass
                else:
                    continue
        if not allow_requests:
            raise RuntimeError('模型 API 未启用；缓存清单段已保留，未发起模型请求')
        llm_client.check_request_budget(message, OUTPUT_TOKENS, adjust_output=True,
            base_url=settings['base_url'], model=settings['model'])
    _save(plan_path, job)
    fragments = []
    if existing:
        baseline = deepcopy(existing)
        baseline.pop('metadata_gaps', None)
        fragments.append(('retained', baseline))
    for number, (unit, request) in enumerate(zip(units, messages), 1):
        from app.services import teaching_index
        if teaching_index._read_source(project, source_type, source_path) != content:
            raise ValueError('补录期间来源已更新；已停止后续请求，完成段仍保留')
        path = directory / f'part-{number}.json'
        cached = _read(path)
        if cached and cached.get('response') is not None:
            try:
                proposal = _decode(cached['response'], unit, context)
            except (ValueError, TypeError, KeyError) as exc:
                if not retry_invalid:
                    raise ValueError(f'第 {number} 段清单仍未通过本地校验，已保留响应且未再次调用模型；可仅重试失败段：{exc}') from exc
            else:
                fragments.append((unit['key'], proposal))
                continue
        elif cached and not retry_invalid:
            raise ValueError(f'第 {number} 段上次请求未完成；已暂停，只有“仅重试失败段”会重新请求')
        try:
            response = llm_client.call_openai_compatible_chat(settings['base_url'], settings['api_key'], settings['model'],
                request, timeout=180, reasoning_effort='disabled', response_format={'type': 'json_object'},
                max_tokens=OUTPUT_TOKENS, max_attempts=1)
        except Exception as exc:
            _save(path, {'error': str(exc)})
            raise
        _save(path, {'response': response})
        try:
            proposal = _decode(response, unit, context)
        except (ValueError, TypeError, KeyError) as exc:
            raise ValueError(f'第 {number} 段清单未通过校验，已保存响应；正文和此前通过的清单段均保留，可仅重试失败段：{exc}') from exc
        fragments.append((unit['key'], proposal))
    sources = {unit['key']: unit['body'] for unit in units}
    sources['retained'] = body
    result = merge_manifests(fragments, body, source_bodies=sources)
    result['placement_changes'] = []
    return result, context
