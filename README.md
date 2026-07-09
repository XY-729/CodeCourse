# GitHub 项目学习器 MVP

这是一个面向学习的 GitHub 项目阅读与课程生成工具。第一阶段只做项目导入、结构扫描、Markdown 课程生成、代码阅读和课程阅读，不运行代码，不调试，不做多人协作。

## 功能

- 输入 GitHub 仓库 URL，后端使用 `git clone --depth 1` 克隆到 `workspace/repos/`。
- 扫描目录树并忽略 `.git`、`node_modules`、`build`、`dist`、`target`、`__pycache__` 等目录。
- 识别 README、package.json、pyproject.toml、Cargo.toml、go.mod、Dockerfile 等关键文件。
- 在被导入项目根目录生成 `.generated_course/project_map.md`、`outline.md` 和 `lesson_01.md` 到 `lesson_04.md`。
- 前端提供三栏布局：文件树和课程目录、只读 Monaco 代码阅读器或 Markdown 阅读器、解释面板。
- 支持查看已导入项目列表、切换项目、重新生成课程、删除本地导入。
- 针对 C/C++、Node、Python、Go、Rust、Docker 等项目生成更贴近技术栈的课程大纲。
- 预留 LLM provider 配置；没有 `GPL_LLM_API_KEY` 时使用规则模板解释。

## GitHub URL 建议

当前 VM 到 GitHub HTTPS `443` 可能不稳定，优先使用 SSH 地址：

```text
git@github.com:owner/repo.git
```

如果使用 HTTPS 导入失败，前端会提示改用 SSH，后端也会返回更具体的网络、认证或仓库不存在错误。

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

浏览器访问 `http://<vm-ip>:5173`。如果浏览器运行在 VM 内，也可以访问 `http://localhost:5173`。

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
- `POST /api/explain`

## MVP 边界

第一阶段不执行被导入项目代码，不提供运行、调试、补全或协作功能。项目分析使用规则扫描，不生成完整 AST 或调用图。

## 检查

```bash
cd /home/xiyuan729/github-project-learner/backend
source .venv/bin/activate
PYTHONPATH=. python3 -m unittest discover -s tests -v

cd /home/xiyuan729/github-project-learner/frontend
npm run build
```
