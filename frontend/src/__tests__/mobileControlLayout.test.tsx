import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Project, QARecord } from "../api/client";
import ExplainPanel from "../components/ExplainPanel";
import Sidebar from "../components/Sidebar";

const noop = vi.fn();

function renderAssistant(selectedRecord: QARecord | null = null) {
  return render(
    <ExplainPanel
      selection={null}
      contextSummary={null}
      contextFiles={[]}
      onOpenFilePicker={noop}
      onRemoveContextFile={noop}
      question=""
      loading={false}
      history={[]}
      historyQuery=""
      favoriteOnly={false}
      selectedRecord={selectedRecord}
      settings={null}
      panelError=""
      upperTab="history"
      onUpperTabChange={noop}
      onQuestionChange={noop}
      onSelectionTextChange={noop}
      onClearSelection={noop}
      onAsk={noop}
      onNewConversation={noop}
      onHistoryQueryChange={noop}
      onFavoriteOnlyChange={noop}
      onSelectRecord={noop}
      onOpenRecord={noop}
      onRenameRecord={noop}
      onToggleFavorite={noop}
      onOpenSettings={noop}
    />,
  );
}

describe("mobile controls", () => {
  it("does not show a redundant new-conversation button for an empty question", () => {
    const { getByText, queryByRole } = renderAssistant();

    expect(getByText("新问题")).toBeTruthy();
    expect(queryByRole("button", { name: "新对话" })).toBeNull();
  });

  it("uses an explicit new-question action instead of an ambiguous plus icon", () => {
    const record = {
      id: 1,
      question: "旧问题",
      answer_md: "回答",
    } as QARecord;
    const { getByRole } = renderAssistant(record);

    expect(getByRole("button", { name: "开始新问题" })).toBeTruthy();
  });

  it("groups project refresh and delete actions without placeholder columns", () => {
    const project = {
      id: 1,
      name: "CodeCourse",
      project_type: "repository",
      status: "ready",
      url: "https://example.test/codecourse",
    } as Project;
    const { container, getByRole } = render(
      <Sidebar
        view="projects"
        projects={[project]}
        currentProjectId={project.id}
        tree={null}
        courses={[]}
        selectedPath={null}
        selectedScopePaths={[]}
        selectedCourse={null}
        projectType="repository"
        fileSelectionMode={false}
        busyProjectId={null}
        onSelectProject={noop}
        onCreateLearningPlan={noop}
        onRegenerateProject={noop}
        onDeleteProject={noop}
        onSelectFile={noop}
        onOpenFile={noop}
        onSelectCourse={noop}
      />,
    );

    const actions = container.querySelector(".project-row-actions");
    expect(actions?.children).toHaveLength(2);
    expect(actions?.contains(getByRole("button", { name: "重新生成规则课程" }))).toBe(true);
    expect(actions?.contains(getByRole("button", { name: "删除项目" }))).toBe(true);
  });

  it("reserves independent 44px touch targets for project actions", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/apple-android-final.css"), "utf8");

    expect(css).toMatch(/\.project-row\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
    expect(css).toMatch(/\.project-row-actions \.icon-button\s*\{[\s\S]*flex:\s*0 0 44px/);
    expect(css).toMatch(/\.project-row,\s*\nhtml\.platform-android \.project-row-actions\s*\{[\s\S]*gap:\s*8px/);
  });

  it("shows only one create-document action in the empty course state", () => {
    const { getAllByRole } = render(
      <Sidebar
        embedded
        view="courses"
        projects={[]}
        currentProjectId={1}
        tree={null}
        courses={[]}
        selectedPath={null}
        selectedScopePaths={[]}
        selectedCourse={null}
        projectType="repository"
        fileSelectionMode={false}
        busyProjectId={null}
        onSelectProject={noop}
        onCreateLearningPlan={noop}
        onRegenerateProject={noop}
        onDeleteProject={noop}
        onSelectFile={noop}
        onOpenFile={noop}
        onSelectCourse={noop}
        onCreateCourse={noop}
      />,
    );

    expect(getAllByRole("button", { name: "新建文档" })).toHaveLength(1);
  });

  it("defines aligned Android search controls without native button appearance", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/apple-android-final.css"), "utf8");

    expect(css).toMatch(/\.command-palette-search input\s*\{[\s\S]*height:\s*44px/);
    expect(css).toMatch(/\.command-palette-close\s*\{[\s\S]*height:\s*44px[\s\S]*appearance:\s*none/);
  });
});
