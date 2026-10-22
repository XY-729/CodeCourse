import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleHelp, GitBranch, ListTree, RotateCcw, Undo2 } from "lucide-react";
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

type ForestRow = {
  concept: PersonalizationConcept;
  depth: number;
  /** Structural ancestor added only for grouping; never taught or understood. */
  structuralOnly: boolean;
};

const DIMENSION_LABELS: Record<KnowledgeDimension, string> = {
  familiarity: "认识",
  conceptual: "理解",
  code_reading: "读代码",
  implementation: "实现",
  debugging: "调试",
  transfer: "迁移",
};

const DIMENSIONS: KnowledgeDimension[] = [
  "familiarity",
  "conceptual",
  "code_reading",
  "implementation",
  "debugging",
  "transfer",
];

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
  if (!state) return { label: familiarityLabel.unrecorded, tone: "unknown" };
  const manual = state.dimensions.familiarity.manualStatus;
  // Only the user's own declaration is stated as a fact here. Evidence counts
  // are shown separately as researched ranges; they never become "已掌握".
  if (manual === "known") return { label: familiarityLabel.declared_known, tone: "known" };
  if (manual === "unknown") return { label: familiarityLabel.needs_help, tone: "learning" };
  return { label: "未确认理解", tone: "unknown" };
}

/** Authoritative forest order: parents first, siblings by name. Cycles never hang. */
function buildRows(concepts: PersonalizationConcept[]): { rows: ForestRow[]; orphaned: number } {
  const byId = new Map(concepts.map((concept) => [concept.id, concept]));
  const children = new Map<string, PersonalizationConcept[]>();
  let orphaned = 0;
  for (const concept of concepts) {
    const parent = concept.parent_id && byId.has(concept.parent_id) ? concept.parent_id : null;
    if (concept.parent_id && !parent) orphaned += 1;
    const key = parent ?? "";
    const list = children.get(key) ?? [];
    list.push(concept);
    children.set(key, list);
  }
  for (const list of children.values()) {
    list.sort((left, right) => left.displayName.localeCompare(right.displayName));
  }
  const rows: ForestRow[] = [];
  const visited = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const concept of children.get(parent ?? "") ?? []) {
      if (visited.has(concept.id)) continue;
      visited.add(concept.id);
      rows.push({ concept, depth, structuralOnly: false });
      walk(concept.id, depth + 1);
    }
  };
  walk(null, 0);
  // Anything left belongs to a cycle; list it as a root so it stays reachable.
  for (const concept of concepts) {
    if (!visited.has(concept.id)) {
      visited.add(concept.id);
      rows.push({ concept, depth: 0, structuralOnly: false });
      walk(concept.id, 1);
    }
  }
  return { rows, orphaned };
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
  const { rows, orphaned } = useMemo(() => buildRows(concepts), [concepts]);

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

  return (
    <section className="concept-forest" aria-label="概念树">
      <header className="concept-forest-header">
        <div>
          <strong><ListTree size={15} />概念树</strong>
          <small>
            {projectName ? `${projectName} · ` : ""}
            父子关系只表示归属，不代表掌握，也不沿层级传播状态。
          </small>
        </div>
        <span className={`concept-root-status status-${planRootStatus ?? "unassigned"}`}>
          <GitBranch size={13} />
          {ROOT_STATUS_LABELS[String(planRootStatus ?? "unassigned")] ?? "计划根未知"}
        </span>
      </header>

      {rootNames ? <p className="concept-root-names">实际计划根：{rootNames}</p> : null}
      {planRootError ? <p className="concept-root-error" role="alert">{planRootError}</p> : null}
      {message ? <p className="concept-forest-message" role="alert">{message}</p> : null}

      {loading && !concepts.length ? <p className="learner-profile-loading">正在读取概念树…</p> : null}

      {!loading && !concepts.length ? (
        <div className="learner-profile-empty">
          <ListTree size={22} />
          <span>还没有概念记录。生成总纲或课件后，软件会保存实际讲到的概念与范围。</span>
        </div>
      ) : null}

      {rows.length ? (
        <ul className="concept-forest-list">
          {rows.map(({ concept, depth }) => {
            const state = statesByConceptId.get(concept.id);
            const familiarity = familiarityOf(state);
            const ranges = DIMENSIONS.filter((dimension) => dimension !== "familiarity"
              && state
              && state.dimensions[dimension].status === "confirmed");
            const busy = busyConceptId === concept.id;
            const manual = state?.dimensions.familiarity.manualStatus ?? null;
            return (
              <li
                key={concept.id}
                className={`concept-forest-node tone-${familiarity.tone}`}
                style={{ paddingLeft: `${depth * 18}px` }}
              >
                <div className="concept-forest-main">
                  <div className="concept-forest-title">
                    {depth > 0 ? <span className="concept-forest-branch" aria-hidden="true">└</span> : null}
                    <strong>{concept.displayName}</strong>
                    <small>{concept.domain}{concept.scope === "project" ? " · 项目私有" : ""}</small>
                  </div>
                  <span className={`concept-familiarity tone-${familiarity.tone}`}>
                    {familiarity.tone === "known"
                      ? <CheckCircle2 size={12} />
                      : familiarity.tone === "learning"
                        ? <CircleHelp size={12} />
                        : <RotateCcw size={12} />}
                    {familiarity.label}
                  </span>
                  {ranges.length ? (
                    <small className="concept-forest-ranges">
                      有证据的范围：{ranges.map((dimension) => DIMENSION_LABELS[dimension]).join("、")}
                    </small>
                  ) : null}
                </div>
                <div className="concept-forest-actions">
                  {onOpenEvidence ? (
                    <button type="button" className="secondary-button compact" onClick={() => onOpenEvidence(concept.id)}>
                      依据
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={manual === "known" ? "active" : ""}
                    disabled={busy}
                    onClick={() => void correct(concept.id, "known")}
                  >认识</button>
                  <button
                    type="button"
                    className={manual === "unknown" ? "active" : ""}
                    disabled={busy}
                    onClick={() => void correct(concept.id, "unknown")}
                  >不认识</button>
                  {manual ? (
                    <button type="button" disabled={busy} onClick={() => void correct(concept.id, "clear")} title="撤销人工纠正">
                      <Undo2 size={13} />
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {orphaned > 0 ? (
        <p className="settings-note">
          有 {orphaned} 个概念暂未关联到可访问的父概念，已按顶层显示；下次生成时会尝试补齐归属。
        </p>
      ) : null}
    </section>
  );
}
