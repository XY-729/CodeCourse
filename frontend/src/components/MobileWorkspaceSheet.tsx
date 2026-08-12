import { forwardRef, Suspense, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import FluidBottomSheet, { type FluidBottomSheetHandle } from "./FluidBottomSheet";

type Props = {
  action?: ReactNode;
  children?: ReactNode;
  feedback?: ReactNode;
  onDismiss: () => void;
  onMotionPhaseChange?: (phase: "entering" | "open" | "exiting") => void;
  preloadContent?: () => void;
  renderContent?: () => ReactNode;
  tabKey: string;
  title: string;
  variant?: "standard" | "assistant" | "me" | "generation";
};

export type MobileWorkspaceSheetHandle = {
  dismiss: () => void;
};

const MobileWorkspaceSheet = forwardRef<MobileWorkspaceSheetHandle, Props>(function MobileWorkspaceSheet({
    action, children, feedback, onDismiss, onMotionPhaseChange, preloadContent, renderContent, tabKey, title,
    variant = "standard",
  },
  forwardedRef,
) {
  const sheetRef = useRef<FluidBottomSheetHandle | null>(null);
  const [readyTabKey, setReadyTabKey] = useState<string | null>(null);
  const openedRef = useRef(false);
  const dismiss = () => sheetRef.current?.dismiss();
  useImperativeHandle(forwardedRef, () => ({ dismiss }), []);

  useEffect(() => {
    preloadContent?.();
    if (!openedRef.current) return;
    const frame = window.requestAnimationFrame(() => setReadyTabKey(tabKey));
    return () => window.cancelAnimationFrame(frame);
  }, [tabKey]);

  const contentReady = readyTabKey === tabKey;

  const variantClass =
    variant === "assistant"
      ? "is-assistant"
      : variant === "me"
        ? "is-me"
        : variant === "generation"
          ? "is-generation"
          : "";

  return (
    <div className="mobile-workspace-sheet-layer" onMouseDown={dismiss}>
      <FluidBottomSheet
        ref={sheetRef}
        className={
          `mobile-workspace-sheet ` +
          variantClass
        }
        label={title}
        onDismiss={onDismiss}
        onMotionPhaseChange={(phase) => {
          if (phase === "open") {
            openedRef.current = true;
            setReadyTabKey(tabKey);
          }
          onMotionPhaseChange?.(phase);
        }}
      >
        <header className="mobile-workspace-sheet-header">
          <strong>{title}</strong>
          <div>
            {action}
            <button className="icon-button" type="button" onClick={dismiss} aria-label={`关闭${title}`} title="关闭">
              <X size={17} />
            </button>
          </div>
        </header>
        {feedback}
        <div className={`mobile-workspace-sheet-content ${contentReady ? "is-ready" : "is-deferred"}`}>
          {contentReady ? <Suspense fallback={<div className="mobile-workspace-sheet-skeleton"><i /><i /><i /></div>}>
            {renderContent?.() ?? children}
          </Suspense> : (
            <div className="mobile-workspace-sheet-skeleton" aria-label={`${title}正在准备`}>
              <i /><i /><i /><i />
            </div>
          )}
        </div>
      </FluidBottomSheet>
    </div>
  );
});

export default MobileWorkspaceSheet;
