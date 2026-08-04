# Spec: fix-android-project-deletion-leak

## REQ-1: 删除项目时完整清理索引与文件清单

`deleteProject(projectId)` 必须在删除项目行前，删除该项目的全部索引数据与文件清单数据，不得依赖（也不得遗漏）外键级联。

### 验收标准

- **AC-1.1** 删除项目后 `code_chunks` 表中无该 `project_id` 的残留行。
- **AC-1.2** 删除项目后 `code_chunks_fts`（FTS 全文索引表）中无该 `project_id` 的残留行。
- **AC-1.3** 删除项目后 `indexed_files` 表中无该 `project_id` 的残留行。
- **AC-1.4** 删除项目后 `project_files` 表中无该 `project_id` 的残留行。
- **AC-1.5** 上述清理全部成功时项目正常删除；任一步失败不阻断既有行为（沿用现有 `.catch(() => undefined)` 容错模式，与 `code_chunks_fts` 一致）。

### 实现要点

- 清理顺序：先删 FTS 表（`code_chunks_fts`），再删索引主表（`code_chunks`、`indexed_files`）与文件清单（`project_files`），最后删除 `projects` 行。依赖 FK 级联的表（如 `course_files`、`generation_tasks`、`qa_records` 等）无需手动处理。
- `code_chunks` 无 FTS 外键问题（`code_chunks_fts.rowid` 是普通整数引用，非 FK），先删 FTS 行即可安全删主表。

## REQ-2: 回归测试

新增测试验证删除项目清理完整（AC-1.1—AC-1.4），复用现有 AndroidLocalProvider 测试基建（mock `db`）。

### 验收标准

- **AC-2.1** 测试覆盖 `deleteProject` 调用后四张表（`code_chunks`/`code_chunks_fts`/`indexed_files`/`project_files`）查询结果为空。
- **AC-2.2** 测试在 mock 的 `db` 上运行（不依赖真实 SQLite/文件系统），与其他 provider 测试一致。
