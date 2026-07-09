# GitHub 项目学习器 MVP

这是一个面向学习的 GitHub 项目阅读与课程生成工具。第一阶段只做项目导入、结构扫描、Markdown 课程生成、代码阅读和课程阅读，不运行代码，不调试，不做多人协作。

## 功能

- 输入 GitHub 仓库 URL，后端使用 `git clone --depth 1` 克隆到 `workspace/repos/`。
- 导入流程只做 clone、扫描、项目记录创建和规则模板总纲生成，不阻塞等待模型。
- 扫描目录树并忽略 `.git`、`node_modules`、`build`、`dist`、`target`、`__pycache__` 等目录。
- 识别 README、package.json、pyproject.toml、Cargo.toml、go.mod、Dockerfile 等关键文件。
- 新生成内容统一写入 `workspace/generated/<project_id>/`，避免污染被克隆仓库。
- 前端提供三栏布局：文件树和课程目录、只读 Monaco 代码阅读器或 Markdown 阅读器、解释面板。
- 前端支持配置 DeepSeek / OpenAI Compatible 模型 API，并提供 DeepSeek API Key 跳转按钮。
- 支持按学习范围生成 AI 总纲：全项目、指定目录、指定文件。
- 支持选中文件后按需生成粗略版或详细版文件课件。
- 同一文件、同一模式、同一 prompt 版本和同一输入哈希会复用已完成任务，避免重复消耗 token。
- 模型不可用或任务失败时保留旧课件，规则模板回退内容仍可阅读。

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

读取优先级：

1. 环境变量 `DEEPSEEK_API_KEY` 或 `GPL_LLM_API_KEY`
2. 项目根目录 `.env`
3. SQLite 设置

`.env` 与 `workspace/app.db` 已加入 `.gitignore`。

## 启动方式

### 本机开发

在开发机器上分别启动后端和前端，通过 `http://localhost:5173` 访问。

Vite dev server 内置了 proxy，会将同源的 `/api` 请求转发到后端的 `http://127.0.0.1:8000`，无需手动配置 CORS 或跨域。

**1. 启动后端**

```bash
cd /home/xiyuan729/github-project-learner/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

> 后端监听 `0.0.0.0:8000` 是为了同时支持本机和局域网访问。如果只在本机开发，可以不加 `--host 0.0.0.0`。

**2. 启动前端**

```bash
cd /home/xiyuan729/github-project-learner/frontend
npm install
npm run dev
```

浏览器打开 `http://localhost:5173`。

### 虚拟机 / 局域网访问

当后端运行在虚拟机或另一台机器上时，需要通过局域网 IP 访问。

**后端**（在 VM 上）：
```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**前端**（在 VM 上）：
```bash
cd frontend
npm run dev -- --host 0.0.0.0
```

浏览器访问 `http://<VM_IP>:5173`（例如 `http://192.168.60.131:5173`）。

Vite proxy 会将 `/api` 转发到同一台机器上的 `http://127.0.0.1:8000`，因此无论从本机还是局域网访问前端，API 请求都能正确路由到后端。

### SSH 隧道访问

如果 VM 不能直接暴露端口，可以通过 SSH 隧道转发：

```bash
ssh -L 5173:127.0.0.1:5173 -L 8000:127.0.0.1:8000 linux-vm
```

然后打开 `http://localhost:5173`。

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
