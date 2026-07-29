import { useRef, useState } from "react";
import type {
  AppDialogState,
  ChoiceDialogOption,
} from "../components/AppDialog";

type DialogResult = string | boolean | null;
type DialogResolver = (value: DialogResult) => void;

export type ConfirmActionOptions = {
  confirmText?: string;
  danger?: boolean;
  skipKey?: string;
};

export type RequestTextOptions = {
  title: string;
  message?: string;
  label?: string;
  initialValue?: string;
  placeholder?: string;
  confirmText?: string;
};

export function useAppDialog() {
  const [dialog, setDialog] = useState<AppDialogState | null>(null);
  const [value, setValue] = useState("");
  const [skipKey, setSkipKey] = useState<string | null>(null);
  const [skipChecked, setSkipChecked] = useState(false);
  const skipCheckedRef = useRef(false);
  const resolverRef = useRef<DialogResolver | null>(null);

  function open(state: AppDialogState): Promise<DialogResult> {
    setDialog(state);
    setValue(
      state.kind === "input"
        ? state.initialValue ?? ""
        : state.kind === "choice"
          ? state.initialValue ?? state.options[0]?.value ?? ""
          : "",
    );
    return new Promise((resolve) => {
      resolverRef.current = resolve;
    });
  }

  async function confirm(
    title: string,
    message: string,
    options?: ConfirmActionOptions,
  ) {
    if (
      options?.skipKey
      && window.localStorage.getItem(`codecourse.noshow.${options.skipKey}`) === "true"
    ) {
      return true;
    }
    setSkipKey(options?.skipKey ?? null);
    setSkipChecked(false);
    skipCheckedRef.current = false;
    const result = await open({
      kind: "confirm",
      title,
      message,
      confirmText: options?.confirmText,
      danger: options?.danger,
    });
    return result === true;
  }

  async function requestText(options: RequestTextOptions) {
    const result = await open({ kind: "input", ...options });
    return typeof result === "string" ? result : null;
  }

  async function requestChoice(
    title: string,
    message: string,
    options: ChoiceDialogOption[],
  ) {
    const result = await open({
      kind: "choice",
      title,
      message,
      options,
      initialValue: options[0]?.value,
    });
    return typeof result === "string" ? result : null;
  }

  function setSkip(checked: boolean) {
    setSkipChecked(checked);
    skipCheckedRef.current = checked;
  }

  function close(result: DialogResult) {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setDialog(null);
    setValue("");
    setSkipKey(null);
    setSkipChecked(false);
    skipCheckedRef.current = false;
    resolver?.(result);
  }

  function submit() {
    if (!dialog) return;
    if (dialog.kind === "confirm") {
      if (skipCheckedRef.current && skipKey) {
        window.localStorage.setItem(`codecourse.noshow.${skipKey}`, "true");
      }
      close(true);
      return;
    }
    close(value.trim());
  }

  return {
    dialog,
    value,
    skipChecked,
    setValue,
    setSkip,
    close,
    submit,
    confirm,
    requestText,
    requestChoice,
  };
}
