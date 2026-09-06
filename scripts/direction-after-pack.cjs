const { execFileSync } = require('node:child_process');
const path = require('node:path');
module.exports = async function(context) {
  if (context.electronPlatformName !== 'win32') return;
  execFileSync(path.join(context.packager.projectDir, 'node_modules/rcedit/bin/rcedit-x64.exe'), [
    path.join(context.appOutDir, 'CodeCourse Direction C.exe'),
    '--set-icon', path.join(context.packager.projectDir, 'resources/direction-c/icon.ico'),
    '--set-version-string', 'FileDescription', 'CodeCourse Direction C',
    '--set-version-string', 'ProductName', 'CodeCourse Direction C',
    '--set-version-string', 'InternalName', 'CodeCourseDirectionC',
  ], { windowsHide: true });
};
