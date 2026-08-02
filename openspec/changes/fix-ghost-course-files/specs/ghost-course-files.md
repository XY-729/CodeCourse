# Specs: 修复生成失败后幽灵课件导致的 404

## 1. 后端：失败清理占位文件

**Given** `stream_file_lesson_generation` / `stream_outline_lesson_generation` / `stream_outline_generation` 任一分支开始生成（`_incremental_open` 已创建占位文件）

**When** 生成抛异常或取消

**Then**

- 任务标记 failed（stage_label="生成失败"/"已取消"）
- 输出占位文件（`output_path`）若存在则删除
- outline 分支输出目录下的占位文件（outline.md / project_map.md）一并删除
- 已完成的输出文件不受影响（completed 分支不删）

## 2. 前端：SSE error 后清理幽灵课件

**Given** 前端通过 `generateFileLessonStream` / `generateOutlineStream` / `generateOutlineLessonStream` 发起生成，收到 SSE `error` 事件（`onError` 触发）

**Then**

- 刷新课程列表（幽灵课件从列表消失）
- 若当前打开的 tab 是失败课件（`onTaskCreated` 返回的 filename 或已打开），关闭该 tab 并显示失败消息
- 不再对该幽灵课件发送 learning-state 更新

## 3. 存量幽灵课件

**Given** 已存在的幽灵课件（learning_states 记录但文件不存在）

**When** `get_learning_state` 轮询执行

**Then** 校验失败的状态记录被删除（现有逻辑，无需新增）

## 4. 验证

**Given** 修复后的代码

**When** 运行后端测试 + 前端测试

**Then** 新增失败清理测试通过；全量测试不回归
