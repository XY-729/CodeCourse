# Proposal: 课件重命名

## 背景

课程内容（总纲、子总纲、课件、笔记）生成后文件名由系统按标题生成，用户无法修改。Codex 中断前已完成本功能的绝大部分实现（后端 API、引用迁移、前端 UI、测试），遗留工作为收尾提交与交付。

## 问题分析

- 生成后的课件文件名不可改，命名不合适（缩写、错字）只能删除重建，丢失学习状态、知识网络连边与 QA 记录。
- 手工改文件名会导致知识网络、学习进度、高亮、QA 引用全部失效。

## 方案

新增"重命名课件"能力（仅课程内容文件，系统文件 outline.md / project_map.md 不可重命名）：

1. **后端**：`PATCH /api/projects/{id}/course/{filename}`，接受新名称（自动补 `.md`、防路径穿越、拒绝保留名与重名），移动文件并原子更新其 H1 标题；若为重命名后的子总纲（`sub-outline-*.md` 或含 `<!-- CODECOURSE_OUTLINE -->` 标记），追加标记并重写课件生成链接，使课件生成功能继续可用。
2. **引用迁移**：事务内迁移 generation_tasks / qa_records / qa_sessions / highlights / knowledge_links / document_terms / learning_states / term_impressions / term_model_scans / knowledge_nodes 中该文件的路径与标题引用；失败回滚文件与引用。
3. **前端**：课程列表每行新增铅笔按钮（保留名行不显示），弹出文本输入框（`requestText`），生成任务进行中拦截；成功后同步布局、选中态、QA 历史/会话树，并刷新课程、学习状态、高亮、知识链接、QA 列表。
4. **Android**：`renameGeneratedFile` 原生重命名文件系统条目。
5. **检测**：`CourseFile.is_outline` 标记供前端识别子总纲；`_validate_sub_outline_path` 改为按文件存在性与标记校验（重命名后的子总纲仍可生成课件）。

## 非目标

- 不重命名项目仓库文件（源码）。
- 不提供目录级重命名。
- 不改 Android 端 UI 入口（仅文件系统能力；UI 沿用桌面端 CourseList 共用组件）。
