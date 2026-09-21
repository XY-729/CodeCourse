# Tasks: 默认生成模型改为 deepseek-flash

## 1. 后端默认/回退值

- [x] 1.1 `storage.py` `get_llm_settings()` 环境分支默认 → `deepseek-flash`
- [x] 1.2 `storage.py` `get_llm_settings()` 库回退默认 → `deepseek-flash`
- [x] 1.3 `storage.py` `save_llm_settings()` 空值默认 → `deepseek-flash`
- [x] 1.4 `api/settings.py` 响应默认 → `deepseek-flash`
- [x] 1.5 `models/schemas.py` QA 请求 `Field(default)` 与 `LLMSettingsRequest` 默认 → `deepseek-flash`
- [x] 1.6 `services/data_transfer.py` 导入/导出默认 2 处 → `deepseek-flash`
- [x] 1.7 `services/qa_service.py` 选区问答 model 回退 → `deepseek-flash`

## 2. 前端占位

- [x] 2.1 `LLMSettingsDialog.tsx` Model 输入框占位 → `deepseek-flash`

## 3. 校验

- [x] 3.1 后端 unittest：330 用例，1 个失败系他人未提交改动（lesson-preview 进度计数），与本变更无关
- [x] 3.2 前端 `tsc -b` 通过（打包内）、vitest 96 文件 533 用例全绿
- [x] 3.3 `grep deepseek-v4-pro backend/app frontend/src electron` 无残留（只剩文档与本变更说明）
- [x] 3.4 切档安全性实测：真实 planner prompt（14317 字符）单发，`deepseek-flash` 返回 8268 字符正文，未复现空 `content` 故障
- [x] 3.5 名称核实：`deepseek-v4.1flash` / `deepseek-v4.1-flash` 均为 HTTP 400；官方支持名为 `deepseek-flash`、`deepseek-v4-pro`

## 4. 生效与交付

- [x] 4.1 运行中工作区（`AppData\Roaming\CodeCourse`）的 `llm.model` 切到 `deepseek-flash`（经应用自身 `PUT /api/settings/llm`）
- [x] 4.2 重新打包桌面应用并更新本机安装内容
- [x] 4.3 校验桌面 `CodeCourse.lnk` 指向新的安装可执行文件
