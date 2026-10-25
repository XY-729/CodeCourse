# 总纲规划大概念与课件子森林（2026-10-25）

本轮修改桌面后端的总纲、课件和相关上下文链路，安装版本为 `CodeCourse-0.4.11-outline-forest`。

后续 QA 已改为与课件共用子森林；没有可用总纲时正常回答且不上传树，见 [QA 共用知识树输入](15-qa-shared-forest-20261025.md)。

## 生成行为

- 普通总纲、子总纲和流式总纲都读取完整的可见知识树。提示词要求逐课分析目标、前置基础、代码机制和应用领域，给出 `outline_knowledge.major_refs` 与跨分支 `repeated_ids`。
- 总纲只创建大概念及其必要祖先。带有该声明的清单若提前创建无关的细节概念，会在本地校验中被拒绝。
- 总纲发布时，把实际绑定的大概念 ID、重复概念 ID 和逐范围历史讲解存入 `teaching_documents.outline_scope_json`。范围按概念、aspect、dimension 记录，并绑定原始来源和内容 hash；planned/mentioned 不冒充讲解。
- 课件规划、各章节、整合、文件课件和流式课件只发送这些大概念的当前后代森林及连接祖先。连接祖先仅保留身份与父边，不带入兄弟分支的学习历史。森林后附已讲范围清单。
- 每次新课件读取当前森林，并刷新仍然有效的历史来源，吸收随后新增的讲解、剔除已删除或已失效的记录。章节重试使用同一份冻结上下文，缓存绑定总纲来源、hash 和大概念 ID。
- 问答、问卷、术语扫描与补录的模型输入在本地按明确名称、别名、来源概念及必要祖先选择，不再默认上传完整树。完整本地树仍是身份和作用域校验的依据。

## 对原方案的修订

总纲未发现重复，不能证明后续任何示例、前置知识或其他课程的新讲解都不会重复。因此保留来源可校验的历史清单，并在生成时刷新。

大概念保存稳定 ID，避免改名或同名概念造成选错子树。课件新概念必须能沿父链回到总纲选定的大概念，不能另建无归属根、修改现有父边或在连接祖先的其他分支上追加范围。身份按规范名或别名解析以后仍要验证归属，因此遗漏在森林外的同名已有概念也不会被误挂。

如果总纲漏掉领域，程序明确提示补充总纲并回滚本次树变更；不能保证模型一次分析绝对无遗漏，也不会用猜测父节点掩盖遗漏。旧课件保留。

## 兼容与持久化

旧 v2 总纲可以从实际 coverage 恢复锚点；无可靠清单的总纲在调用模型前提示补录或重新生成。读取时明确使用原总纲路径，子总纲及重命名总纲分别保留自己的森林。

生成范围存于 `GenerationContext.generation_scope_json` 和课件检查点；发布、崩溃恢复及再次索引携带 `lesson_scope_json`。写入前同时检查总纲数据库 hash 与磁盘正文，拒绝过期生成结果。数据库新列可随现有桌面数据导出导入，无需新增独立表。

核心实现：`personalization/teaching/outline_forest.py`、`generation_context.py`、`generation_service.py`、`knowledge_tree_service.py`、`teaching_index.py`、`personalization/teaching/publication.py`。

## 验证与安装

- 后端完整回归：544 项通过，其中新增森林测试 15 项。
- 课件专项回归：60 项通过。
- 前端正式源码：130 个测试文件，752 项通过、1 项跳过；生产构建通过。
- PyInstaller 后端及 Electron 目录包构建通过。
- 使用打包后的 `backend.exe` 在独立工作区连接本机模拟模型，验证总纲收到完整树、课件排除 40 个无关领域、附带已讲范围、新次概念归属正确。第三次模拟孤立根提案失败，旧课件字节不变、知识树中没有孤立节点。仅调用本机模拟模型 3 次，未调用外部模型。
- 包：`dist-desktop-outline-forest/win-unpacked`。安装：`C:/Users/xiyua/CodeCourse-0.4.11-outline-forest`。桌面 `CodeCourse.lnk` 指向新安装目录，旧快捷方式保存在 `tmp/CodeCourse-before-outline-forest.lnk`。
- 11,207 个安装文件逐一 SHA-256 核对一致；文件一致性和打包验收记录分别保存在 `tmp/outline-forest-install-verification.json`、`tmp/outline-forest-package-verification.json`。

没有修改界面主题、工作区拖动行为或用户生产数据库；没有提交或推送本轮工作区改动。
