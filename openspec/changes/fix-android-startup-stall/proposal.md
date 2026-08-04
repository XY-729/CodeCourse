# Fix Android Startup Stall

## 问题

用户反馈安卓端"刚打开的时候还是卡顿"。冷启动时 UI 被阻塞数秒，主要瓶颈：

1. **`AndroidLocalProvider.create()` 串行瀑布**：`db.init()`（约 40 张表建库 + 加密密钥初始化）→ `reconcileGenerationServiceState` → `resumeTasks` → `resumeIndexes` → `resumeObserverJobs`，全部 await 后才返回 provider。而 App 首帧渲染等 provider 就绪后才开始加载数据。
2. **`openProject()` 串行加载**：8 个接口挤进一个 `Promise.all`，其中 `hydrateStoredLayout` 对每个打开的面板逐个 `getProjectFile`/`getCourseContent`（每面板一次 DB 读）。整个阶段 `setLoading(true)`，主界面只有加载态。
3. **N+1 查询**：`listProjects` 对每个项目单独查一次 `courseNames`。

## 目标

- 冷启动首帧尽快渲染（秒级可交互），数据分阶段加载
- 不改变功能行为与数据一致性

## 非目标

- 不优化单次 SQLite 查询本身（加密 DB 单查开销是平台特性）
- 不做缓存系统重构
