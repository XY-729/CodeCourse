import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

/*
 * Deferred-lift text controls.
 *
 * Problem being solved: the app's composer/instruction inputs were controlled by
 * state living at the top of the App component, so every keystroke re-rendered
 * the whole app (including the heavy workbench: Monaco, markdown renderers,
 * knowledge graph) and produced visible input lag.
 *
 * These controls keep the draft locally: typing re-renders only the tiny input,
 * and the value is "lifted" to the parent only when it actually matters —
 *   - after `liftDelayMs` of silence (debounce, for search boxes),
 *   - on blur (flush),
 *   - on unmount (so a draft survives sheet/tab switches),
 *   - when the parent passes a new `resetToken` (an explicit reset such as
 *     clearing the composer after a question was asked).
 *
 * External value changes (e.g. suggestion fill, or the round-trip of our own
 * lift) are synced back into the draft automatically.
 */

export type DeferredLiftTextOptions = {
  /** Called with every keystroke — use for cheap panel-local derived UI (e.g. enable the send button). */
  onDraftChange?: (value: string) => void;
  /** Debounce (ms) before the draft is lifted to the parent. 0 = lift on blur/unmount only. */
  liftDelayMs?: number;
  /** When this value changes the draft is reset to the current `value` prop, even if that value is identical to what the parent last saw. */
  resetToken?: unknown;
};

/**
 * Shared state logic for deferred-lift inputs. Returns the props to spread onto
 * an <input> or <textarea> plus helpers.
 */
export function useDeferredLiftText(
  value: string,
  onLift: (value: string) => void,
  options: DeferredLiftTextOptions = {},
) {
  const { onDraftChange, liftDelayMs = 0, resetToken } = options;
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(draft);
  const onLiftRef = useRef(onLift);
  const onDraftChangeRef = useRef(onDraftChange);
  const timerRef = useRef<number | null>(null);
  // The last external value this control acknowledged (initialized or synced).
  const lastExternalRef = useRef(value);

  draftRef.current = draft;
  onLiftRef.current = onLift;
  onDraftChangeRef.current = onDraftChange;

  // Sync external changes down (suggestion fill, own lift round-trip, new selection).
  useEffect(() => {
    if (value === lastExternalRef.current) return;
    lastExternalRef.current = value;
    setDraft(value);
  }, [value]);

  // Explicit resets: the parent cleared its state to a value that may be identical
  // to what we last acknowledged (e.g. composer cleared to "" after asking).
  useEffect(() => {
    if (resetToken === undefined) return;
    lastExternalRef.current = value;
    setDraft(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetToken]);

  function liftNow() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    onLiftRef.current(draftRef.current);
  }

  function handleChange(next: string) {
    setDraft(next);
    onDraftChangeRef.current?.(next);
    if (liftDelayMs > 0) {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(liftNow, liftDelayMs);
    }
  }

  // Programmatic fill (e.g. a suggestion button). Marks the value as
  // acknowledged so a later parent round-trip does not re-sync or clobber it.
  function setValue(next: string) {
    lastExternalRef.current = next;
    setDraft(next);
  }

  // Lift the final draft on unmount so it survives sheet/tab switches.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (draftRef.current !== lastExternalRef.current) {
        try {
          onLiftRef.current(draftRef.current);
        } catch {
          // Parent may be unmounting too; nothing sensible to do.
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    value: draft,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => handleChange(event.target.value),
    onBlur: () => {
      if (liftDelayMs === 0) liftNow();
    },
    setValue,
    liftNow,
  };
}

export type DeferredLiftTextareaHandle = {
  /** Programmatically fill the draft (e.g. from a suggestion button). */
  setValue: (value: string) => void;
  focus: () => void;
};

type DeferredLiftTextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange" | "defaultValue"
> &
  DeferredLiftTextOptions & {
    value: string;
    onLift: (value: string) => void;
  };

export const DeferredLiftTextarea = forwardRef<DeferredLiftTextareaHandle, DeferredLiftTextareaProps>(
  function DeferredLiftTextarea({ value, onLift, onDraftChange, liftDelayMs, resetToken, onBlur, ...rest }, forwardedRef) {
    const lifted = useDeferredLiftText(value, onLift, { onDraftChange, liftDelayMs, resetToken });
    const innerRef = useRef<HTMLTextAreaElement | null>(null);
    useImperativeHandle(forwardedRef, () => ({
      setValue: lifted.setValue,
      focus: () => innerRef.current?.focus(),
    }), [lifted.setValue]);
    return (
      <textarea
        {...rest}
        ref={innerRef}
        value={lifted.value}
        onChange={lifted.onChange}
        onBlur={(event) => {
          lifted.onBlur();
          onBlur?.(event);
        }}
      />
    );
  },
);

type DeferredLiftInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "defaultValue"> &
  DeferredLiftTextOptions & {
    value: string;
    onLift: (value: string) => void;
  };

export const DeferredLiftInput = forwardRef<HTMLInputElement, DeferredLiftInputProps>(
  function DeferredLiftInput({ value, onLift, onDraftChange, liftDelayMs, resetToken, onBlur, ...rest }, forwardedRef) {
    const lifted = useDeferredLiftText(value, onLift, { onDraftChange, liftDelayMs, resetToken });
    return (
      <input
        {...rest}
        ref={forwardedRef}
        value={lifted.value}
        onChange={lifted.onChange}
        onBlur={(event) => {
          lifted.onBlur();
          onBlur?.(event);
        }}
      />
    );
  },
);
