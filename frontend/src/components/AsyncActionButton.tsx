import { useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";
import { Check, Loader2 } from "lucide-react";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  action: () => unknown | Promise<unknown>;
  pendingLabel?: string;
  successLabel?: string;
  onPendingChange?: (pending: boolean) => void;
};

/** Feedback belongs to the control that started the operation. False means failure. */
export default function AsyncActionButton({ action, pendingLabel = "保存中…", successLabel, onPendingChange, children, disabled, ...props }: Props) {
  const [state, setState] = useState<"idle" | "pending" | "success">("idle");
  const [error, setError] = useState("");
  const locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (state !== "success") return;
    const timer = window.setTimeout(() => setState("idle"), 1600);
    return () => window.clearTimeout(timer);
  }, [state]);
  return <>
    <button {...props} type={props.type ?? "button"} disabled={disabled || state === "pending"}
      aria-busy={state === "pending"} data-action-state={state}
      onClick={async (event) => {
        event.stopPropagation();
        if (locked.current) return;
        locked.current = true;
        setError(""); setState("pending"); onPendingChange?.(true);
        try {
          const result = await action();
          if (mounted.current) setState(result !== false && successLabel ? "success" : "idle");
        } catch (caught) {
          if (mounted.current) { setError(caught instanceof Error ? caught.message : "操作失败，请重试"); setState("idle"); }
        } finally {
          locked.current = false;
          onPendingChange?.(false);
        }
      }}>
      {state === "pending" ? <><Loader2 size={14} className="spin" aria-hidden="true" />{pendingLabel}</>
        : state === "success" ? <><Check size={14} aria-hidden="true" />{successLabel}</> : children}
    </button>
    {error ? <span className="error-text" role="alert">{error}</span> : null}
  </>;
}
