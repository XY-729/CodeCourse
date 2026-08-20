# 修复 Android 后台生成"假运行"

> **状态：已废弃。** 该方案依赖 WebView 在后台持续执行，但 Android 不保证这一行为。当前实现以 `android-foreground-generation-recovery` 为准：生成仅在前台运行，持久化检查点用于中断恢复，原生层只发送完成通知。

## 背景

用户（安卓 APK 真机）报告：后台生成"是假的"——通知挂在通知栏几小时不更新，回到应用才真正推进。

排查确认（Capacitor 源码逐行核对）的根因链：

1. **所有生成逻辑运行在 WebView 的 JS 中**（`localProvider.ts` 的 `runTask` → `callLLM` → `CapacitorHttp` → DB/文件写入）。原生 `CodeCourseGenerationService` 只是前台服务（通知 + PARTIAL_WAKE_LOCK），**不执行任何生成**。
2. **WebView 在后台被挂起**：Capacitor `BridgeActivity.onPause()` → `Bridge.onPause()` → `MockCordovaWebViewImpl.handlePause()` → `webView.onPause()`。官方文档明确要求 pause 后立即恢复（否则页面/渲染进程挂起、onResume 不再触发）。宿主进程进后台时，WebView 渲染进程还会被系统降低优先级/节流。
3. **JS 无后台心跳**：`reportProgress` 只在任务主动推进时才更新通知。LLM 单次调用（max_tokens 65536）可达数分钟，这期间通知完全静止；`shouldSendProgress` 又按 stage label 节流，后台被节流时可能远超 1.5s 才重发。
4. **结果**：后台期间 JS 被挂起 → 生成停滞 → 通知纹丝不动 → 回到前台 `appStateChange` 恢复 → 任务继续。用户观感"假生成"。

## 目标

1. 后台时 WebView 渲染进程保持运行（`setRendererPriorityPolicy`），JS 不被挂起。
2. 后台期间通知持续真实地反映进度（原生侧心跳兜底，不受 JS 节流/挂起影响）。
3. JS 在后台期间仍处于挂起状态时，通知诚实显示"回到应用后继续生成"，而不是假进度。
4. 回到前台时立即恢复推进（已有 `appStateChange` → `resumeTasks` 链路，保持）。

## 非目标

- 不把生成逻辑迁移到原生（WorkManager 等）——那是另一个量级的重构，另行评估。
- 不改 `shouldSendProgress` 节流策略本身（前台体验不变）。
- 不动桌面端。

## 方案

### 原生（3 个文件）

**MainActivity.java**：`onPause` 里，若后台仍有活跃生成任务（`CodeCourseGenerationService.isServiceActive()`），跳过 `super.onPause()`（从而跳过 `webView.onPause()`），并补发 `onResume()` 事件；无任务时维持默认行为。`onResume` 里同样在任务活跃时显式 `bridge.onResume()`。`onCreate` 里设置 `WebView.setRendererPriorityPolicy(RENDERER_PRIORITY_IMPORTANT, false)`（API 26+，minSdk 26，安全）。

**CodeCourseGenerationService.java**：新增 `updateHeartbeat(context, sessionId, taskId, sequence, stageLabel)` 静态方法——心跳只更新通知文案（"后台生成中 · 继续完成中"），不校验 sequence（避免被过时的 session 校验拒掉），不打断主进度条。新增 `hasPendingProgress()` 静态方法：SERVICE_ACTIVE 且从未收到任何进度时返回 true（供 JS 决定是否进入"挂起"通知模式）。

**CodeCourseNativePlugin.java**（新增权限方法）：`requestIgnoreBatteryOptimizations()`——真机无权限时请求豁免（`ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` intent），Java 侧先检查 `PowerManager.isIgnoringBatteryOptimizations()` 是否已豁免。

### 前端（3 个文件）

**localProvider.ts**：
- `runTask` 内新增 `startNativeHeartbeat()`/`stopNativeHeartbeat()`（`setInterval`，1s tick → `updateHeartbeat`；网络重试等待期间也持续 tick——这是用户"几小时不变"时通知仍会动的关键）。interval 句柄存入 provider 级 Map，随任务结束清理。
- 后台**挂起**检测：`appStateChange` 恢复时若任务从未推进（DB `progress_current == 0` 且 `stage_label` 为初始值，或 `hasPendingProgress` 原生标志），先调 `serviceCoordinator.heartbeatPaused()` 把通知切为"应用在后台挂起，回到应用后继续生成"，再走现有 `reloadGenerationTasks` 恢复链路。

**generationServiceCoordinator.ts**：新增 `heartbeatPaused()` 方法——`native.setGenerationActive({active: true, label: "应用在后台挂起，回到应用后继续生成", ...})` 同参数重发（原生会更新通知文案，进度条切为不确定状态）。

**generationState.ts**：`shouldSendProgress` 逻辑不动；`callLLM` 重试等待的 `setTimeout` 改为同时驱动心跳（不阻塞网络重试本身）。

## 验证

- 前端：心跳注册/清理逻辑单测（`startNativeHeartbeat` 在任务结束时停止；interval 不泄漏）。
- 原生：`CodeCourseGenerationService` 心跳方法单测（无 Java 单测基建，改为编译验证 + 真机日志验证 `onPause` 分支）。
- 前端 `tsc -b` 全绿；`pnpm vitest` 全绿。
- 真机：锁屏/切后台 10+ 分钟，通知进度持续推进；通知栏文案不为假进度；回到应用任务状态正确恢复。
- 重新构建 APK 并同步（仅 APK，桌面端无改动）。
