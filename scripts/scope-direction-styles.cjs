// One-time mechanical migration: retain approved scene artwork rules and
// remove the experimental overrides of the original long-form reader.
const fs = require('node:fs');
const path = require('node:path');
const file = path.resolve(__dirname, '../frontend/src/desktop/direction.css');
const source = fs.readFileSync(file, 'utf8');
if (source.startsWith('/* Scoped Direction C')) process.exit(0);
const keep = ['.direction-brand', '.direction-projects', '.direction-nav', '.direction-system'];
const rules = source.split(/\r?\n/).filter(line => keep.some(prefix => line.startsWith(prefix)));
// Scene navigation now represents a single reader, with original mixed tabs.
const result = rules.join('\n')
  .replace('repeat(6,minmax(0,1fr))', 'repeat(4,minmax(0,1fr))')
  .replace('inset:28px -12% -20%', 'inset:var(--dir-window-height) -12% -20%')
  .replace('z-index:7000', 'z-index:var(--dir-layer-transition)')
  .replace('visibility:hidden;pointer-events:auto', 'visibility:hidden;pointer-events:none');
fs.writeFileSync(file, '/* Scoped Direction C scene artwork; reader rules live in the original apple-* styles. */\n' + result + '\n');
