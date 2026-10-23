/**
 * Android adapter over the shared cross-platform TeachingManifest v2 codec.
 * Parsing, structural validation and namespacing live in
 * shared/personalization so desktop and Android cannot drift apart.
 */
import {
  mergeTeachingManifests as mergeShared,
  parseTeachingManifest as parseShared,
  serializeTeachingManifest,
  teachingMarkers,
  type TeachingManifestV2,
} from "../../personalization/teachingManifest";

export type TeachingManifest = TeachingManifestV2;
export type TeachingManifestStatus = "complete" | "invalid" | "pending" | "legacy";
export type TeachingManifestResult = {
  status: TeachingManifestStatus;
  manifest?: TeachingManifestV2;
  error?: string;
  legacyItems?: Record<string, unknown>[];
};

export const TEACHING_MANIFEST_CONTRACT = `<teaching_manifest_contract>
range_catalog 给出已有范围的 aspect_id、规范 aspect 与同义名称。同概念、同维度且语义相同的 coverage 必须复用 aspect_id 与规范名；新应用范围不要强行合并。
正文先正常输出，结尾固定另起一行输出 TEACHING: {"schema_version":2,"concepts":[],"coverage":[],"terms":[],"placement_changes":[]}。这是同一次响应的完整知识清单，不另调模型提取；JSON 必须是单行，字符串中的换行转义。
concepts 每项为 {"ref":"本响应唯一引用","existing_id":null,"name":"规范名","domain":"领域","scope":"global","parent_ref":null,"aliases":[]}；scope 只用 global/project。已有概念必须复用完整树上下文提供的真实 existing_id，不能自造数据库 ID。
先语义匹配已有概念和最近的合理父概念；细粒度概念缺父或中间层时，同次补齐必要父/祖先链并连接已有合理祖先或真正领域根。parent_ref 只能引用同清单 concepts.ref，结构祖先可没有 coverage/terms，不能由此宣称用户已懂。已有有效父边不因普通生成改变；为已有无父节点补父/重挂时明确 placement_changes: [{"concept_ref":"子引用","from_parent_id":null,"to_parent_ref":"父引用","reason":"原因"}]，from_parent_id 使用上下文原父 ID。
coverage 每项为 {"concept_ref":"概念引用","aspect":"实际范围","kind":"explained","dimension":"conceptual","core":true,"quote":"正文逐字出现且唯一定位的原文"}。kind 只用 planned/mentioned/brief/explained；dimension 只用 conceptual/code_reading/implementation/debugging/transfer。总纲未来目标是 planned，实际讲解才是 brief/explained。
terms 是完整技术术语候选池，每项 {"concept_ref":"概念引用","text":"正文原词","quote":"包含原词且可唯一定位的原文上下文"}，不能按历史熟悉度先删术语，不设 12/20/24/30 等数量配额。代码块和已有链接不选；行内代码、标题、表格中的真实技术术语可以选。有效 v2 的 terms 是权威，不再输出 legacy TERMS。
不得输出用户熟悉度、能力权重、understood=true 或自报 source_type/source_path/content_hash/tree_version/generation_id；来源和版本由软件绑定。当前明确要求优先，历史生成不代表已学会，不沿父子关系传播理解状态。
</teaching_manifest_contract>`;

function stripMarkers(content: string): string {
  let body = content;
  for (const marker of [...teachingMarkers(content)].reverse()) {
    body = body.slice(0, marker.start) + body.slice(marker.end);
  }
  return body.replace(/\r\n?/g, "\n");
}

/** Visible text only: hidden metadata never contributes quotes, spans or hashes. */
export function visibleTeachingBody(content: string): string {
  return stripMarkers(content).trim();
}

function mapResult(raw: string): TeachingManifestResult {
  const parsed = parseShared(raw);
  if (parsed.status === "ready") return { status: "complete", manifest: parsed.manifest ?? undefined };
  if (parsed.status === "legacy") return { status: "legacy", legacyItems: parsed.legacy_items };
  if (parsed.status === "missing") return { status: "pending" };
  return { status: "invalid", error: parsed.errors.map(issue => issue.message).join("；") || "知识清单未通过校验" };
}

/** Parse a model response or a persisted document that ends with hidden metadata. */
export function parseTeachingManifest(content: string): TeachingManifestResult {
  return mapResult(content);
}

function canonicalComment(value: unknown): string {
  return `<!-- codecourse-teaching: ${serializeTeachingManifest(value as TeachingManifestV2)} -->`;
}

export function appendTeachingManifest(body: string, manifest: TeachingManifestV2): string {
  const clean = visibleTeachingBody(body);
  return `${clean}${clean ? "\n\n" : ""}${canonicalComment(manifest)}`;
}

/**
 * Persist a canonical single-line comment. Invalid metadata keeps an explicit
 * invalid state instead of silently falling back to the legacy array format.
 */
export function normalizeTeachingResponse(raw: string): string {
  const body = visibleTeachingBody(raw);
  const markers = teachingMarkers(raw);
  const result = mapResult(raw);
  if (result.status === "complete") return appendTeachingManifest(body, result.manifest!);
  if (result.status === "invalid") {
    const invalid = {
      schema_version: 2,
      metadata_status: "invalid",
      error: result.error,
      raw_metadata: markers.map(marker => marker.json),
    };
    return `${body}${body ? "\n\n" : ""}${canonicalComment(invalid)}`;
  }
  if (result.status === "legacy") {
    return `${body}${body ? "\n\n" : ""}${canonicalComment(result.legacyItems ?? [])}`;
  }
  return body;
}

export type ManifestTermInput = { concept_ref: string; text: string; quote: string; source: "manifest" };

/** Keep a body whose same-response metadata was rejected, with an explicit state. */
export function appendInvalidManifest(body: string, error: string): string {
  const clean = body.trim();
  return `${clean}${clean ? "\n\n" : ""}${canonicalComment({
    schema_version: 2,
    metadata_status: "invalid",
    error,
  })}`;
}

/**
 * Authoritative v2 term candidates. undefined means no v2 authority; an empty
 * list from invalid v2 deliberately blocks legacy TERMS instead of rescuing them.
 */
export function manifestTerms(content: string): ManifestTermInput[] | undefined {
  const result = mapResult(content);
  if (result.status === "pending" || result.status === "legacy") return undefined;
  if (result.status !== "complete") return [];
  return (result.manifest?.terms ?? []).map(term => ({
    concept_ref: term.concept_ref,
    text: term.text,
    quote: term.quote,
    source: "manifest" as const,
  }));
}

/** Section manifests share one namespace scheme so refs cannot collide. */
export function mergeTeachingManifests(parts: Array<{ namespace: string; manifest: TeachingManifestV2 }>): TeachingManifestV2 {
  return mergeShared(parts);
}

/** Latest v2 manifest in a document, used to rebuild passages without a model. */
export function teachingManifestOf(content: string): TeachingManifestV2 | null {
  return mapResult(content).manifest ?? null;
}
