export interface TermOccurrence {
  candidateId: string;
  termId: string;
  termText: string;
  paragraphIndex: number;
  localOffset: number;
  absoluteOffset: number;
}

export function buildTermCandidateId(
  termId: string,
  paragraphIndex: number,
  occurrenceIndex: number,
): string {
  return `term:${encodeURIComponent(termId)}:p${paragraphIndex}:o${occurrenceIndex}`;
}

export function candidateIdForRendering(
  termId: string,
  occurrenceCounter: number,
): string {
  return `term:${encodeURIComponent(termId)}:occ:${occurrenceCounter}`;
}
