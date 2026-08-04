# 需求规格：fix-android-background-generation

## 背景问题

后台生成"假运行"：通知几小时不动，回前台才推进。根因：

1. 生成逻辑全在 WebView JS（localProvider.runTask → callLLM），原生 Service 只做通知。
2. Capacitor BridgeActivity.onPause → webView.onPause() 挂起页面/渲染进程，JS 停滞。
3. 无心跳：LLM 单次调用可达数分钟，通知静止；shouldSendProgress 按 label 节流，后台被节流时更久。
4. 回前台 resume 链路（appStateChange → reconcile + reloadGenerationTasks）已存在，但后台期间无任何保活/诚实反馈。

## 功能需求

### FR-1 后台保活

- FR-1.1 MainActivity.onCreate：`WebView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)`（API 26+ 安全；minSdk 26）。
- FR-1.2 MainActivity.onPause：仅当 `CodeCourseGenerationService.isServiceActive()` 为 true 时跳过 `super.onPause()`，随后调 `bridge.onResume()` 补发 resume 事件，避免插件/WebView 状态不一致。无活跃任务时走默认 `super.onPause()`。
- FR-1.3 MainActivity.onResume：任务活跃时显式调 `bridge.onResume()`（与 FR-1.2 对称）。

### FR-2 通知诚实反映后台状态

- FR-2.1 `CodeCourseGenerationService.updateHeartbeat(context, sessionId, taskId, sequence, stageLabel)`：静态方法，只更新通知文案（"正在后台生成学习内容 · 继续完成中"），不校验 sequence（过时心跳也接受），不调 setProgress（保持主进度条）。Service 未激活或 session 不匹配时静默忽略。
- FR-2.2 `CodeCourseGenerationService.hasPendingProgress()`：SERVICE_ACTIVE 且 `sLastAcceptedSequence == 0` 时返回 true（任务启动后从未收到任何进度）。
- FR-2.3 `localProvider`：`runTask` 开始时注册 1s `setInterval` 心跳（调 `serviceCoordinator.heartbeat()`），任务结束（成功/失败/取消/替换）清理。心跳 tick 覆盖 LLM 调用与网络重试退避等待期间。
- FR-2.4 `generationServiceCoordinator.heartbeatPaused()`：向原生重发 `setGenerationActive({active: true, label: "应用在后台挂起，回到应用后继续生成"})`，原生更新通知文案、进度条切不确定。
- FR-2.5 `localProvider` appStateChange 恢复：若有 running 任务且（`hasPendingProgress()` 原生标志 或 DB 任务从未推进），先 `heartbeatPaused()` 再走现有 `reloadGenerationTasks` 恢复链路。

### FR-3 电池优化豁免

- FR-3.1 `CodeCourseNativePlugin.requestIgnoreBatteryOptimizations()`：先查 `PowerManager.isIgnoringBatteryOptimizations()`，已豁免直接返回；未豁免发 `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` intent。
- FR-3.2 前端生成设置页加"后台生成优化"入口调用 FR-3.1（真机才显示，桌面隐藏）。

## 非目标

- 不迁移生成到原生/WorkManager。
- 不改 shouldSendProgress 前台节流。
- 不动桌面端。

## 验收

- 锁屏/切后台 10+ 分钟，通知每 1s 心跳更新、文案真实。
- 挂起（渲染进程被杀）时通知显示"回到应用后继续生成"。
- 回前台任务从断点恢复，状态一致。
- 前端 tsc/vitest、原生编译、APK 重建全绿。
