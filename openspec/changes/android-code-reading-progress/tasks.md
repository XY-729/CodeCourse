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
