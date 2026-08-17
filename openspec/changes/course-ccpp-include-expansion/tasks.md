# Tasks: 课件文件选择展开被 include 的项目头文件

## 1. 解析器 include_resolver.py

- [x] 1.1 `extract_quoted_includes`:仅引号 include,按出现顺序去重
- [x] 1.2 `resolve_include`:候选根(同目录 → include/src/src/include/inc/headers/lib → 仓库根)+ 包含性拦截
- [x] 1.3 `walk_source_files`:跳 IGNORED_DIRS,C/C++ 后缀清单(排序确定)
- [x] 1.4 后缀匹配兜底:浅路径优先

## 2. 选择展开

- [x] 2.1 `expand_c_cpp_includes`:BFS、去重、cap、惰性 walk
- [x] 2.2 `select_lesson_file_paths` 接入展开后再截断

## 3. 缓存失效

- [x] 3.1 `SELECTION_SCHEME_VERSION` + `_lesson_files_fingerprint`
- [x] 3.2 `_ensure_lesson_files` 两处 upsert 与 stale 判断使用版本化指纹

## 4. 测试

- [x] 4.1 `test_include_resolver.py` 新增(12 用例)
- [x] 4.2 `test_lesson_files.py` 展开用例 + 指纹断言更新
- [x] 4.3 后端全量 pytest:297 passed + 39 subtests 全绿

## 5. 验证

- [x] 5.1 真实 mikuOJ 仓库验证:sandbox_common.cpp → include/cppjudge/sandbox_internal.h + common.h + sandbox.h 全部选中
- [ ] 5.2 提交前 git status 只含本变更文件
