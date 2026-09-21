/** Recognize only the generated trailing record, never arbitrary Markdown sections. */
export function splitRecordInformation(content: string): { body: string; information: string } {
  const match = /(?:^|\n)## 记录信息\r?\n\s*\r?\n(- 来源类型：[^\r\n]+\r?\n- 来源路径：[^\r\n]*\r?\n- 模型：[^\r\n]*\r?\n- 收藏：[^\r\n]*\r?\n- 创建时间：[^\r\n]*\r?\n- 更新时间：[^\r\n]*\s*)$/.exec(content);
  if (!match) return { body: content, information: "" };
  // A matching string inside an unclosed code fence is still document content.
  const before = content.slice(0, match.index);
  let fence = "";
  for (const line of before.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (!marker) continue;
    if (!fence) fence = marker;
    else if (marker[0] === fence[0] && marker.length >= fence.length) fence = "";
  }
  if (fence) return { body: content, information: "" };
  return { body: before.replace(/\n---\s*$/, "").trimEnd(), information: match[1].trim() };
}
