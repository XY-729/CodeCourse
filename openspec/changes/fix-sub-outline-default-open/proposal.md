# 修复子总纲生成后主总纲不再默认显示、桌面端子总纲分组缺失

## 背景

用户（安卓 APK 真机）报告：生成子总纲后，"原来的总纲不见了"——侧边栏总纲项消失，且打开项目默认显示子总纲内容。

现场排查确认（两端写入路径逐行核对）：

1. **数据层无覆盖**：`outline.md` / `project_map.md` 在任何路径都不会被子总纲覆盖或删除。
   - 安卓 `generateSubOutline` 写独立文件 `sub-outline-<hash>.md`（localProvider.ts:1613）。
   - 桌面 `run_outline_generation_task` / `stream_outline_generation` 的子总纲分支只写 `sub-outline-*.md`，主总纲分支写 `project_map.md + outline.md`（generation_service.py:706-714, 1813-1826）。
   - `upsertCourse` 按 filename 键控，`INSERT OR REPLACE` 不影响其他行。
2. **根因 A（打开项目默认显示被抢占）**：`openProject` 打开项目的默认文件选择（App.tsx:2420）：
   ```
   recentCourse ?? outline.md ?? 第一个课件 ?? courses[0]
   ```
   `recentCourse` 来自 `learning_states.last_opened_at`。生成子总纲后打开过它，`last_opened_at` 最新 → 每次打开项目都默认显示子总纲，主总纲不再优先出现。
3. **根因 B（桌面端子总纲分组缺失）**：`list_course_files_from_dir`（course_generator.py:39-51）用 `PREFERRED_COURSE_FILES = ["project_map.md", "outline.md"]` 把主总纲排最前，其余按文件名排序。`sub-outline-*.md` 不在 preferred 中，被归入 `其他` 分组（`_derive_group` 对无父目录返回 GROUP_LABELS 未覆盖的值）。侧边栏"项目总纲"分组只显示主总纲，子总纲单独出现在"其他"组——观感上像"总纲被替代/不见"。安卓端 `upsertCourse` 已显式写 `group="总纲"`（localProvider.ts:665），两端行为不一致。

## 目标

1. 打开项目时默认显示主总纲（`outline.md`），子总纲不再抢占默认视图。
2. 桌面端 `sub-outline-*.md` 归入"项目总纲"分组（排在 `outline.md` 之后），与安卓端一致，侧边栏完整显示主总纲 + 子总纲。
3. 子总纲仍可正常生成、打开、用于生成课件（不受影响）。

## 非目标

- 不改子总纲的生成/课件链路本身。
- 不改 `recentCourse`（最近学习）在其他场景（非默认打开）的恢复逻辑。
- 不做 UI 布局大改。

## 方案

### 前端（App.tsx）

`openProject` 默认打开选择（约 2420 行）改为 `outline.md` 优先：

```ts
const firstCourse = nextCourses.find((file) => file.filename === "outline.md")
  ?? recentCourse
  ?? nextCourses.find((file) => isLessonPath(file.filename))
  ?? nextCourses[0];
```

### 后端（course_generator.py）

`list_course_files_from_dir` 把 `sub-outline-*.md` 纳入 preferred（排在 `outline.md` 之后）：

```python
PREFERRED_COURSE_FILES = ["project_map.md", "outline.md", ...]  # 或单独处理
```

具体：在 `preferred` 列表构建时，`outline.md` 之后追加按文件名排序的 `sub-outline-*.md` 文件；`extras` 中排除它们（避免重复）。`_derive_group` 对 `sub-outline-*.md` 已返回默认分组，无需改动。

## 验证

- 前端：`openProject` 默认打开逻辑测试（有 outline.md + 子总纲 + recentCourse 指向子总纲时，默认打开 outline.md）。
- 后端：`list_course_files_from_dir` 测试（含 sub-outline-*.md 时，项目总纲分组包含主总纲与子总纲，子总纲排在 outline.md 后、课件前）。
- 真机：安卓生成子总纲 → 打开项目默认显示主总纲；侧边栏总纲分组含主总纲与子总纲。
