# Capability: C/C++ 课件文件选择展开被 include 的头文件

## 场景

### 场景 1: 选中源文件 include 项目头文件

**Given** 第 4 课选中的文件包含 `src/sandbox_common.cpp`,其第 1 行 `#include "cppjudge/sandbox_internal.h"`
**When** `select_lesson_file_paths` 选择文件
**Then** `include/cppjudge/sandbox_internal.h`(经候选 include 根解析)被加入课件文件集,课件证据包含其完整代码

### 场景 2: 头文件再 include 其他头文件(传递)

**Given** 被展开的头文件自身 `#include "core/types.h"`
**When** 展开
**Then** `core/types.h` 也进入文件集(受上限约束)

### 场景 3: 头文件位于自定义 include 目录

**Given** 头文件在 `deps/sandbox/internal.h`,被 `#include "sandbox/internal.h"` 引用
**When** 候选根解析失败
**Then** 后缀匹配兜底解析到 `deps/sandbox/internal.h`

### 场景 4: 展开受文件数上限约束

**Given** 检索已返回接近 `MAX_FILES_PER_LESSON` 的文件
**When** 展开
**Then** 文件集不超过 `MAX_FILES_PER_LESSON`,且检索结果优先保留

### 场景 5: 非 C/C++ 项目不受影响

**Given** 选中的文件都是 Python/TS
**When** 展开
**Then** 文件集原样返回(无 `#include` 匹配)

### 场景 6: 重新生成自动换用新选择

**Given** 旧课件用旧版选择逻辑(无头文件)生成并缓存了 lesson_files
**When** 用户重新生成该课
**Then** 版本号变化使缓存判 stale,自动重新选择并包含头文件

## 边界

- 仅跟随引号 include `"..."`,不跟随系统头 `<...>`。
- `../` 越界、绝对系统路径被包含性检查拦截,绝不返回仓库外路径。
- include 解析失败或文件不存在时静默跳过,不改变原选择。
- 只有集合内含 C/C++ 文件才触发展开;纯非 C/C++ 项目开销为零。
