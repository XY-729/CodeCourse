# Spec: android-battery-optimization

## REQ-1: 原生电池优化豁免能力

### 1.1 `isIgnoringBatteryOptimizations()`

返回 `{ ignoring: boolean }`：
- API < 23：`ignoring: true`（无此机制，视为无需豁免）。
- API >= 23：`PowerManager.isIgnoringBatteryOptimizations(packageName)`。

### 1.2 `requestIgnoreBatteryOptimizations()`

- 已豁免 → `{ granted: true, fallback: false }`。
- 未豁免 → 拉起 `Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`（带 `EXTRA_APP_PACKAGE`）系统对话框；返回 `{ granted: false, fallback: false }`。
- 拉起失败（部分机型拒绝该 intent）→ 返回 `{ granted: false, fallback: true, packageName }`，前端据此引导进入应用详情/电池设置。

### 1.3 Manifest

新增 `android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`。

## REQ-2: 前端检查与引导

### 2.1 生成开始时检查

安卓端生成任务开始前（`setGenerationActive(true)` 路径）检查 `isIgnoringBatteryOptimizations`；未豁免时展示电池提示条（复用 permission-notice-banner）。

### 2.2 引导按钮

提示条按钮调用 `requestIgnoreBatteryOptimizations()` 拉起系统页；返回 app 后（现有 resume 检查路径）重新检查，已豁免则提示消失。

### 2.3 通知权限提示共存

通知权限与电池豁免为独立状态，各自独立提示（可先后显示），互不覆盖。
