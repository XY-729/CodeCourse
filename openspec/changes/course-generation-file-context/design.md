# Design: course-generation-file-context

## Problem

桌面端课件生成 pipeline 不给 LLM 提供文件的真实代码:
- `build_outline_lesson_input`(generation_service.py:330-391)只注入总纲摘要 + 本课计划 + RAG 检索片段
- RAG 检索依赖索引已构建;若未构建/未命中,返回字面量 `"索引中没有匹配片段。"`,LLM 只能编造"文件名:行号"
- Android 端 `generateOutlineLesson`(localProvider.ts:1185)有 `projectContext` 兜底(8 个关键文件真实代码),所以 Android 课件更长、引用更实

## Design

### 1. Per-lesson file list (桌面端)

新增 `lesson_files` 表(经 storage.py 迁移):

```
lesson_files(
  project_id INTEGER,
  lesson_number INTEGER,
  file_path TEXT,
  source TEXT,          -- 'index' | 'key_files' | 'llm'
  PRIMARY KEY (project_id, lesson_number, file_path)
)
```

选择时机:总纲任务完成(`run_outline_generation_task` 写盘后)立即执行 `select_lesson_files(project_id, outline)`。

选择逻辑(与 spec 的 index→key_files→llm 三级一致):
1. `search_project(project_id, lesson_title + lesson_section, limit=10)` → 取不同文件的 top N(去重后 2-10 个)
2. 若结果不足:按目录树启发式补关键文件(README、CMakeLists、入口 main.*、被多处 include 的头文件)
3. 若仍不足(极端情况):可做一次轻量 LLM 调用,让模型从目录树挑文件;**实现第一版跳过 LLM 调用**,保留扩展点

### 2. Lesson input 注入文件代码

`build_outline_lesson_input` 重写(保持签名 `(project_id, repo_root, lesson_number, requested_title, instructions) -> (title, lesson_input, input_hash)`):

```
lesson_input = [
  "项目总纲摘要：\n```markdown\n" + outline[:7000] + "\n```",
  "本课计划：\n```markdown\n" + lesson_section + "\n```",
  "涉及文件代码：\n" + file_code_blocks,        # 新
  "RAG 索引检索片段：\n" + rag_context,          # 保留,可为空提示
]
```

`file_code_blocks` 构造(新函数 `build_file_code_blocks(repo_root, files, budget=24000)`):
- 每文件:头部注释 `### <relative_path>` + 代码(单文件 ≤12000 字符,超长取 head 4000 + tail 4000,中间 `# ... (省略 n 行) ...` 占位)
- 按预算分配;超出预算的后续文件截断
- 文件缺失/读取失败 → 跳过并记 log,不影响其它文件

`input_hash` 加入 file_code_blocks 与 rag_context,保证 checkpoint 失效正确。

### 3. Android 端对齐

`localProvider.ts`:
- `generateOutline`(1080 行):成功生成 outline 后,插入 `selectLessonFiles`(每课标题 → 本地 search / projectContext 式直读,持久化到新表 `lesson_files`)
- `generateOutlineLesson`(1185 行):lessonInput 改为 **总纲 + 涉及文件代码 + RAG 片段**,文件代码优先,projectContext 降级为仅在涉及文件为空时兜底
- `database.ts`:新增 `lesson_files` 表(与桌面端同 schema)

### 4. 存储迁移

桌面端 `storage.py`:`_migrate_*` 增加 `lesson_files` 建表。Android `database.ts` `initTables()` 增加同表。

## 权衡与说明

- **不修索引本身**:索引是好的(406 chunks,FTS5 检索正常),问题在生成 pipeline 对索引的强依赖
- **第一版不做 LLM 选文件**:自动选择(index → key_files 启发式)已能覆盖绝大多数场景;LLM 选文件留给后续(设计上留了 `source='llm'` 字段)
- **hash 包含新内容**:旧 checkpoint 因 hash 不同而自动失效,已生成的课件需重新生成才生效
- 总纲生成后选文件是后台快速操作(索引查询 / 目录读取),不阻塞用户

## 涉及文件

- 新增 `backend/app/services/lesson_files.py` — 选文件 + 构建代码块
- `backend/app/services/storage.py` — lesson_files 表 + 迁移 + CRUD
- `backend/app/services/generation_service.py` — 总纲完成后调 select;build_outline_lesson_input 注入代码块
- `frontend/src/platform/android/database.ts` — lesson_files 表
- `frontend/src/platform/android/localProvider.ts` — 总纲后选文件;课件输入注入文件代码
