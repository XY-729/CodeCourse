# Capability: 课件生成后立即显示正确标题

## 场景

### 场景 1: 生成完成后打开课件

**Given** 课件 `lessons/lesson_01.md` 刚生成完成（`trackTask` 已 setCourses）
**When** 系统自动打开该课件
**Then** tab 标题显示内容 H1（如 `第 1 课：React 整体架构与启动流程`），而非裸文件名 `lessons/lesson_01.md`

### 场景 2: 从命令面板/拖拽打开课件

**Given** 课件已生成但 `courses` 状态尚未刷新
**When** 用户通过命令面板或拖拽打开
**Then** 标题从内容 H1 推导显示正确名称

### 场景 3: 重启后恢复布局

**Given** 应用重启，工作区布局从持久化恢复
**When** course 类型 tab 水合
**Then** 标题优先取 `availableCourses` 快照，缺失时从内容 H1 推导

### 场景 4: 阅读器当前课标题

**Given** 用户正在阅读某课
**When** 界面展示当前课标题（阅读器头部/重新生成按钮）
**Then** 使用 H1 推导的标题而非裸文件名

### 场景 5: 图谱连边失败不影响生成

**Given** 课件生成完成，但图谱连边（建节点/建边）异常（如数据库行缺失、节点不存在）
**When** 连边抛错
**Then** 课件仍标记为 completed，图谱连边仅记 warn 日志

## 边界

- 内容无 `# H1` 时回退到文件名去 `.md`（与既有 `titleFromMarkdown` 行为一致）。
- 仅影响显示标题，不改变 `course_files` 表中已快照的 title，也不改变文件名。
