import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import OutlineQuestionnaireDialog from "../components/OutlineQuestionnaireDialog";
import type { OutlinePreflight } from "../api/client";

const samplePreflight: OutlinePreflight = {
  preflight_id: "pf:1:abc123",
  questions: [
    {
      question: "你对本领域前置知识的了解程度？",
      question_type: "single_choice",
      dimension: "prerequisite_level",
      options: [
        { value: "none", label: "完全没了解" },
        { value: "some", label: "了解一点" },
        { value: "familiar", label: "较熟悉" },
      ],
    },
    {
      question: "想学到什么程度？",
      question_type: "multi_choice",
      dimension: "learning_depth",
      options: [
        { value: "basic", label: "了解即可" },
        { value: "deep", label: "深入掌握" },
      ],
    },
    {
      question: "你的学习目标是什么？",
      question_type: "text",
      dimension: "learning_goal",
      options: [],
    },
  ],
};

const singlePreflight: OutlinePreflight = {
  preflight_id: "pf:1:single",
  questions: [
    {
      question: "你今天想学点什么？",
      question_type: "single_choice",
      dimension: "topic",
      options: [
        { value: "a", label: "选项 A" },
        { value: "b", label: "选项 B" },
      ],
    },
  ],
};

function renderDialog(preflight: OutlinePreflight, onAnswers = vi.fn()) {
  render(
    <OutlineQuestionnaireDialog
      preflight={preflight}
      loading={false}
      error=""
      onAnswers={onAnswers}
      onClose={vi.fn()}
    />,
  );
  return onAnswers;
}

function nextQuestion() {
  fireEvent.click(screen.getByText("下一步"));
}

function backQuestion() {
  fireEvent.click(screen.getByText("上一步"));
}

function submitOutline() {
  fireEvent.click(screen.getByText("生成总纲"));
}

function typeAnswer(value: string) {
  fireEvent.change(screen.getByPlaceholderText("输入你的回答..."), {
    target: { value },
  });
}

describe("OutlineQuestionnaireDialog", () => {
  it("renders one question at a time, navigates, resolves answers on submit", () => {
    const onAnswers = renderDialog(samplePreflight);

    expect(screen.getByText("生成总纲前问卷")).toBeTruthy();
    expect(screen.getByText(/前置知识的了解程度/)).toBeTruthy();
    expect(screen.queryByText(/想学到什么程度/)).toBeNull();

    fireEvent.click(screen.getByText("完全没了解"));
    nextQuestion();

    expect(screen.getByText(/想学到什么程度/)).toBeTruthy();
    expect(screen.queryByText(/前置知识的了解程度/)).toBeNull();

    fireEvent.click(screen.getByText("深入掌握"));
    nextQuestion();

    expect(screen.getByPlaceholderText("输入你的回答...")).toBeTruthy();
    typeAnswer("  想上手写项目  ");
    expect(screen.getByText("第 3 / 3 题")).toBeTruthy();
    submitOutline();

    expect(onAnswers).toHaveBeenCalledTimes(1);
    const answers = onAnswers.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(answers).toHaveLength(3);
    expect(answers[0]).toMatchObject({
      dimension: "prerequisite_level",
      selected: "none",
    });
    expect(answers[1]).toMatchObject({
      dimension: "learning_depth",
      selected: ["deep"],
    });
    expect(answers[2]).toMatchObject({
      dimension: "learning_goal",
      selected: "想上手写项目",
    });
  });

  it("single choice keeps only latest selection", () => {
    const onAnswers = renderDialog(samplePreflight);

    fireEvent.click(screen.getByText("完全没了解"));
    fireEvent.click(screen.getByText("较熟悉"));
    nextQuestion();
    fireEvent.click(screen.getByText("深入掌握"));
    nextQuestion();
    typeAnswer("go");
    submitOutline();

    const answers = onAnswers.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(answers[0]).toMatchObject({ selected: "familiar" });
  });

  it("next stays disabled until the current question is answered", () => {
    renderDialog(samplePreflight);

    const firstNext = screen.getByText("下一步") as HTMLButtonElement;
    expect(firstNext.disabled).toBe(true);
    fireEvent.click(screen.getByText("完全没了解"));
    expect(firstNext.disabled).toBe(false);
    nextQuestion();

    const secondNext = screen.getByText("下一步") as HTMLButtonElement;
    expect(secondNext.disabled).toBe(true);
    fireEvent.click(screen.getByText("了解即可"));
    expect(secondNext.disabled).toBe(false);
    nextQuestion();

    const submit = screen.getByText("生成总纲") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    typeAnswer("ok");
    expect(submit.disabled).toBe(false);
  });

  it("skip resolves null", () => {
    const onAnswers = renderDialog(samplePreflight);

    fireEvent.click(screen.getByText("跳过，直接生成"));
    expect(onAnswers).toHaveBeenCalledWith(null);
  });

  it("back preserves earlier selections", () => {
    const onAnswers = renderDialog(samplePreflight);

    fireEvent.click(screen.getByText("完全没了解"));
    nextQuestion();
    fireEvent.click(screen.getByText("深入掌握"));
    backQuestion();

    expect(screen.getByText(/前置知识的了解程度/)).toBeTruthy();
    expect(screen.getByText("完全没了解").closest("button")?.className).toContain("selected");

    nextQuestion();
    expect(screen.getByText("深入掌握").closest("button")?.className).toContain("selected");
    nextQuestion();
    typeAnswer("goal");
    submitOutline();

    expect(onAnswers).toHaveBeenCalledTimes(1);
    const answers = onAnswers.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(answers[0]).toMatchObject({ selected: "none" });
    expect(answers[1]).toMatchObject({ selected: ["deep"] });
  });

  it("progress shows current position", () => {
    renderDialog(samplePreflight);

    expect(screen.getByText("第 1 / 3 题")).toBeTruthy();
    fireEvent.click(screen.getByText("完全没了解"));
    nextQuestion();
    expect(screen.getByText("第 2 / 3 题")).toBeTruthy();
  });

  it("close button resolves null", () => {
    const onAnswers = renderDialog(samplePreflight);

    fireEvent.click(screen.getByLabelText("关闭"));
    expect(onAnswers).toHaveBeenCalledWith(null);
  });

  it("Escape resolves null", () => {
    const onAnswers = renderDialog(samplePreflight);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onAnswers).toHaveBeenCalledWith(null);
  });

  it("single question hides back button and submits directly", () => {
    const onAnswers = renderDialog(singlePreflight);

    expect(screen.queryByText("上一步")).toBeNull();
    const submit = screen.getByText("生成总纲") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByText("选项 A"));
    expect(submit.disabled).toBe(false);
    submitOutline();

    expect(onAnswers).toHaveBeenCalledTimes(1);
    const answers = onAnswers.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ selected: "a" });
  });
});
