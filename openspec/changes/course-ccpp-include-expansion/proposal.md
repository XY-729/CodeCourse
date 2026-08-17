# Proposal: 课件文件选择展开被 #include 的项目头文件

## Why

用户报告第 4 课课件只写了 `sandbox_internal.h` "确实存在但 RAG 没有给出它的具体内容"。调查结论:课件证据由两层拼成,但都受同一道闸门——`select_lesson_file_paths` 的 top-8 语义检索——控制:

1. **整文件汇编**(`assemble_file_code_blocks`)只读选中的文件;`sandbox_internal.h` 未被选中 → 81 行的完整内容不会进课件(它远低于 12KB 上限,只要选中就会全量进入)。
2. **RAG 片段**被 `[item for item in results if item.path in assembly.included]` 过滤,只保留已选文件的片段 → 头文件连零碎片段都拿不到。

模型唯一看到的线索是 `src/sandbox_common.cpp` 第 1 行 `#include "cppjudge/sandbox_internal.h"`,于是只能推断"存在但内容未知"。这是 C/C++ 项目的系统性缺陷:**文件选择不跟随 `#include` 依赖**——被选中源文件依赖的头文件(往往是本课声明的来源)永远不会被拉进证据。

## What Changes

**新增 `backend/app/services/include_resolver.py`**:
- `extract_quoted_includes(content)`:解析 C/C++ `#include "..."`(仅引号形式,不碰系统头 `<...>`)。
- `resolve_include(repo_root, including_rel, include_path, source_files=None)`:解析到仓库内真实存在的文件。依次尝试:包含文件所在目录 → 常见 include 根(`include`/`src`/`src/include`/`inc`/`headers`/`lib`) → 仓库根 → 后缀匹配兜底(对全仓库 C/C++ 文件做一次有界遍历,找 `*/<include_path>` 最短路径者,覆盖自定义 `-I` 目录)。`../` 越界与系统绝对路径被包含性检查拦截。
- `_walk_source_files(repo_root)`:跳过 `IGNORED_DIRS` 的 C/C++ 文件清单,仅在后缀兜底需要时惰性构建一次。

**`backend/app/services/lesson_files.py`**:
- `expand_c_cpp_includes(repo_root, files, cap=MAX_FILES_PER_LESSON)`:对选中集合做 BFS——只要集合里有 C/C++ 文件,就顺带展开其引号 include 的头文件(头文件再展开其 include),去重、受 cap 约束、仅当文件真实存在。
- `select_lesson_file_paths` 在返回前调用展开,再统一按 `MAX_FILES_PER_LESSON` 截断(展开项与检索项公平竞争)。

**缓存失效 `SELECTION_SCHEME_VERSION`**:
- `_ensure_lesson_files` 目前只在索引指纹变化时才重新选择。主 `outline.md` 的课 `bypass_cache=False`,旧缓存(无头文件)会一直复用。引入 `SELECTION_SCHEME_VERSION`,写入 `lesson_files.indexed_fingerprint` 的值变成 `f"{fp}#{SELECTION_SCHEME_VERSION}"`——版本号变化使旧记录自动判为 stale,下次生成/预览即重新选择,用户无需重建索引即可拿到含头文件的课件。

## Capabilities

### New Capabilities
- `lesson-file-selection`: C/C++ 课件展开被选中文件引号 include 的项目头文件

### Modified Capabilities
- (无既有 capability 被破坏;`select_lesson_file_paths` 返回值集合在 C/C++ 项目中变大)

## Impact

### New Files
- `backend/app/services/include_resolver.py`

### Modified Files
- `backend/app/services/lesson_files.py` — 展开逻辑 + 接入选择
- `backend/app/services/generation_service.py` — 指纹带版本号,自动失效旧缓存
- `backend/tests/test_lesson_files.py` — 指纹测试更新 + 展开用例
- `backend/tests/test_include_resolver.py` — 新解析器单测

### Not Touched
- RAG 检索算法、`assemble_file_code_blocks` 预算
- 系统头 `<...>` 跟随(无法解析到仓库内)
- 编译数据库/真实 `-I` 解析(候选根 + 后缀匹配已覆盖实际布局)
