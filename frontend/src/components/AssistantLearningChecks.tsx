import { useEffect, useState, type ComponentProps } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type ExplainPanel from "./ExplainPanel";

type Props = Pick<ComponentProps<typeof ExplainPanel>, "loading" | "surveyCandidate" | "diagnosticItem" | "diagnosticResult" | "onAnswerSurvey" | "onDismissSurvey" | "onDisableSurveys" | "onAnswerDiagnostic" | "onDismissDiagnostic" | "onFlagDiagnostic">;

/** Existing teaching checks, also used by the independent desktop scene. */
export default function AssistantLearningChecks({ loading, surveyCandidate, diagnosticItem, diagnosticResult, onAnswerSurvey, onDismissSurvey, onDisableSurveys, onAnswerDiagnostic, onDismissDiagnostic, onFlagDiagnostic }: Props) {
  const [diagnosticAnswer, setDiagnosticAnswer] = useState<unknown>(null);
  const [diagnosticOrder, setDiagnosticOrder] = useState<string[]>([]);
  useEffect(() => {
    setDiagnosticAnswer(null);
    setDiagnosticOrder(diagnosticItem?.itemType === "step_order" ? diagnosticItem.options.map(option => String(option.value)) : []);
  }, [diagnosticItem?.id]);
  return <>{!loading && surveyCandidate ? (
          <section className="assistant-survey-card">
            <strong>{surveyCandidate.question}</strong>
            <div>
              {surveyCandidate.options.map((option) => (
                <button type="button" key={option.value} onClick={() => onAnswerSurvey?.(option.value)}>
                  {option.label}
                </button>
              ))}
              <button type="button" className="text-button" onClick={onDismissSurvey}>稍后</button>
              <button type="button" className="text-button" onClick={onDisableSurveys}>以后不再询问</button>
            </div>
          </section>
        ) : null}

        {!loading && diagnosticItem ? (
          <section className="assistant-diagnostic-card" aria-label="理解检查">
            <div className="diagnostic-card-heading">
              <strong>快速理解检查</strong>
              <span>{diagnosticItem.dimension.replace("_", " ")}</span>
            </div>
            <p>{diagnosticItem.prompt}</p>
            {diagnosticItem.itemType === "step_order" ? (
              <div className="diagnostic-order-list">
                {diagnosticOrder.map((value, index) => {
                  const label = diagnosticItem.options.find((option) => String(option.value) === value)?.label || value;
                  return (
                    <div key={value}>
                      <span>{index + 1}. {label}</span>
                      <button type="button" aria-label="上移" disabled={index === 0 || diagnosticResult != null} onClick={() => setDiagnosticOrder((items) => {
                        const next = [...items];
                        [next[index - 1], next[index]] = [next[index], next[index - 1]];
                        return next;
                      })}><ArrowUp size={14} /></button>
                      <button type="button" aria-label="下移" disabled={index === diagnosticOrder.length - 1 || diagnosticResult != null} onClick={() => setDiagnosticOrder((items) => {
                        const next = [...items];
                        [next[index + 1], next[index]] = [next[index], next[index + 1]];
                        return next;
                      })}><ArrowDown size={14} /></button>
                    </div>
                  );
                })}
              </div>
            ) : diagnosticItem.options.length ? (
              <div className="diagnostic-options">
                {diagnosticItem.options.map((option) => (
                  <button
                    type="button"
                    key={String(option.value)}
                    className={diagnosticAnswer === option.value ? "selected" : ""}
                    disabled={diagnosticResult != null}
                    onClick={() => setDiagnosticAnswer(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : (
              <input
                className="diagnostic-text-answer"
                value={String(diagnosticAnswer ?? "")}
                disabled={diagnosticResult != null}
                onChange={(event) => setDiagnosticAnswer(event.target.value)}
                placeholder="输入你的判断"
              />
            )}
            {diagnosticResult != null ? (
              <div className={`diagnostic-result ${diagnosticResult ? "correct" : "incorrect"}`}>
                {diagnosticResult ? "回答正确，已记为一次验证证据。" : "这次没有答对，老师会补充这一处。"}
                <button type="button" className="text-button" onClick={onFlagDiagnostic}>题目有问题</button>
              </div>
            ) : (
              <div className="diagnostic-actions">
                <button
                  type="button"
                  className="primary-button compact"
                  disabled={diagnosticItem.itemType === "step_order" ? !diagnosticOrder.length : diagnosticAnswer == null || diagnosticAnswer === ""}
                  onClick={() => onAnswerDiagnostic?.(
                    diagnosticItem.itemType === "step_order" ? diagnosticOrder : diagnosticAnswer,
                  )}
                >
                  提交
                </button>
                <button type="button" className="text-button" onClick={onDismissDiagnostic}>跳过</button>
              </div>
            )}
          </section>
        ) : null}</>;
}

