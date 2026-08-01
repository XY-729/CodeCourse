import { useMemo, useState } from "react";
import type {
  OutlinePreflight,
  OutlineQuestion,
  OutlineSurveyAnswer,
} from "../api/client";

type Props = {
  preflight: OutlinePreflight | null;
  loading: boolean;
  error: string;
  onAnswers: (answers: OutlineSurveyAnswer[] | null) => void;
  onClose: () => void;
};

type Selection = string[];

function isMulti(question: OutlineQuestion): boolean {
  return question.question_type === "multi_choice";
}

function isText(question: OutlineQuestion): boolean {
  return question.question_type === "text" || !question.options?.length;
}

function toAnswer(
  question: OutlineQuestion,
  selection: Selection,
  text: string,
): OutlineSurveyAnswer {
  const selected = isText(question)
    ? text.trim()
    : isMulti(question)
      ? selection
      : (selection[0] ?? "");
  return {
    question: question.question,
    question_type: question.question_type,
    dimension: question.dimension,
    selected,
    _key: `q${question.dimension}:${question.question.slice(0, 24)}`,
  };
}

export default function OutlineQuestionnaireDialog({ preflight, loading, error, onAnswers, onClose }: Props) {
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});

  const questions = preflight?.questions ?? [];

  const answersReady = useMemo(() => {
    if (questions.length === 0) return false;
    return questions.every((q) => {
      if (isText(q)) return (texts[q.question] ?? "").trim().length > 0;
      const selected = selections[q.question] ?? [];
      return isMulti(q) ? selected.length > 0 : selected.length === 1;
    });
  }, [questions, selections, texts]);

  function toggleOption(question: OutlineQuestion, value: string) {
    const key = question.question;
    setSelections((prev) => {
      const current = prev[key] ?? [];
      if (isMulti(question)) {
        return {
          ...prev,
          [key]: current.includes(value)
            ? current.filter((item) => item !== value)
            : [...current, value],
        };
      }
      return { ...prev, [key]: [value] };
    });
  }

  function submit() {
    if (!answersReady || questions.length === 0) return;
    const answers = questions.map((q) => toAnswer(q, selections[q.question] ?? [], texts[q.question] ?? ""));
    onAnswers(answers);
  }

  if (!preflight && !loading) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="生成总纲前问卷">
      <div className="app-dialog outline-questionnaire-dialog">
        <div className="app-dialog-title">生成总纲前问卷</div>
        <div className="app-dialog-message">
          先回答几个问题，让总纲更贴合你的学习意图。所有答案会注入本次总纲，其中前置知识程度会更新你的学习档案。
        </div>

        <div className="outline-questionnaire-body">
          {loading ? <div className="outline-questionnaire-loading">正在生成问卷...</div> : null}
          {error ? <div className="outline-questionnaire-error">{error}</div> : null}

          {!loading && !error
            ? questions.map((q, index) => {
                const key = q.question;
                const multi = isMulti(q);
                const text = isText(q);
                return (
                  <section className="learner-survey-card" key={key}>
                    <div>
                      <strong>{index + 1}. {q.question}</strong>
                      {q.rationale ? <small className="outline-question-rationale">{q.rationale}</small> : null}
                    </div>
                    {text ? (
                      <input
                        className="outline-question-text"
                        placeholder="输入你的回答..."
                        value={texts[key] ?? ""}
                        onChange={(event) => setTexts((prev) => ({ ...prev, [key]: event.target.value }))}
                      />
                    ) : (
                      <div className="learner-survey-options">
                        {q.options.map((option) => {
                          const checked = (selections[key] ?? []).includes(option.value);
                          return (
                            <button
                              type="button"
                              key={option.value}
                              className={checked ? "selected" : ""}
                              onClick={() => toggleOption(q, option.value)}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              })
            : null}
        </div>

        <div className="app-dialog-actions">
          <button type="button" className="secondary-button" onClick={() => onAnswers(null)}>
            跳过，直接生成
          </button>
          <button type="submit" className="primary-button" disabled={!answersReady || loading} onClick={submit}>
            生成总纲
          </button>
        </div>
      </div>
    </div>
  );
}
