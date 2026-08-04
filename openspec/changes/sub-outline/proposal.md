# 子总纲（Sub-Outline）

## 问题

用户想要在已有总纲的情况下，对**部分文件**做深入学习路线，但：
- 重新生成总纲会**覆盖** `outline.md`（INSERT OR REPLACE），无法保留
- 没有"基于所选文件生成独立子总纲"的能力
- 需求明确："比如我突然想深入学习部分文件，但又不想重新导入，能生成子总纲吗"——用户已确认要做

## 现状（已核实）

- `generateOutline` 固定写 `outline.md`（localProvider.ts:1570），`upsertCourse` 用 `INSERT OR REPLACE` 覆盖（:948）
- `outline_lesson` 课件从 `outline.md` 读总纲（:1621），`queueTask` 的 `sourceFingerprint = hashText(readGeneratedFile("outline.md"))`（:1240）——总纲一改，全部课件重新生成
- `outline` 任务已有 `scope.paths` 支持（`projectContext(projectId, paths)` 过滤文件，:1272-1280），前端 GenerationSheet 已有"指定文件"范围（scopeType==="files" + selectedScopeFiles）
- 课件证据管道是通用的：`prepareLessonEvidence` → `assembleLessonFileEvidence`（每文件保底 1600 字符样本）
- `selectLessonFilePaths` 有 RAG 检索 + 关键文件兜底（≤10 文件）——子总纲选择"指定文件"时不需要它，但 AI 生成子总纲时有用

## 设计

子总纲 = 一份独立 markdown 文档（`sub-outline-<hash>.md`），由用户在**选定文件**后生成，落在"总纲"分组，**不覆盖** `outline.md`；主总纲的课件生成链路完全不动（主总纲变化仍会使主课件失效重生成）。

生成路径（安卓，与主总纲共用 `generateOutline` 内核）：
- 新端点 `POST /projects/:id/outlines/sub`，body `{ title, paths, instructions }`
- 任务类型 `sub_outline`（新），生成时：
  - `projectContext(projectId, paths)` 提供选定文件上下文（现有逻辑）
  - 文件名 `sub-outline-<hash8>.md` 由 `hashText(paths+title)` 派生，幂等（同文件集重复生成 → 同文件名覆盖，不无限堆积）
  - 写 `course_files` group="总纲" + `writeGeneratedFileAtomic`
- 课件：新端点 `POST /projects/:id/lessons/sub-outline`，body `{ outline_path, lesson_number, title }`
  - `outline_lesson` 内核参数化：`outline_path` 默认 `outline.md`，取对应 `### 第 N 课` 段落，`queueTask` sourceFingerprint 用子总纲文件而非主总纲
  - 校验 `outline_path` 必须是 course_files 中存在的 `sub-outline-*.md`（防越权路径）
- 桌面端：`outline/generate` 时 scope.paths 非空 → 生成 `sub-outline-<hash>.md`（替代现有覆盖行为）；`lessons/outline` 加 `outline_path` 可选参数

## 非目标

- 不做子总纲的删除/重命名 UI（用现有 course_files 删除）
- 不做学习计划（learning_plan）的子总纲
- 不改主总纲行为
