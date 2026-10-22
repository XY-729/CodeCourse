import { describe, expect, it } from "vitest";
import {
  FAMILIARITY_STATES,
  familiarityLabel,
  serializeConceptForest,
  stableSerialize,
  type ConceptForestSnapshot,
  type TeachingSourceVersion,
} from "../conceptForest";

const source: TeachingSourceVersion = {
  source_type: "course",
  source_path: "lessons/lesson-1.md",
  artifact_kind: "lesson",
  content_hash: "hash-1",
  generation_id: "gen-1",
  tree_version: { topology_version: 3, state_version: 5 },
};

function snapshot(): ConceptForestSnapshot {
  return {
    topology_version: 3,
    state_version: 5,
    concepts: [
      {
        id: "concept-vector", name: "std::vector", domain: "cpp", aliases: ["vector"],
        parent_id: "concept-stl", scope: "global", familiarity: "unrecorded", ranges: [], coverage: [],
      },
      {
        id: "concept-cpp", name: "C++", domain: "cpp", aliases: ["cpp"],
        parent_id: null, scope: "global", familiarity: "unrecorded", ranges: [], coverage: [],
      },
      {
        id: "concept-stl", name: "STL 容器", domain: "cpp", aliases: [],
        parent_id: "concept-cpp", scope: "global", familiarity: "unrecorded", ranges: [],
        coverage: [{
          aspect: "分类", dimension: "conceptual", kind: "planned",
          source,
        }],
      },
    ],
    plan_roots: [{ project_id: 7, root_concept_ids: ["concept-cpp"], status: "ready" }],
  };
}

describe("concept forest snapshot", () => {
  it("keeps stable ids and the parent chain across reloads", () => {
    const serialized = serializeConceptForest(snapshot());
    const parsed = JSON.parse(serialized) as { topology: Array<{ id: string; parent_id: string | null }> };
    const byId = new Map(parsed.topology.map((node) => [node.id, node]));
    expect(byId.get("concept-vector")?.parent_id).toBe("concept-stl");
    expect(byId.get("concept-stl")?.parent_id).toBe("concept-cpp");
    expect(byId.get("concept-cpp")?.parent_id).toBeNull();
  });

  it("serializes byte-identically for the same snapshot", () => {
    expect(serializeConceptForest(snapshot())).toBe(serializeConceptForest(snapshot()));
  });

  it("puts stable topology before dynamic state and adds no timestamps or activity order", () => {
    const serialized = serializeConceptForest(snapshot());
    expect(serialized.indexOf("topology")).toBeLessThan(serialized.indexOf("state_version"));
    expect(serialized).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(Object.keys(JSON.parse(serialized) as Record<string, unknown>)).toEqual([
      "topology", "topology_version", "plan_roots", "state_version", "states",
    ]);
    const parsed = JSON.parse(serialized) as { topology: Array<{ id: string }>; states: Array<{ id: string }> };
    expect(parsed.topology.map((node) => node.id)).toEqual([...parsed.topology.map((node) => node.id)].sort());
    expect(parsed.states.map((node) => node.id)).toEqual([...parsed.states.map((node) => node.id)].sort());
  });

  it("never derives familiarity from a parent or from coverage", () => {
    const value = snapshot();
    value.concepts[0].familiarity = "self_reported_understood";
    const parsed = JSON.parse(serializeConceptForest(value)) as {
      states: Array<{ id: string; familiarity: string }>;
    };
    const byId = new Map(parsed.states.map((state) => [state.id, state.familiarity]));
    // Understanding vector does not upgrade STL or C++.
    expect(byId.get("concept-vector")).toBe("self_reported_understood");
    expect(byId.get("concept-stl")).toBe("unrecorded");
    expect(byId.get("concept-cpp")).toBe("unrecorded");
  });

  it("labels states as facts, not as mastery percentages", () => {
    for (const state of FAMILIARITY_STATES) {
      expect(familiarityLabel[state]).not.toMatch(/\d/);
      expect(familiarityLabel[state]).not.toContain("掌握");
    }
    expect(familiarityLabel.self_reported_understood).toBe("已理解（自述）");
    expect(familiarityLabel.unrecorded).toBe("暂无学习记录");
  });

  it("stable serialization sorts object keys and drops undefined values", () => {
    expect(stableSerialize({ b: 1, a: { d: 2, c: [3, 1] }, skip: undefined })).toBe('{"a":{"c":[3,1],"d":2},"b":1}');
  });
});
