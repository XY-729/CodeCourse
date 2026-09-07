from __future__ import annotations

import re


class StreamingMetadataFilter:
    """Suppress reserved metadata lines while streaming ordinary text immediately.

    Raw responses are accumulated separately for final parsing. Fenced examples
    retain their literal TITLE/TERMS text; partial metadata prefixes never leak.
    """

    def __init__(self, names: tuple[str, ...] = ("TITLE", "TERMS", "HANDOFF", "术语")) -> None:
        self.names = names
        self.metadata_re = re.compile(r"^\s*(?:" + "|".join(names) + r")\s*[:：]", re.I)
        self.pending = ""
        self.passthrough = False
        self.hidden = False
        self.fence = ""
        self.continuation = False
        self.metadata_fence = ""

    def _complete_line(self, line: str) -> str:
        if self.continuation:
            if self.metadata_fence and line.strip() == self.metadata_fence:
                self.continuation = False
                self.metadata_fence = ""
                return ""
            if re.match(r'^\s*(?:[\[\]{}",]|$)', line):
                if line.strip() == "]" and not self.metadata_fence:
                    self.continuation = False
                return ""
            self.continuation = False
            self.metadata_fence = ""
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})", line)
        if marker:
            value = marker.group(1)
            if not self.fence:
                self.fence = value
            elif value[0] == self.fence[0] and len(value) >= len(self.fence):
                self.fence = ""
            return line
        if not self.fence and self.metadata_re.match(line):
            value = self.metadata_re.sub("", line, count=1).strip()
            metadata_fence = re.match(r"^(`{3,}|~{3,})(?:json)?\s*$", value, re.I)
            self.metadata_fence = metadata_fence.group(1) if metadata_fence else ""
            self.continuation = bool(metadata_fence or not value or (value.startswith("[") and not value.endswith("]")))
            return ""
        return line

    def push(self, chunk: str) -> list[str]:
        outputs = []
        for part in chunk.splitlines(keepends=True):
            ends_line = part.endswith("\n")
            if self.hidden:
                self.pending = (self.pending + part)[:16000]
                if ends_line:
                    self._complete_line(self.pending)
                    self.pending = ""
                    self.hidden = False
                continue
            if self.passthrough:
                outputs.append(part)
                if ends_line:
                    self.passthrough = False
                continue
            self.pending += part
            if ends_line:
                visible = self._complete_line(self.pending)
                if visible:
                    outputs.append(visible)
                self.pending = ""
                continue
            candidate = self.pending.lstrip().upper()
            if not self.fence and self.metadata_re.match(self.pending):
                self.hidden = True
                continue
            possible_metadata = not self.fence and any(
                name.startswith(candidate) or candidate.startswith(name)
                for name in self.names
            )
            possible_fence = not candidate or candidate.startswith(("`", "~"))
            possible_continuation = self.continuation and (not candidate or candidate[0] in '[]{}",')
            if not possible_metadata and not possible_fence and not possible_continuation:
                self.continuation = False
                outputs.append(self.pending)
                self.pending = ""
                self.passthrough = True
        return outputs

    def finish(self) -> list[str]:
        pending, self.pending = self.pending, ""
        candidate = pending.strip().upper()
        if self.hidden or (not self.fence and candidate and any(name.startswith(candidate) for name in self.names)):
            return []
        visible = self._complete_line(pending)
        return [visible] if visible else []
