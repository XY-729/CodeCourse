# REQ-1 后台保持 WebView 渲染进程存活

> **状态：已废弃。** 下列任务仅保留为历史记录，已由 `android-foreground-generation-recovery` 取代，不再作为当前待办。

- [x] 1.1 MainActivity.onCreate 设置 WebView.setRendererPriorityPolicy(RENDERER_PRIORITY_IMPORTANT, false)
- [x] 1.2 MainActivity.onPause 在生成任务活跃时跳过 super.onPause（避免 webView.onPause 挂起 JS），并补发 bridge.onResume
- [x] 1.3 MainActivity.onResume 在任务活跃时显式 bridge.onResume，保证 pause/resume 状态一致
- [x] 1.4 原生编译验证通过（JAVA_HOME=C:/Users/xiyua/.jdks/jdk-21.0.2 ./gradlew.bat compileDebugJavaWithJavac）

## REQ-2 后台通知真实反映进度（原生心跳）

- [x] 2.1 CodeCourseGenerationService 新增 updateHeartbeat 静态方法（更新通知文案、不打断进度条、不校验 sequence）
- [x] 2.2 CodeCourseGenerationService 新增 hasPendingProgress 静态方法（从未收到进度时为 true）
- [x] 2.3 localProvider.runTask 内启动/停止原生心跳（1s interval，任务结束清理，不泄漏）
- [x] 2.4 generationServiceCoordinator 新增 heartbeatPaused 方法（通知切为"应用在后台挂起，回到应用后继续生成"）
- [x] 2.5 localProvider resumeTasks 恢复时检测挂起（从未推进）→ 先 heartbeatPaused 再走恢复链路

## REQ-3 电池优化豁免

- [x] 3.1 CodeCourseNativePlugin 新增 requestIgnoreBatteryOptimizations 方法（先查 isIgnoringBatteryOptimizations，未豁免才发 intent）
- [x] 3.2 前端本地设置入口调用该原生方法（生成设置页，真机无权限时请求）

## 验证与交付

- [x] 4.1 前端 tsc / vitest 全绿
- [x] 4.2 前端心跳注册/清理单测通过
- [x] 4.3 原生编译通过
- [x] 4.4 重建 APK 并推送提交
- [ ] 4.5 真机验证：锁屏/切后台 10+ 分钟通知持续推进、回前台状态恢复
