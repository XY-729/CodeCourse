import { expect, it } from "vitest";
import { StreamingMetadataFilter } from "./streamingMetadata";

it.each(["`return` 是语法", "TERMS are ordinary words", "~~划线~~正文", "中文正文"])("streams ordinary text immediately: %s", text => {
  expect(new StreamingMetadataFilter().push(text)).toBe(text);
});

it("hides arbitrarily split metadata and preserves fenced literal examples", () => {
  const filter = new StreamingMetadataFilter();
  const raw = 'TITLE: 标题\nTERMS: [\n{"name":"秘密"}\n]\nHANDOFF: {}\n正文\n```text\nTITLE: 示例\n```\n';
  let output = "";
  for (const letter of raw) output += filter.push(letter);
  output += filter.finish();
  expect(output).toBe('正文\n```text\nTITLE: 示例\n```\n');
});

it("does not leak a partial metadata prefix on interruption", () => {
  const filter = new StreamingMetadataFilter();
  expect(filter.push("HAND")).toBe("");
  expect(filter.finish()).toBe("");
});
