# Proposal: android-battery-optimization

> **状态：已废弃。** CodeCourse 不再以原生前台 Service/WakeLock 维持 WebView 生成，因此不再申请电池优化豁免。现行行为见 `android-foreground-generation-recovery`。

## Problem

安卓端"后台生成"依赖前台服务（`CodeCourseGenerationService`，`startForeground` 已实现）。但 Android（尤其国产 ROM：MIUI/EMUI/ColorOS 等）默认对应用开启**电池优化**，系统会在后台冻结/杀死进程。app 从未申请**电池优化豁免**（`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`），用户在系统设置里也找不到对应的"后台运行/电池不受限制"入口（该入口在 ROM 电池设置页，非权限面板）。

用户反馈："手机设置里并没有看到对后台工作权限的申请，是不是就无法后台工作"——对应缺口正是电池优化豁免 + 引导入口。

现状：

- 前台服务 + `startForeground` 已实现（CodeCourseGenerationService.java:238）
- 通知权限申请/引导已实现（CodeCourseNativePlugin.java:134/186 + App.tsx permission-notice-banner）
- **电池优化豁免：无**（Manifest 无 `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`，插件无方法，前端无检查无提示）

## Why it matters

- 无豁免时后台生成在部分机型上必被冻结（前台服务也不保证豁免）；"无法后台工作"直接命中用户痛点。
- 属于一次性用户引导，实现成本低，收益直接。

## Scope

- 仅安卓端：原生插件 + Manifest + 前端提示。
- 不修改前台服务本身。
- 国产 ROM 的自启动白名单（`ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` 之外的厂商私有跳转）不在本次范围——豁免页已能覆盖大多数场景（荣耀/HyperOS 的"电池不受限制"就是豁免页）。

## Approach

1. **原生**（CodeCourseNativePlugin.java）：
   - `isIgnoringBatteryOptimizations()`：返回 `{ ignoring: boolean }`（`PowerManager.isIgnoringBatteryOptimizations(packageName)`，API 23+；低于 23 返回 true 视为无需豁免）。
   - `requestIgnoreBatteryOptimizations()`：若已豁免直接返回 `{ granted: true }`；否则通过 `Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` + `EXTRA_APP_PACKAGE` 拉起系统豁免对话框；若抛出（部分机型拒绝跳转）返回 `{ granted: false, fallback: true }` 并附带 `packageName`，前端可引导进电池设置页。
2. **Manifest**：新增 `android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`。
3. **前端**：
   - runtime.ts 注册 `isIgnoringBatteryOptimizations` / `requestIgnoreBatteryOptimizations`。
   - App.tsx：生成任务开始（`setGenerationActive(true)` 前）检查豁免；未豁免时显示常驻提示条（复用 permission-notice-banner 样式），带"前往设置"按钮（调 `requestIgnoreBatteryOptimizations`）；resume 时重新检查（复用现有 app-resume 检查路径）。
   - generationState.ts：`PermissionNotice` 扩展 `battery` 类型提示，复用现有 banner 渲染。

## Success criteria

- 豁免页能弹出/跳转；已豁免时静默通过。
- 生成开始时未豁免 → 出现引导提示；点击按钮跳系统页面；返回 app 后提示消失（resume 重新检查）。
- 原生方法在 API < 23 安全返回已豁免。
