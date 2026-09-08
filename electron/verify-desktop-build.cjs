const fs = require("node:fs");
const path = require("node:path");

function verifyDesktopBuild(projectDir) {
  const dist = path.join(projectDir, "frontend", "dist-desktop");
  const fail = (detail) => { throw new Error(`Desktop packaging stopped: ${detail}. Run npm --prefix frontend run build first.`); };
  const stampPath = path.join(dist, "build-platform.json");
  if (!fs.existsSync(stampPath)) fail("missing build-platform.json");
  const stamp = JSON.parse(fs.readFileSync(stampPath, "utf8"));
  const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
  if (stamp.platform !== "desktop") fail(`expected desktop frontend, found ${stamp.platform}`);
  if (stamp.version !== pkg.version) fail(`frontend version ${stamp.version} differs from desktop ${pkg.version}`);
  const assets = path.join(dist, "assets");
  const files = fs.readdirSync(assets);
  if (!files.some((name) => /^DirectionShell-.*\.js$/.test(name))) fail("DirectionShell game scene is absent");
  const hasGameStyles = files.filter((name) => name.endsWith(".css"))
    .some((name) => fs.readFileSync(path.join(assets, name), "utf8").includes(".direction-shell"));
  if (!hasGameStyles) fail("Direction C desktop styles are absent");
  for (const name of ["project", "source", "ask"]) {
    if (!fs.existsSync(path.join(dist, "direction", `${name}.png`))) fail(`missing ${name} scene artwork`);
  }
  console.log(`Verified Direction C desktop frontend ${stamp.version}`);
}

module.exports = (context) => verifyDesktopBuild(context.packager.projectDir);
module.exports.verifyDesktopBuild = verifyDesktopBuild;
if (require.main === module) verifyDesktopBuild(path.resolve(__dirname, ".."));
