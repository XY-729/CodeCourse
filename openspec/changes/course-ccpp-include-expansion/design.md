# Design: 课件文件选择展开被 include 的项目头文件

## 背景

`_repository_lesson_evidence`(generation_service.py:548)的证据由两层拼成,都受 `_ensure_lesson_files → select_lesson_file_paths`(top-8 语义检索)控制:

- `assembly.content`:对**已选文件**从磁盘直读完整内容再压缩(`assemble_file_code_blocks`)。
- `rag_context`:只保留 `item.path in assembly.included` 的片段。

`sandbox_internal.h` 未被选中 → 两层都没有它 → 模型只见 `#include` 行、不见内容。根因是文件选择不跟随 `#include` 依赖。

## 方案

### include_resolver.py(新)

```
extract_quoted_includes(content) -> list[str]
  正则 ^\s*#\s*include\s*"([^"]+)" 按出现顺序去重。

resolve_include(repo_root, including_rel, include_path, source_files=None) -> Optional[str]
  候选根解析(仅文件系统,不建索引):
    1. including 文件所在目录
    2. INCLUDE_ROOTS = include / src / src/include / inc / headers / lib
    3. 仓库根
  每个候选做 .is_file() + 仓库包含性检查(拦 ../ 与绝对路径)+ C/C++ 后缀检查。
  全部失败且 source_files 提供时:后缀匹配 f"/{include_path}",选路径段数最少者(浅路径优先)。

_walk_source_files(repo_root) -> list[str]
  os.walk 跳过 IGNORED_DIRS,只收 C/C++ 后缀,返回相对 posix 路径。
```

### lesson_files.py

```
expand_c_cpp_includes(repo_root, files, *, cap=MAX_FILES_PER_LESSON) -> list[str]
  if not any C/C++ in files: return files 原样
  seen = set(files); queue = files 副本; walk 惰性建
  while queue and len(selected) < cap:
    出队 rel → read_text_file(失败 continue)→ extract_quoted_includes
    逐个 resolve_include(候选根失败才建 walk 重试)→ 去重、存在性校验 → append + 入队
  返回 selected(检索项在前,展开项在后)

select_lesson_file_paths(...):
  原检索 + 兜底不变
  files = expand_c_cpp_includes(repo_root, files)
  return files[:MAX_FILES_PER_LESSON]   # 展开项与检索项公平竞争后截断
```

### 缓存失效

```
lesson_files.py:   SELECTION_SCHEME_VERSION = "ccpp-includes-1"
generation_service._ensure_lesson_files:
  fingerprint 改用 _lesson_files_fingerprint(project_id) = f"{fp}#{SELECTION_SCHEME_VERSION}"(fp None 时 None)
  stale 比较、两处 upsert 都用它
```

旧记录存的是裸指纹 → 与版本化值不等 → 判 stale → 自动重选。`get_lesson_file_records` 只读 `indexed_fingerprint` 字符串,格式不变,无需改 storage。

## 测试

- `test_include_resolver.py`(新):引号/系统头区分、同目录解析、include 根解析(mikuOJ 型)、后缀兜底、`../` 越界拦截、去重。
- `test_lesson_files.py`:展开去重、cap 截断、检索项优先、非 C/C++ 原样、`test_index_fingerprint_change_reselects_with_full_lesson_plan` 指纹断言更新为版本化值。
- 后端全量 pytest。

## 不做

- 不跟随系统头 `<...>`(无法解析到仓库内)。
- 不引入编译数据库(compile_commands.json)/真实 `-I` 解析——候选根 + 后缀匹配已覆盖本项目实际布局,避免过度工程。
- 不改 RAG 检索算法、不改 assembly 预算。
