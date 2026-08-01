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

- [ ] 5.1 桌面 dev backend 真实验证：仓库项目生成课件，确认并发（多章节）、进度条显示、输出含文件证据/RAG 片段
- [ ] 5.2 总纲与文件课件进度条可见
- [ ] 5.3 Android 端回归：课件生成不受影响

## 6. 打包与推送

- [ ] 6.1 提交推送（含 openspec 变更），CI 绿
- [ ] 6.2 重新打包桌面端（kill → rm dist → clean pycache → pack → 拷贝 → 验证 shortcut/exe）
- [ ] 6.3 重新构建 APK 交付
