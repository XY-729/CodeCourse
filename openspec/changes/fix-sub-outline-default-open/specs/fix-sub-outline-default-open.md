# Specs: 修复子总纲抢占默认显示 + 桌面端子总纲分组

## 1. 打开项目默认显示主总纲

**Given** 项目课程列表包含 `outline.md`（主总纲）与 `sub-outline-*.md`（子总纲），且 `learning_states` 最近打开的课程是子总纲

**When** 用户打开该项目（无工作区布局恢复）

**Then**

- 默认打开的课件是 `outline.md`（主总纲），而不是子总纲
- 子总纲仍可通过侧边栏正常打开

## 2. 桌面端子总纲分组

**Given** 项目课程目录包含 `project_map.md`、`outline.md`、`sub-outline-<hash8>.md`、若干课件文件

**When** 调用 `list_course_files_from_dir` 列出课程

**Then**

- 返回列表中 `sub-outline-<hash8>.md` 的 `group` 为"项目总纲"
- 排序为：`project_map.md`、`outline.md`、`sub-outline-*.md`（按文件名），之后才是课件
- `sub-outline-*.md` 不出现在"其他"分组，也不重复出现

## 3. 安卓端行为不变

**Given** 安卓端 `upsertCourse` 对 `sub_outline` 任务写 `group="总纲"`

**When** 生成子总纲

**Then**

- 分组行为保持现状（不回归）
- 本变更不改安卓端分组代码

## 4. 验证

**Given** 修复后的代码

**When** 运行后端测试 + 前端测试 + tsc

**Then**

- 新增默认打开测试通过：recentCourse 指向子总纲时仍默认打开 outline.md
- 新增课程列表分组测试通过：sub-outline 归入项目总纲组
- 全量测试不回归
