# Proposal: fix-android-project-deletion-leak

## Problem

安卓端删除项目后 app 变得卡顿；切换项目后的一段时间也卡顿。根因不是缓存或资源不足，而是**删除项目时 SQLite 索引数据泄漏**：

- `deleteProject`（localProvider.ts:850）只手动清理了 FTS 表 `code_chunks_fts` 与学习/个性化作用域表，**从未删除 `code_chunks` 与 `indexed_files` 两张索引主表**。这两个表每行对应一个项目的切块数据（每 ~80 行一个 chunk + 全文检索条目），大项目可达数万行。项目删除后这些行永久残留。
- 残留行导致：`search_project`（1878 行 JOIN code_chunks_fts + code_chunks）每次搜索都要扫描幽灵数据；`indexStatus`/`buildIndex` 的 `COALESCE(MAX(generation))` 对死行计算；数据库文件持续膨胀，所有查询变慢。这就是"删除项目后卡顿"。
- "切换项目后卡顿"是残留数据放大 + 正常索引重建叠加的结果。
- 顺带发现 `project_files` 表未清理，同样泄漏（删除项目后项目文件清单还在）。

## Why it matters

- 用户明确报告删除项目后卡顿；这是数据泄漏 bug，不是性能优化问题——"向手机申请更多资源"无法解决（死行仍然在、仍然被扫）。
- 数据库体积无上限增长，会随删除/导入项目次数累积恶化。

## Scope

- 仅安卓端（`frontend/src/platform/android/localProvider.ts`）删除项目路径。
- 不改桌面端后端（其 ORM/级联删除已有完整清理）。
- 不含索引性能优化（增量重建、批量插入等），另行评估。

## Approach

1. 在 `deleteProject` 中删除索引主表与文件清单表（FTS 表需先删，且表内无 `project_id` 索引，删除可能较慢，但在项目删除事务中可接受；`indexed_files`/`project_files` 依赖 FK 级联，先删手动表、后删项目行即可清干净）：
   ```ts
   await db.run("DELETE FROM code_chunks_fts WHERE project_id = ?", [projectId]).catch(() => undefined);
   await db.run("DELETE FROM code_chunks WHERE project_id = ?", [projectId]).catch(() => undefined);
   await db.run("DELETE FROM indexed_files WHERE project_id = ?", [projectId]).catch(() => undefined);
   await db.run("DELETE FROM project_files WHERE project_id = ?", [projectId]).catch(() => undefined);
   ```
   （现有 `DELETE FROM code_chunks_fts` 保留；其 `.catch(() => undefined)` 模式沿用。）
2. 新增单元测试：验证 `deleteProject` 调用后 `code_chunks`、`code_chunks_fts`、`indexed_files`、`project_files` 均为空；复用现有 provider 测试基建（mock 的 `db`）。
3. 回归验证：前端 `tsc` + 全量测试通过。

## Success criteria

- 删除项目后索引表（`code_chunks`/`code_chunks_fts`/`indexed_files`/`project_files`）无该项目的任何残留行。
- 新增测试通过；现有测试无回归。
