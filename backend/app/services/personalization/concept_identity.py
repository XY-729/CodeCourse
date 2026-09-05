"""Conservative lexical identity. Semantic taxonomy belongs to the observer."""
from __future__ import annotations

import re


def canonical_concept_name(value: str) -> str:
    text = re.sub(r"\s+", " ", value.strip().strip("`"))
    if not 2 <= len(text) <= 120 or "\n" in value:
        return ""
    if re.search(r"[。！？!?；;，=\[\]{}\"“”]|(?:为什么|怎么|如何|下一步|请解释|它要求)", text):
        return ""
    # Generic arguments may contain commas; validate punctuation after stripping.
    # Retain member identity; never infer a namespace for a bare identifier.
    if "<" in text or ">" in text:
        depth = 0
        output = []
        for char in text:
            if char == "<":
                depth += 1
            elif char == ">":
                depth -= 1
                if depth < 0:
                    return ""
            elif depth == 0:
                output.append(char)
        if depth:
            return ""
        text = "".join(output)
        if not re.fullmatch(r"[A-Za-z_]\w*(?:(?:::|\.)[A-Za-z_]\w*)*", text):
            return ""
    if re.search(r"[(),（）/\\]|^(?:return|delete|new|void\*)\b", text):
        return ""
    if len(re.findall(r"[\u4e00-\u9fff]", text)) > 16 or len(text.split()) > 5:
        return ""
    return text


def mentions_concept(text: str, name: str) -> bool:
    if not canonical_concept_name(name):
        return False
    left = r"(?<![a-zA-Z0-9_])" if re.match(r"[a-zA-Z0-9_]", name) else ""
    right = r"(?![a-zA-Z0-9_])" if re.search(r"[a-zA-Z0-9_]$", name) else ""
    return re.search(left + re.escape(name) + right, text, re.IGNORECASE) is not None
