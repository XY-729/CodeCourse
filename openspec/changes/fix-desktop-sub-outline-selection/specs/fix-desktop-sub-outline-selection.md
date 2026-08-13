# 修复桌面端子总纲文件选择与高亮残留

## 需求背景

用户报告桌面端两个缺陷：

1. 生成面板选择"指定文件"范围后，文件选择"窗口"无法弹出（被面板遮罩盖住）。
2. 生成完成后，侧边栏中选中的文件高亮不消失。

## 场景

### 场景 1：桌面端切换"指定文件"范围后可直接选择文件

- **当** 用户在桌面端打开生成面板（意图为 outline），并把学习范围切换为"指定文件"
- **且** 当前项目不是学习计划
- **则** 生成面板关闭，左侧源码侧边栏打开并进入文件选择模式
- **且** 侧边栏可见、可点击（无遮罩遮挡），文件行显示选中态（`scope-selected` 高亮）
- **且** 重新打开生成面板时，范围仍为"指定文件"，提示区显示已选文件数

### 场景 2：生成成功后选中状态清理

- **当** 用户以"指定文件"范围成功创建总纲任务或课件任务（`handleGenerateOutline` 或 `handleGenerateOutlineLesson` 成功路径）
- **则** `selectedScopeFiles` 被清空，侧边栏文件高亮消失
- **且** `scopeType` 重置为 `"full_project"`（非学习计划项目），侧边栏退出文件选择模式
- **且** 下次打开生成面板，范围默认为"全项目"

### 场景 3：安卓端行为不变

- **当** 用户使用安卓端进行上述操作
- **则** 文件选择仍走移动端独立视图（`MobileGenerationPanel` files 视图），不受本次改动影响

## 边界

- 学习计划项目：范围锁定为"学习计划"，`onScopeChange` 不触发侧边栏打开；成功路径清理选中状态不影响学习计划项目（`selectedScopeFiles` 恒为空）。
- 生成失败：不清理选中状态（用户可修正后重试）；若用户主动取消生成，选中状态保持（用户可能稍后重新打开面板继续选择）。

## 功能需求

- FR-1：桌面端 `GenerationSheet.onScopeChange` 收到 `"files"` 时，关闭生成面板并打开左侧源码侧边栏（`openMobileNavigation("files")`），面板状态保持 `scopeType === "files"`。
- FR-2：`handleGenerateOutline` 成功路径（任务创建成功后）执行 `setSelectedScopeFiles([])` 与 `setScopeType("full_project")`（非学习计划项目）。
- FR-3：`handleGenerateOutlineLesson` 成功路径（任务创建成功后）执行相同的清理。
- FR-4：新增前端测试，覆盖成功路径清理行为（桌面分支）。

## 技术要求

- 仅修改 `frontend/src/App.tsx`（`onScopeChange` 桌面分支、两个成功路径）与新增测试文件。
- 不新增 CSS、不修改遮罩层级（侧边栏点选交互在关闭面板后天然可用）。
- 前端 `tsc` 与 `vitest` 全绿。
