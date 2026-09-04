# 修复 mobileControlLayout 测试红 — 设计

## Context

`cf8cbf9` 提交的测试先行引用了 ExplainPanel 的追问 API，但该 UI 实现在 `qa-followup-topic-stability` 的 4.1 被明确排除在正式提交之外（只存在于本地未提交工作树）。正式 ExplainPanel（Props 第 24 行起）从未声明 `followUpRecord`/`onFollowUp`，也不渲染「取消追问」，只渲染「开始新问题」。测试与组件自相矛盾，正式树 `tsc -b` 报唯一错误 `mobileControlLayout.test.tsx(25,7): TS2322`。

## Goals / Non-Goals

**Goals:**
- 让已提交 main 自洽、PR Validation 恢复绿
- 保持追问 UI 被排除在正式提交之外

**Non-Goals:**
- 不把追问 UI 补进正式 ExplainPanel（引入被排除内容）
- 不改变 qa 追问功能的正式后端 / MobileAssistantPanel 行为

## Decisions

### Decision 1: 恢复测试至绿基线 `bc842f8` 版本

测试改为只使用已提交 ExplainPanel 的 Props，断言回「开始新问题」。经 `git diff bc842f8 HEAD -- <测试>` 确认两版仅差 cf8cbf9 引入的 3 处（加 `followUpRecord`、加 `onFollowUp`、断言改「取消追问」），恢复即回到历史绿态。

**Why not 在正式 ExplainPanel 补 Props/UI 桩**:提交前哨版本一旦带假状态实现会让测试「过」但 UI 失真，且等于把被排除内容搬回正式。等将来该 UI 真正正式落地时，再与 Props 一并提交。

## Validation

- 正式树 `pnpm -C frontend exec tsc -b` → exit 0
- 全量 vitest 90 文件 / 514 用例通过
