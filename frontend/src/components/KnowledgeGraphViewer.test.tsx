import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Core } from "cytoscape";
import KnowledgeGraphViewer from "./KnowledgeGraphViewer";

const cytoscapeState = vi.hoisted(() => ({ core: null as Core | null }));

vi.mock("cytoscape", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const createCore = (actual.default ?? actual) as (options: Record<string, unknown>) => Core;
  return {
    ...actual,
    default: (options: Record<string, unknown>) => {
      const core = createCore({
        ...options,
        container: undefined,
        headless: true,
        styleEnabled: false,
      });
      cytoscapeState.core = core;
      return core;
    },
  };
});

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    getKnowledgeGraph: vi.fn().mockResolvedValue({
      nodes: [1, 2, 3].map((id) => ({
        id,
        project_id: 1,
        node_type: "concept",
        title: `节点 ${id}`,
        ref_type: null,
        ref_id: null,
        ref_path: null,
        summary: null,
        x: id * 80,
        y: id * 60,
        created_at: "",
        updated_at: "",
      })),
      edges: [
        { id: 1, project_id: 1, source_node_id: 1, target_node_id: 2, relation_type: "related_to", label: null, created_at: "", updated_at: "" },
        { id: 2, project_id: 1, source_node_id: 2, target_node_id: 3, relation_type: "related_to", label: null, created_at: "", updated_at: "" },
      ],
    }),
    createKnowledgeEdge: vi.fn(),
    deleteKnowledgeEdge: vi.fn(),
    deleteKnowledgeNode: vi.fn(),
    updateKnowledgeNode: vi.fn(),
  };
});

class ResizeObserverStub {
  observe() {}
  disconnect() {}
  unobserve() {}
}

function labels() {
  return [...document.querySelectorAll<HTMLDivElement>(".knowledge-node-label")];
}

function expectAllLabelsVisible() {
  expect(labels()).toHaveLength(3);
  expect(labels().every((label) => label.dataset.visible === "true")).toBe(true);
}

describe("KnowledgeGraphViewer overview recovery", () => {
  beforeEach(() => {
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
  });

  it("restores every title through overview, repeated overview, blank-canvas tap, and a stuck gesture", async () => {
    const view = render(
      <KnowledgeGraphViewer
        projectId={1}
        onOpenQA={vi.fn()}
        onOpenCourse={vi.fn()}
        onOpenFile={vi.fn()}
      />,
    );

    await waitFor(expectAllLabelsVisible);
    const cy = cytoscapeState.core!;

    act(() => {
      cy.getElementById("n1").emit("tap");
    });
    await waitFor(() => {
      expect(labels().find((label) => label.textContent === "节点 3")?.dataset.visible).toBe("false");
    });

    act(() => {
      cy.emit({ type: "pan", originalEvent: new Event("pointermove") } as never);
    });
    fireEvent.click(screen.getByRole("button", { name: "全览" }));
    await waitFor(expectAllLabelsVisible);

    fireEvent.click(screen.getByRole("button", { name: "全览" }));
    await waitFor(expectAllLabelsVisible);

    act(() => {
      cy.getElementById("n3").emit("tap");
    });
    await waitFor(() => {
      expect(labels().find((label) => label.textContent === "节点 1")?.dataset.visible).toBe("false");
    });
    act(() => {
      cy.emit("tap");
    });
    await waitFor(expectAllLabelsVisible);

    act(() => {
      cy.getElementById("n1").emit("mouseover");
    });
    await waitFor(expectAllLabelsVisible);
    view.rerender(
      <KnowledgeGraphViewer
        projectId={2}
        onOpenQA={vi.fn()}
        onOpenCourse={vi.fn()}
        onOpenFile={vi.fn()}
      />,
    );
    await waitFor(expectAllLabelsVisible);
  });
});
