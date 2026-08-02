# 修复多工作区联动 bug（group id 冲突）

## 背景

用户反馈："当打开多个工作区时，会出现同时触发的 bug。比如我点击一个工作区右上角的 ⋯，所有工作区都会弹出选项。此外比如我拖动一个文件到 a 工作区，那么所有工作区都会打开文档，关闭也是同理。"

现状核查结果（已读代码确认）：

- 工作台布局持久化时 `stripLayoutContent` 保留 group/split 的 id（`"group-1"`、`"group-2"`…），只清空 items 的 content/dirty。
- App.tsx 的 `idCounter = useRef(1)`（App.tsx:531）每次 mount 从 1 开始；`nextId(prefix)` 前置自增返回 `${prefix}-${idCounter.current}`（App.tsx:1460）。
- 因此 restart 后：idCounter 回到 1 → 用户分割第一个新 workspace 时生成 `"group-2"`，与恢复布局中已存在的 `"group-2"` 重复。
- `updateGroup`/`findGroup`/`splitGroup`/`removeGroupFromLayout`（layout.ts）全部按 `group.id` 精确匹配；重复 id 时每个操作命中两个 group —— 菜单、drop、close 全部联动。
- 由该 bug 产生的持久化布局本身可能已含重复 id（重启前已联动分割过），需一并修复。

## 目标

1. 恢复持久化布局后，运行时 group id 计数器同步到布局中最大 `group-N`。
2. 恢复布局中重复的 group id 被重命名为全新 id，杜绝按 id 匹配命中多 group。
3. 逻辑提取为 layout.ts 纯函数 `normalizeGroupIds`，可单元测试。

## 非目标

- 不改持久化格式（version 仍为 1，布局结构不变）。
- 不改 `updateGroup` 等既有 API 签名。
- 不动拖放/菜单交互逻辑本身。

## 方案

- `frontend/src/workbench/layout.ts` 新增纯函数 `normalizeGroupIds(node, nextId)`：
  - 遍历 layout，遇到 `group-N` 形 id 时调用 `nextId("group")`（保持与真实 `nextId` 相同的消费语义，推进共享计数器）。
  - `seen` 集合记录已访问 id；重复 id 用 `nextId("group")` 重命名。
  - 返回修复后的 layout（其余结构/items 原样保留）。
- App.tsx 的 `syncLayoutIdCounter` 委托给 `normalizeGroupIds(node, nextId)`，两个恢复调用点（Android 与桌面路径）不变。
