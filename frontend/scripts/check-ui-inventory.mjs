import { readFile, readdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const inventory = JSON.parse(await readFile(path.join(root, "ui-surfaces.json"), "utf8"));
const errors = [];
const documentedFiles = new Set();
const ids = new Set();

async function walk(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const name = `${directory}/${entry.name}`;
    return entry.isDirectory() ? walk(name) : [name];
  }));
  return nested.flat();
}

async function verifyPath(file, owner) {
  if (typeof file !== "string" || !file.startsWith("src/") || file.includes("..") || file.includes("\\")) {
    errors.push(`${owner}: invalid source path ${file}`);
    return;
  }
  try { await access(path.join(root, file)); }
  catch { errors.push(`${owner}: missing file ${file}`); }
}

for (const surface of inventory.surfaces) {
  if (!surface.id || ids.has(surface.id)) errors.push(`Missing/duplicate surface id: ${surface.id}`);
  ids.add(surface.id);
  for (const field of ["name", "entry"]) {
    if (!surface[field]?.trim()) errors.push(`${surface.id}: missing ${field}`);
  }
  for (const field of ["platforms", "states", "files", "styles"]) {
    if (!Array.isArray(surface[field]) || !surface[field].length) errors.push(`${surface.id}: missing ${field}`);
  }
  for (const file of surface.files ?? []) {
    await verifyPath(file, surface.id);
    documentedFiles.add(file);
  }
  for (const style of surface.styles ?? []) await verifyPath(style, surface.id);
}

// Explicit entries, not directory globs: a new visual file must be considered by a person.
const uiFiles = (await walk("src")).filter(file =>
  file.endsWith(".tsx") && !/\.(?:test|spec)\.tsx$/.test(file) && !file.includes("/__tests__/"),
);
for (const file of uiFiles) {
  if (!documentedFiles.has(file)) errors.push(`Unlisted UI file: ${file}`);
}
for (const file of documentedFiles) {
  if (!uiFiles.includes(file)) errors.push(`Inventory UI entry is not a production TSX file: ${file}`);
}

if (errors.length) {
  console.error("UI inventory check failed:\n" + errors.map(error => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`UI inventory OK: ${inventory.surfaces.length} surfaces, ${uiFiles.length} UI files; all source/style paths exist.`);
}
