const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("node:path");
const execFileAsync = promisify(execFile);

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;
  const projectDir = context.packager.projectDir;
  const { productFilename, version } = context.packager.appInfo;
  // signAndEditExecutable is off; embed the independent icon and metadata here.
  await execFileAsync(path.join(projectDir, "node_modules/rcedit/bin/rcedit-x64.exe"), [
    path.join(context.appOutDir, `${productFilename}.exe`),
    "--set-icon", path.join(projectDir, "resources/direction-c/icon.ico"),
    "--set-version-string", "FileDescription", productFilename,
    "--set-version-string", "ProductName", productFilename,
    "--set-version-string", "InternalName", "CodeCourseDirectionC",
    "--set-file-version", version,
    "--set-product-version", version,
  ], { windowsHide: true });
};
