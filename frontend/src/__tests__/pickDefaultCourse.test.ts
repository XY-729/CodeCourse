import { describe, expect, it } from "vitest";
import type { CourseFile } from "../api/client";
import { pickDefaultCourse } from "../App";

function course(filename: string): CourseFile {
  return { filename, title: filename, group: "课程" };
}

describe("pickDefaultCourse", () => {
  const outline = course("outline.md");
  const subOutline = course("sub-outline-1a2b3c4d.md");
  const lesson = course("lessons/lesson_01.md");
  const other = course("notes/自定义笔记.md");

  it("prefers outline.md even when a sub-outline was recently opened", () => {
    const picked = pickDefaultCourse([subOutline, outline, lesson], subOutline);
    expect(picked?.filename).toBe("outline.md");
  });

  it("falls back to the recent course when there is no outline.md", () => {
    const picked = pickDefaultCourse([subOutline, lesson], subOutline);
    expect(picked?.filename).toBe("sub-outline-1a2b3c4d.md");
  });

  it("falls back to the first lesson when there is no outline or recent course", () => {
    const picked = pickDefaultCourse([other, lesson], null);
    expect(picked?.filename).toBe("lessons/lesson_01.md");
  });

  it("falls back to the first course otherwise", () => {
    const picked = pickDefaultCourse([other], null);
    expect(picked?.filename).toBe("notes/自定义笔记.md");
  });

  it("returns null for an empty course list", () => {
    expect(pickDefaultCourse([], null)).toBeNull();
  });
});
