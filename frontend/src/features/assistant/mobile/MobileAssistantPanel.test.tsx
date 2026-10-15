import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagnosticItem, LLMSettings, QARecord } from "../../../api/client";
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
    contextFiles: [], onOpenFilePicker: vi.fn(), onRemoveContextFile: vi.fn(),
    question: "", loading: false, loadingLabel: "", streamContent: "",
    history: [RECORD], historyQuery: "", favoriteOnly: false,
    selectedRecord: null, followUpRecord: null, selectedRecordReadOnly: false,
    surveyCandidate: null, diagnosticItem: null, diagnosticResult: null,
    settings: SETTINGS, panelError: "",
    knowledgeContent: <div>测试知识网络</div>, knowledgeDisabled: false,
    onQuestionChange: vi.fn(), onSelectionTextChange: vi.fn(), onClearSelection: vi.fn(),
    onAsk: vi.fn(), onNewConversation: vi.fn(),
    onHistoryQueryChange: vi.fn(), onFavoriteOnlyChange: vi.fn(),
    onSelectRecord: vi.fn(), onFollowUp: vi.fn(), onOpenRecord: vi.fn(), onDeleteRecord: vi.fn(),
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
    expect(screen.getByText(/默认仅发送问题、选区/)).toBeTruthy();
  });

  it("updates question immediately in the local draft", () => {
    const props = createProps();
    render(<MobileAssistantPanel {...props} />);
    const textbox = screen.getByRole("textbox", { name: "输入问题" }) as HTMLTextAreaElement;
    expect(textbox.placeholder).toBe("请输入问题");
    fireEvent.change(textbox, { target: { value: "立即提交的问题" } });
    expect(textbox.value).toBe("立即提交的问题");
    // The send action is enabled straight away from the local draft (typing
    // must not re-render the whole app).
    expect((screen.getByRole("button", { name: "询问" }) as HTMLButtonElement).disabled).toBe(false);
    // The draft is lifted to the parent on blur.
    fireEvent.blur(textbox);
    expect(props.onQuestionChange).toHaveBeenCalledWith("立即提交的问题");
  });

  it("uses suggestion without delay", () => {
    const props = createProps();
    render(<MobileAssistantPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "这个文件的主要职责是什么？" }));
    expect(props.onQuestionChange).toHaveBeenCalledWith("这个文件的主要职责是什么？");
    expect((screen.getByRole("textbox", { name: "输入问题" }) as HTMLTextAreaElement).value).toBe("这个文件的主要职责是什么？");
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

  it("expands matching history so search results and favorite actions are visible", () => {
    const { container } = render(<MobileAssistantPanel {...createProps()} view="history" historyQuery="状态" />);
    expect(container.querySelector("details")?.open).toBe(true);
  });

  it("shows loading and retryable errors in history instead of claiming it is empty", () => {
    const props = { ...createProps(), view: "history" as const, history: [], onRetryHistory: vi.fn() };
    const { rerender } = render(<MobileAssistantPanel {...props} historyLoading />);
    expect(screen.getByRole("status").textContent).toContain("正在加载历史记录");
    expect(screen.queryByText("还没有提问记录")).toBeNull();
    rerender(<MobileAssistantPanel {...props} historyError="读取记录失败" />);
    expect(screen.getByRole("alert").textContent).toContain("读取记录失败");
    expect(screen.queryByText("还没有提问记录")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试加载历史" }));
    expect(props.onRetryHistory).toHaveBeenCalledOnce();
  });

  it("preserves both topics from one session when filtering and restoring history", () => {
    const second = { ...RECORD, id: 2, display_title: "异步顺序" };
    const threads = [RECORD, second].map(record => ({ sessionId: 10, topic: record.display_title!, progressSummary: "", unresolvedPoints: [], turnCount: 1, latestQaRecordId: record.id, isCurrent: false, updatedAt: record.updated_at, records: [record.id] }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const props = { ...createProps(), view: "history" as const, threads, historyQuery: "状态" };
      const { container, rerender } = render(<MobileAssistantPanel {...props} history={[RECORD, second]} />);
      rerender(<MobileAssistantPanel {...props} history={[second]} />);
      rerender(<MobileAssistantPanel {...props} history={[RECORD, second]} />);
      expect(container.querySelectorAll("details")).toHaveLength(2);
      expect(screen.getByRole("button", { name: "打开 状态管理" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "打开 异步顺序" })).toBeTruthy();
      expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/same key/);
    } finally { consoleError.mockRestore(); }
  });

  it("starts follow-up only from the explicit history action", () => {
    const props = { ...createProps(), view: "history" as const };
    render(<MobileAssistantPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "追问 状态管理" }));
    expect(props.onFollowUp).toHaveBeenCalledWith(RECORD);
    expect(props.onViewChange).toHaveBeenCalledWith("ask");
    expect(props.onSelectRecord).not.toHaveBeenCalled();
  });

  it("renders knowledge without remount navigation", () => {
    const props = { ...createProps(), view: "knowledge" as const };
    render(<MobileAssistantPanel {...props} />);
    expect(screen.getByText("测试知识网络")).toBeTruthy();
  });

  it("allows a new independent question while viewing a readonly record", () => {
    const props = { ...createProps(), question: "继续追问", selectedRecord: RECORD, selectedRecordReadOnly: true };
    render(<MobileAssistantPanel {...props} />);
    const btn = screen.getByRole("button", { name: "询问" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
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

  it("locks session-changing actions while loading", () => {
    const props = { ...createProps(), loading: true, selectedRecord: RECORD, followUpRecord: RECORD };
    render(<MobileAssistantPanel {...props} />);
    expect((screen.getByRole("tab", { name: "历史" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("tab", { name: "知识" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "新对话" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables history actions while loading", () => {
    const props = { ...createProps(), view: "history" as const, loading: true };
    render(<MobileAssistantPanel {...props} />);
    expect((screen.getByRole("button", { name: "收藏 状态管理" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "打开 状态管理" }) as HTMLButtonElement).disabled).toBe(true);
    expect(props.onSelectRecord).not.toHaveBeenCalled();
  });
});

afterEach(() => vi.unstubAllGlobals());

it("renders streamed Markdown, labels the active request, and stops it", () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const onStopAnswer = vi.fn();
  render(<MobileAssistantPanel {...createProps()} loading streamContent="**正在解释** `return`" conversationLabel="本次为新对话" canStopAnswer onStopAnswer={onStopAnswer} />);
  expect(screen.getByText("正在解释").tagName).toBe("STRONG");
  expect(screen.getByText("return").tagName).toBe("CODE");
  expect(screen.getByText("本次为新对话")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "停止回答" }));
  expect(onStopAnswer).toHaveBeenCalledTimes(1);
});

it("toggles document context and returns the answer to its original source", () => {
  const onIncludeContextChange = vi.fn(), onReturnToSource = vi.fn();
  render(<MobileAssistantPanel {...createProps()} includeContext onIncludeContextChange={onIncludeContextChange} selectedRecord={RECORD} onReturnToSource={onReturnToSource} />);
  fireEvent.click(screen.getByRole("checkbox", { name: /附带上下文/ }));
  expect(onIncludeContextChange).toHaveBeenCalledWith(false);
  fireEvent.click(screen.getByRole("button", { name: "回到原文" }));
  expect(onReturnToSource).toHaveBeenCalledWith(RECORD);
});
