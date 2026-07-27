export interface TermOccurrence {
  candidateId: string;
  termId: string;
  termText: string;
  paragraphIndex: number;
  localOffset: number;
  absoluteOffset: number;
}

function hashParagraphText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function buildTermCandidateId(
  termId: string,
  paragraphText: string,
  matchIndex: number,
): string {
  return `term:${encodeURIComponent(termId)}:ph${hashParagraphText(paragraphText)}:n${matchIndex}`;
}

export function candidateIdForRendering(
  termId: string,
  paragraphText: string,
  matchIndex: number,
): string {
  return buildTermCandidateId(termId, paragraphText, matchIndex);
}
