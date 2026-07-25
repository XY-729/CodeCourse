import { describe, it, expect, vi, beforeAll } from "vitest";
import hljs from "highlight.js";
import { splitHighlightedToLines } from "../components/MobileCodeViewer";

// Helper: check that every line has balanced HTML tags
function hasBalancedTags(html: string): boolean {
  const stack: string[] = [];
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^>]*)?>/g;
  let match;
  while ((match = tagRe.exec(html)) !== null) {
    const full = match[0];
    if (full.startsWith("</")) {
      if (stack.length === 0) return false;
      const open = stack.pop()!;
      if (open !== match[1]) return false;
    } else if (!full.endsWith("/>")) {
      stack.push(match[1]);
    }
  }
  return stack.length === 0;
}

// Helper: check that no dangerous HTML elements exist
function hasDangerousElements(lines: React.ReactNode[][]): boolean {
  for (const line of lines) {
    for (const node of line) {
      if (typeof node === "string") {
        if (/<(script|iframe|img|svg|object|embed)/i.test(node)) return true;
        if (/\bon\w+\s*=/.test(node)) return true;
      }
    }
  }
  return false;
}

describe("splitHighlightedToLines", () => {
  it("produces balanced spans for Java multi-line comment", () => {
    const code = "/*\n * hello\n * world\n */";
    const html = hljs.highlight(code, { language: "java", ignoreIllegals: true }).value;
    const lines = splitHighlightedToLines(html);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) {
      expect(hasBalancedTags(line)).toBe(true);
    }
  });

  it("produces balanced spans for JS template string", () => {
    const code = "const v = `\nhello ${name}\nworld\n`;";
    const html = hljs.highlight(code, { language: "javascript", ignoreIllegals: true }).value;
    const lines = splitHighlightedToLines(html);
    for (const line of lines) {
      expect(hasBalancedTags(line)).toBe(true);
    }
  });

  it("produces balanced spans for Python triple-quoted string", () => {
    const code = 'value = """\nhello\nworld\n"""';
    const html = hljs.highlight(code, { language: "python", ignoreIllegals: true }).value;
    const lines = splitHighlightedToLines(html);
    for (const line of lines) {
      expect(hasBalancedTags(line)).toBe(true);
    }
  });

  it("handles empty lines", () => {
    const code = "line1\n\n\nline4";
    const html = hljs.highlightAuto(code).value;
    const lines = splitHighlightedToLines(html);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) {
      expect(hasBalancedTags(line)).toBe(true);
    }
  });

  it("handles trailing newline", () => {
    const code = "import os\nimport sys\n";
    const html = hljs.highlight(code, { language: "python", ignoreIllegals: true }).value;
    const lines = splitHighlightedToLines(html);
    for (const line of lines) {
      expect(hasBalancedTags(line)).toBe(true);
    }
  });

  it("does not produce extra closing tags", () => {
    const code = "function hello() { return 42; }";
    const html = hljs.highlight(code, { language: "javascript", ignoreIllegals: true }).value;
    const lines = splitHighlightedToLines(html);
    // Should produce exactly one line
    expect(lines.length).toBe(1);
    const opens = (lines[0].match(/<span/g) || []).length;
    const closes = (lines[0].match(/<\/span>/g) || []).length;
    expect(opens).toBe(closes);
  });

  it("no script/img/iframe elements present", () => {
    const code = '<img src=x onerror="alert(1)">\n<script>evil()</script>';
    const lines = splitHighlightedToLines(code);
    for (const line of lines) {
      expect(line).not.toMatch(/<script/i);
      expect(line).not.toMatch(/<img\b/i);
      expect(line).not.toMatch(/<iframe/i);
      expect(line).not.toMatch(/\bonerror\s*=/i);
    }
  });

  it("escapes < > & \" in text content", () => {
    const code = 'if (a < b && c > d) { return "hello & goodbye"; }';
    const lines = splitHighlightedToLines(code);
    for (const line of lines) {
      // &lt; and &gt; should appear, not raw < and >
      expect(line).not.toMatch(/ a < b /);
      expect(line).not.toMatch(/ c > d /);
    }
  });

  it("handles nested spans gracefully", () => {
    // Some highlight.js output has nested spans
    const code = '// check return type\nfunction example<T>(x: T): T { return x; }';
    const html = hljs.highlight(code, { language: "typescript", ignoreIllegals: true }).value;
    const lines = splitHighlightedToLines(html);
    for (const line of lines) {
      expect(hasBalancedTags(line)).toBe(true);
    }
  });
});
