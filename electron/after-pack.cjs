const { execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const projectDir = context.packager.projectDir;
  const productName = context.packager.appInfo.productFilename;
  const version = context.packager.appInfo.version;
  const executablePath = path.join(context.appOutDir, `${productName}.exe`);
  const iconPath = path.join(projectDir, "resources", "icon.ico");
  const rceditPath = path.join(
    projectDir,
    "node_modules",
    "rcedit",
    "bin",
    "rcedit-x64.exe",
  );

  await execFileAsync(rceditPath, [
    executablePath,
    "--set-icon",
    iconPath,
    "--set-version-string",
    "FileDescription",
    "CodeCourse",
    "--set-version-string",
    "ProductName",
    "CodeCourse",
    "--set-version-string",
    "InternalName",
    "CodeCourse",
    "--set-file-version",
    version,
    "--set-product-version",
    version,
  ]);
};
