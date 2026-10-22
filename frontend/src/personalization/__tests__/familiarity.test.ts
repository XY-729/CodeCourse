import { describe, expect, it } from "vitest";
import {
  familiarityFromFacts,
  familiarityIsHelpfulEntry,
  familiarityText,
  type LearningFact,
} from "../familiarity";

describe("factual familiarity reduction", () => {
  it("reports unrecorded when nothing was recorded", () => {
    expect(familiarityFromFacts([])).toBe("unrecorded");
    // Generated or planned content is not learning evidence.
    expect(familiarityFromFacts([
      { source: "course", kind: "planned", action: "teach" },
      { source: "qa", kind: "mentioned", action: "answer" },
    ])).toBe("unrecorded");
  });

  it("separates confirmed understanding, partial understanding and needs-help", () => {
    expect(familiarityFromFacts([{ source: "manual", action: "understand", result: "understood" }]))
      .toBe("self_reported_understood");
    expect(familiarityFromFacts([{ source: "manual", action: "understand", result: "partial" }]))
      .toBe("partially_understood");
    expect(familiarityFromFacts([{ source: "manual", action: "understand", result: "needs_help" }]))
      .toBe("needs_help");
  });

  it("keeps a manual declaration and lets the user clear it", () => {
    expect(familiarityFromFacts([{ source: "manual", action: "manual_known" }])).toBe("declared_known");
    expect(familiarityFromFacts([
      { source: "manual", action: "manual_known" },
      { source: "manual", action: "manual_clear" },
    ])).toBe("unrecorded");
  });

  it("does not turn finishing a course into understanding", () => {
    expect(familiarityFromFacts([{ source: "course_completion", action: "complete" }])).toBe("studied");
  });

  it("lets an open question outrank old positive evidence", () => {
    expect(familiarityFromFacts([
      { source: "manual", action: "understand", result: "understood", eventTime: "2026-09-01T00:00:00Z" },
      { source: "manual", action: "ask", result: "needs_help", eventTime: "2026-10-01T00:00:00Z" },
    ])).toBe("needs_help");
  });

  it("ignores voided facts", () => {
    expect(familiarityFromFacts([
      { source: "manual", action: "understand", result: "understood", voided: true },
    ])).toBe("unrecorded");
  });

  it("phrases unknown as unknown and keeps an entry available", () => {
    expect(familiarityText("unrecorded")).toBe("暂无学习记录");
    expect(familiarityText("self_reported_understood")).toBe("已理解（自述）");
    expect(familiarityIsHelpfulEntry("unrecorded")).toBe(true);
    expect(familiarityIsHelpfulEntry("needs_help")).toBe(true);
    expect(familiarityIsHelpfulEntry("self_reported_understood")).toBe(false);
    expect(familiarityIsHelpfulEntry("declared_known")).toBe(false);
  });

  it("does not let a fact about one range leak into another", () => {
    const vector: LearningFact[] = [{ source: "manual", action: "understand", result: "understood" }];
    const stl: LearningFact[] = [];
    expect(familiarityFromFacts(vector)).toBe("self_reported_understood");
    expect(familiarityFromFacts(stl)).toBe("unrecorded");
  });
});
