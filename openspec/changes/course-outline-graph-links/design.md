# Design: 课件生成后自动连接总纲节点

## 背景

知识图谱由 SQLite `knowledge_nodes`/`knowledge_edges` 持久化(`storage.py:750-819`)。节点类型含 `course`(总纲与课件共用)。边类型 `Literal["explains","parent_of","related_to","references"]`(`schemas.py:389`)。前端 `KnowledgeGraphViewer.tsx:108-113` 已含 `parent_of → 父子` 标签。

现状缺口:
- 课件节点已建(三个 `outline_lesson` 路径 + 文件课件),但无任何边 → 图中孤立。
- 总纲节点只在用户追问总纲时惰性创建(`knowledge_service.py:_resolve_source_node`,title="总纲",ref_path="outline.md")。
- `create_knowledge_edge`(`storage.py:3450`)按 (project_id, source, target, relation_type) 去重,幂等。

## 方案

### 共享辅助函数(后端)

```python
def _link_lesson_to_outline(project_id, lesson_node_id, outline_rel):
    outline = find_knowledge_node(project_id, node_type="course", ref_type="course", ref_path=outline_rel)
    if outline is None:
        outline = create_knowledge_node(
            project_id=project_id, node_type="course",
            title="总纲" if outline_rel == "outline.md" else outline_rel,
            ref_type="course", ref_path=outline_rel, summary="课程学习总纲")
    create_knowledge_edge(project_id, outline.id, lesson_node_id, "parent_of", "属于总纲")
```

边方向语义:`parent_of` 源为总纲,目标为课件(总纲是课件的父)。`create_knowledge_edge` 幂等,重生成不产生重复边。

### 调用点(后端 `generation_service.py`)

| 路径 | 位置 | 总纲 ref_path |
|---|---|---|
| `run_file_lesson_task`(文件课件) | 节点创建后 | `"outline.md"`(硬编码,与 `build_file_lesson_input` L794 一致) |
| `run_outline_lesson_task` learning_plan 分支 | 节点创建后 | `outline_path or "outline.md"` |
| `run_outline_lesson_task` repository 分支 | 节点创建后 | `outline_path or "outline.md"` |
| `stream_outline_lesson_generation`(SSE) | 节点创建后 | `outline_path or "outline.md"` |

文件课件此前不建节点,本变更补建 `course` 节点(title=源文件名,ref_path=`files/{base}_{mode}.md`),与 Android 端 `ensureCourseNode` 行为对齐。

### 调用点(Android `localProvider.ts`)

任务完成持久化块:对 `outline`/`sub_outline` 之外的任务类型,取 `payload.outline_path || "outline.md"` 为总纲路径,`ensureCourseNode` 取课件节点后 `linkLessonToOutline` 建边。总纲/子总纲任务自身跳过(避免自连)。

## 测试

- 后端: 单测验证各路径建边、总纲缺失自动创建、幂等无重复边(见 tasks)。
- Android: `localProvider` 单测验证任务完成后建 `parent_of` 边、总纲任务不自连。
- 类型: `npx tsc -b`;后端 `python -m py_compile`。

## 不做

- 不建新的图谱构建/刷新端点;边由生成副作用增量写入(与现有机制一致)。
- 不动前端渲染逻辑(`RELATION_LABELS` 已支持 `parent_of`)。
