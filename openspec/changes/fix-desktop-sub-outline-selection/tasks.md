# REQ-1 桌面端切换"指定文件"后侧边栏可见可点

- [x] 1.1 桌面端 onScopeChange 收到 "files" 时关闭生成面板并打开左侧源码侧边栏（openMobileNavigation("files")）
- [x] 1.2 面板状态保持 scopeType === "files"（重新打开面板仍显示"指定文件"及已选数量）

## REQ-2 生成成功后清理选中状态

- [x] 2.1 handleGenerateOutline 成功路径清理 selectedScopeFiles 并重置 scopeType
- [x] 2.2 handleGenerateOutlineLesson 成功路径清理 selectedScopeFiles 并重置 scopeType
- [x] 2.3 学习计划项目不受影响（选中列表恒为空，scopeType 不动）

## REQ-3 测试与验证

- [x] 3.1 新增测试覆盖成功路径清理行为
- [x] 3.2 前端 tsc / vitest 全绿
- [x] 3.3 浏览器实测：切"指定文件"→ 侧边栏可见可点、选中高亮生效；生成后高亮消失、范围复位
