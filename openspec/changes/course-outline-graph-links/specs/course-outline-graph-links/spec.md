# Capability: 课件生成后自动连接总纲节点

## 场景

### 场景 1: 按课生成的课件连接总纲

**Given** 项目已生成总纲(`outline.md`)
**When** 生成第 N 课课件(learning_plan / repository / SSE 流式路径)
**Then** 课件 `course` 节点(ref_path=`lessons/lesson_NN.md`)创建/复用后,与总纲 `course` 节点(ref_path=`outline.md`)建立 `parent_of` 边(label="属于总纲")

### 场景 2: 总纲节点不存在时自动创建

**Given** 项目尚未生成总纲节点(仅 `outline.md` 文件存在)
**When** 生成任一课件
**Then** 系统自动创建总纲节点(title="总纲", ref_type="course", ref_path="outline.md"),再建 `parent_of` 边

### 场景 3: 文件课件连接总纲

**Given** 项目有总纲
**When** 生成文件课件(`files/{base}_{mode}.md`)
**Then** 文件课件也建 `course` 节点,并与 `outline.md` 建立 `parent_of` 边

### 场景 4: 子总纲课件连接到子总纲

**Given** 基于 `sub-outline-*.md` 生成课件
**When** 课件生成完成
**Then** 课件节点连接到该子总纲节点(ref_path=`sub-outline-*.md`),而非全局总纲

### 场景 5: 幂等重入

**Given** 课件已生成并已连边
**When** 重新生成同一课件(缓存命中或重跑)
**Then** 不产生重复边(`create_knowledge_edge` 按 source/target/relation_type 去重)

### 场景 6: Android 端

**Given** Android 端生成课件(文件课件或按课课件)
**When** 任务完成持久化
**Then** 课件节点与总纲节点(取 `payload.outline_path` 或 `outline.md`)建立 `parent_of` 边;总纲/子总纲任务自身不连自己

## 边界

- 总纲/子总纲任务(`outline`/`sub_outline`)不创建自连边。
- 图谱前端 `RELATION_LABELS` 已含 `parent_of → 父子`,新增边可直接渲染。
