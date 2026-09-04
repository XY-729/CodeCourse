# Tasks: 默认生成模型改为 deepseek-v4-pro

## 1. 后端默认/回退值

- [x] 1.1 `storage.py` `get_llm_settings()` 环境分支默认 → `deepseek-v4-pro`
- [x] 1.2 `storage.py` `get_llm_settings()` 库回退默认 → `deepseek-v4-pro`
- [x] 1.3 `storage.py` `save_llm_settings()` 空值默认 → `deepseek-v4-pro`
- [x] 1.4 `api/settings.py` 响应默认 → `deepseek-v4-pro`
- [x] 1.5 `models/schemas.py` QA 请求 `Field(default)` 与 `LLMSettingsRequest` 默认 → `deepseek-v4-pro`
- [x] 1.6 `services/data_transfer.py` 导入/导出默认 2 处 → `deepseek-v4-pro`
- [x] 1.7 `services/qa_service.py` 选区问答 model 回退 → `deepseek-v4-pro`

## 2. 前端占位

- [x] 2.1 `LLMSettingsDialog.tsx` Model 输入框占位 → `deepseek-v4-pro`

## 3. 校验

- [x] 3.1 后端：相关单测全绿（settings/llm 默认相关；全量 307 通过）
- [x] 3.2 前端：tsc 无新增错误（`pnpm -C frontend exec tsc -b` exit 0）
- [x] 3.3 `grep deepseek-v4-flash backend/app frontend/src electron` 无残留默认

## 4. 提交与发布

- [x] 4.1 只提交本变更文件（不含他人未提交工作）
- [x] 4.2 推送 main，CI 绿（配合 c003bcf 自洽修复后绿）
- [x] 4.3 打 tag v0.4.6 + CI 发布 release + 更新本地安装与快捷方式
