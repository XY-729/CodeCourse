import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CallGuide } from "../api/client";
import CallGuideViewer, { routeToRoot } from "./CallGuideViewer";

function guide(edges: CallGuide["edges"]): CallGuide {
  return {
    id: 1, project_id: 1, title: "run 调用链",
    root: { symbol_name: "run", path: "main.ts", start_line: 1, end_line: 2 },
    nodes: [
      { id: "root", symbol_name: "run", path: "main.ts", start_line: 1, end_line: 2, content: "", direction: "root", hop: 0 },
      { id: "direct", symbol_name: "start", path: "start.ts", start_line: 1, end_line: 2, content: "", direction: "caller", hop: 1 },
      { id: "second", symbol_name: "main", path: "entry.ts", start_line: 1, end_line: 2, content: "", direction: "caller", hop: 2 },
    ],
    edges,
    coverage: { status: "complete", callers_complete: true, callees_complete: true, engine: "test" },
    current_node_id: "root", visited_node_ids: [], stale: false, created_at: "", updated_at: "",
  };
}

describe("call guide route", () => {
  it("returns only a path made from verified graph edges", () => {
    const value = guide([
      { id: "a", source: "second", target: "direct", relation: "calls", verified: true },
      { id: "b", source: "direct", target: "root", relation: "calls", verified: true },
    ]);
    expect(routeToRoot(value, "second")).toEqual(["second", "direct", "root"]);
  });

  it("does not synthesize a route for disconnected nodes", () => {
    expect(routeToRoot(guide([]), "second")).toEqual([]);
  });

  it("only enables explanation for a current verified route", () => {
    const onExplain = vi.fn();
    const value = guide([
      { id: "a", source: "second", target: "direct", relation: "calls", verified: true },
      { id: "b", source: "direct", target: "root", relation: "calls", verified: true },
    ]);
    value.current_node_id = "second";
    render(
      <CallGuideViewer
        guide={value}
        onSelectNode={vi.fn()}
        onOpenSource={vi.fn()}
        onExplain={onExplain}
        onRefresh={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /讲解这条路径/ }));
    expect(onExplain).toHaveBeenCalledOnce();
    expect(onExplain).toHaveBeenCalledWith(
      expect.objectContaining({ id: "second" }),
      ["second", "direct", "root"],
    );
  });

  it.each([
    ["stale", true, guide([{ id: "a", source: "direct", target: "root", relation: "calls", verified: true }])],
    ["disconnected", false, guide([])],
  ])("blocks explanation for a %s guide", (_label, stale, value) => {
    value.stale = stale;
    value.current_node_id = "direct";
    render(
      <CallGuideViewer
        guide={value}
        onSelectNode={vi.fn()}
        onOpenSource={vi.fn()}
        onExplain={vi.fn()}
        onRefresh={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect((screen.getByRole("button", { name: /讲解这条路径/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
