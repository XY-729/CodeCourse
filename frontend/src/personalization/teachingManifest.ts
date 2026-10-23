import { stableSerialize, type TeachingCoverageKind, type TeachingDimension } from "./conceptForest";

export interface ManifestConcept {
  ref: string;
  existing_id: string | null;
  name: string;
  domain: string;
  scope: "global" | "project";
  parent_ref: string | null;
  aliases: string[];
}
export interface ManifestCoverage {
  aspect_id?: string;
  concept_ref: string;
  aspect: string;
  kind: TeachingCoverageKind;
  dimension: TeachingDimension;
  core: boolean;
  quote: string;
}
export interface ManifestTerm { concept_ref: string; text: string; quote: string }
export interface ManifestPlacementChange {
  concept_ref: string;
  from_parent_id: string | null;
  to_parent_ref: string;
  reason: string;
}
export interface TeachingManifestV2 {
  schema_version: 2;
  concepts: ManifestConcept[];
  coverage: ManifestCoverage[];
  terms: ManifestTerm[];
  placement_changes?: ManifestPlacementChange[];
}
export interface ManifestValidationIssue { code: string; path: string; message: string }
export interface TeachingManifestResult {
  status: "ready" | "legacy" | "missing" | "invalid";
  manifest: TeachingManifestV2 | null;
  legacy_items: Record<string, unknown>[];
  errors: ManifestValidationIssue[];
}
export interface TeachingManifestOptions {
  max_json_chars?: number;
  max_entries?: number;
  max_depth?: number;
  allowed_existing_ids?: ReadonlySet<string>;
  validate_quotes?: boolean;
}
const DEFAULT_LIMITS = { max_json_chars: 2_000_000, max_entries: 50_000, max_depth: 128 };
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const issue = (code: string, path: string, message: string): ManifestValidationIssue => ({ code, path, message });
const kinds = new Set(["planned", "mentioned", "brief", "explained"]);
const dimensions = new Set(["conceptual", "code_reading", "implementation", "debugging", "transfer"]);

export function serializeTeachingManifest(manifest: TeachingManifestV2): string {
  return stableSerialize({ ...manifest, placement_changes: manifest.placement_changes ?? [] })
    .replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

export function validateTeachingManifest(value: unknown, body?: string, options: TeachingManifestOptions = {}): TeachingManifestResult {
  const errors: ManifestValidationIssue[] = [];
  const bad = (path: string, message: string, code = "invalid_manifest") => errors.push(issue(code, path, message));
  if (!isObject(value) || value.schema_version !== 2 || !Array.isArray(value.concepts)
    || !Array.isArray(value.coverage) || !Array.isArray(value.terms)
    || (value.placement_changes !== undefined && !Array.isArray(value.placement_changes))) {
    return { status: "invalid", manifest: null, legacy_items: [], errors: [issue("invalid_manifest", "", "知识清单不符合 v2 结构")] };
  }
  const limit = options.max_entries ?? DEFAULT_LIMITS.max_entries;
  if (value.concepts.length + value.coverage.length + value.terms.length + (value.placement_changes?.length ?? 0) > limit) {
    return { status: "invalid", manifest: null, legacy_items: [], errors: [issue("resource_limit", "", "知识清单超出解析资源限制")] };
  }
  const concepts = new Map<string, Record<string, unknown>>();
  value.concepts.forEach((c, i) => {
    const path = `concepts[${i}]`;
    if (!isObject(c) || !isString(c.ref) || !isString(c.name) || !isString(c.domain)
      || !["global", "project"].includes(String(c.scope))
      || !(c.existing_id === null || isString(c.existing_id))
      || !(c.parent_ref === null || isString(c.parent_ref))
      || !Array.isArray(c.aliases) || !c.aliases.every(isString)) { bad(path, "概念字段不完整"); return; }
    if (concepts.has(c.ref)) bad(`${path}.ref`, "同一响应 ref 必须唯一");
    concepts.set(c.ref, c);
    if (options.allowed_existing_ids && c.existing_id && !options.allowed_existing_ids.has(c.existing_id as string)) bad(`${path}.existing_id`, "概念 ID 不在可访问快照中", "inaccessible_concept");
    if (["familiarity", "weight", "understood", "probability"].some((key) => key in c)) bad(path, "模型不能提供熟悉度或能力权重");
  });
  for (const [ref, c] of concepts) {
    if (c.parent_ref !== null) {
      const parent = concepts.get(String(c.parent_ref));
      if (!parent) bad(`concepts.${ref}.parent_ref`, "父 ref 不存在");
      if (parent?.scope === "project" && c.scope === "global") bad(`concepts.${ref}.parent_ref`, "全局节点不能依赖项目私有父节点");
    }
    const ancestors = new Set<string>([ref]);
    let parent = c.parent_ref;
    while (typeof parent === "string" && concepts.has(parent)) {
      if (ancestors.has(parent)) { bad(`concepts.${ref}.parent_ref`, "父子关系包含循环", "cyclic_parent"); break; }
      ancestors.add(parent);
      if (ancestors.size > (options.max_depth ?? DEFAULT_LIMITS.max_depth)) { bad(`concepts.${ref}.parent_ref`, "父链超出解析资源限制", "resource_limit"); break; }
      parent = concepts.get(parent)!.parent_ref;
    }
  }
  const validateQuote = (quote: string, path: string) => {
    if (body !== undefined && options.validate_quotes !== false && body.split(quote).length !== 2) bad(path, "引用必须在可见正文中逐字唯一定位", "invalid_quote");
  };
  value.coverage.forEach((c, i) => {
    const path = `coverage[${i}]`;
    if (!isObject(c) || !isString(c.concept_ref) || !concepts.has(c.concept_ref) || !isString(c.aspect)
      || !kinds.has(String(c.kind)) || !dimensions.has(String(c.dimension)) || typeof c.core !== "boolean"
      || typeof c.quote !== "string" || (["brief", "explained"].includes(String(c.kind)) && !isString(c.quote))) { bad(path, "覆盖范围字段或概念引用无效"); return; }
    if (c.quote) validateQuote(c.quote, `${path}.quote`);
  });
  value.terms.forEach((t, i) => {
    const path = `terms[${i}]`;
    if (!isObject(t) || !isString(t.concept_ref) || !concepts.has(t.concept_ref) || !isString(t.text)
      || !isString(t.quote) || !t.quote.includes(t.text)) { bad(path, "术语必须引用本清单概念并保留原词与上下文"); return; }
    validateQuote(t.quote, `${path}.quote`);
  });
  (value.placement_changes ?? []).forEach((p, i) => {
    const path = `placement_changes[${i}]`;
    if (!isObject(p) || !isString(p.concept_ref) || !concepts.get(p.concept_ref)?.existing_id
      || !(p.from_parent_id === null || isString(p.from_parent_id)) || !isString(p.to_parent_ref)
      || !concepts.has(p.to_parent_ref) || !isString(p.reason) || p.concept_ref === p.to_parent_ref) bad(path, "结构变更必须引用已存在节点和有效目标父节点");
  });
  return errors.length ? { status: "invalid", manifest: null, legacy_items: [], errors }
    : { status: "ready", manifest: value as unknown as TeachingManifestV2, legacy_items: [], errors: [] };
}

export interface TeachingMarker { json: string; start: number; end: number; persisted: boolean }
/** Reserved markers only count outside fenced code. Offsets refer to the original text. */
export function teachingMarkers(content: string): TeachingMarker[] {
  const markers: TeachingMarker[] = [];
  let fence: { char: string; length: number } | null = null;
  let offset = 0;
  for (const chunk of content.match(/[^\n]*(?:\n|$)/g) ?? []) {
    if (!chunk) continue;
    const line = chunk.replace(/\r?\n$/, "");
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.char && fenceMatch[1].length >= fence.length && !fenceMatch[2].trim()) fence = null;
    } else if (fenceMatch) fence = { char: fenceMatch[1][0], length: fenceMatch[1].length };
    else {
      const raw = line.match(/^ {0,3}TEACHING\s*:\s*(.*)$/i);
      if (raw) markers.push({ json: raw[1], start: offset, end: offset + line.length, persisted: false });
      else {
        const re = /<!--\s*codecourse-teaching:\s*([^\n]*?)\s*-->/g;
        for (const m of line.matchAll(re)) markers.push({ json: m[1], start: offset + m.index!, end: offset + m.index! + m[0].length, persisted: true });
        if (!line.match(re) && /<!--\s*codecourse-teaching:/i.test(line)) markers.push({ json: "", start: offset, end: offset + line.length, persisted: true });
      }
    }
    offset += chunk.length;
  }
  return markers;
}

export function parseTeachingManifest(content: string, options: TeachingManifestOptions = {}): TeachingManifestResult {
  const markers = teachingMarkers(content);
  if (!markers.length) return { status: "missing", manifest: null, legacy_items: [], errors: [] };
  let body = content;
  for (const marker of [...markers].reverse()) body = body.slice(0, marker.start) + body.slice(marker.end);
  const manifests: TeachingManifestV2[] = [];
  const legacy: Record<string, unknown>[] = [];
  const errors: ManifestValidationIssue[] = [];
  for (const marker of markers) {
    if (marker.json.length > (options.max_json_chars ?? DEFAULT_LIMITS.max_json_chars)) {
      errors.push(issue("resource_limit", "", "知识清单超出解析资源限制")); continue;
    }
    let value: unknown;
    try { value = JSON.parse(marker.json); }
    catch { errors.push(issue("invalid_json", "", "知识清单 JSON 损坏或未完成")); continue; }
    if (Array.isArray(value)) {
      if (value.length > (options.max_entries ?? DEFAULT_LIMITS.max_entries)) errors.push(issue("resource_limit", "", "旧知识清单超出解析资源限制"));
      else if (!value.every(isObject)) errors.push(issue("invalid_legacy", "", "旧知识清单数组项无效"));
      else legacy.push(...value);
    } else {
      const result = validateTeachingManifest(value, body, options);
      if (result.manifest) manifests.push(result.manifest);
      errors.push(...result.errors);
    }
  }
  // A malformed reserved TEACHING marker poisons the metadata, even beside a valid legacy array.
  if (errors.length) return { status: "invalid", manifest: null, legacy_items: [], errors };
  if (manifests.length) return { status: "ready", manifest: manifests.length === 1 ? manifests[0] : mergeTeachingManifests(manifests.map((manifest, i) => ({ namespace: `section_${i}`, manifest }))), legacy_items: [], errors: [] };
  return { status: "legacy", manifest: null, legacy_items: legacy, errors: [] };
}

export function namespaceTeachingManifest(manifest: TeachingManifestV2, namespace: string): TeachingManifestV2 {
  if (!namespace.trim()) throw new Error("章节命名空间不能为空");
  const ref = (value: string) => `${namespace}:${value}`;
  return { schema_version: 2,
    concepts: manifest.concepts.map((c) => ({ ...c, ref: ref(c.ref), parent_ref: c.parent_ref === null ? null : ref(c.parent_ref) })),
    coverage: manifest.coverage.map((c) => ({ ...c, concept_ref: ref(c.concept_ref) })),
    terms: manifest.terms.map((t) => ({ ...t, concept_ref: ref(t.concept_ref) })),
    placement_changes: (manifest.placement_changes ?? []).map((p) => ({ ...p, concept_ref: ref(p.concept_ref), to_parent_ref: ref(p.to_parent_ref) })),
  };
}
export function mergeTeachingManifests(sections: { namespace: string; manifest: TeachingManifestV2 }[]): TeachingManifestV2 {
  if (new Set(sections.map((s) => s.namespace)).size !== sections.length) throw new Error("章节命名空间必须唯一");
  const all = sections.map(({ namespace, manifest }) => namespaceTeachingManifest(manifest, namespace));
  return { schema_version: 2, concepts: all.flatMap((m) => m.concepts), coverage: all.flatMap((m) => m.coverage), terms: all.flatMap((m) => m.terms), placement_changes: all.flatMap((m) => m.placement_changes ?? []) };
}
