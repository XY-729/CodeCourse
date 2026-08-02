# Tasks: 修复多工作区联动 bug（group id 冲突）

## 1. 定位根因

- [x] 1.1 复现：restart 后 idCounter 从 1 开始，持久化布局保留 group-2 → 新分割生成重复 group id
- [x] 1.2 确认 `updateGroup`/`findGroup`/`splitGroup`/`removeGroupFromLayout` 按 id 精确匹配，重复 id 导致菜单/drop/close 联动
- [x] 1.3 浏览器验证：构造冲突布局到 localStorage → reload → 点 group-2 ⋯ 只弹 1 个菜单（修复后行为）

## 2. 实现

- [x] 2.1 layout.ts 新增纯函数 `normalizeGroupIds`（推进计数器 + seen 去重重命名）
- [x] 2.2 App.tsx `syncLayoutIdCounter` 委托给 `normalizeGroupIds`，两条恢复路径接入
- [x] 2.3 单元测试：计数器越过恢复 id、重复 id 重命名、非数字 id 重复、深度嵌套去重、形状/数据保留

## 3. 验证

- [x] 3.1 `npx tsc -b` 零错
- [x] 3.2 全量前端测试 396 绿（含新增 5 条）
- [x] 3.3 `npm run build` 通过

## 4. 提交推送与交付

- [ ] 4.1 提交推送（仅本变更文件）
- [ ] 4.2 重新打包桌面端并验证快捷方式指向最新
- [ ] 4.3 重建 APK 并交付绝对路径
