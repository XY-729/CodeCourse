import { useId, useRef, type FormEvent } from "react";
import { useModalFocus } from "../hooks/useModalFocus";

export type ConfirmDialogState = {
  kind: "confirm";
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

export type InputDialogState = {
  kind: "input";
  title: string;
  message?: string;
  label?: string;
  initialValue?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
};

export type ChoiceDialogOption = {
  value: string;
  label: string;
  description?: string;
};

export type ChoiceDialogState = {
  kind: "choice";
  title: string;
  message?: string;
  options: ChoiceDialogOption[];
  initialValue?: string;
  confirmText?: string;
  cancelText?: string;
};

export type AppDialogState = ConfirmDialogState | InputDialogState | ChoiceDialogState;

type Props = {
  state: AppDialogState | null;
  value: string;
  onValueChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  skipChecked?: boolean;
  onSkipChange?: (checked: boolean) => void;
};

export default function AppDialog({ state, value, onValueChange, onCancel, onConfirm, skipChecked, onSkipChange }: Props) {
  const dialogRef = useRef<HTMLFormElement>(null);
  const messageId = useId();
  useModalFocus(dialogRef, !!state);
  if (!state) {
    return null;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmDisabled) onConfirm();
  }

  const confirmText = state.confirmText ?? "确定";
  const cancelText = state.cancelText ?? "取消";
  const confirmDisabled = state.kind === "input" ? !value.trim() : state.kind === "choice" ? !value : false;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={state.title} aria-describedby={state.message ? messageId : undefined}>
      <form ref={dialogRef} className="app-dialog" onSubmit={submit} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) {
          event.stopPropagation();
          if (event.key === "Enter") event.preventDefault();
          return;
        }
        if (event.key === "Escape") {
          event.stopPropagation();
          event.preventDefault();
          onCancel();
        }
      }}>
        <div className="app-dialog-title">{state.title}</div>
        {"message" in state && state.message ? <p id={messageId} className="app-dialog-message">{state.message}</p> : null}

        {state.kind === "confirm" && onSkipChange ? (
          <label className="app-dialog-skip">
            <input type="checkbox" checked={skipChecked ?? false} onChange={(event) => onSkipChange(event.target.checked)} />
            <span>不再提示</span>
          </label>
        ) : null}

        {state.kind === "input" ? (
          <label className="app-dialog-field">
            <span>{state.label ?? "名称"}</span>
            <input
              data-modal-initial-focus
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
              placeholder={state.placeholder}
            />
          </label>
        ) : null}

        {state.kind === "choice" ? (
          <div className="app-dialog-choice-list">
            {state.options.map((option) => (
              <label className="app-dialog-choice" key={option.value}>
                <input
                  type="radio"
                  name="app-dialog-choice"
                  value={option.value}
                  checked={value === option.value}
                  onChange={(event) => onValueChange(event.target.value)}
                />
                <span>
                  <strong>{option.label}</strong>
                  {option.description ? <small>{option.description}</small> : null}
                </span>
              </label>
            ))}
          </div>
        ) : null}

        <div className="app-dialog-actions">
          <button data-modal-initial-focus={state.kind === "confirm" ? "" : undefined} type="button" className="secondary-button" onClick={onCancel}>
            {cancelText}
          </button>
          <button type="submit" className={state.kind === "confirm" && state.danger ? "primary-button danger" : "primary-button"} disabled={confirmDisabled}>
            {confirmText}
          </button>
        </div>
      </form>
    </div>
  );
}
