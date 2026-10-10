import { describe, expect, it } from "vitest";
import type { QAAskPayload, QARecord } from "../api/client";
import { desktopFollowUpTarget, requestConversationLabel } from "./qaConversation";
import { locateQASource } from "./qaSourceLocation";

describe("question conversation identity", () => {
  const record = { id: 1, project_id: 4 } as QARecord;
  it("uses the same explicit or selected answer for label and request", () => {
    expect(desktopFollowUpTarget(4, null, record)).toBe(record);
    const branch = { id: 2, project_id: 4 } as QARecord;
    expect(desktopFollowUpTarget(4, branch, record)).toBe(branch);
  });
  it("never carries another project's record into a new request", () => {
    expect(desktopFollowUpTarget(5, record, record)).toBeNull();
    expect(desktopFollowUpTarget(4, null, null)).toBeNull();
  });
  it("labels the submitted parent even if another history record is being read", () => {
    const request = { parent_qa_id: 1 } as QAAskPayload;
    expect(requestConversationLabel(request, [{ ...record, display_title: "Python return" }])).toBe("本次追问：Python return");
    expect(requestConversationLabel(request, [])).toBe("本次追问：回答 #1");
    expect(requestConversationLabel({} as QAAskPayload, [])).toBe("本次为新对话");
  });
});

describe("return to original selection", () => {
  const range = { start_line: 2, start_column: 5, end_line: 2, end_column: 17 };
  it("keeps a verified recorded range even when matching text repeats", () => {
    expect(locateQASource("def add():\n    return a + b\n    return a + b", { selected_text: "return a + b", selection_range: range }))
      .toEqual({ startLineNumber: 2, startColumn: 5, endLineNumber: 2, endColumn: 17 });
  });
  it("relocates a uniquely matching selection after the file was edited", () => {
    expect(locateQASource("# new line\r\ndef add():\r\n    return a + b", { selected_text: "return a + b", selection_range: range }))
      .toEqual({ startLineNumber: 3, startColumn: 5, endLineNumber: 3, endColumn: 17 });
  });
  it("refuses to guess when the old range changed and text repeats", () => {
    expect(locateQASource("# shifted\ndef add():\n return a + b\n return a + b", { selected_text: "return a + b", selection_range: range })).toBeNull();
  });
  it("supports older records with selection text and no stored range", () => {
    expect(locateQASource("first\nunique snippet\nlast", { selected_text: "unique snippet" })?.startLineNumber).toBe(2);
    expect(locateQASource("unchanged", { selected_text: "deleted snippet" })).toBeNull();
  });
});
