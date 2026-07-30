import { lazy, Suspense } from "react";
import { isAndroidRuntime } from "../platform/runtime";
import MobileCodeViewer from "./MobileCodeViewer";

const MonacoCodeViewer = lazy(() => import("./MonacoCodeViewer"));

export type ViewerRange = { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
export type ViewerAnchorRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
export type ViewerSelection = { sourceType: "file" | "course" | "qa"; sourcePath: string | null; selectedText: string; language?: string; range?: ViewerRange; anchorRect?: ViewerAnchorRect };
export type CodeJumpRequest = { id: string; line: number; align: "start" | "center" };
type Props = {
  path: string | null;
  language: string;
  content: string;
  selectedRange?: ViewerRange | null;
  onSelectionChange?: (selection: ViewerSelection) => void;
  restoreLine?: number;
  jumpRequest?: CodeJumpRequest | null;
  onJumpConsumed?: (requestId: string) => void;
  onVisibleLineChange?: (line: number) => void;
  mobileSearchRequestId?: number;
};

export default function CodeViewer(props: Props) {
  if (isAndroidRuntime()) return <MobileCodeViewer {...props} />;
  const { mobileSearchRequestId: _, ...desktopProps } = props;
  return <Suspense fallback={<div className="viewer-loading">正在打开代码…</div>}><MonacoCodeViewer {...desktopProps} /></Suspense>;
}
