import { forwardRef, useImperativeHandle, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import FluidBottomSheet, { type FluidBottomSheetHandle } from "./FluidBottomSheet";

type Props = {
  action?: ReactNode;
  children: ReactNode;
  feedback?: ReactNode;
  onDismiss: () => void;
  tabKey: string;
  title: string;
  variant?: "standard" | "assistant";
};

export type MobileWorkspaceSheetHandle = {
  dismiss: () => void;
};

const MobileWorkspaceSheet = forwardRef<MobileWorkspaceSheetHandle, Props>(function MobileWorkspaceSheet({
    action, children, feedback, onDismiss, tabKey, title,
    variant = "standard",
  },
  forwardedRef,
) {
  const sheetRef = useRef<FluidBottomSheetHandle | null>(null);
  const dismiss = () => sheetRef.current?.dismiss();
  useImperativeHandle(forwardedRef, () => ({ dismiss }), []);

  return (
    <div className="mobile-workspace-sheet-layer" onMouseDown={dismiss}>
      <FluidBottomSheet
        ref={sheetRef}
        className={`mobile-workspace-sheet ${variant === "assistant" ? "is-assistant" : ""}`}
        label={title}
        onDismiss={onDismiss}
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
        <div className="mobile-workspace-sheet-content" key={tabKey}>
          {children}
        </div>
      </FluidBottomSheet>
    </div>
  );
});

export default MobileWorkspaceSheet;
