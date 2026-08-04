# Specs

## REQ-1 首帧解耦

- **1.1** `AndroidLocalProvider.create()` 不再串行等待非关键恢复（`reconcileGenerationServiceState` / `resumeObserverJobs`），改为 fire-and-forget（`void` 启动，内部自捕获错误）。`db.init()` 仍 await（DB 就绪是 provider 可用的前提）。
- **1.2** `resumeTasks` 保留在 create() 中 await（生成任务恢复是核心功能，启动时若静默丢失状态会造成进度错乱）。
- **1.3** `App.tsx` 首帧渲染不依赖 provider 完成恢复：provider 就绪后立即渲染主界面骨架（导航 + 空态），`loadProjects()` 异步填充项目列表。

## REQ-2 打开项目分阶段

- **2.1** `openProject()` 第一阶段只加载轻量元数据：`getProject` + `getTree` + `getCourseFiles` + `listGenerationTasks`（4 个并行），立即 `setProject` / `setTree` / `setCourses`，渲染骨架。
- **2.2** 第二阶段（骨架渲染后）加载重数据：`getLLMSettings` / `getProjectIndexStatus` / `getLearningStates` / `listQARecords` / `getLearnerPreferences`，并行，完成后 setState。
- **2.3** `setLoading(true)` 仅覆盖第一阶段；第二阶段以增量方式更新，不阻塞界面。
- **2.4** 恢复工作区布局（`hydrateStoredLayout`）保持行为，但改为在第二阶段并行执行，不阻塞第一帧。

## REQ-3 查询减负

- **3.1** `listProjects` 用单条 JOIN 查询取 `courseNames`，消除 N+1。
- **3.2** `getProject` 同样用 JOIN 一次取课程名。

## 验证

- 前端 tsc / 测试全绿
- 真机冷启动：首帧 < 2s 可交互，项目列表先出，重数据后填充
