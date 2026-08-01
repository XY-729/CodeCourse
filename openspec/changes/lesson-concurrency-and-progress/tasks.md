# Tasks: 所有课件并发生成 + 所有生成任务进度条

## 1. 后端：仓库课件并发分章节生成

- [x] 1.1 `_run_repository_lesson_task`：规划→并发章节(≤4)→整合→组装，基于 `prompt.outline_lesson` + 章节级指令
- [x] 1.2 `run_outline_lesson_task` repository 分支委托并发流程，保留术语注册、知识节点、覆盖校验、旧课件保护
- [x] 1.3 进度上报：0/12 规划 → 1/2+N 计划完成 → 章节逐章 → 1+N 整合 → 完成

## 2. 后端：总纲与文件课件进度

- [x] 2.1 `run_outline_generation_task`：4 步进度（正在分析项目 1/4 → 正在生成总纲 2/4 → 正在解析与归档 3/4 → 生成完成 4/4），repository + learning_plan 分支
- [x] 2.2 `run_file_lesson_task`：3 步进度（正在读取文件 1/3 → 正在生成课件 2/3 → 生成完成 3/3）
- [x] 2.3 失败分支统一 `stage_label="生成失败"`

## 3. 后端测试

- [x] 3.1 `tests/test_lesson_concurrency.py`：仓库课件并发分章节（6 次调用、6/6 进度、文件证据注入）
- [x] 3.2 仓库课件失败保留旧课件
- [x] 3.3 outline 任务 4/4 进度
- [x] 3.4 file_lesson 任务 3/3 进度
- [x] 3.5 后端全量测试绿（223 个）

## 4. 前端

- [x] 4.1 `GenerationSheet.tsx` 状态区渲染进度条（`generationTaskProgress`），无 progress 时仅文字
- [x] 4.2 `apple-overlays.css` + `android-experience.css` 追加 `.generation-sheet-progress` 样式
- [x] 4.3 `npx tsc -b` 零错 + 376 测试绿 + `npm run build` 通过

## 5. 真实验证

- [x] 5.1 真实 API（deepseek-v4-flash）仓库课件生成：8 章节并发、进度 10/10 逐章推进、输出 131KB 含 `src/sandbox_linux.cpp` 等文件证据与 RAG 片段
- [x] 5.2 文件课件真实 3/3 进度（读取→生成→完成）
- [x] 5.3 总纲 4/4 进度（测试验证）

## 6. 打包与推送

- [x] 6.1 提交推送（d87009b，含 openspec 变更）
- [ ] 6.2 重新打包桌面端（kill → rm dist → clean pycache → pack → 拷贝 → 验证 shortcut/exe）
- [ ] 6.3 重新构建 APK 交付
