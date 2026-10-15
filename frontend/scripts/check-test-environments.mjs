import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const errors = [];
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await check(file);
    else if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
      const source = await readFile(file, "utf8");
      if (/(?:from\s+|import\s*\(\s*)["']node:sqlite["']/.test(source)
          && !/^\s*\/\/\s*@vitest-environment\s+node\b/.test(source)) {
        errors.push(`${path.relative(root, file)}: node:sqlite tests require // @vitest-environment node`);
      }
    }
  }
}
await check(path.join(root, "src"));
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Test environments OK: SQLite integration tests explicitly use Node.");
}
