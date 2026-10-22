# 阅读器术语复验修复（2026-10-22）

在 R01–R11 与知识树改动的复验中，真实桌面 GET /terms 返回了两个同拼写概念，但阅读器没有生成任何标注；仅修正来源名后，两处术语又指向同一个概念。本次将这两个阻塞问题修复并加入正式回归测试。

## 修复

- 阅读器同时接受桌面 `teaching_manifest_v2` 与 Android `manifest`，并将两者作为清单候选参与事实画像决策。
- 清单候选按精确位置与唯一上下文匹配。上下文定位用于对齐隐藏元数据被移除后的正文，以及 Python Unicode 码点与 JavaScript UTF-16 的差异；过期或含糊的上下文不会退化为全文同名匹配。
- Markdown 分析和实际 remark 渲染共享同一套匹配规则，处理行内代码定界符、空白、转义与字符实体。代码块和已有链接继续不标注。
- 点击入口保留具体候选的身份、文字与位置，避免同名概念或同概念的不同别名因旧表 ID 为 0 而串绑。
- 无精确位置的旧记录继续兼容原有文本匹配；更新标注规则版本使缓存失效。
- 将已有 Markdown 解码工具 `micromark-util-decode-string@2.0.1` 声明为直接依赖，锁文件只增加对应导入项。

## 验证

- Node 22.23.3、pnpm 10.16.1，与 PR Validation 的 Node 主版本一致；冻结锁文件离线安装通过。
- 正式前端源码测试：127 文件、739 项通过、1 项跳过。新增桌面/Android 同名候选、中文/表情符号、隐藏元数据、行内代码、转义/实体、失效位置和真实点击对象验证。
- 先前独立失败的两项验收断言通过；输入来自真实 publication 服务与 GET /terms 响应。
- Python 3.11.1 完整后端 unittest：453 项通过。
- TypeScript、桌面 Web、Android Web 构建与 Capacitor 同步通过。
- Java 21 下 Gradle `test assembleDebug lint --offline` 通过。未进行真机验收。
- 桌面前端打包的 75 个文件与已验证构建逐字节一致；PyInstaller 后端使用项目常用的 Python 3.11 环境重建。
- 本机安装目录 `C:\Users\xiyua\CodeCourse-0.4.10-reader-acceptance` 与 `dist-desktop-reader-acceptance/win-unpacked` 共 11,207 个文件 SHA-256 全等，无缺失、无多余、无差异；桌面 `CodeCourse.lnk` 目标和工作目录有效，原快捷方式已备份。
- 安装后的后端在隔离工作区启动成功，健康检查通过；真实术语接口保留两个概念身份、两个位置，概念树接口可访问这两个身份。

本机详细日志与复现保存在忽略目录 `tmp/fix-reader-*` 和 `frontend/.cache/review-final-reader-*`。提交后的 GitHub Actions 另行核对，以上为本机验证结果。
