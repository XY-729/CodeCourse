import { fireEvent, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { QARecord } from "../../api/client";
import ExplainPanel from "./ExplainPanel";

function props(extra: Partial<ComponentProps<typeof ExplainPanel>> = {}): ComponentProps<typeof ExplainPanel> {
  const noop = vi.fn();
  return { selection: null, contextSummary: null, contextFiles: [], onOpenFilePicker: noop, onRemoveContextFile: noop,
    question: "", loading: false, history: [], historyQuery: "", favoriteOnly: false, selectedRecord: null,
    followUpRecord: null, settings: null, panelError: "", upperTab: "history", onUpperTabChange: noop,
    onQuestionChange: noop, onSelectionTextChange: noop, onClearSelection: noop, onAsk: noop, onNewConversation: noop,
    onHistoryQueryChange: noop, onFavoriteOnlyChange: noop, onSelectRecord: noop, onFollowUp: noop, onOpenRecord: noop,
    onRenameRecord: noop, onToggleFavorite: noop, onOpenSettings: noop, ...extra };
}
it("always offers a new-conversation action and identifies the exact follow-up", () => {
  const parent = { id: 4, project_id: 1, question: "Python return 怎样使用", display_title: "Python return" } as QARecord;
  const next = vi.fn();
  const { getByRole, getByText } = render(<ExplainPanel {...props({ followUpRecord: parent, onNewConversation: next })} />);
  expect(getByText("正在追问：Python return")).toBeTruthy();
  fireEvent.click(getByRole("button", { name: "新对话" }));
  expect(next).toHaveBeenCalledOnce();
});
it("offers stop during model generation but not during saving", () => {
  const stop = vi.fn();
  const { getByRole, queryByRole, rerender } = render(<ExplainPanel {...props({ loading: true, canStopAnswer: true, onStopAnswer: stop })} />);
  fireEvent.click(getByRole("button", { name: "停止回答" }));
  expect(stop).toHaveBeenCalledOnce();
  rerender(<ExplainPanel {...props({ loading: true, canStopAnswer: false, onStopAnswer: stop })} />);
  expect(queryByRole("button", { name: "停止回答" })).toBeNull();
});
