# 发布正式版本

1. 更新根目录 `package.json`、`README.md` 和 `RELEASE_NOTES.md`。Android 版本名和版本号由根目录版本自动计算。
2. 按 `.github/workflows/pr-validation.yml` 使用 Node 22 验证，提交并推送到 `main`，等待该提交的 PR Validation 全部通过。
3. 确认仓库已配置四项 Android 正式签名 secrets。对已验证提交创建并推送对应的 `v*` 标签；两个平台发布流程会将产物上传至同一份草稿 Release。
4. 等待 Production Release Build 和 Android APK Build 都通过，核对安装版、便携版、正式签名 APK、说明书、更新元数据及两个平台的 SHA-256 校验文件齐全。验证下载文件的 SHA-256、Windows 版本和 Android 签名、版本号、隐私扫描。
5. 使用正式产物更新本机桌面应用，核对安装文件与快捷方式，并在独立工作区验证打包后端。
6. 用 `RELEASE_NOTES.md` 更新草稿说明，再将 Release 公开并设为最新版本。仅构建成功或部分产物上传完成不代表正式发布完成。

草稿阶段保留上一正式版为 Latest，避免用户下载到尚未核对齐全的跨平台发布。
