# Proposal: 修复 mobileControlLayout 测试红（引用未提交的 ExplainPanel 追问 UI）

## Why

`cf8cbf9`（feat(qa)）把 `frontend/src/__tests__/mobileControlLayout.test.tsx` 改为期望 ExplainPanel 具备 `followUpRecord` / `onFollowUp` props 并渲染「取消追问」按钮。但配套的 ExplainPanel 追问 UI 仅存在于**本地未提交工作树**，按 `qa-followup-topic-stability` 的 4.1 自述明确排除在正式提交之外，从未进入 main。

结果：自 `cf8cbf9` 起正式 main 上该测试向 ExplainPanel 传入其已提交 Props 不存在的属性 → PR Validation TypeScript 检查 `TS2322`，阻塞 `0658aed`（默认模型 v4-pro）、版本 0.4.6 及后续一切发布。

## What Changes

把该测试恢复到与**已提交 ExplainPanel** 自洽的状态（绿基线 `bc842f8` 版本）：

- 移除传给 ExplainPanel 的 `followUpRecord` / `onFollowUp`（正式 Props 无此二项）
- 断言改回已提交 ExplainPanel 实际渲染的「开始新问题」按钮

不向正式代码引入任何追问 / 取消追问 UI（该实现仍保持排除）。

## Capabilities

### Modified Capabilities
- `explain-panel-test-consistency`:移动端布局测试只引用已提交 ExplainPanel 具备的 Props 与渲染行为
