import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Sparkles, X } from "lucide-react";
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
  const [currentIndex, setCurrentIndex] = useState(0);

  const questions = preflight?.questions ?? [];
  const preflightId = preflight?.preflight_id;

  useEffect(() => {
    setCurrentIndex(0);
  }, [preflightId]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onAnswers(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onAnswers]);

  const answersReady = useMemo(() => {
    if (questions.length === 0) return false;
    return questions.every((q) => {
      if (isText(q)) return (texts[q.question] ?? "").trim().length > 0;
      const selected = selections[q.question] ?? [];
      return isMulti(q) ? selected.length > 0 : selected.length === 1;
    });
  }, [questions, selections, texts]);

  const current = questions[currentIndex];
  const isLast = currentIndex === questions.length - 1;

  function questionAnswered(question: OutlineQuestion | undefined): boolean {
    if (!question) return false;
    if (isText(question)) return (texts[question.question] ?? "").trim().length > 0;
    const selected = selections[question.question] ?? [];
    return isMulti(question) ? selected.length > 0 : selected.length === 1;
  }

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

  function goNext() {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((index) => index + 1);
    } else {
      submit();
    }
  }

  function goBack() {
    if (currentIndex > 0) setCurrentIndex((index) => index - 1);
  }

  function skip() {
    onAnswers(null);
  }

  function handleTextKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      goNext();
    }
  }

  if (!preflight && !loading) {
    return null;
  }

  const progressPct = questions.length > 0 ? ((currentIndex + 1) / questions.length) * 100 : 0;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="生成总纲前问卷">
      <div className="app-dialog outline-questionnaire-dialog">
        <header className="outline-questionnaire-header">
          <div className="modal-title">
            <span>
              <Sparkles size={16} />
              生成总纲前问卷
            </span>
            <button type="button" className="icon-button" aria-label="关闭" onClick={skip}>
              <X size={17} />
            </button>
          </div>
          {questions.length > 0 ? (
            <div
              className="outline-questionnaire-progress"
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={questions.length}
              aria-valuenow={currentIndex + 1}
            >
              <div className="outline-questionnaire-progress-track">
                <span style={{ width: `${progressPct}%` }} />
              </div>
              <small>
                第 {currentIndex + 1} / {questions.length} 题
              </small>
            </div>
          ) : null}
        </header>

        <div className="outline-questionnaire-body">
          {loading ? <div className="outline-questionnaire-loading">正在生成问卷...</div> : null}
          {error ? <div className="outline-questionnaire-error">{error}</div> : null}

          {!loading && !error && current ? renderQuestion(current, currentIndex) : null}
        </div>

        <div className="app-dialog-actions outline-questionnaire-nav">
          <button type="button" className="link-button outline-questionnaire-skip" onClick={skip}>
            跳过，直接生成
          </button>
          <span className="outline-questionnaire-nav-spacer" />
          {currentIndex > 0 ? (
            <button type="button" className="secondary-button" onClick={goBack}>
              <ChevronLeft size={14} />
              上一步
            </button>
          ) : null}
          <button
            type="submit"
            className="primary-button"
            disabled={!questionAnswered(current) || loading}
            onClick={goNext}
          >
            {isLast ? "生成总纲" : (
              <>
                下一步
                <ChevronRight size={14} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  function renderQuestion(q: OutlineQuestion, index: number) {
    const key = q.question;
    const multi = isMulti(q);
    const text = isText(q);
    return (
      <section className="outline-question-card" key={key}>
        <div className="outline-question-head">
          <span className="outline-question-index">{index + 1}</span>
          <div>
            <h3>{q.question}</h3>
            {q.rationale ? <small className="outline-question-rationale">{q.rationale}</small> : null}
          </div>
          {multi ? <span className="outline-question-multi-hint">可多选</span> : null}
        </div>
        {text ? (
          <textarea
            className="outline-question-text"
            rows={3}
            placeholder="输入你的回答..."
            value={texts[key] ?? ""}
            autoFocus={index === 0}
            onChange={(event) => setTexts((prev) => ({ ...prev, [key]: event.target.value }))}
            onKeyDown={handleTextKeyDown}
          />
        ) : (
          <div className="learner-survey-options">
            {q.options.map((option) => {
              const checked = (selections[key] ?? []).includes(option.value);
              return (
                <button
                  type="button"
                  key={option.value}
                  className={`outline-question-option ${checked ? "selected" : ""} ${multi ? "multi" : "single"}`}
                  onClick={() => toggleOption(q, option.value)}
                >
                  <span className="outline-question-option-glyph">
                    {checked ? <Check size={13} /> : null}
                  </span>
                  <span className="outline-question-option-label">{option.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    );
  }
}
