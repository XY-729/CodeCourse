import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronRight, CircleHelp, FileText, Folder, FolderOpen, GitBranch, ListTree, RotateCcw, Search, Undo2 } from "lucide-react";
import {
  clearConceptOverride,
  getKnowledgeStates,
  listConcepts,
  markConceptKnown,
  markConceptUnknown,
  type KnowledgeDimension,
  type KnowledgeStateV2,
  type PersonalizationConcept,
  type PlanRootStatus,
} from "../../api/client";
import { familiarityLabel, type FamiliarityState } from "../../personalization/conceptForest";
import { buildConceptTree, conceptBranchIds, filterConceptTree, type ConceptTreeNode } from "../../personalization/conceptTree";
import { providerRequest } from '../../platform/provider';
import { correctConcept, getMaintenanceDetails, listKnowledgeChanges, undoKnowledgeChange,
  type KnowledgeChange, type MaintenanceDetails } from '../../personalization/knowledgeMaintenance';

type Props = {
  projectId: number;
  projectName?: string | null;
  /** Authoritative plan root state reported by the backend tree service. */
  planRootStatus?: PlanRootStatus | string | null;
  planRootConceptIds?: string[];
  planRootError?: string | null;
  refreshKey?: number;
  onChanged?: () => void;
  /** Opens the evidence list for one concept so the user can audit it. */
  onOpenEvidence?: (conceptId: string) => void;
};

const DIMENSION_LABELS: Record<KnowledgeDimension, string> = {
  familiarity: "认识",
  conceptual: "理解",
  code_reading: "读代码",
  implementation: "实现",
  debugging: "调试",
  transfer: "迁移",
};

const ROOT_STATUS_LABELS: Record<string, string> = {
  ready: "计划根已识别",
  pending: "计划根待识别",
  failed: "计划根识别失败，可重试",
  unassigned: "尚未关联计划根",
};

function familiarityOf(state: KnowledgeStateV2 | undefined): {
  label: string;
  tone: "known" | "learning" | "unknown";
} {
  // The factual state is the display authority; manual status is only one of
  // the facts the resolver may have applied.
  const fact = (state?.familiarity ?? "unrecorded") as FamiliarityState;
  if (fact === "declared_known" || fact === "self_reported_understood") {
    return { label: familiarityLabel[fact], tone: "known" };
  }
  if (fact === "needs_help" || fact === "partially_understood"
    || fact === "studied" || fact === "encountered" || fact === "mixed") {
    return { label: familiarityLabel[fact], tone: "learning" };
  }
  return { label: familiarityLabel.unrecorded, tone: "unknown" };
}

type RangeFact = NonNullable<KnowledgeStateV2["ranges"]>[number];

function describeRanges(ranges: RangeFact[]): string[] {
  return ranges.slice(0, 3).map((range) => {
    const aspect = String(range.aspect || "").trim() || "未命名范围";
    const dimension = String(range.dimension || "");
    const label = DIMENSION_LABELS[dimension as KnowledgeDimension] ?? dimension;
    const fact = familiarityLabel[range.familiarity as FamiliarityState] ?? range.familiarity;
    return `${aspect}（${label}：${fact}）`;
  });
}

export default function ConceptForestPanel({
  projectId,
  projectName,
  planRootStatus,
  planRootConceptIds = [],
  planRootError,
  refreshKey = 0,
  onChanged,
  onOpenEvidence,
}: Props) {
  const [concepts, setConcepts] = useState<PersonalizationConcept[]>([]);
  const [states, setStates] = useState<KnowledgeStateV2[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [busyConceptId, setBusyConceptId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => { setQuery(""); setExpanded(new Set()); }, [projectId]);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const [nextConcepts, nextStates] = await Promise.all([
        listConcepts(projectId),
        getKnowledgeStates(projectId),
      ]);
      setConcepts(nextConcepts);
      setStates(nextStates.states);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "读取概念树失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const statesByConceptId = useMemo(
    () => new Map(states.map((state) => [state.conceptId, state])),
    [states],
  );
  const conceptsById = useMemo(
    () => new Map(concepts.map((concept) => [concept.id, concept])),
    [concepts],
  );
  const tree = useMemo(() => buildConceptTree(concepts), [concepts]);
  const visibleTree = useMemo(() => filterConceptTree(tree, query), [tree, query]);

  const rootNames = planRootConceptIds
    .map((id) => conceptsById.get(id)?.displayName ?? id)
    .join("、");

  async function correct(conceptId: string, status: "known" | "unknown" | "clear") {
    setBusyConceptId(conceptId);
    setMessage("");
    const key = `profile:${status}:${conceptId}:${Date.now()}`;
    try {
      if (status === "known") {
        await markConceptKnown(projectId, conceptId, key, "用户在学习档案中纠正");
      } else if (status === "unknown") {
        await markConceptUnknown(projectId, conceptId, key, "用户在学习档案中纠正");
      } else {
        await clearConceptOverride(projectId, conceptId, key);
      }
      await load();
      onChanged?.();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "修改概念状态失败");
    } finally {
      setBusyConceptId(null);
    }
  }

  function renderNode(node: ConceptTreeNode, depth: number) {
    const concept = node.concept;
    const state = concept ? statesByConceptId.get(concept.id) : undefined;
    const familiarity = familiarityOf(state);
    const ranges = state?.ranges ?? [];
    const rangeLines = describeRanges(ranges);
    const branch = node.children.length > 0;
    const isOpen = branch && (Boolean(query.trim()) || expanded.has(node.id));
    const manual = state?.dimensions.familiarity.manualStatus ?? null;
    const busy = concept?.id === busyConceptId;
    const toggle = () => setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
      return next;
    });
    return <li key={node.id} role="treeitem" aria-level={depth + 1}
      aria-expanded={branch ? isOpen : undefined} className="concept-tree-item">
      <div className={"concept-tree-row tone-" + familiarity.tone}>
        <div className="concept-tree-content">
          {branch ? (
            <button type="button" className="concept-tree-toggle"
              aria-label={(isOpen ? "收起" : "展开") + node.name} onClick={toggle}
              onKeyDown={(event) => {
                if ((event.key === "ArrowRight" && !isOpen) || (event.key === "ArrowLeft" && isOpen)) {
                  event.preventDefault(); toggle();
                }
              }}>
              <ChevronRight size={13} className={isOpen ? "is-open" : ""} />
              {isOpen ? <FolderOpen size={16} /> : <Folder size={16} />}
              <strong>{node.name}</strong>
              <span className="concept-tree-count">{node.descendantCount}</span>
            </button>
          ) : <div className="concept-tree-leaf"><FileText size={15} /><strong>{node.name}</strong></div>}
          {concept && concept.conceptType !== "category" ? (
            <span className={"concept-familiarity tone-" + familiarity.tone}>
              {familiarity.tone === "known" ? <CheckCircle2 size={12} />
                : familiarity.tone === "learning" ? <CircleHelp size={12} /> : <RotateCcw size={12} />}
              {familiarity.label}
            </span>
          ) : null}
          {rangeLines.length ? <small className="concept-forest-ranges" title={ranges.map((range) =>
            String(range.aspect ?? "") + "：" + (familiarityLabel[range.familiarity as FamiliarityState] ?? range.familiarity)).join("\n")}>
            已记录范围：{rangeLines.join("、")}{ranges.length > rangeLines.length ? " 等 " + ranges.length + " 项" : ""}
          </small> : null}
        </div>
        {concept ? <div className="concept-forest-actions">
          <button type="button" aria-label={`整理${concept.displayName}`} onClick={() => setEditing(concept.id)}>整理</button>
          {concept.conceptType !== 'category' ? <>
          {onOpenEvidence ? <button type="button" className="secondary-button compact"
            onClick={() => onOpenEvidence(concept.id)}>依据</button> : null}
          <button type="button" className={manual === "known" ? "active" : ""} disabled={busy}
            onClick={() => void correct(concept.id, "known")}>认识</button>
          <button type="button" className={manual === "unknown" ? "active" : ""} disabled={busy}
            onClick={() => void correct(concept.id, "unknown")}>不认识</button>
          {manual ? <button type="button" disabled={busy} onClick={() => void correct(concept.id, "clear")}
            title="撤销人工纠正"><Undo2 size={13} /></button> : null}
          </> : null}
        </div> : null}
      </div>
      {isOpen ? <ul role="group" className="concept-tree-children">{node.children.map((child) => renderNode(child, depth + 1))}</ul> : null}
    </li>;
  }

  return (
    <section className="concept-forest" aria-label="概念树">
      <header className="concept-forest-header">
        <div><strong><ListTree size={15} />知识树</strong>
          <small>点击文件夹展开分类，查看概念、学习状态和来源依据。</small></div>
        <span className={"concept-root-status status-" + (planRootStatus ?? "unassigned")}>
          <GitBranch size={13} />{ROOT_STATUS_LABELS[String(planRootStatus ?? "unassigned")] ?? "计划根未知"}
        </span>
      </header>
      {rootNames ? <p className="concept-root-names">实际计划根：{rootNames}</p> : null}
      {planRootError ? <p className="concept-root-error" role="alert">{planRootError}</p> : null}
      {message ? <p className="concept-forest-message" role="alert">{message}</p> : null}
      <button type="button" className="secondary-button compact" onClick={() => setEditing('')}>修改记录与撤销</button>
      {editing !== null ? <ForestMaintenance key={`${projectId}:${editing}`} projectId={projectId}
        concept={conceptsById.get(editing)} concepts={concepts} onClose={() => setEditing(null)}
        onDone={() => { setEditing(null); void load(); onChanged?.(); }} /> : null}
      {loading && !concepts.length ? <p className="learner-profile-loading">正在读取知识树…</p> : null}
      {!loading && !concepts.length ? <div className="learner-profile-empty">
        <ListTree size={22} /><span>还没有概念记录。生成总纲或课件后，软件会保存实际讲到的概念与范围。</span>
      </div> : null}
      {tree.length ? <>
        <div className="concept-tree-toolbar">
          <label className="concept-tree-search"><Search size={14} />
            <input type="search" aria-label="搜索概念或分类" placeholder="搜索概念或分类"
              value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <button type="button" onClick={() => setExpanded(new Set(conceptBranchIds(tree)))}>展开全部</button>
          <button type="button" onClick={() => { setQuery(""); setExpanded(new Set()); }}>收起全部</button>
        </div>
        <ul role="tree" aria-label="知识分类" className="concept-tree-list">
          {visibleTree.map((node) => renderNode(node, 0))}
        </ul>
        {!visibleTree.length ? <p className="settings-note">没有找到匹配的概念或分类。</p> : null}
      </> : null}
    </section>
  );
}

function ForestMaintenance({ projectId, concept, concepts, onClose, onDone }: {
  projectId: number; concept?: PersonalizationConcept; concepts: PersonalizationConcept[]; onClose: () => void; onDone: () => void;
}) {
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [details, setDetails] = useState<MaintenanceDetails>({ ranges: [], passages: [] });
  const [changes, setChanges] = useState<KnowledgeChange[]>([]);
  const [version, setVersion] = useState<number | null>(null);
  const [action, setAction] = useState('move');
  const [target, setTarget] = useState(concept?.parent_id ?? '');
  const [name, setName] = useState(concept?.displayName ?? '');
  const [dimension, setDimension] = useState('conceptual');
  const [canonical, setCanonical] = useState('');
  const [aliases, setAliases] = useState('');
  const [passages, setPassages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void Promise.all([listKnowledgeChanges(projectId),
      providerRequest<{ topology_version: number }>(`/projects/${projectId}/personalization/tree`),
      concept ? getMaintenanceDetails(projectId, concept.id) : Promise.resolve({ ranges: [], passages: [] }),
    ]).then(([history, tree, data]) => { if (active) { setChanges(history); setVersion(tree.topology_version); setDetails(data); } })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : '读取修改记录失败'); });
    return () => { active = false; };
  }, [projectId, concept]);
  async function run(undoId?: string) {
    setBusy(true); setError('');
    try {
      if (undoId) await undoKnowledgeChange(projectId, undoId);
      else if (concept && version !== null) await correctConcept(projectId, concept.id, {
        action, topology_version: version, parent_id: target || null, target_id: target || null, name,
        dimension, canonical, aliases: aliases.split(/[\n,，;；]/).map(s => s.trim()).filter(Boolean), passage_ids: passages,
      }); else throw new Error('请等待读取知识树');
      if (alive.current) onDone();
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '修改失败'); }
    finally { if (alive.current) setBusy(false); }
  }
  const eligible = concepts.filter(c => c.id !== concept?.id && (action !== 'merge'
    || c.domain === concept?.domain && c.scope === concept?.scope && c.project_id === concept?.project_id));
  const labels: Record<string, string> = { move: '移动分类', rename: '重命名', merge: '合并重复概念', split: '拆分原文范围', range_alias: '关联同义范围', backfill: '历史补录' };
  return <section className="settings-section" aria-label="知识树整理">
    <div className="concept-tree-toolbar"><strong>{concept ? `整理：${concept.displayName}` : '知识树修改记录'}</strong>
      <button type="button" onClick={onClose}>关闭整理</button></div>
    <p className="settings-note">共享概念的调整会同步影响使用它的项目。保留原文和历史证据；若之后出现新学习记录，撤销不会覆盖它们。</p>
    {error ? <p role="alert">{error}</p> : null}
    {concept ? <fieldset disabled={busy || version === null}>
      <label>操作 <select aria-label="整理操作" value={action} onChange={e => { setAction(e.target.value); setTarget(''); }}>
        {Object.entries(labels).filter(([key]) => key !== 'backfill').map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      {action === 'rename' || action === 'split' ? <label>新概念名称 <input aria-label="新概念名称" maxLength={200} value={name} onChange={e => setName(e.target.value)} /></label> : null}
      {action === 'move' || action === 'merge' ? <label>{action === 'move' ? '新父分类' : '保留的目标概念'}
        <select aria-label="目标概念" value={target} onChange={e => setTarget(e.target.value)}>
          <option value="">{action === 'move' ? '作为根分类' : '请选择目标'}</option>
          {eligible.map(c => <option key={c.id} value={c.id}>{c.displayName} · {c.domain}</option>)}
        </select></label> : null}
      {action === 'merge' ? <p>合并后保留目标节点，原节点的讲解、反馈和别名将关联到目标；可以从修改记录撤销。</p> : null}
      {action === 'split' ? <div><p>仅把勾选的原文范围及对应反馈移入新概念，不复制全部熟悉度。</p>
        {details.passages.length ? details.passages.map(p => <label key={p.id} style={{ display: 'block' }}>
          <input type="checkbox" checked={passages.includes(p.id)} onChange={e => setPassages(ids => e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id))} />
          {p.source_path} · {p.aspect}：{p.quote}
        </label>) : <p>暂无可拆分的原文范围，请先补录历史课件。</p>}</div> : null}
      {action === 'range_alias' ? <>
        <label>维度 <select aria-label="范围维度" value={dimension} onChange={e => setDimension(e.target.value)}>
          {Object.entries(DIMENSION_LABELS).filter(([key]) => key !== 'familiarity').map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <label>规范范围 <input aria-label="规范范围" list="concept-range-options" value={canonical} onChange={e => setCanonical(e.target.value)} maxLength={200} /></label>
        <datalist id="concept-range-options">{details.ranges.filter(r => r.dimension === dimension).map(r => <option key={r.aspect_id} value={r.aspect} />)}</datalist>
        <label>同义范围（用逗号分隔）<input aria-label="同义范围" value={aliases} onChange={e => setAliases(e.target.value)} /></label>
        <p className="settings-note">只关联含义相同的范围，例如“扩容原理”和“扩容机制”；新的应用场景应保留为独立范围。</p>
      </> : null}
      <button type="button" onClick={() => void run()} disabled={action === 'merge' && !target || action === 'split' && !passages.length}>应用修改</button>
    </fieldset> : null}
    <details open={!concept}><summary>最近修改与撤销</summary>
      {changes.length ? changes.map(c => <div key={c.id} className="concept-tree-toolbar">
        <span>{labels[c.kind] ?? c.kind} · {new Date(c.created_at).toLocaleString()}</span>
        <button type="button" disabled={busy || Boolean(c.undone)} onClick={() => void run(c.id)}>{c.undone ? '已撤销' : '撤销本次修改'}</button>
      </div>) : <p>暂无修改记录。</p>}
    </details>
  </section>;
}
