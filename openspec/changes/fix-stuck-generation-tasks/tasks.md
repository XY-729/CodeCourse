# Tasks: 修复生成任务卡死

## REQ-1 流式 LLM 整体截止

- [x] 1.1 `stream_openai_compatible_chat` 加 `total` 整体截止（read+30s 缓冲），到点强制断开并抛错
- [x] 1.2 测试：mock 慢流在超过 total 后抛超时错误

## REQ-2 任务级 watchdog

- [x] 2.1 `fail_stale_generation_tasks(timeout_minutes)`：running 且 updated_at 超阈值 → failed（"生成超时，已自动取消，请重新生成"）
- [x] 2.2 周期任务（60s）随 lifespan 启动/关闭，不触碰非 running 任务
- [x] 2.3 测试：构造陈旧 running 任务 → watchdog → 断言 failed 且 completed 不受影响

## REQ-3 启动清理

- [x] 3.1 lifespan startup 将遗留 running 任务标 failed（"上次生成中断，请重新生成"）
- [x] 3.2 测试：遗留 running → 启动 → failed

## REQ-4 交付

- [x] 4.1 后端全量测试 + tsc 通过
- [ ] 4.2 提交推送 + 桌面包重建同步
