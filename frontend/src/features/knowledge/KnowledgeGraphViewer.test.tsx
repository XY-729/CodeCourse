import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Core } from "cytoscape";
import type { KnowledgeGraph, KnowledgeNode } from "../../api/client";
import { createKnowledgeEdge, getKnowledgeGraph, updateKnowledgeNode } from "../../api/client";
import KnowledgeGraphViewer from "./KnowledgeGraphViewer";

const cytoscapeState = vi.hoisted(() => ({ core: null as Core | null }));

vi.mock("cytoscape", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const createCore = (actual.default ?? actual) as (options: Record<string, unknown>) => Core;
  return {
    ...actual,
    default: (options: Record<string, unknown>) => {
      const core = createCore({ ...options, container: undefined, headless: true, styleEnabled: false });
      vi.spyOn(core, "width").mockReturnValue(900);
      vi.spyOn(core, "height").mockReturnValue(680);
      vi.spyOn(core, "animate").mockImplementation(((properties: { zoom?: number; pan?: { x: number; y: number } }) => {
        if (typeof properties.zoom === "number") core.zoom(properties.zoom);
        if (properties.pan) core.pan(properties.pan);
        return core;
      }) as typeof core.animate);
      cytoscapeState.core = core;
      return core;
    },
  };
});

// Keep real Cytoscape events and graph updates. The simulation has separate
// convergence and dragging tests, so no physics timer is needed in UI tests.
vi.mock("./knowledgeGraphSimulation", () => ({
  createKnowledgeGraphSimulation: vi.fn(() => ({
    update: vi.fn(), setForces: vi.fn(), pin: vi.fn(), release: vi.fn(),
    reheat: vi.fn(), stop: vi.fn(), destroy: vi.fn(),
  })),
}));

vi.mock("../../api/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../api/client")>(),
  getKnowledgeGraph: vi.fn(), createKnowledgeEdge: vi.fn(),
  deleteKnowledgeEdge: vi.fn(), deleteKnowledgeNode: vi.fn(), updateKnowledgeNode: vi.fn(),
}));

class ResizeObserverStub {
  observe() {}
  disconnect() {}
  unobserve() {}
}

function makeGraph(projectId = 1, offset = 0): KnowledgeGraph {
  const definitions: Partial<KnowledgeNode>[] = [
    { title: "节点一课件", node_type: "course", ref_type: "course", ref_path: "lessons/one.md" },
    { title: "节点二", node_type: "concept" },
    { title: "节点三回答", node_type: "qa", ref_type: "qa", ref_id: 31 },
    { title: "孤立节点", node_type: "manual" },
    { title: "节点五", node_type: "concept" },
  ];
  return {
    nodes: definitions.map((definition, index) => ({
      id: index + 1 + offset, project_id: projectId, node_type: "concept", title: "",
      ref_type: null, ref_id: null, ref_path: null, summary: null,
      x: index * 80, y: index * 60, created_at: "2026-10-29T00:00:00Z", updated_at: "",
      ...definition,
    })),
    edges: [[1, 2], [2, 3], [2, 5]].map(([source, target], index) => ({
      id: index + 1 + offset, project_id: projectId,
      source_node_id: source + offset, target_node_id: target + offset,
      relation_type: "related_to", label: null, created_at: "", updated_at: "",
    })),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function labels() {
  return [...document.querySelectorAll<HTMLDivElement>(".knowledge-node-label")];
}

function viewerProps(projectId = 1) {
  return { projectId, onOpenQA: vi.fn(), onOpenCourse: vi.fn(), onOpenFile: vi.fn() };
}

async function loaded(nodeId = 1) {
  await waitFor(() => expect(cytoscapeState.core?.getElementById("n" + nodeId).length).toBe(1));
  return cytoscapeState.core!;
}

function contextNode(cy: Core, nodeId: number) {
  act(() => {
    cy.getElementById("n" + nodeId).emit({
      type: "cxttap", renderedPosition: { x: 120, y: 80 },
      originalEvent: new MouseEvent("contextmenu"),
    } as never);
  });
}

describe("KnowledgeGraphViewer native graph interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getKnowledgeGraph).mockReset().mockResolvedValue(makeGraph());
    vi.mocked(createKnowledgeEdge).mockReset().mockResolvedValue(makeGraph().edges[0]);
    vi.mocked(updateKnowledgeNode).mockReset();
    window.localStorage.clear();
    document.documentElement.dataset.theme = "light";
    cytoscapeState.core = null;
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      queueMicrotask(() => callback(performance.now()));
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("opens linked content on a single click without hiding or rearranging the global graph", async () => {
    const props = viewerProps();
    render(<KnowledgeGraphViewer {...props} />);
    const cy = await loaded();
    const before = cy.nodes().map((node) => ({ id: node.id(), ...node.position() }));

    act(() => { cy.getElementById("n1").emit("tap"); });
    expect(props.onOpenCourse).toHaveBeenCalledExactlyOnceWith("lessons/one.md");
    expect(cy.nodes().map((node) => ({ id: node.id(), ...node.position() }))).toEqual(before);
    expect(cy.nodes().filter((node) => node.hasClass("graph-hidden"))).toHaveLength(0);
    expect(screen.queryByLabelText("局部知识网络")).toBeNull();

    act(() => { cy.getElementById("n3").emit("tap"); });
    expect(props.onOpenQA).toHaveBeenCalledExactlyOnceWith(31);
  });

  it("uses the right-clicked node for local view, restores labels, and uses +/- to zoom", async () => {
    render(<KnowledgeGraphViewer {...viewerProps()} focusRef={{ ref_type: "course", ref_path: "lessons/one.md" }} />);
    const cy = await loaded();
    contextNode(cy, 3);
    fireEvent.click(screen.getByRole("menuitem", { name: "查看局部关系图" }));

    await waitFor(() => {
      expect(cy.getElementById("n3").hasClass("focus-root")).toBe(true);
      expect(cy.getElementById("n1").hasClass("graph-hidden")).toBe(true);
      expect(labels().find((label) => label.textContent === "节点一课件")?.dataset.visible).toBe("false");
    });
    fireEvent.click(screen.getByRole("button", { name: "全览" }));
    await waitFor(() => {
      expect(cy.nodes().filter((node) => node.hasClass("graph-hidden"))).toHaveLength(0);
      expect(labels()).toHaveLength(5);
      expect(labels().every((label) => label.dataset.visible === "true")).toBe(true);
    });

    const viewer = screen.getByLabelText("知识网络");
    const zoomBefore = cy.zoom();
    fireEvent.keyDown(viewer, { key: "+" });
    expect(cy.zoom()).toBeGreaterThan(zoomBefore);
    const zoomAfter = cy.zoom();
    fireEvent.keyDown(viewer, { key: "-" });
    expect(cy.zoom()).toBeLessThan(zoomAfter);
    expect(screen.queryByLabelText("局部知识网络")).toBeNull();
  });

  it("filters search and orphans without changing the original connection-count colors", async () => {
    render(<KnowledgeGraphViewer {...viewerProps()} />);
    const cy = await loaded();
    // Three complete-graph connections keep node 2 purple even when its
    // neighbors are filtered out.
    expect(cy.getElementById("n2").data("color")).toBe("#8b5cf6");
    fireEvent.click(screen.getByRole("button", { name: "打开图谱设置" }));
    fireEvent.change(screen.getByRole("textbox", { name: "筛选节点" }), { target: { value: "节点二" } });
    await waitFor(() => {
      expect(cy.nodes().filter((node) => !node.hasClass("graph-hidden"))).toHaveLength(1);
      expect(cy.getElementById("n2").hasClass("graph-hidden")).toBe(false);
    });
    expect(cy.getElementById("n2").data("color")).toBe("#8b5cf6");

    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    fireEvent.click(screen.getByRole("switch", { name: "显示孤立节点" }));
    await waitFor(() => {
      expect(cy.getElementById("n4").hasClass("graph-hidden")).toBe(true);
      expect(cy.nodes().filter((node) => !node.hasClass("graph-hidden"))).toHaveLength(4);
    });
    expect(cy.getElementById("n2").data("color")).toBe("#8b5cf6");
  });

  it("ignores an earlier project's response after a newer project has loaded", async () => {
    const oldResponse = deferred<KnowledgeGraph>();
    vi.mocked(getKnowledgeGraph).mockImplementation((project) => project === 1 ? oldResponse.promise : Promise.resolve(makeGraph(2, 100)));
    const view = render(<KnowledgeGraphViewer {...viewerProps()} />);
    await waitFor(() => expect(getKnowledgeGraph).toHaveBeenCalledWith(1));
    view.rerender(<KnowledgeGraphViewer {...viewerProps(2)} />);
    const cy = await loaded(101);
    await act(async () => { oldResponse.resolve(makeGraph()); await oldResponse.promise; });
    expect(cytoscapeState.core).toBe(cy);
    expect(cy.getElementById("n101")).toHaveLength(1);
    expect(cy.getElementById("n1")).toHaveLength(0);
  });

  it("does not rename the previous project or invalidate a new load after an old prompt resolves", async () => {
    const renamePrompt = deferred<string | null>();
    const newResponse = deferred<KnowledgeGraph>();
    const requestText = vi.fn().mockReturnValue(renamePrompt.promise);
    const props = { ...viewerProps(), onRequestText: requestText };
    const view = render(<KnowledgeGraphViewer {...props} />);
    const cy = await loaded();
    contextNode(cy, 1);
    fireEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
    expect(requestText).toHaveBeenCalledOnce();
    vi.mocked(getKnowledgeGraph).mockImplementation((project) => project === 2 ? newResponse.promise : Promise.resolve(makeGraph()));
    view.rerender(<KnowledgeGraphViewer {...props} projectId={2} />);
    await waitFor(() => expect(getKnowledgeGraph).toHaveBeenCalledWith(2));

    await act(async () => { renamePrompt.resolve("不应写入旧项目"); await renamePrompt.promise; });
    expect(updateKnowledgeNode).not.toHaveBeenCalled();
    await act(async () => { newResponse.resolve(makeGraph(2, 100)); await newResponse.promise; });
    await loaded(101);
    expect(cytoscapeState.core!.getElementById("n1")).toHaveLength(0);
  });

  it("preserves the explains relation when linking from a node's context menu", async () => {
    render(<KnowledgeGraphViewer {...viewerProps()} />);
    const cy = await loaded();
    contextNode(cy, 1);
    fireEvent.click(screen.getByRole("menuitem", { name: "开始连线" }));
    act(() => { cy.getElementById("n3").emit("tap"); });
    await waitFor(() => expect(createKnowledgeEdge).toHaveBeenCalledWith(1, {
      source_node_id: 1, target_node_id: 3, relation_type: "explains", label: "解释",
    }));
  });
});
