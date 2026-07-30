import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MobileTopBar from "./MobileTopBar";
import MobileBottomNavigation from "./MobileBottomNavigation";
import Sidebar from "./Sidebar";

describe("MobileTopBar", () => {
  it("shows the current project and opens projects", () => {
    const onToggleProjects = vi.fn();

    render(
      <MobileTopBar
        projectName="CodeCourse"
        projectSheetOpen={false}
        onToggleProjects={onToggleProjects}
        onSearch={() => undefined}
        onMore={() => undefined}
      />,
    );

    const button = screen.getByRole("button", {
      name: "切换项目，当前项目：CodeCourse",
    });

    expect(button.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(button);

    expect(onToggleProjects).toHaveBeenCalledTimes(1);
  });

  it("uses a clear empty-project label", () => {
    render(
      <MobileTopBar
        projectName={null}
        projectSheetOpen={false}
        onToggleProjects={() => undefined}
        onSearch={() => undefined}
        onMore={() => undefined}
      />,
    );

    expect(screen.getByText("选择项目")).toBeTruthy();
  });
});

describe("MobileBottomNavigation", () => {
  it("marks the current destination", () => {
    render(
      <MobileBottomNavigation
        active="source"
        onLearn={() => undefined}
        onSource={() => undefined}
        onAsk={() => undefined}
        onMe={() => undefined}
      />,
    );

    const sourceButton = screen.getByRole("button", { name: "源码" });

    expect(sourceButton.getAttribute("aria-current")).toBe("page");

    expect(
      screen.getByRole("button", { name: "学习" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("runs the selected action once", () => {
    const onAsk = vi.fn();

    render(
      <MobileBottomNavigation
        active="learn"
        onLearn={() => undefined}
        onSource={() => undefined}
        onAsk={onAsk}
        onMe={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "提问" }));

    expect(onAsk).toHaveBeenCalledTimes(1);
  });
});

describe("Sidebar embedded", () => {
  it("hides the nested project header when embedded", () => {
    const { container } = render(
      <Sidebar
        embedded
        view="projects"
        projects={[]}
        currentProjectId={null}
        tree={null}
        courses={[]}
        selectedPath={null}
        selectedScopePaths={[]}
        selectedCourse={null}
        projectType="repository"
        fileSelectionMode={false}
        busyProjectId={null}
        onSelectProject={() => undefined}
        onCreateLearningPlan={() => undefined}
        onRegenerateProject={() => undefined}
        onDeleteProject={() => undefined}
        onSelectFile={() => undefined}
        onOpenFile={() => undefined}
        onSelectCourse={() => undefined}
      />,
    );

    expect(
      container.querySelector(".navigation-panel-header"),
    ).toBeNull();
  });
});
