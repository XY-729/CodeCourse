# Fix empty term occurrence buttons

## 背景

用户在课件里反馈：被引号框住的词"过一会才能看到"，实际表现为**课件中术语按钮渲染为空、术语原文消失**（如 `seccomp 必须在 execve 前最后一步装` 只剩一个空按钮）。

## 根因

`frontend/src/personalization/termOccurrences.ts` 的 `occurrenceNode`（~366-379）生成的 mdast 节点只有 `value` 字段、没有 `children`：

```ts
return {
  type: "termOccurrence",
  value: match.term.term_text,
  data: { hName: "span", hProperties: {...} },
};
```

remark-rehype 对自定义节点只映射 `data.hName` / `data.hProperties`，**不会把 `value` 转成文本子节点**。已用项目内统一栈（remark-parse → remark-rehype，无 stringify 也可观察 hast）实证：转换后 `<span ... children=0>`。于是：

- 该 span 渲染为空；
- 插件用 occurrenceNode **替换**了原文本节点（`entry.parent.children.splice(entry.childIndex, 1, ...nextChildren)`），原文因此从 DOM 中消失；
- MarkdownViewer 的 span 组件把 `spanProps.children`（undefined）放进按钮 → 空按钮。

## 方案

`occurrenceNode` 增加 `children: [{ type: "text", value: match.term.term_text }]`，使 remark-rehype 生成带文本子节点的 span；按钮/Android span 的 children 不再为 undefined。

## 影响范围

- `frontend/src/personalization/termOccurrences.ts`：occurrenceNode 补 children
- `frontend/src/personalization/__tests__/termOccurrences.test.ts`：新增渲染断言（hast 树 span 含文本 child），防止回归
- 不改后端、不改渲染组件（MarkdownViewer span 组件已正确使用 spanProps.children）

## 验证

1. 新增测试：用 unified 管线跑 remarkTermOccurrences → remark-rehype，断言 span 节点含文本子节点且文本等于术语原文
2. 前端 tsc / npm test / build 全绿
3. 浏览器 preview 验证空按钮消失、术语原文出现在按钮内
4. 重打包桌面 + 重建 APK
