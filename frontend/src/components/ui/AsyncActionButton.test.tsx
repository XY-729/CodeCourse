import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AsyncActionButton from "./AsyncActionButton";
import TaskFeedback from "./TaskFeedback";
afterEach(cleanup);
it("acknowledges immediately, blocks duplicate clicks and confirms only success", async () => {
  let finish!: (value: boolean) => void;
  const action = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
  render(<AsyncActionButton action={action} successLabel="已保存">保存</AsyncActionButton>);
  const button = screen.getByRole("button");
  fireEvent.click(button); fireEvent.click(button);
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.textContent).toBe("保存中…");
  expect(action).toHaveBeenCalledOnce();
  await act(async () => finish(false));
  expect(button.textContent).toBe("保存");
  fireEvent.click(button);
  await act(async () => finish(true));
  expect(button.textContent).toBe("已保存");
});
it("renders rejection as an error and permits retry", async () => {
  const action = vi.fn().mockRejectedValueOnce(new Error("未保存")).mockResolvedValueOnce(true);
  render(<AsyncActionButton action={action} successLabel="已保存">保存</AsyncActionButton>);
  await act(async () => fireEvent.click(screen.getByRole("button")));
  expect(screen.getByRole("alert").textContent).toBe("未保存");
  expect(screen.queryByText("已保存")).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button")));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("已保存")).toBeTruthy();
});
it("does not render informational notices as success", () => {
  const view = render(<TaskFeedback toast="请等待当前操作完成" />);
  expect(view.container.querySelector(".success")).toBeNull();
  view.rerender(<TaskFeedback toast="已保存" toastKind="success" />);
  expect(view.container.querySelector(".success")?.textContent).toBe("已保存");
});
