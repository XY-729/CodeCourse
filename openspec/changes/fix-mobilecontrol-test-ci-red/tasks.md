# Tasks: 修复 mobileControlLayout 测试红

## Tasks

- [x] 1.1 `frontend/src/__tests__/mobileControlLayout.test.tsx` 恢复至绿基线 `bc842f8`（移除 `followUpRecord` / `onFollowUp`，断言回「开始新问题」）
- [x] 1.2 验证：正式树 `pnpm -C frontend exec tsc -b` exit 0；vitest 全量 90 文件 / 514 用例通过
- [x] 1.3 只提交本测试与 OpenSpec 变更文件；推送 main
- [ ] 1.4 PR Validation（CI）绿
