## Why

用户反馈课件生成的两个问题:

1. **课件经常提到"没有包含涉及文件的代码",只能靠猜**。桌面端课件生成输入(`build_outline_lesson_input`)只包含:总纲摘要 7000 字 + 本课计划 + RAG 检索片段。**没有任何文件的真实代码**。当 RAG 检索为空(索引未建或查不到),LLM 收到"索引中没有匹配片段。",只能自己编造"文件名:行号"引用。

2. **桌面端课件明显比安卓端短**。Android 端 `generateOutlineLesson` 有两条兜底上下文:本地 FTS 检索片段 + `projectContext`(8 个关键文件的真实代码,每个最多 3000 字)。桌面端两条都没有 → 桌面课件短、且无法逐行引用真实代码。

3. **RAG 检索为空导致课件引用指向空行**。实际案例:项目索引在课件生成后才构建(课件 11:41 生成,索引 15:59 建成),生成时 `get_active_generation()==0` → 检索直接返回空 → 课件引用"common.h:73-82"但 LLM 明说"该片段的代码文本为空"。索引本身是好的(406 chunks,FTS5 正常),问题在**生成 pipeline 不等待索引、也没有兜底直读文件**。

## What Changes

### 1. 总纲阶段决定每课涉及文件

- 总纲生成后,由 LLM 从项目地图/目录树中**声明每课涉及的文件清单**
- 或由系统在总纲生成后,针对每课标题用代码索引检索 + 关键文件启发式,自动挑选每课 top-N 文件
- 文件清单持久化,课件生成时使用

### 2. 课件生成时注入真实文件代码

- 文件级课件:注入该文件**完整代码**(或大文件分段)
- 课程级课件:注入**涉及文件清单内各文件的代码片段**(关键符号、函数体、行号范围)
- **不再依赖 RAG 是否构建成功**:RAG 为空时自动兜底直读文件内容

### 3. 桌面端对齐 Android 端上下文量

- 桌面端课件输入加入文件真实代码 → 课件长度自然对齐 Android 端
- 行号引用有真实代码支撑,不再"靠猜"

## Capabilities

### New Capabilities
- `lesson-file-selection`: 总纲阶段为每课决定涉及文件清单,持久化供课件生成使用

### Modified Capabilities
- `course-generation`: 课件生成输入包含涉及文件的真实代码,不再仅依赖 RAG 检索
- `index-search`: RAG 检索结果作为附加信号而非唯一来源;为空时直读文件兜底

## Impact

### New Files
- `backend/app/services/lesson_files.py` — 每课文件清单的挑选与持久化逻辑

### Modified Files
- `backend/app/services/generation_service.py` — outline 生成后挑选每课文件;课件输入注入文件真实代码
- `backend/app/services/storage.py` — 新增 lesson 文件清单的持久化(表或 JSON 字段)
- `frontend/src/platform/android/localProvider.ts` — Android 端同步:总纲阶段决定文件清单、课件输入注入文件代码
- `frontend/src/platform/android/database.ts` — Android 端新增清单表
- `backend/app/api/` — 若需要暴露清单查询

### Not Touched
- Electron shell (`electron/`)
- Android Java code (`android/`)
- 索引构建本身(索引功能是好的,问题在生成 pipeline 的依赖方式)
- RAG 检索算法
