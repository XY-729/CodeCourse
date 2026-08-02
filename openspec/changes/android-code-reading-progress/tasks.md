# Tasks: Android 代码阅读位置进度条

## 1. MobileCodeViewer 进度条

- [x] 1.1 新增 `progressFillRef` + `refreshScrollProgress`（rAF 节流，scaleX 更新，不可滚动时 opacity 0）
- [x] 1.2 `handleCodeScroll` 追加进度刷新；卸载清理 rAF
- [x] 1.3 组件顶部渲染 `.mobile-code-progress`（sticky 顶部、aria-hidden）
- [x] 1.4 挂载时初始刷新一次（含内容/路径切换后重置）

## 2. 样式

- [x] 2.1 `android-experience.css` 追加 `.mobile-code-progress` / `.mobile-code-progress-fill`（2px、圆角、`--mobile-progress`、明暗自适应）

## 3. 测试

- [x] 3.1 用例：进度条元素渲染
- [x] 3.2 用例：滚动后 transform scaleX 按比例更新
- [x] 3.3 用例：不可滚动时 opacity 0
- [x] 3.4 回归：`npx tsc -b` 零错 + 前端全量测试绿（384）+ `npm run build` 通过

## 4. 真实验证

- [x] 4.1 桌面 dev server + Android 模拟视口验证首次打开代码文件顶部出现进度条、滚动更新、课件进度条不回归

## 5. 打包交付

- [x] 5.1 提交推送
- [x] 5.2 重建 APK 交付绝对路径

## 6. 首次打开进度条失效修复（0.4.2 回归）

- [x] 6.1 定位根因：MarkdownViewer scroll effect cleanup 取消挂起 rAF 后 `progressRafRef` 未归零，`onScrollRatioChange` 内联引用变化导致 effect 重跑时永久短路
- [x] 6.2 cleanup 取消 rAF 后归零 ref；effect 重跑时补 `scheduleProgressRefresh()`
- [x] 6.3 回归测试：rAF 挂起时 effect 重跑（rerender 新 onScrollRatioChange）→ 滚动后进度条仍更新
- [x] 6.4 真实验证：首次打开即 `scaleX(0)`，滚动实时更新，切换文档恢复正确，re-render 后不死锁
- [x] 6.5 tsc 零错 + 全量测试 391 绿 + build 通过
- [ ] 6.6 提交推送并重新打包桌面端，验证快捷方式指向最新
