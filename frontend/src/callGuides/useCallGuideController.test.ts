import { describe, expect, it } from "vitest";
import type { CallGuide } from "../api/client";
import { callGuideOpenItem, mergeCallGuide } from "./useCallGuideController";

function guide(id: number, title = `Guide ${id}`): CallGuide {
  return {
    id,
    project_id: 1,
    title,
    root: {
      symbol_name: "root",
      qualified_name: "root",
      path: "src/root.ts",
      start_line: 1,
      end_line: 2,
      signature: "root()",
    },
    nodes: [],
    edges: [],
    coverage: {
      status: "complete",
      reason: "",
      callers_complete: true,
      callees_complete: true,
      engine: "test",
    },
    indexed_fingerprint: "index",
    current_node_id: null,
    visited_node_ids: [],
    stale: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("call guide controller helpers", () => {
  it("moves an updated guide to the front without duplicates", () => {
    expect(mergeCallGuide([guide(1), guide(2)], guide(2, "Updated")).map((item) => item.title))
      .toEqual(["Updated", "Guide 1"]);
  });

  it("creates a hydrated workspace item", () => {
    expect(callGuideOpenItem(guide(7, "Call path"))).toMatchObject({
      id: "call-guide:7",
      type: "call_guide",
      path: "call-guide://7",
      title: "Call path",
      callGuideId: 7,
      hydrated: true,
    });
  });
});
