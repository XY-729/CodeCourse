import { describe, expect, it, vi } from "vitest";
import type { CourseFile, LearningState, QARecord } from "../api/client";
import { resolveRecentProjectDocument } from "./resolveRecentProjectDocument";

const outline: CourseFile = { filename: "outline.md", title: "总纲", group: "课程" };

function state(sourceType: LearningState["source_type"], sourcePath: string, opened: string): LearningState {
  return {
    id: 1,
    project_id: 1,
    source_type: sourceType,
    source_path: sourcePath,
    status: "in_progress",
    position_kind: sourceType === "file" ? "line" : "scroll_ratio",
    position_value: 1,
    last_opened_at: opened,
    updated_at: opened,
  };
}

describe("resolveRecentProjectDocument", () => {
  it("restores a recent source file without waiting for QA history", async () => {
    let resolveQA: ((records: QARecord[]) => void) | undefined;
    const qaRecords = new Promise<QARecord[]>((resolve) => { resolveQA = resolve; });
    const loadFile = vi.fn(async () => ({ path: "src/main.ts", language: "typescript", content: "main();" }));
    const result = await resolveRecentProjectDocument({
      projectId: 1,
      courses: [outline],
      learningStates: [state("file", "src/main.ts", "2026-08-20T10:00:00Z")],
      qaRecords,
      loaders: { loadFile, loadCourse: vi.fn() },
    });
    resolveQA?.([]);

    expect(result.source).toBe("recent-file");
    expect(result.item?.type).toBe("file");
    expect(loadFile).toHaveBeenCalledWith(1, "src/main.ts");
  });

  it("falls back to the outline when the recent file was removed", async () => {
    const result = await resolveRecentProjectDocument({
      projectId: 1,
      courses: [outline],
      learningStates: [state("file", "removed.ts", "2026-08-20T10:00:00Z")],
      qaRecords: [],
      loaders: {
        loadFile: vi.fn(async () => { throw new Error("missing"); }),
        loadCourse: vi.fn(async (_projectId: number, filename: string) => ({ filename, content: "# 总纲" })),
      },
    });

    expect(result.source).toBe("default-course");
    expect(result.item?.path).toBe("outline.md");
  });

  it("reopens a recent answer as editable QA when its generated document is unavailable", async () => {
    const record = {
      id: 7,
      project_id: 1,
      source_type: "selection",
      source_path: "src/main.ts",
      question: "socket 是什么",
      answer_md: "answer",
      output_path: "qa/7.md",
      favorite: false,
      created_at: "",
      updated_at: "",
    } as QARecord;
    const result = await resolveRecentProjectDocument({
      projectId: 1,
      courses: [outline],
      learningStates: [state("qa", "qa/7.md", "2026-08-20T10:00:00Z")],
      qaRecords: [record],
      loaders: {
        loadFile: vi.fn(),
        loadCourse: vi.fn(async () => { throw new Error("missing"); }),
      },
    });

    expect(result.source).toBe("recent-qa");
    expect(result.item?.type).toBe("qa");
    expect(result.selectedQA?.id).toBe(7);
  });
});
