import { describe, expect, it } from "vitest";
import { resolveCourseFilename } from "./appUtils";

const courseFilenames = ["outline.md", "lessons/lesson_05.md", "selection_answers/explicit_0038.md"];

describe("resolveCourseFilename", () => {
  it("matches the Windows absolute output path the backend stores", () => {
    expect(resolveCourseFilename(
      "C:\\Users\\xiyua\\AppData\\Roaming\\CodeCourse\\generated\\12\\lessons\\lesson_05.md",
      courseFilenames,
      12,
    )).toBe("lessons/lesson_05.md");
  });

  it("keeps working for relative and forward-slash names", () => {
    expect(resolveCourseFilename("lessons/lesson_05.md", courseFilenames, 12)).toBe("lessons/lesson_05.md");
    expect(resolveCourseFilename("/home/learner/generated/12/lessons/lesson_05.md", courseFilenames, 12)).toBe("lessons/lesson_05.md");
    expect(resolveCourseFilename("outline.md", courseFilenames, 12)).toBe("outline.md");
    expect(resolveCourseFilename("C:\\elsewhere\\outline.md", courseFilenames, 12)).toBe("outline.md");
  });

  it("normalizes course entries that themselves carry backslashes", () => {
    expect(resolveCourseFilename(
      "C:\\Users\\x\\CodeCourse\\generated\\12\\selection_answers\\explicit_0038.md",
      ["selection_answers\\explicit_0038.md"],
      12,
    )).toBe("selection_answers/explicit_0038.md");
  });

  it("falls back to the segment after generated/<project>/ for unknown files", () => {
    expect(resolveCourseFilename("C:\\Users\\x\\CodeCourse\\generated\\12\\lessons\\lesson_09.md", courseFilenames, 12))
      .toBe("lessons/lesson_09.md");
  });

  it("returns null instead of handing a raw absolute path to the backend", () => {
    expect(resolveCourseFilename("D:\\other\\project\\unknown.md", courseFilenames, 12)).toBeNull();
    expect(resolveCourseFilename("", courseFilenames, 12)).toBeNull();
    expect(resolveCourseFilename(null, courseFilenames, 12)).toBeNull();
    expect(resolveCourseFilename(undefined, courseFilenames, 12)).toBeNull();
  });
});
