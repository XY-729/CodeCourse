# Windows GitHub 导入系统代理修复

2026-10-25，导入 `https://github.com/XY-729/cpp-kv-workbench` 返回 502，Git 报告 `Recv failure: Connection was reset`。

本机 Windows 系统代理已启用，但 Git/curl 不自动读取 Windows Internet Settings。内置 Git 直连失败，通过系统代理访问同一仓库成功。

修复位于 `backend/app/services/git_service.py`：Windows HTTPS 导入在没有显式 Git 或环境变量代理时读取系统 HTTPS 代理，仅传递给当前 Git 子进程，不修改全局 Git 配置。保留显式禁用代理、代理绕过规则及 SSH 行为。关闭不可交互的凭据提示，隐藏 Git 子进程窗口，将失败详情记入后端日志。

验证：

- 7 项代理继承及错误日志测试、11 项仓库身份和课程接口测试、4 项本地导入测试通过。
- 修复后的源码使用内置 Git 成功克隆实际仓库。
- 重建前端、PyInstaller 后端及 Electron 桌面应用。
- 打包后端在独立数据目录中实际导入该仓库，读取源码树、README、默认总纲，重复导入复用同一项目 ID。
- 本机安装内容逐文件核对 SHA-256，更新并验证桌面快捷方式。

打包验证记录：`tmp/github-import-proxy-package-verification.json`。安装验证记录：`tmp/github-import-proxy-install-verification.json`。
