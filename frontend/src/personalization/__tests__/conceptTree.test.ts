import { describe, expect, it } from "vitest";
import { buildConceptTree, filterConceptTree } from "../conceptTree";
import type { PersonalizationConcept } from "../../api/client";

function concept(id: string, name: string, parent_id: string | null, extra = {}): PersonalizationConcept {
  return { id, displayName: name, canonicalName: name, conceptKey: id, parent_id,
    domain: "cpp", conceptType: "theory", aliases: [], difficulty: 0.5, createdAt: "", ...extra };
}

describe("persisted concept folder tree", () => {
  it("uses the stored hierarchy and retains all descendants", () => {
    const roots = buildConceptTree([concept("v", "vector", "stl"), concept("cpp", "C++", null), concept("stl", "容器", "cpp")]);
    expect(roots).toHaveLength(1);
    expect(roots[0].descendantCount).toBe(2);
    expect(roots[0].children[0].children[0].id).toBe("v");
  });

  it("groups unclassified, missing-parent and cyclic records without inventing parents", () => {
    const roots = buildConceptTree([concept("v", "vector", null, { placement_status: "pending" }),
      concept("a", "A", "b"), concept("b", "B", "a"), concept("m", "Missing", "absent")]);
    expect(roots).toHaveLength(1);
    expect(roots[0].name).toBe("待归类");
    expect(roots[0].descendantCount).toBe(4);
  });

  it("isolates unreadable and archived records instead of rendering garbage", () => {
    const roots = buildConceptTree([concept("bad", "\ufffd\ufffd", null),
      concept("old", "old code fragment", null, { conceptType: "archived" }),
      concept("ok", "Git", null)]);
    expect(roots.map((node) => node.name)).toEqual(["Git"]);
  });

  it("searches aliases and includes the actual ancestor chain", () => {
    const roots = buildConceptTree([concept("cpp", "C++", null), concept("v", "动态数组", "cpp", { aliases: ["vector"] })]);
    expect(filterConceptTree(roots, "VECTOR")[0].children[0].name).toBe("动态数组");
    expect(filterConceptTree(roots, "no match")).toEqual([]);
  });
});
