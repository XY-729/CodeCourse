const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'frontend', 'public', 'live2d');
const required = [
  path.join(publicDir, 'core', 'live2dcubismcore.min.js'),
  path.join(publicDir, 'models', 'board-muse', 'board-muse.model3.json'),
];
const missing = required.filter((file) => !fs.existsSync(file));
const result = {
  runtime: missing.includes(required[0]) ? 'missing' : 'ready',
  model: missing.includes(required[1]) ? 'missing' : 'ready',
  publicDir,
  missing: missing.map((file) => path.relative(root, file)),
};
console.log(JSON.stringify(result, null, 2));
if (process.argv.includes('--strict') && missing.length) process.exitCode = 1;
