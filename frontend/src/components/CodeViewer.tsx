import { lazy, Suspense } from "react";
import { isAndroidRuntime } from "../platform/runtime";
import MobileCodeViewer from "./MobileCodeViewer";

const MonacoCodeViewer = lazy(() => import("./MonacoCodeViewer"));

export type ViewerRange = { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
export type ViewerAnchorRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
export type ViewerSelection = { sourceType: "file" | "course" | "qa"; sourcePath: string | null; selectedText: string; language?: string; range?: ViewerRange; anchorRect?: ViewerAnchorRect };
type Props = { path: string | null; language: string; content: string; selectedRange?: ViewerRange | null; onSelectionChange?: (selection: ViewerSelection) => void; onContextMenu?: (payload: { clientX: number; clientY: number; selectedText: string; sourcePath: string | null }) => void; initialLine?: number; onVisibleLineChange?: (line: number) => void };

export default function CodeViewer(props: Props) {
  if (isAndroidRuntime()) return <MobileCodeViewer path={props.path} language={props.language} content={props.content} selectedRange={props.selectedRange} onSelectionChange={props.onSelectionChange} initialLine={props.initialLine} onVisibleLineChange={props.onVisibleLineChange} />;
  return <Suspense fallback={<div className="viewer-loading">正在打开代码…</div>}><MonacoCodeViewer {...props} /></Suspense>;
}
