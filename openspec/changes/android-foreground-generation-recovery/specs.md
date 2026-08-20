# Spec: android-foreground-generation-recovery

## REQ-1：诚实的运行边界

当 Android 生成任务开始时，界面必须提示用户保持应用在前台，不得声称关闭应用后任务仍会继续。

## REQ-2：可恢复性

任务必须持久化状态、进度和有效检查点。应用重新进入前台后，未完成任务应从持久化状态恢复，不应依赖常驻原生 Service。

## REQ-3：最小原生权限

应用不得为 WebView 生成声明 `FOREGROUND_SERVICE`、`WAKE_LOCK` 或 `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`。通知权限只用于可选的完成提醒。

## REQ-4：Android 专用产物

Android 构建不得包含仅适用于桌面的分离窗口、Monaco 查看器、桌面工具栏、桌面手势指南、调用指南或桌面生成面板模块。
