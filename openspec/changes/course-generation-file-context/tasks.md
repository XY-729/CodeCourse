## 1. 数据层 — lesson_files 表

- [x] 1.1 `backend/app/services/storage.py`:新增 `lesson_files(project_id, lesson_number, file_path, source, PRIMARY KEY(project_id, lesson_number, file_path))` 建表语句并入 schema 初始化
- [x] 1.2 `backend/app/services/storage.py`:新增 `_migrate_*` 迁移逻辑(旧库补建该表)
- [x] 1.3 `backend/app/services/storage.py`:新增 CRUD `upsert_lesson_files()`、`get_lesson_files(project_id, lesson_number)`、`delete_lesson_files(project_id, lesson_number)`
- [x] 1.4 `frontend/src/platform/android/database.ts`:`initTables()` 增加同结构 `lesson_files` 表

## 2. 文件选择与代码块构建 — backend/app/services/lesson_files.py(新)

- [x] 2.1 实现 `select_lesson_files(project_id, repo_root, outline) -> dict[int, list[str]]`:解析每课标题(复用 `extract_outline_lessons`),每课先 `search_project` 取 top 文件
- [x] 2.2 实现索引不足时的关键文件启发式:README、CMakeLists/package.json/pyproject、入口文件(main.*)、被多个文件 include 的头文件,补足每课 2-10 个文件
- [x] 2.3 实现 `build_file_code_blocks(repo_root, files, budget=24000) -> str`:每文件 `### <path>` + 代码,单文件 ≤12000 字符,超长 head 4000 + tail 4000 + 省略占位
- [x] 2.4 文件缺失/读取失败时跳过并记录,不影响其它文件
- [x] 2.5 单测:`tests/test_lesson_files.py` — 选择逻辑(索引命中/索引空)、代码块构造(超长文件截断、缺失文件跳过)

## 3. 桌面端生成 pipeline 接入

- [x] 3.1 `generation_service.py` `run_outline_generation_task`:总纲写盘后调用 `select_lesson_files` 并 `upsert_lesson_files` 持久化(失败不阻塞总纲完成)
- [x] 3.2 `generation_service.py` `build_outline_lesson_input`:读取 `get_lesson_files`,调用 `build_file_code_blocks` 构造"涉及文件代码"段,注入 lesson_input
- [x] 3.3 `input_hash` 纳入 file_code_blocks 与 rag_context,保证旧 checkpoint 失效
- [x] 3.4 保留 RAG 检索片段(有则并入),文件代码块作为主要上下文
- [x] 3.5 更新 `tests/test_generation_service.py` 相关断言(输入包含涉及文件代码)

## 4. Android 端对齐

- [x] 4.1 `localProvider.ts` `generateOutline`:生成成功且非 learning_plan 时,逐课选择涉及文件并写入 `lesson_files`(复用本地 `search` 与 `projectContext` 直读逻辑)
- [x] 4.2 `localProvider.ts` `generateOutlineLesson`:lessonInput 优先注入"涉及文件代码"(直读文件,每文件 head/tail 采样),RAG 检索片段保留,`projectContext` 降级为兜底
- [x] 4.3 Android 端 `generateDetailedLesson` 的输入构造同步检查(是否同样缺文件代码)

## 5. 验证

- [x] 5.1 桌面端:对 mikuOJ 项目(索引已建)重新生成一课,确认课件包含真实行号引用且指向非空行
- [x] 5.2 桌面端:对索引未建项目生成课件,确认文件代码兜底生效(不再出现"索引中没有匹配片段")
- [x] 5.3 后端测试通过:`python -m pytest backend/tests -x`(相关部分)
- [x] 5.4 Android:构建 APK,验证总纲后选文件与课件代码注入
- [x] 5.5 检查 checkpoint 失效行为:旧课件 hash 不匹配时自动重新生成
