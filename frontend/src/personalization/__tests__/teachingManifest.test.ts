import { describe, expect, it } from "vitest";
import {
  mergeTeachingManifests,
  namespaceTeachingManifest,
  parseTeachingManifest,
  serializeTeachingManifest,
  teachingMarkers,
  validateTeachingManifest,
  type TeachingManifestV2,
} from "../teachingManifest";

const body = "vector 在连续内存中保存元素，扩容时重新分配。std::sort 对随机访问迭代器排序。";

function manifest(overrides: Partial<TeachingManifestV2> = {}): TeachingManifestV2 {
  return {
    schema_version: 2,
    concepts: [
      { ref: "cpp", existing_id: "concept-cpp", name: "C++", domain: "cpp", scope: "global", parent_ref: null, aliases: ["cpp"] },
      { ref: "stl", existing_id: null, name: "STL 容器", domain: "cpp", scope: "global", parent_ref: "cpp", aliases: [] },
      { ref: "vector", existing_id: null, name: "std::vector", domain: "cpp", scope: "global", parent_ref: "stl", aliases: ["vector"] },
    ],
    coverage: [{
      concept_ref: "vector", aspect: "连续存储与扩容", kind: "explained",
      dimension: "conceptual", core: true, quote: "vector 在连续内存中保存元素，扩容时重新分配。",
    }],
    terms: [{ concept_ref: "vector", text: "vector", quote: "vector 在连续内存中保存元素" }],
    ...overrides,
  };
}

function marker(value: unknown): string {
  return `<!-- codecourse-teaching: ${JSON.stringify(value)} -->`;
}

describe("TeachingManifest v2", () => {
  it("accepts the shared sample and keeps the auto-added ancestor chain", () => {
    const result = validateTeachingManifest(manifest(), body, { allowed_existing_ids: new Set(["concept-cpp"]) });
    expect(result.status).toBe("ready");
    expect(result.manifest?.concepts.map((concept) => concept.parent_ref)).toEqual([null, "cpp", "stl"]);
    expect(result.errors).toEqual([]);
  });

  it("rejects a parent that is neither in the batch nor in the snapshot", () => {
    const broken = manifest();
    broken.concepts[2] = { ...broken.concepts[2], parent_ref: "missing" };
    const result = validateTeachingManifest(broken, body, { allowed_existing_ids: new Set(["concept-cpp"]) });
    expect(result.status).toBe("invalid");
    expect(result.errors[0].code).toBe("invalid_manifest");
  });

  it("rejects cycles, private parents for global nodes and unknown existing ids", () => {
    const cycle = manifest({
      concepts: [
        { ref: "a", existing_id: null, name: "A", domain: "d", scope: "global", parent_ref: "b", aliases: [] },
        { ref: "b", existing_id: null, name: "B", domain: "d", scope: "global", parent_ref: "a", aliases: [] },
      ],
    });
    expect(validateTeachingManifest(cycle, body).errors.some((issue) => issue.code === "cyclic_parent")).toBe(true);

    const privateParent = manifest({
      concepts: [
        { ref: "p", existing_id: null, name: "P", domain: "d", scope: "project", parent_ref: null, aliases: [] },
        { ref: "g", existing_id: null, name: "G", domain: "d", scope: "global", parent_ref: "p", aliases: [] },
      ],
    });
    expect(validateTeachingManifest(privateParent, body).status).toBe("invalid");

    const inaccessible = validateTeachingManifest(manifest(), body, { allowed_existing_ids: new Set() });
    expect(inaccessible.errors.some((issue) => issue.code === "inaccessible_concept")).toBe(true);
  });

  it("requires explained coverage to quote the visible body exactly once", () => {
    const missing = manifest({
      coverage: [{ concept_ref: "vector", aspect: "扩容", kind: "explained", dimension: "conceptual", core: true, quote: "正文里没有这句话" }],
    });
    expect(validateTeachingManifest(missing, body).errors.some((issue) => issue.code === "invalid_quote")).toBe(true);

    const duplicated = manifest({
      coverage: [{ concept_ref: "vector", aspect: "扩容", kind: "explained", dimension: "conceptual", core: true, quote: "vector" }],
    });
    expect(validateTeachingManifest(duplicated, `${body} vector`).status).toBe("invalid");
  });

  it("refuses model-supplied familiarity or weights", () => {
    const withScore = manifest();
    (withScore.concepts[0] as unknown as Record<string, unknown>).familiarity = "self_reported_understood";
    const result = validateTeachingManifest(withScore, body);
    expect(result.status).toBe("invalid");
    expect(result.errors[0].message).toContain("熟悉度");
  });

  it("only accepts placement changes for existing nodes", () => {
    const placement = manifest({
      placement_changes: [{ concept_ref: "vector", from_parent_id: null, to_parent_ref: "stl", reason: "补父" }],
    });
    // vector has no existing_id yet, so it cannot be reparented in this response.
    expect(validateTeachingManifest(placement, body, { allowed_existing_ids: new Set(["concept-cpp"]) }).status).toBe("invalid");

    const existing = manifest({
      concepts: [
        { ref: "cpp", existing_id: "concept-cpp", name: "C++", domain: "cpp", scope: "global", parent_ref: null, aliases: [] },
        { ref: "stl", existing_id: "concept-stl", name: "STL", domain: "cpp", scope: "global", parent_ref: "cpp", aliases: [] },
      ],
      coverage: [],
      terms: [],
      placement_changes: [{ concept_ref: "stl", from_parent_id: null, to_parent_ref: "cpp", reason: "补父" }],
    });
    expect(validateTeachingManifest(existing, body, { allowed_existing_ids: new Set(["concept-cpp", "concept-stl"]) }).status).toBe("ready");
  });

  it("parses a v2 tail marker written after streamed Markdown", () => {
    const raw = `${body}\nTEACHING: ${JSON.stringify(manifest())}`;
    const parsed = parseTeachingManifest(raw);
    expect(parsed.status).toBe("ready");
    expect(parsed.manifest?.terms).toHaveLength(1);
  });

  it("keeps legacy arrays readable but never mixes them into v2", () => {
    const legacy = parseTeachingManifest(`${body}\nTEACHING: [{"concept":"vector","quote":"vector"}]\n`);
    expect(legacy.status).toBe("legacy");
    expect(legacy.legacy_items).toHaveLength(1);

    const mixed = parseTeachingManifest(`${body}\nTEACHING: [{"concept":"x"}]\n${marker(manifest())}`);
    expect(mixed.status).toBe("ready");
    expect(mixed.legacy_items).toEqual([]);
  });

  it("marks damaged v2 invalid instead of silently falling back", () => {
    expect(parseTeachingManifest(`${body}\nTEACHING: {"schema_version":2,"concepts":`).status).toBe("invalid");
    expect(parseTeachingManifest(`${body}\n${marker({ schema_version: 2, concepts: [] })}`).status).toBe("invalid");
    expect(parseTeachingManifest(`${body}\n${marker(manifest())}`).status).toBe("ready");
  });

  it("ignores markers inside fenced code and records their offsets", () => {
    const raw = ["正文", "```text", `TEACHING: ${JSON.stringify(manifest())}`, "```", body].join("\n");
    expect(teachingMarkers(raw).filter((marker) => !marker.json.length)).toEqual([]);
    expect(parseTeachingManifest(raw).status).toBe("missing");
  });

  it("namespace-merges concurrent lesson sections without clobbering refs", () => {
    const first = manifest();
    const second = manifest({
      concepts: [{ ref: "cpp", existing_id: null, name: "C++", domain: "cpp", scope: "global", parent_ref: null, aliases: [] }],
      coverage: [],
      terms: [],
    });
    const namespaced = namespaceTeachingManifest(first, "lesson-1");
    expect(namespaced.concepts[2].ref).toBe("lesson-1:vector");
    expect(namespaced.concepts[2].parent_ref).toBe("lesson-1:stl");

    const merged = mergeTeachingManifests([
      { namespace: "lesson-1", manifest: first },
      { namespace: "lesson-2", manifest: second },
    ]);
    expect(merged.concepts.map((concept) => concept.ref)).toContain("lesson-1:vector");
    expect(merged.concepts.map((concept) => concept.ref)).toContain("lesson-2:cpp");
    expect(merged.terms).toHaveLength(1);
    expect(() => mergeTeachingManifests([
      { namespace: "same", manifest: first },
      { namespace: "same", manifest: second },
    ])).toThrow("章节命名空间必须唯一");
  });

  it("serializes deterministically and escapes comment terminators", () => {
    const left = serializeTeachingManifest(manifest({ terms: [{ concept_ref: "vector", text: "a>b", quote: "a>b" }] }));
    const right = serializeTeachingManifest(manifest({ terms: [{ concept_ref: "vector", text: "a>b", quote: "a>b" }] }));
    expect(left).toBe(right);
    expect(left).not.toContain("-->");
    expect(left).toContain("\\u003e");
  });
});
