import { spawn } from 'node:child_process';
import path from 'node:path';

// Keep the video runtime and browser artifacts inside the isolated prototype.
const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.resolve('.cache/playwright') },
  windowsHide: true,
});
child.on('exit', code => { process.exitCode = code ?? 1; });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
