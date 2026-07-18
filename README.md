# GitHub 项目学习器 CodeCourse

CodeCourse 是一个面向学习的 GitHub 项目阅读与课程生成工具。它不是 IDE，不运行代码，不调试代码，而是帮助用户把一个项目拆成“结构说明、学习总纲、文件课件、上下文问答和学习记录”。

用户可以导入 GitHub 仓库，也可以创建一个不绑定仓库的学习计划。系统会把项目文件、课程 Markdown、AI 问答历史、本地检索索引都保存在本机 workspace 中，适合用来阅读陌生项目、整理源码学习路线、针对某段代码或某份课件持续提问。

## 核心能力

### 项目导入与学习计划

- 支持输入 GitHub SSH / HTTPS 地址导入公开仓库或当前机器可访问的仓库。
- 后端使用 `git clone --depth 1` 下载项目到 `workspace/repos/`。
- 自动扫描项目目录树，并忽略 `.git`、`node_modules`、`build`、`dist`、`target`、`__pycache__`、`.venv`、`venv`、`.next`、`coverage` 等目录。
- 自动识别关键文件，例如 `README.md`、`package.json`、`pyproject.toml`、`requirements.txt`、`CMakeLists.txt`、`Cargo.toml`、`go.mod`、`Dockerfile`、`docker-compose.yml`。
- 支持创建“学习计划”项目，用于自定义知识点学习，不需要绑定 GitHub 仓库。
- 仓库项目导入后会生成规则占位课程；学习计划项目不会创建默认课程，只有用户点击生成后才创建总纲。

### 课程生成

- 所有模型调用都需要用户主动点击并确认，不会在导入项目时自动调用 AI。
- 支持三类生成范围：
  - `全项目`：根据 README、目录树、关键文件和项目索引生成学习总纲。
  - `指定文件`：从文件树选择文件后，只围绕这些文件生成内容。
  - `学习计划`：根据用户输入的生成要求生成自定义学习总纲。
- 支持按需生成文件课件：
  - `粗略介绍`：低 token 消耗，适合快速理解文件职责和阅读顺序。
  - `详细分析`：更深入解释关键结构、数据流、修改风险和练习任务。
- 生成失败时不会覆盖旧内容。
- 生成内容统一写入 `workspace/generated/<project_id>/`，避免污染被克隆项目。

### 代码与课件阅读

- 前端是三栏布局：左侧项目与目录，中间工作区，右侧 AI 助手。
- 代码阅读器使用 Monaco Editor，只读展示和语法高亮，不提供运行、调试或补全入口。
- Markdown 阅读器支持标题、代码块、表格，后续可继续扩展 Mermaid。
- 中间工作区采用类似 VS / VS Code 的递归拆分编辑组：
  - 默认一个全屏工作区。
  - 拖拽文件、课件或回答到工作区边缘，可自动拆出新的工作区。
  - 支持横向、纵向、嵌套拆分。
  - 分隔线可拖动调整大小，拖到很小或双击分隔线可折叠一侧工作区。
  - 每个工作区有独立标签页，可同时阅读代码、课件和 AI 回答。

### AI 助手

右侧面板已经从“选区提问”升级为“AI 助手”。它不是只能回答选中文本，而是可以围绕项目、当前文件、当前课件、当前回答或用户选区进行上下文问答。

- 没有选区时，可以直接问：
  - “这个项目入口在哪？”
  - “这个文件是干什么用的？”
  - “我只想学判题核心，该先看哪些文件？”
  - “这份课件应该怎么学？”
- 有选区时，会把选区作为附带上下文发送给模型。
- 选区文本可以在右侧编辑，也可以清空；清空后源页面蓝色临时选区会同步消失。
- Markdown 课件和 AI 回答支持选中文本后打标记，例如荧光、高亮、加粗、下划线。
- 问答记录会保存到历史中，支持搜索、收藏、重命名。
- 双击历史记录可在中间工作区打开为 Markdown，可继续编辑并保存。
- 每条回答会落盘为 Markdown，便于复习和归档。

### 本地 RAG 与对话记忆

CodeCourse 内置本地混合 RAG，不依赖外部 embedding API。

- 可以为项目构建本地索引。
- 基础索引使用 SQLite FTS5、规则符号提取和带行号的文本块，构建完成后即可检索。
- Windows 桌面版会在后台继续使用内置 `codebase-memory-mcp` 建立 Tree-sitter 结构图和本地语义索引；Web/VM 找不到结构引擎时自动回退到 FTS。
- AI 助手会结合选区所属符号、调用者/被调用者、文件定义与导入关系、相关代码片段回答，而不是用关键词相似度冒充调用关系。
- 回答下方的“参考代码”会保留真实路径、行号、符号、关系和检索引擎，点击可直接定位源码。
- 回答会带上项目上下文、当前负责解释的文件或课件、最近对话摘要和检索片段。
- 同一个对话会保留记忆，后续追问会知道当前项目、当前文件或当前课件的语境。
- 项目删除时会同步清理文本索引、结构缓存和分析快照；结构分析不会修改被导入仓库或 Git 状态。

## 模型 API

点击页面右上角 `模型 API` 配置模型。当前设计支持 DeepSeek / OpenAI Compatible 风格接口。

默认配置示例：

- Provider: `deepseek`
- Base URL: `https://api.deepseek.com`
- Model: `deepseek-v4-flash`

API Key 读取优先级：

1. 环境变量 `DEEPSEEK_API_KEY` 或 `GPL_LLM_API_KEY`
2. 项目根目录 `.env`
3. 本地 SQLite 设置

安全约束：

- API 不会回显完整 Key，只返回是否已配置和掩码后的 Key。
- Key 不会写入日志。
- `.env`、`workspace/app.db`、`workspace/repos/`、`workspace/generated/` 不应提交到 Git。
- 所有调用模型 API 的动作都需要用户确认。
- 项目源码、README 和课件内容会被当作不可信材料处理，提示词中会要求模型不要执行仓库文本里的指令，也不要泄露 Key、环境变量或本地敏感路径。

## 数据存储

```text
github-project-learner/
  backend/
  frontend/
  workspace/
    app.db                  # SQLite 本地数据库
    repos/                  # 克隆下来的仓库
    generated/<project_id>/ # 课程、回答、生成内容
```

主要数据：

- `workspace/repos/`：GitHub 仓库克隆结果。
- `workspace/generated/<project_id>/`：项目地图、学习总纲、文件课件、AI 回答 Markdown。
- `workspace/app.db`：项目记录、生成任务、模型设置、QA 历史、高亮标记、RAG 索引、对话记忆。

## 技术栈

- 前端：React、TypeScript、Vite、Monaco Editor、react-markdown、remark-gfm、lucide-react
- 后端：Python、FastAPI、Pydantic、Uvicorn
- 存储：SQLite、本地文件系统
- 项目分析：文件扫描、规则识别、SQLite FTS5、Tree-sitter 结构图、本地语义检索
- AI 接入：DeepSeek / OpenAI Compatible API

## Windows 桌面版

从 [GitHub Releases](https://github.com/XY-729/CodeCourse/releases) 下载 Windows 版本：

- 推荐：`CodeCourse-<version>-setup.exe`。安装一次后，后续可从开始菜单或桌面快捷方式直接启动；内置 Python 后端和 Git，不需要额外安装 Python 或 Git。
- 备选：`CodeCourse-<version>-portable.exe`。免安装，但每次启动需要先解压到临时目录，启动速度会比安装版慢。

首次运行时 Windows 可能显示 SmartScreen 提示，这是未签名个人软件的正常提示。确认下载来源为本仓库后，选择“更多信息”并运行即可。

## 本地运行

### 后端

```bash
cd /home/xiyuan729/github-project-learner/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
PYTHONPATH=. uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 前端

```bash
cd /home/xiyuan729/github-project-learner/frontend
npm install
npm run dev -- --host 0.0.0.0
```

### Windows 通过 SSH 隧道访问 VM

如果服务跑在 VM 上，可以在 Windows 本机执行：

```bash
ssh -L 5173:127.0.0.1:5173 -L 8000:127.0.0.1:8000 linux-vm
```

然后打开：

```text
http://localhost:5173
```

## 桌面软件运行

当前项目已加入 Electron 桌面壳，可以把 Web 前端和本地 FastAPI 后端一起作为桌面软件启动。Windows Release 会内置 PyInstaller 打包的 `backend.exe`、精简 Git 运行时和固定版本的本地结构索引引擎，下载后无需另装 Python、Git 或代码分析工具。

### 桌面开发模式

先确保后端依赖和前端依赖已经安装：

```bash
cd /home/xiyuan729/github-project-learner/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cd /home/xiyuan729/github-project-learner/frontend
npm install

cd /home/xiyuan729/github-project-learner
npm install
```

如果 VM 访问 GitHub 下载 Electron 二进制失败，可以临时使用镜像安装，不修改全局配置：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

启动桌面开发版：

```bash
npm run desktop:dev
```

这个命令会启动 Vite 前端开发服务，然后 Electron 主进程会自动寻找空闲端口并启动 FastAPI 后端。

### Windows Portable Release

GitHub Release 中的 `CodeCourse-<version>-portable.exe` 可直接双击运行。首次启动会在 `%APPDATA%/CodeCourse` 建立本地 workspace；模型 API Key、SQLite、导入仓库和生成课件都只保存在这个目录，不包含在安装包中。

源码发布时推送 `v*` 标签会在 GitHub Actions 的 Windows runner 上自动构建并上传 portable exe 到对应 Release。

### 桌面打包

生成未压缩的本机桌面目录：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run desktop:pack
```

生成安装包或 AppImage：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run desktop:build
```

Linux 未压缩产物默认在：

```text
dist-desktop/linux-unpacked/
```

### 桌面数据目录

桌面版不会把用户数据写进安装目录，而是写入系统用户数据目录：

- Windows：`%APPDATA%/CodeCourse`
- Linux：`~/.config/CodeCourse`

其中仍保持原有结构：`app.db`、`repos/`、`generated/`、后端日志等都在这个目录下。

Web 开发模式仍然保留，可以继续使用后端 `8000` 和前端 `5173` 的启动方式。

## Android 竖屏版

Android 版使用 Capacitor 8，并采用独立本地运行架构。APK 不启动 FastAPI、不携带 Python 或 Git，也不读取电脑端 workspace。项目、课件、问答、索引和知识网络全部保存在手机应用数据目录中。

主要能力：

- 导入公开 GitHub HTTPS 仓库快照，或从系统文件选择器导入本地 ZIP。
- 使用加密 SQLite 保存项目数据；模型 API Key 使用 Android Keystore 加密保存。
- 本地扫描文件、识别关键配置、建立 FTS5/FTS4 索引并提供 RAG 检索。
- 支持学习总纲、文件课件、学习计划分章节课件、AI 助手会话记忆、陌生术语、个人总结与知识网络。
- 使用轻量只读代码阅读器，支持行号、语法高亮、横向滚动和选区提问；手机端不加载 Monaco。
- 无网络时仍可阅读项目、课程、历史和知识网络；下载仓库和模型生成需要联网。

移动端限制：

- 只支持公开 GitHub 仓库和本地 ZIP，不支持 SSH、私有仓库或 Git 历史。
- Android 与电脑端数据相互独立，第一版不提供跨设备同步。
- 不运行、编译或调试导入项目。

同步 Android 工程：

```bash
pnpm install --frozen-lockfile
pnpm run mobile:sync
```

本地构建 debug APK 需要 JDK 21、Android SDK 36 和 Gradle Wrapper：

```bash
cd android
./gradlew assembleDebug
```

GitHub Actions 的 `Android APK Build` 支持手动生成 debug APK。推送 `v*` 标签时会构建签名 Release APK，并上传到对应 GitHub Release。签名发布前需要配置以下仓库 Secrets：

- `CODECOURSE_ANDROID_KEYSTORE_BASE64`
- `CODECOURSE_ANDROID_STORE_PASSWORD`
- `CODECOURSE_ANDROID_KEY_ALIAS`
- `CODECOURSE_ANDROID_KEY_PASSWORD`

Release APK 构建后会执行隐私扫描，阻止个人仓库名、本地路径、数据库、workspace、环境文件或签名文件进入产物。

## 常用 API

### 项目

- `POST /api/projects/import`：导入 GitHub 仓库。
- `POST /api/projects/learning-plan`：创建学习计划项目。
- `GET /api/projects`：项目列表。
- `GET /api/projects/{project_id}`：项目详情。
- `DELETE /api/projects/{project_id}`：删除项目记录和本地数据。
- `GET /api/projects/{project_id}/tree`：读取项目文件树。
- `GET /api/projects/{project_id}/file?path=...`：读取安全范围内的文本文件。

### 课程

- `GET /api/projects/{project_id}/course`：课程文件列表。
- `GET /api/projects/{project_id}/course/{filename}`：读取课程 Markdown。
- `POST /api/projects/{project_id}/outline/generate`：生成 AI 总纲。
- `POST /api/projects/{project_id}/lessons/file`：生成指定文件课件。
- `GET /api/projects/{project_id}/tasks`：生成任务列表。
- `GET /api/projects/{project_id}/tasks/{task_id}`：任务详情。

### AI 助手

- `POST /api/projects/{project_id}/qa/ask`：发起上下文问答。
- `GET /api/projects/{project_id}/qa`：问答历史。
- `GET /api/projects/{project_id}/qa/{qa_id}`：问答详情。
- `PUT /api/projects/{project_id}/qa/{qa_id}`：编辑问答标题或 Markdown。
- `POST /api/projects/{project_id}/qa/{qa_id}/favorite`：收藏或取消收藏。

### 高亮与索引

- `POST /api/projects/{project_id}/highlights`：创建高亮标记。
- `GET /api/projects/{project_id}/highlights`：读取高亮标记。
- `DELETE /api/projects/{project_id}/highlights/{highlight_id}`：删除高亮标记。
- `POST /api/projects/{project_id}/index/build`：构建本地 RAG 索引。
- `GET /api/projects/{project_id}/index/status`：查看索引状态。
- `POST /api/projects/{project_id}/search`：搜索本地索引。

### 设置

- `GET /api/settings/llm`：读取模型配置状态。
- `PUT /api/settings/llm`：保存模型配置。
- `POST /api/settings/llm/test`：测试模型连通性。
- `GET /api/settings/prompts`：读取提示词配置。
- `PUT /api/settings/prompts/{key}`：保存指定提示词。
- `POST /api/settings/prompts/{key}/reset`：重置指定提示词。

## 验证命令

后端测试：

```bash
cd /home/xiyuan729/github-project-learner/backend
PYTHONPATH=. .venv/bin/python -m unittest discover -s tests -v
```

前端构建：

```bash
cd /home/xiyuan729/github-project-learner/frontend
npm run build
```

## 当前边界

- 不运行被导入项目的代码。
- 不提供调试、断点、终端运行或自动补全。
- 不做多人协作。
- 不追求完整 AST 或完整调用图。
- RAG 第一版使用 SQLite FTS5 和规则符号提取，不使用 embedding。
- Tree-sitter、向量检索、桌面端封装可以作为后续阶段增强。
