/** Hide protocol lines while releasing ordinary Markdown without waiting for a newline. */
export class StreamingMetadataFilter {
  private pending = "";
  private passthrough = false;
  private hidden = false;
  private fence = "";
  private continuation = false;
  private metadataFence = "";
  private readonly names = ["TITLE", "TERMS", "HANDOFF", "术语", "TEACHING", "REUSE"];
  private readonly metadata = /^\s*(?:TITLE|TERMS|HANDOFF|术语|TEACHING|REUSE)\s*[:：]/i;

  private complete(line: string): string {
    if (this.continuation) {
      if (this.metadataFence && line.trim() === this.metadataFence) {
        this.continuation = false; this.metadataFence = ""; return "";
      }
      if (/^\s*(?:[\[\]{}",]|$)/.test(line)) {
        if (line.trim() === "]" && !this.metadataFence) this.continuation = false;
        return "";
      }
      this.continuation = false; this.metadataFence = "";
    }
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
    if (marker) {
      if (!this.fence) this.fence = marker;
      else if (marker[0] === this.fence[0] && marker.length >= this.fence.length) this.fence = "";
      return line;
    }
    if (!this.fence && this.metadata.test(line)) {
      const value = line.replace(this.metadata, "").trim();
      this.metadataFence = value.match(/^(`{3,}|~{3,})(?:json)?\s*$/i)?.[1] || "";
      this.continuation = Boolean(this.metadataFence || !value || (value.startsWith("[") && !value.endsWith("]")));
      return "";
    }
    return line;
  }

  push(chunk: string): string {
    let output = "";
    for (const part of chunk.match(/[^\n]*\n|[^\n]+$/g) || []) {
      const endsLine = part.endsWith("\n");
      if (this.hidden) {
        this.pending = (this.pending + part).slice(0, 250000);
        if (endsLine) { this.complete(this.pending); this.pending = ""; this.hidden = false; }
        continue;
      }
      if (this.passthrough) { output += part; if (endsLine) this.passthrough = false; continue; }
      this.pending += part;
      if (endsLine) { output += this.complete(this.pending); this.pending = ""; continue; }
      const candidate = this.pending.trimStart().toUpperCase();
      if (!this.fence && this.metadata.test(this.pending)) { this.hidden = true; continue; }
      const possibleMetadata = !this.fence && this.names.some(name => name.startsWith(candidate) || (candidate.startsWith(name) && !candidate.slice(name.length).trim()));
      const possibleFence = !candidate || /^ {0,3}(?:`{1,2}$|~{1,2}$|`{3,}|~{3,})/.test(this.pending);
      const possibleContinuation = this.continuation && (!candidate || '[]{}",'.includes(candidate[0]));
      if (!possibleMetadata && !possibleFence && !possibleContinuation) {
        this.continuation = false; output += this.pending; this.pending = ""; this.passthrough = true;
      }
    }
    return output;
  }

  finish(): string {
    const pending = this.pending; this.pending = "";
    const candidate = pending.trim().toUpperCase();
    if (this.hidden || (!this.fence && candidate && this.names.some(name => name.startsWith(candidate)))) return "";
    return this.complete(pending);
  }
}
