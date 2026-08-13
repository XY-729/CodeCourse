# Spec: 课件重命名

## 场景

### 场景 1：重命名普通课件
用户在课程列表点击铅笔按钮 → 输入新名称 → 保存。文件移动、H1 标题更新、所有数据库引用同步迁移，知识网络节点保留连边并更新标题。

### 场景 2：重命名子总纲
子总纲重命名后仍是"子总纲"：文件保留 `<!-- CODECOURSE_OUTLINE -->` 标记，课件生成链接中的 `outline_path` 更新为新文件名，基于该子总纲生成课件继续可用。

### 场景 3：非法输入
空名、路径分隔符、非法字符、重名、系统文件（outline.md / project_map.md）、自身重命名——均被拒绝并返回明确错误。

## 功能需求

### FR-1 后端 API

- `PATCH /api/projects/{project_id}/course/{filename:path}`，请求体 `{"name": string}`，返回 `CourseFile`（含 `is_outline`）。
- 校验规则：
  - 空名 / `.` / `..` → 400
  - 含 `/` `\` NUL → 400
  - 含 `<>:"|?*` → 400
  - 名称自动去 `.md` 后缀再补回（"支付模块.md" 与 "支付模块" 等价）
  - 新名与原名相同 → 400
  - 目标已存在 → 409
  - `outline.md` / `project_map.md` → 400
  - 源文件不存在 → 404
  - 文件系统错误 → 409
- 文件系统操作：
  - 移动文件（保留目录层级），原子写入新标题（首行 `# title`，无则前置）。
  - 若为子总纲（`sub-outline-*.md` 或含 `OUTLINE_MARKER`）：确保标记存在，并调用 `add_outline_lesson_links` 重写课件生成链接。
  - 全部课程文件中 `outline_path=<old>` 引用重写为 `outline_path=<new>`（URL 编码）。
  - 任何失败回滚：引用改回、文件移回、内容还原。

### FR-2 引用迁移

事务内执行 `rename_course_references(project_id, old, new, title, old_abs, new_abs)`：
- `generation_tasks.source_path / output_path`（相对与绝对）
- `qa_records.source_path（source_type='course'）/ output_path + display_title`
- `qa_sessions.active_source_path`
- `highlights / knowledge_links / document_terms / learning_states / term_impressions / term_model_scans` 的 `source_path`
- `knowledge_nodes.ref_path + title`（ref_type in course/qa）

### FR-3 子总纲校验扩展

`_validate_sub_outline_path(project_id, outline_path)` 不再仅匹配文件名正则，改为：
- 解析并校验路径在课程目录内；
- 文件必须存在；
- 文件名为 `sub-outline-*.md` **或** 内容含 `OUTLINE_MARKER`。

所有调用点（preview、build_input、create/reuse task、stream）传入 `project_id`。

### FR-4 前端

- `CourseList` 每行（保留名行除外）显示铅笔按钮（`Pencil` 图标，`title="重命名课件"`），点击不触发行选中。
- `Sidebar` 透传 `onRenameCourse`。
- `App.handleRenameCourse`：
  - 生成/QA/任务进行中 → toast 拦截；
  - `requestText` 弹窗（默认值当前标题，空输入取消）；
  - flush 待提交的学习状态更新；
  - 成功后：布局 items（course/qa 类型的 path/title/id）、activeItemId、selectedCourse、QA 历史与会话树的 source/output/display_title 全部同步；
  - 刷新 courses / learning states / highlights / knowledge links / QA history，递增 knowledge refresh key，toast 提示。
- `api/client.ts` 新增 `renameCourseFile(projectId, filename, name)`（PATCH，路径段 encodeURIComponent）。
- `platform/android/workspace.ts` 新增 `renameGeneratedFile`（Filesystem.rename）。

### FR-5 样式

- `.course-row-actions` 容器容纳操作按钮；悬停/焦点显示（移动端始终可见，44px 触控尺寸）。

## 边界与约束

- 保留系统文件：`outline.md`、`project_map.md` 不可重命名（后端 400 + 前端隐藏按钮）。
- 重命名不改变文件所属组（group 由路径推导）。
- 迁移失败时回滚文件与引用，保持一致性。
- 测试：`backend/tests/test_course_rename.py`（图谱连边保留 + 引用迁移 + 拒绝保留名/重名）。
