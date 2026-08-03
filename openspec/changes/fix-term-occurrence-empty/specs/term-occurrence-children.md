# Change: fix-term-occurrence-empty

## 1. Summary

修复课件中术语按钮渲染为空、术语原文从正文消失的问题。根因是 `occurrenceNode` 生成的 mdast 节点缺少 `children`，remark-rehype 不会把 `value` 转成文本子节点。

## 2. Motivation

- 用户反馈：md 文件里引号框住的词"过一会才能看到"，实际是**永远看不到**——按钮渲染为空且原词消失。
- 复现：包含术语（如 `seccomp 必须在 execve 前最后一步装`）的课件，正文中该短语被空按钮取代。
- 根因：`occurrenceNode` 缺 `children`；remark-rehype 对自定义节点只读 `data.hName`/`data.hProperties`。

## 3. Requirements

- **REQ-1**：`occurrenceNode` 生成的节点必须带文本子节点，使 hast 中 span 的 children 包含术语原文。
- **REQ-2**：插件分析与匹配逻辑不变（`analyzeMarkdownTermOccurrences`、`matchTermsInTextNode`、candidateId 规则）。
- **REQ-3**：MarkdownViewer 的 span 组件渲染逻辑不变；修复后按钮/Android span 内应显示术语原文。
- **REQ-4**：新增回归测试：unified 管线跑 `remarkTermOccurrences` → `remark-rehype`，断言 span 节点含文本 child 且文本等于术语原文。

## 4. Technical Design

### 4.1 `occurrenceNode` 补 children

`frontend/src/personalization/termOccurrences.ts` ~366-379：

```ts
return {
  type: "termOccurrence",
  value: match.term.term_text,
  children: [{ type: "text", value: match.term.term_text }],
  data: {
    hName: "span",
    hProperties: {
      "data-term-candidate-id": candidateId,
      "data-term-id": termId,
      "data-term-text": match.term.term_text,
      "data-term-link-origin": linkOriginOf(match.term),
      "data-term-status": match.term.status,
    },
  },
};
```

remark-rehype 对 `children` 中的 text 节点生成文本子节点，`spanProps.children` 不再为 undefined。

### 4.2 回归测试

在 `termOccurrences.test.ts` 新增：

```ts
it("renders term text inside the occurrence node (hast)", () => {
  const processor = unified()
    .use(remarkParse)
    .use(remarkTermOccurrences, { sourceKey: "course:lesson.md", terms: [term(1, "socket")] })
    .use(remarkRehype);
  const mdast = processor.parse("**socket**");
  const hast = processor.runSync(mdast);
  const span = // 遍历找 tagName === "span"
  expect(span.children).toHaveLength(1);
  expect(span.children[0].type).toBe("text");
  expect(span.children[0].value).toBe("socket");
});
```

## 5. Edge Cases

- 术语文本与正文一致时，span 内文本与原正文完全一致，视觉无差异。
- 术语在 `strong`/`em` 等内联节点内：文本 child 继承原位置，加粗等样式保留。
- 空术语：`prepareTermsForMatching` 已过滤空 `term_text`，不受影响。
- 插件异常仍走 `catch` 回退（纯 Markdown 渲染），不阻塞正文。
