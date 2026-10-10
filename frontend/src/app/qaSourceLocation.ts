import type { QARecord } from "../api/client";
import type { ViewerRange } from "../features/reader/CodeViewer";

export function locateQASource(content: string, origin: Pick<QARecord, "selected_text" | "selection_range">): ViewerRange | null {
  const text = content.replace(/\r\n/g, "\n");
  const selected = origin.selected_text.replace(/\r\n/g, "\n").trim();
  const saved = origin.selection_range;
  if (!selected) return null;
  const lines = text.split("\n");
  if (saved && saved.start_line > 0 && saved.end_line >= saved.start_line && saved.end_line <= lines.length) {
    const excerpt = lines.slice(saved.start_line - 1, saved.end_line);
    excerpt[excerpt.length - 1] = excerpt[excerpt.length - 1].slice(0, saved.end_column - 1);
    excerpt[0] = excerpt[0].slice(saved.start_column - 1);
    if (excerpt.join("\n").trim() === selected) return { startLineNumber: saved.start_line, startColumn: saved.start_column,
      endLineNumber: saved.end_line, endColumn: saved.end_column };
  }
  const start = text.indexOf(selected);
  if (start < 0 || text.indexOf(selected, start + 1) >= 0) return null;
  const before = text.slice(0, start).split("\n");
  const through = text.slice(0, start + selected.length).split("\n");
  return { startLineNumber: before.length, startColumn: before.at(-1)!.length + 1,
    endLineNumber: through.length, endColumn: through.at(-1)!.length + 1 };
}
