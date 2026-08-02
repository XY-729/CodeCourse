import { describe, expect, it } from "vitest";
import type { TermScanStatus } from "../../api/client";
import { shouldPollTermScan } from "../useDocumentTermsController";

function status(scanStatus: string): TermScanStatus {
  return {
    source_type: "course",
    source_path: "outline.md",
    content_hash: "abc",
    scan_status: scanStatus,
    model_scan_authorized: true,
    candidate_count: 1,
    high_confidence_count: 1,
    local_candidate_count: 1,
    model_candidate_count: 0,
  };
}

describe("document term polling", () => {
  it("continues only while a scan can still produce candidates", () => {
    expect(shouldPollTermScan(status("idle"))).toBe(true);
    expect(shouldPollTermScan(status("queued"))).toBe(true);
    expect(shouldPollTermScan(status("running"))).toBe(true);
    expect(shouldPollTermScan(status("completed"))).toBe(false);
    expect(shouldPollTermScan(status("failed"))).toBe(false);
    expect(shouldPollTermScan(status("local_only"))).toBe(false);
  });
});
