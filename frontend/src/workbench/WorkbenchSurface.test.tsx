import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import WorkbenchSurface from "./WorkbenchSurface";
import { createInitialLayout } from "./layout";

function props() {
  return {
    mobile: false,
    mobilePanelOpen: false,
    projectAvailable: false,
    projectError: "",
    layout: createInitialLayout(),
    navigationOpen: true,
    assistantOpen: true,
    navigationResizing: false,
    assistantResizing: false,
    sidebarWidth: 264,
    assistantWidth: 400,
    navigationContent: <nav>课程</nav>,
    assistantContent: <aside>历史</aside>,
    renderGroup: vi.fn(() => <div>document</div>),
    onCollapseSplit: vi.fn(),
    onStartSplitResize: vi.fn(),
    onStartNavigationResize: vi.fn(),
    onStartAssistantResize: vi.fn(),
    onRelocateProject: vi.fn(),
    onReturnToProjects: vi.fn(),
    onImportProject: vi.fn(),
    onCreateLearningPlan: vi.fn(),
  };
}

describe("WorkbenchSurface", () => {
  it("renders a quiet start state without mounting editor groups", () => {
    const value = props();
    const html = renderToStaticMarkup(<WorkbenchSurface {...value} />);
    expect(html).toContain("从一个项目开始学习");
    expect(value.renderGroup).not.toHaveBeenCalled();
  });

  it("keeps navigation and assistant as desktop grid siblings", () => {
    const value = props();
    value.projectAvailable = true;
    const html = renderToStaticMarkup(<WorkbenchSurface {...value} />);
    expect(html).toContain("课程");
    expect(html).toContain("历史");
    expect(html).toContain("document");
  });
});
