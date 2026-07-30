import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DiagnosticItem, LLMSettings, QARecord } from "../api/client";
import MobileAssistantPanel from "./MobileAssistantPanel";

const SETTINGS: LLMSettings = { provider: "openai", base_url: "", model: "test-model", enabled: true, has_api_key: true, masked_api_key: "***" };

const RECORD: QARecord = {
  id: 1, project_id: 1, session_id: 10, parent_qa_id: null, relation_type: "follow_up",
  source_type: "file", source_path: "src/App.tsx", display_title: "状态管理",
  selected_text: "", question: "状态如何管理？", answer_md: "这是一个测试回答。",
  provider: "openai", model: "test-model", output_path: "qa/1.md", favorite: false,
  created_at: "2026-07-30T00:00:00Z", updated_at: "2026-07-30T00:00:00Z",
};

function createProps() {
  return {
    view: "ask" as const, onViewChange: vi.fn(),
    selection: null,
    contextSummary: { label: "当前文件", sourceType: "file" as const, sourcePath: "src/App.tsx", preview: "当前正在阅读 App.tsx。" },
    question: "", loading: false, loadingLabel: "", streamContent: "",
    history: [RECORD], historyQuery: "", favoriteOnly: false,
    selectedRecord: null, selectedRecordReadOnly: false,
    surveyCandidate: null, diagnosticItem: null, diagnosticResult: null,
    settings: SETTINGS, panelError: "",
    knowledgeContent: <div>测试知识网络</div>, knowledgeDisabled: false,
    onQuestionChange: vi.fn(), onSelectionTextChange: vi.fn(), onClearSelection: vi.fn(),
    onAsk: vi.fn(), onNewConversation: vi.fn(),
    onHistoryQueryChange: vi.fn(), onFavoriteOnlyChange: vi.fn(),
    onSelectRecord: vi.fn(), onOpenRecord: vi.fn(), onDeleteRecord: vi.fn(),
    onRenameRecord: vi.fn(), onToggleFavorite: vi.fn(), onOpenSettings: vi.fn(),
    onAnswerSurvey: vi.fn(), onDismissSurvey: vi.fn(), onDisableSurveys: vi.fn(),
    onAnswerDiagnostic: vi.fn(), onDismissDiagnostic: vi.fn(), onFlagDiagnostic: vi.fn(),
  };
}

describe("MobileAssistantPanel", () => {
  it("shows ask context by default", () => {
    const props = createProps();
    render(<MobileAssistantPanel {...props} />);
    expect(screen.getByText("当前上下文")).toBeTruthy();
    expect(screen.getByText("src/App.tsx")).toBeTruthy();
  });

  it("updates question immediately", () => {
    const props = createProps();
    render(<MobileAssistantPanel {...props} />);
    fireEvent.change(screen.getByRole("textbox", { name: "输入问题" }), { target: { value: "立即提交的问题" } });
    expect(props.onQuestionChange).toHaveBeenCalledWith("立即提交的问题");
  });

  it("uses suggestion without delay", () => {
    const props = createProps();
    render(<MobileAssistantPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "这个文件的主要职责是什么？" }));
    expect(props.onQuestionChange).toHaveBeenCalledWith("这个文件的主要职责是什么？");
  });

  it("selects history and returns to ask", () => {
    const props = { ...createProps(), view: "history" as const };
    render(<MobileAssistantPanel {...props} />);
    fireEvent.click(screen.getByText("状态管理"));
    expect(props.onSelectRecord).toHaveBeenCalledWith(RECORD);
    expect(props.onViewChange).toHaveBeenCalledWith("ask");
  });

  it("keeps history actions independent", () => {
    const props = { ...createProps(), view: "history" as const };
    render(<MobileAssistantPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "收藏 状态管理" }));
    expect(props.onToggleFavorite).toHaveBeenCalledWith(RECORD);
    expect(props.onSelectRecord).not.toHaveBeenCalled();
  });

  it("renders knowledge without remount navigation", () => {
    const props = { ...createProps(), view: "knowledge" as const };
    render(<MobileAssistantPanel {...props} />);
    expect(screen.getByText("测试知识网络")).toBeTruthy();
  });

  it("disables asking for readonly record", () => {
    const props = { ...createProps(), question: "继续追问", selectedRecord: RECORD, selectedRecordReadOnly: true };
    render(<MobileAssistantPanel {...props} />);
    const btn = screen.getByRole("button", { name: "继续追问" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("shows model configuration when unavailable", () => {
    const props = { ...createProps(), settings: { ...SETTINGS, enabled: false, has_api_key: false } };
    render(<MobileAssistantPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "配置模型" }));
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("submits diagnostic answers", () => {
    const diagnostic: DiagnosticItem = {
      id: "diagnostic-1", projectId: 1, conceptIds: [], dimension: "conceptual",
      itemType: "single_choice", prompt: "哪个选项正确？",
      options: [{ value: "a", label: "选项 A" }, { value: "b", label: "选项 B" }],
      sourceRefs: [], rationale: "", difficulty: 0.5, createdAt: "2026-07-30T00:00:00Z",
    };
    const props = { ...createProps(), diagnosticItem: diagnostic };
    render(<MobileAssistantPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "选项 A" }));
    fireEvent.click(screen.getByRole("button", { name: "提交" }));
    expect(props.onAnswerDiagnostic).toHaveBeenCalledWith("a");
  });
});
