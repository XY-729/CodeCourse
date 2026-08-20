# Tasks

> **状态：已废弃。** 下列任务仅保留为历史记录，不再作为当前待办。

## REQ-1 原生

- [x] 1.1 Manifest 加 `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`
- [x] 1.2 插件加 `isIgnoringBatteryOptimizations` / `requestIgnoreBatteryOptimizations`（API<23 兼容 + fallback 包名）

## REQ-2 前端

- [x] 2.1 runtime.ts 注册两个新方法
- [x] 2.2 App.tsx 生成开始检查 + 提示条（复用 permission-notice-banner）+ resume 重查
- [x] 2.3 generationState.ts 扩展 battery 提示

## 验证与交付

- [x] 3.1 前端 tsc / 测试全绿
- [x] 3.2 提交推送
- [x] 3.3 重建 APK + 重打包桌面
- [ ] 3.2 提交推送
- [ ] 3.3 重建 APK + 重打包桌面
