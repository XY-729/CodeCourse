# Tasks: 课件生成后自动连接总纲节点

## 1. 后端 `generation_service.py`

- [x] 1.1 导入 `create_knowledge_edge`
- [x] 1.2 新增 `_link_lesson_to_outline(project_id, lesson_node_id, outline_rel)` 辅助函数(find/create 总纲节点 + 建 parent_of 边)
- [x] 1.3 `run_file_lesson_task`:补建 course 节点 + 连 `outline.md`
- [x] 1.4 `run_outline_lesson_task` learning_plan 分支:捕获节点 + 连 `outline_path or "outline.md"`
- [x] 1.5 `run_outline_lesson_task` repository 分支:捕获节点 + 连边
- [x] 1.6 `stream_outline_lesson_generation`:捕获节点 + 连边

## 2. Android `localProvider.ts`

- [x] 2.1 新增 `linkLessonToOutline(projectId, lessonNodeId, outlinePath)`(createNode 幂等取总纲 + createEdge 建 parent_of)
- [x] 2.2 任务完成持久化块:非 outline/sub_outline 类型取 `payload.outline_path || "outline.md"`,先 `ensureCourseNode` 再连边

## 3. 测试

- [x] 3.1 后端单测:各路径建边、总纲缺失自动创建、幂等无重复边(`tests/test_outline_graph_links.py`,4 用例通过)
- [x] 3.2 Android 单测:17 个 platform/android 测试通过(无回归)
- [x] 3.3 `python -m py_compile` 通过
- [x] 3.4 `npx tsc -b` 通过

## 4. 验证

- [x] 4.1 后端回归测试:255 个测试全部通过
- [x] 4.2 前端测试套件回归(platform/android)
- [ ] 4.3 打包 APK 给用户真机验证
