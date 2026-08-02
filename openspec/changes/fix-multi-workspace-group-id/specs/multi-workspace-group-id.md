# Specs: 修复多工作区联动 bug（group id 冲突）

## 1. layout.ts 新增 normalizeGroupIds

**Given** 持久化布局 `LayoutNode`（可能含 `group-2` 等 id 与重复 id）和 `nextId(prefix: string) => string`（语义与 App.tsx `nextId` 一致：前置自增共享计数器、返回 `${prefix}-${count}`）

**When** 调用 `normalizeGroupIds(node, nextId)`

**Then**

- 返回与原布局同构的新 `LayoutNode`（split/group 结构、items、activeItemId、ratio 等全部保留）
- 对每个 `group-N` 形 id 恰好消费一次 `nextId("group")`（计数器推进到超过布局中最大 N）
- 遍历中重复出现的 group id（含非 `group-N` 形 id 的重复）被重命名为 `nextId("group")` 的结果
- 深度嵌套 split 递归遍历，全部 group 覆盖

## 2. App.tsx 恢复路径接入

**Given** Android 与桌面两条布局恢复路径（`hydrateStoredLayout` 之后）

**When** 恢复的布局交给 `syncLayoutIdCounter`

**Then** `syncLayoutIdCounter` 只做 `normalizeGroupIds(node, nextId)` 委托；之后任何新分割生成的 group id 不与已恢复 id 冲突

## 3. 单元测试

**Given** `frontend/src/__tests__/workspaceNormalization.test.ts`

**When** 运行测试套件

**Then**

- 恢复含 `group-2` 的布局后，下一个 `nextId("group")` 不与任何恢复 id 冲突
- 重复 id 布局被重命名且 id 集合唯一（含非数字 id 重复）
- 深度嵌套 4 组去重后 id 唯一
- 布局形状与 items 数据不变

## 4. 回归验证

**Given** 修复后的代码

**When** 运行 `npx tsc -b`、全量前端测试、`npm run build`

**Then** 零类型错误；全部测试通过（396+）；build 成功
