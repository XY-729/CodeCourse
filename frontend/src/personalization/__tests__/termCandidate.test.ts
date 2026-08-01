import { describe, expect, it } from "vitest";
import vectors from "./termCandidateGolden.json";
import {
  validateTermCandidate,
  type TermCandidateInput,
} from "../termCandidate";

describe("structured term candidate golden vectors", () => {
  for (const vector of vectors.vectors) {
    it(vector.name, () => {
      const result = validateTermCandidate(
        vector.input as TermCandidateInput,
        vector.content,
        { source: "model", confidence: 0.94 },
      );
      expect(result?.display_name ?? null).toBe(vector.expected);
      if (result) {
        expect(vector.content.slice(result.source_span.start, result.source_span.end))
          .toBe(result.display_name);
      }
    });
  }
});
