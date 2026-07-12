import type { FormEvent } from "react";

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
};

export default function AppDialog({ state, value, onValueChange, onCancel, onConfirm }: Props) {
  if (!state) {
    return null;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onConfirm();
  }

  const confirmText = state.confirmText ?? "确定";
  const cancelText = state.cancelText ?? "取消";
  const confirmDisabled = state.kind === "input" ? !value.trim() : state.kind === "choice" ? !value : false;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={state.title}>
      <form className="app-dialog" onSubmit={submit}>
        <div className="app-dialog-title">{state.title}</div>
        {"message" in state && state.message ? <p className="app-dialog-message">{state.message}</p> : null}

        {state.kind === "input" ? (
          <label className="app-dialog-field">
            <span>{state.label ?? "名称"}</span>
            <input
              autoFocus
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
          <button type="button" className="secondary-button" onClick={onCancel}>
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
