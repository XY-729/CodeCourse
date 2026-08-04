# Tasks

## REQ-1 首帧解耦

- [x] 1.1 create() 中 reconcile/observerJobs 改 fire-and-forget
- [x] 1.2 resumeTasks 保留 await
- [x] 1.3 App.tsx 首帧不等待 provider 恢复完成

## REQ-2 打开项目分阶段

- [x] 2.1 openProject 第一阶段轻量元数据（4 并行）
- [x] 2.2 第二阶段重数据并行加载
- [x] 2.3 loading 仅覆盖第一阶段
- [x] 2.4 布局恢复移到第二阶段

## REQ-3 查询减负

- [x] 3.1 listProjects JOIN 消除 N+1
- [x] 3.2 getProject JOIN 一次取课程名

## 验证与交付

- [x] 4.1 前端 tsc / 测试全绿
- [ ] 4.2 提交推送
- [ ] 4.3 重建 APK + 重打包桌面
