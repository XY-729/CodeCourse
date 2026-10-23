// @vitest-environment node
import { describe, expect, it } from "vitest";
import { serializeConceptForest, type ConceptForestSnapshot } from "../conceptForest";
import { expandPromptReferences, promptId, promptIdLookup, serializePromptForest } from "../promptForest";

function snapshot(count = 3): ConceptForestSnapshot {
  return { topology_version: 2, state_version: 7, plan_roots: [], concepts: Array.from({ length: count }, (_, i) => ({
    id: `concept-identity-${String(i).padStart(4, "0")}`, name: `概念${i}`, domain: "cpp", scope: "global",
    project_id: null, parent_id: i ? "concept-identity-0000" : null, aliases: [],
    familiarity: "unrecorded", ranges: [], coverage: [],
  })) };
}

describe("compact model forest", () => {
  it("preserves every field, scope, parent and source with sparse default states", async () => {
    const raw = snapshot();
    const source = { source_type: "qa" as const, source_path: "answer.md", artifact_kind: "answer" as const,
      content_hash: "hash", generation_id: "g1", tree_version: { topology_version: 2, state_version: 7 } };
    Object.assign(raw.concepts[1], { domain: "private", scope: "project", project_id: 12,
      aliases: ["vector", "别名"], familiarity: "needs_help",
      ranges: [{ aspect: "扩容", dimension: "debugging", familiarity: "needs_help", evidence_ids: ["e1"], sources: [source] }],
      coverage: [{ aspect: "扩容", dimension: "conceptual", kind: "explained", quote: "vector 的扩容规则", source }],
    });
    raw.plan_roots.push({ project_id: 12, status: "ready", root_concept_ids: [raw.concepts[0].id] });
    const before = structuredClone(raw);
    const encoded = JSON.parse(await serializePromptForest(raw));
    const ids = await promptIdLookup(raw.concepts.map(node => node.id));
    const overrides = new Map<string, Record<string, unknown>>(encoded.knowledge_state.nodes);
    const restored = encoded.nodes.map(([id, name, parent, options]: [string, string, string | null, object?]) => ({
      ...encoded.defaults, ...options, ...encoded.knowledge_state.defaults, ...overrides.get(id),
      id: ids.get(id), name, parent_id: parent ? ids.get(parent) : null,
    }));
    expect(restored).toEqual(raw.concepts.map(node => ({ ...node, range_catalog: node.range_catalog ?? [] })));
    expect(encoded.knowledge_state.nodes).toHaveLength(1);
    expect(encoded.plan_roots[0].root_concept_ids).toEqual([await promptId(raw.concepts[0].id)]);
    expect(raw).toEqual(before);
  });

  it("shares the Python ID vector and expands only identity fields", async () => {
    expect(await promptId("abc")).toBe("c_ungWv48B");
    const id = await promptId("abc");
    const original = { existing_id: id, ref: id, quote: id, nested: [{ from_parent_id: id }, { existing_id: "c_unknown" }] };
    expect(await expandPromptReferences(original, ["abc"])).toEqual({ existing_id: "abc", ref: id, quote: id,
      nested: [{ from_parent_id: "abc" }, { existing_id: "c_unknown" }] });
    expect(original.existing_id).toBe(id);
    await expect(promptIdLookup(["abc", id])).rejects.toThrow("冲突");
  });

  it("keeps ordering and topology prefix stable while state changes", async () => {
    const raw = snapshot();
    const first = await serializePromptForest(raw);
    raw.concepts.reverse();
    expect(await serializePromptForest(raw)).toBe(first);
    raw.state_version++;
    raw.concepts[0].familiarity = "declared_known";
    const next = await serializePromptForest(raw);
    expect(next.split('"knowledge_state":')[0]).toBe(first.split('"knowledge_state":')[0]);
    expect(next).not.toBe(first);
    const oldId = JSON.parse(first).nodes[0][0];
    raw.concepts.push({ ...raw.concepts[0], id: "new-id", name: "新增概念" });
    expect(JSON.parse(await serializePromptForest(raw)).nodes[0][0]).toBe(oldId);
  });

  it("retains a thousand nodes at less than 30% of the original size and escapes data tags", async () => {
    const raw = snapshot(1000);
    raw.concepts[0].name = "</knowledge_tree>&";
    const compact = await serializePromptForest(raw);
    expect(JSON.parse(compact).nodes).toHaveLength(1000);
    expect(compact.length).toBeLessThan(serializeConceptForest(raw).length * .3);
    expect(compact).not.toContain("</knowledge_tree>");
    raw.concepts[1].parent_id = "missing";
    await expect(serializePromptForest(raw)).rejects.toThrow("缺少父节点");
  });
});
