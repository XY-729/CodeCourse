/** Lexical identity only. Contextual meaning and taxonomy come from the observer. */
export function canonicalConceptName(value: string): string {
  let text = value.trim().replace(/^`|`$/g, "").replace(/\s+/g, " ");
  if (text.length < 2 || text.length > 120 || value.includes("\n")) return "";
  if (/[。！？!?；;，=\[\]{}"“”]|为什么|怎么|如何|下一步|请解释|它要求/.test(text)) return "";
  if (/[<>]/.test(text)) {
    let depth = 0;
    let output = "";
    for (const char of text) {
      if (char === "<") depth++;
      else if (char === ">") { if (--depth < 0) return ""; }
      else if (depth === 0) output += char;
    }
    if (depth || !/^[A-Za-z_]\w*(?:(?:::|\.)[A-Za-z_]\w*)*$/.test(output)) return "";
    text = output;
  }
  if (/[(),（）/\\]|^(?:return|delete|new|void\*)\b/.test(text)) return "";
  if ((text.match(/[\u4e00-\u9fff]/g)?.length ?? 0) > 16 || text.split(" ").length > 5) return "";
  return text;
}

export function mentionsConcept(text: string, name: string): boolean {
  if (!canonicalConceptName(name)) return false;
  const left = /^[a-zA-Z0-9_]/.test(name) ? "(?<![a-zA-Z0-9_])" : "";
  const right = /[a-zA-Z0-9_]$/.test(name) ? "(?![a-zA-Z0-9_])" : "";
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(left + escaped + right, "i").test(text);
}
