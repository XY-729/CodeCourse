# Tasks: 跨文件检索问答（选择文件功能）

## 1. 后端

- [x] 1.1 `QAAskRequest` 新增 `context_files: list[str]`
- [x] 1.2 `_retrieval_context` 透传 `context_files` 给 `hybrid_retrieve`
- [x] 1.3 `hybrid_retrieve` / `structural_retrieve` 接受 `context_files`，非空时 file_pattern 放宽为并集（re.escape 拼接）
- [x] 1.4 后端测试：file_pattern 拼接正确 + 空列表行为不变（3 条，全量 243 绿）

## 2. 前端

- [x] 2.1 `QAAskPayload` 加 `context_files`；`buildAskPayloadContext` 返回；提问 payload 携带
- [x] 2.2 `ContextFilePickerDialog` 组件（搜索 + 列表 + 多选 + 确认/取消）
- [x] 2.3 ExplainPanel"附带上下文"卡片：选择文件按钮 + 已选 chips + 移除
- [x] 2.4 App.tsx 状态接入（切换项目清空 + 弹窗开关）
- [x] 2.5 CSS（styles.css + apple-overlays + android-experience）
- [x] 2.6 前端测试：picker 搜索/勾选/确认 + payload 含 context_files

## 3. 验证与交付

- [ ] 3.1 后端全量测试绿
- [ ] 3.2 前端 tsc + 全量测试 + build 通过
- [ ] 3.3 提交推送（OpenSpec 变更 + 代码）
- [ ] 3.4 重新打包桌面端并验证快捷方式
- [ ] 3.5 重建 APK 交付绝对路径
