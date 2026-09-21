# Tasks: 预读面板按自定义速度逐字展示

## 1. 实现

- [x] 1.1 `DesktopGenerationStatus.tsx`：`useTypedMarkdown`（16ms tick，按 charsPerSecond 累积步长）
- [x] 1.2 终态（completed / failed / cancelled）直接给全文
- [x] 1.3 `prefers-reduced-motion: reduce` 跳过动画（含 `matchMedia` 缺失兜底）
- [x] 1.4 面板头部 慢/标准/快 三档，仅生成中显示；写入 `codecourse.desktop.previewSpeed`
- [x] 1.5 `desktop-generation.css`：速度档位样式（含 `aria-pressed` 高亮）
- [x] 1.6 揭示进度上移到状态条（父组件）持有：关面板不丢，换任务归零
- [x] 1.7 边界回收跳过空 markdown（否则面板重开首帧被夹到 0）

## 2. 测试

- [x] 2.1 逐字：200ms 时未完成、继续推进后完成
- [x] 2.2 速度：默认档下小窗内打不完，切「快」后打完，且写入 localStorage
- [x] 2.3 减少动效：50ms 内即为全文
- [x] 2.4 关面板再打开：已显示部分立即在场且不重打，只打新增内容
- [x] 2.5 既有用例适配新契约（原先断言「轮询回来后内容立即出现」）

## 3. 校验

- [x] 3.1 前端 vitest 全绿（97 文件 543 用例），`tsc -b` 通过

## 4. 交付

- [x] 4.1 重新打包桌面应用并更新本机安装内容（`dist-desktop/win-unpacked` → `C:\Users\xiyua\CodeCourse`）
- [x] 4.2 校验桌面 `CodeCourse.lnk` 指向新的安装可执行文件，且安装内容与打包产物 sha256 一致
- [ ] 4.3 实机用新版重新生成一节课，确认预读逐字与「打开课件」都能用（需真实生成一课，写入课程目录，待用户决定是否现在跑）
