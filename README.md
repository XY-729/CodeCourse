# GitHub 项目学习器 MVP

这是一个面向学习的 GitHub 项目阅读与课程生成工具。第一阶段只做项目导入、结构扫描、Markdown 课程生成、代码阅读和课程阅读，不运行代码，不调试，不做多人协作。

## 当前规则

- 导入仓库只执行 clone、扫描和创建项目记录，不调用模型 API。
- 导入后默认生成的 `project_map.md` 和 `outline.md` 都是“待生成”占位内容。
- 所有会调用模型 API 的动作都必须由用户点击按钮并确认。
- 选中文件后，可以按需生成“粗略介绍”或“详细分析”。
- 已生成内容可以通过填写新的补充要求后重新生成。
- 模型返回空内容或格式异常时，不覆盖旧课件。
- 新生成内容统一写入 `workspace/generated/<project_id>/`，避免污染被克隆仓库。

## 功能

- 输入 GitHub 仓库 URL，后端使用 `git clone --depth 1` 克隆到 `workspace/repos/`。
- 扫描目录树并忽略 `.git`、`node_modules`、`build`、`dist`、`target`、`__pycache__` 等目录。
- 识别 README、package.json、pyproject.toml、Cargo.toml、go.mod、Dockerfile 等关键文件。
- 前端提供三栏布局：文件树和课程目录、只读 Monaco 代码阅读器或 Markdown 阅读器、解释面板。
- 左栏和右栏支持拖拽调整宽度。
- 前端支持配置 DeepSeek / OpenAI Compatible 模型 API，并提供 DeepSeek API Key 跳转按钮。
- 支持按学习范围生成 AI 总纲：全项目、指定目录、指定文件。
- 支持用户补充生成要求，例如“面向 C++ 初学者”“重点讲判题核心”“输出自测题”。
- 同一输入、同一要求、同一模式和同一 prompt 版本会复用已完成任务，避免重复消耗 token。

## GitHub URL 建议

当前 VM 到 GitHub HTTPS `443` 可能不稳定，优先使用 SSH 地址：

```text
git@github.com:owner/repo.git
```

## 模型 API 设置

点击页面右上角 `模型 API`：

- Provider 默认 `DeepSeek`
- Base URL 默认 `https://api.deepseek.com`
- Model 默认 `deepseek-v4-flash`
- 网页填写的 API Key 只保存在本机 SQLite：`workspace/app.db`
- API 不会回显完整 Key，只返回是否已配置和掩码后的 Key
- 可通过面板里的 `DeepSeek API Key` 按钮跳转到 `https://platform.deepseek.com/api_keys`
- 连通性测试会先弹出确认，再调用模型 API

读取优先级：

1. 环境变量 `DEEPSEEK_API_KEY` 或 `GPL_LLM_API_KEY`
2. 项目根目录 `.env`
3. SQLite 设置

`.env` 与 `workspace/app.db` 已加入 `.gitignore`。

## 启动后端

```bash
cd /home/xiyuan729/github-project-learner/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## 启动前端

```bash
cd /home/xiyuan729/github-project-learner/frontend
npm install
npm run dev -- --host 0.0.0.0
```

浏览器访问 `http://<vm-ip>:5173`。如果通过 SSH 隧道访问 Windows 本机，转发 `5173` 和 `8000` 后打开 `http://localhost:5173`。

## API 概览

- `POST /api/projects/import`
- `GET /api/projects`
- `GET /api/projects/{project_id}`
- `POST /api/projects/{project_id}/regenerate`
- `DELETE /api/projects/{project_id}`
- `GET /api/projects/{project_id}/tree`
- `GET /api/projects/{project_id}/file?path=...`
- `GET /api/projects/{project_id}/course`
- `GET /api/projects/{project_id}/course/{filename}`
- `POST /api/projects/{project_id}/outline/generate`
- `POST /api/projects/{project_id}/lessons/file`
- `GET /api/projects/{project_id}/tasks`
- `GET /api/projects/{project_id}/tasks/{task_id}`
- `POST /api/explain`
- `GET /api/settings/llm`
- `PUT /api/settings/llm`
- `POST /api/settings/llm/test`

## MVP 边界

第一阶段不执行被导入项目代码，不提供运行、调试、补全或协作功能。项目分析使用规则扫描和正则信号提取，不生成完整 AST 或调用图。

## 检查

```bash
cd /home/xiyuan729/github-project-learner/backend
source .venv/bin/activate
PYTHONPATH=. python3 -m unittest discover -s tests -v

cd /home/xiyuan729/github-project-learner/frontend
npm run build
```
