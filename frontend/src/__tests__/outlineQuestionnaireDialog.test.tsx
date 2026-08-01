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
  ],
};

describe("OutlineQuestionnaireDialog", () => {
  it("renders all questions and resolves answers on submit", () => {
    const onAnswers = vi.fn();
    render(
      <OutlineQuestionnaireDialog
        preflight={samplePreflight}
        loading={false}
        error=""
        onAnswers={onAnswers}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("生成总纲前问卷")).toBeTruthy();
    expect(screen.getByText(/前置知识的了解程度/)).toBeTruthy();
    expect(screen.getByText(/想学到什么程度/)).toBeTruthy();

    fireEvent.click(screen.getByText("完全没了解"));
    fireEvent.click(screen.getByText("深入掌握"));

    fireEvent.click(screen.getByText("生成总纲"));

    expect(onAnswers).toHaveBeenCalledTimes(1);
    const answers = onAnswers.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(answers).toHaveLength(2);
    expect(answers[0]).toMatchObject({
      dimension: "prerequisite_level",
      selected: "none",
    });
    expect(answers[1]).toMatchObject({
      dimension: "learning_depth",
      selected: ["deep"],
    });
  });

  it("resolve single choice keeps only latest selection", () => {
    const onAnswers = vi.fn();
    render(
      <OutlineQuestionnaireDialog
        preflight={samplePreflight}
        loading={false}
        error=""
        onAnswers={onAnswers}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("完全没了解"));
    fireEvent.click(screen.getByText("较熟悉"));
    fireEvent.click(screen.getByText("深入掌握"));
    fireEvent.click(screen.getByText("生成总纲"));

    const answers = onAnswers.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(answers[0]).toMatchObject({ selected: "familiar" });
  });

  it("submit stays disabled until every question is answered", () => {
    const onAnswers = vi.fn();
    render(
      <OutlineQuestionnaireDialog
        preflight={samplePreflight}
        loading={false}
        error=""
        onAnswers={onAnswers}
        onClose={vi.fn()}
      />,
    );

    const submit = screen.getByText("生成总纲") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.click(screen.getByText("完全没了解"));
    expect(submit.disabled).toBe(true);

    fireEvent.click(screen.getByText("了解即可"));
    expect(submit.disabled).toBe(false);
  });

  it("skip resolves null", () => {
    const onAnswers = vi.fn();
    render(
      <OutlineQuestionnaireDialog
        preflight={samplePreflight}
        loading={false}
        error=""
        onAnswers={onAnswers}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("跳过，直接生成"));
    expect(onAnswers).toHaveBeenCalledWith(null);
  });
});
