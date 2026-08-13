# 修复桌面端子总纲文件选择与高亮残留

## 背景

用户在桌面端反馈两个问题：

1. **文件选择窗口无法弹出**：在生成面板选择"指定文件"后，无法弹出文件选择窗口。
2. **选中高亮不消失**：生成完成后，侧边栏中之前选中的文件仍然保持绿色高亮（`.scope-selected`）。

## 问题分析

### 问题 1：文件选择"窗口"被遮罩盖住

桌面端"指定文件"模式没有独立弹窗——切换时经 `GenerationSheet.onScopeChange("files")` 调用 `openMobileNavigation("files")`，打开左侧源码侧边栏并进入点选模式（`fileSelectionMode`）。但生成面板的 `.apple-sheet-layer` 是 `position: fixed; z-index: 70` 的全屏遮罩（`apple-overlays.css:1-11`），覆盖整个工作区：

- 侧边栏渲染在 `main.workbench` 的 grid 内联列内（无 z-index、非浮层），**被遮罩完全盖住**；
- 所有点击都落在遮罩上，被 `onMouseDown={onClose}` 当作"点击遮罩关闭面板"，表现为"窗口没弹出来"。

安卓无此问题：移动端有独立的文件选择视图（`MobileGenerationPanel` files 视图），不走侧边栏。

### 问题 2：生成成功后选中状态未清理

`handleGenerateOutline`（`App.tsx:2869`）与 `handleGenerateOutlineLesson`（`App.tsx:3067`）的成功路径只调用 `setGenerationOpen(false)` 关闭面板，从未清理 `selectedScopeFiles`：

- 侧边栏文件的绿色高亮（`.tree-row.scope-selected`，`styles.css:331-339`）由 `selectedScopeFiles` 驱动，一直保持亮起；
- `fileSelectionMode`（`!isLearningPlanProject && scopeType === "files"`）仍为 true，侧边栏持续处于点选模式；
- 下次打开生成面板仍带着旧的选中文件，`buildScope` 会继续沿用旧选择。

## 方案

1. **问题 1**：`GenerationSheet.onScopeChange` 收到 `"files"` 时，先关闭生成面板再打开侧边栏。侧边栏是 workbench 内联 grid 列，没有浮层遮挡，用户可直接点选文件；选中完成后点"生成总纲"重新打开面板，`scopeType === "files"` 且已有选中文件，流程顺畅。
   - 注意：桌面端 `onScopeChange` 闭包是 `handleOpenGeneration` 内联的（`App.tsx:5829` 附近），修改时新增桌面分支：`setGenerationOpen(false)` + `openMobileNavigation("files")`。
2. **问题 2**：`handleGenerateOutline` 与 `handleGenerateOutlineLesson` 的成功路径（任务创建成功后、`setGenerationOpen(false)` 前后）清理选中状态：
   - `setSelectedScopeFiles([])`；
   - 同步重置 `scopeType` 为 `"full_project"`（非学习计划项目时），使 `fileSelectionMode` 复位、侧边栏恢复正常导航语义，下次打开面板默认回到"全项目"，与子总纲默认整份生成语义一致。
3. 补一个前端测试：成功生成后选中状态与 scope 被清理（桌面路径）。

## 非目标

- 不为桌面端新增独立文件选择弹窗（现有侧边栏点选已满足交互，本修复让其可用）。
- 不改动安卓端文件选择流程。
- 不改动 `ContextFilePickerDialog`（问答参考文件选择器，与子总纲无关）。
