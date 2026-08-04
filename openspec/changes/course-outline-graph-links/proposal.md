# Proposal: 课件生成后自动连接总纲节点

## Why

用户要求:"所有课件必须在生成后在知识网络里连上它的总纲"。

当前知识图谱(KnowledgeGraph)中,课件(lesson)节点在生成时已创建(`generation_service.py` 三处 `outline_lesson` 路径 + 文件课件,Android 端 `ensureCourseNode`),但 **outline↔lesson 之间没有边**。总纲节点只在用户对总纲追问时才惰性创建(`knowledge_service.py:_resolve_source_node`,title="总纲",ref_path="outline.md")。结果是:课件节点在图中是孤立岛,用户无法从课件追溯到总纲,也无法从总纲看到所有衍生课件。

本变更让每个课件在生成后自动与它所属的总纲建立 `parent_of` 边,图谱中形成"总纲 → 课件"的层级。

## What Changes

**后端 `backend/app/services/generation_service.py`**

1. 新增模块级辅助函数 `_link_lesson_to_outline(project_id, lesson_node_id, outline_rel)`:
   - 按 `ref_path=outline_rel`(总纲文件相对路径)查找总纲节点;不存在则创建(title="总纲" 或子总纲文件名,ref_type="course")。
   - `create_knowledge_edge(outline.id, lesson_node.id, "parent_of", "属于总纲")`(已按三元组去重,幂等)。
2. 四个课件生成路径在节点创建后调用该辅助函数:
   - `run_file_lesson_task`(文件课件,新增 course 节点 + 连 `outline.md`)
   - `run_outline_lesson_task` learning_plan 分支(连 `outline_path or "outline.md"`)
   - `run_outline_lesson_task` repository 分支(同上)
   - `stream_outline_lesson_generation`(SSE 流式,同上)
3. 每个路径把 `find_knowledge_node`/`create_knowledge_node` 的返回值捕获到 `existing`,用其 `.id` 连边。

**Android `frontend/src/platform/android/localProvider.ts`**

1. 新增 `linkLessonToOutline(projectId, lessonNodeId, outlinePath)`:
   - `createNode` 幂等获取总纲节点(title="总纲",ref_type="course",ref_path=outlinePath)。
   - `createEdge`(已按 source/target/relation_type 去重)建 `parent_of` 边。
2. 任务完成持久化块(L687 附近):对 `outline`/`sub_outline` 之外的任务类型(`file_lesson`/`outline_lesson`),先 `ensureCourseNode` 取课件节点,再 `linkLessonToOutline`,总纲路径取 `payload.outline_path || "outline.md"`。

**子总纲**

`payload.outline_path` 或 `outline_path` 为 `sub-outline-*.md` 时,连到该子总纲节点(title=文件名),而非全局总纲。这样每个课件都连到它真正基于的总纲。

## Capabilities

### New Capabilities

### Modified Capabilities
- `course-outline-graph-links`: 课件生成后自动与所属总纲建 `parent_of` 边;总纲节点缺失时自动创建;幂等可重入
