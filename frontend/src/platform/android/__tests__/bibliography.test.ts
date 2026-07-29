import { describe, expect, it } from "vitest";
import {
  appendValidatedBibliography,
  bibliographyMarkdown,
  parseBibliographyMetadata,
  validateBibliographySelections,
} from "../bibliography";

describe("curated bibliography", () => {
  it("accepts only known IDs and exact allowed topics", () => {
    const selections = validateBibliographySelections([
      {
        id: "cpp-concurrency-in-action-2",
        topics: ["thread management", "invented chapter"],
      },
      {
        id: "cpp-primer-5",
        topics: ["multithreading"],
      },
      { id: "invented-book", topics: ["anything"] },
    ]);
    expect(selections).toHaveLength(2);
    expect(selections[0].topics).toEqual(["thread management"]);
    expect(selections[1].topics).toEqual([]);
    const rendered = bibliographyMarkdown(selections);
    expect(rendered).toContain("C++ Concurrency in Action");
    expect(rendered).not.toContain("invented chapter");
    expect(rendered).not.toContain("multithreading");
  });

  it("strips free-form citations and appends only validated metadata", () => {
    const parsed = parseBibliographyMetadata(`# 课程

### 教材依据
- 《C++ Primer》第 18.2 节“多线程”

## 下一部分
正文保留。

BIBLIOGRAPHY: [{"id":"cpp-concurrency-in-action-2","topics":["thread management"]}]`);
    const rendered = appendValidatedBibliography(parsed.content, parsed.selections);
    expect(rendered).not.toContain("18.2");
    expect(rendered).not.toContain("《C++ Primer》");
    expect(rendered).toContain("正文保留");
    expect(rendered).toContain("C++ Concurrency in Action");
  });
});
