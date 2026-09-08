import { createRequire } from 'node:module';
import { dirname, join, resolve, sep, extname } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import type { Plugin } from 'vite';

/** Ship the editor's matching scripts, styles and fonts with the desktop app. */
export function monacoAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const editorRequire = createRequire(require.resolve('@monaco-editor/react'));
  const root = join(dirname(editorRequire.resolve('monaco-editor/package.json')), 'min', 'vs');
  return {
    name: 'codecourse-local-monaco',
    configureServer(server) {
      server.middlewares.use('/monaco/vs', (req, res, next) => {
        const path = resolve(root, `.${decodeURIComponent((req.url || '/').split('?')[0])}`);
        if (!path.startsWith(root + sep)) return next();
        try {
          const data = readFileSync(path);
          const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.json': 'application/json' };
          res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
          res.end(data);
        } catch { next(); }
      });
    },
    generateBundle() {
      const emitDirectory = (directory: string, prefix: string) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const path = join(directory, entry.name), fileName = `${prefix}/${entry.name}`;
          if (entry.isDirectory()) emitDirectory(path, fileName);
          else this.emitFile({ type: 'asset', fileName, source: readFileSync(path) });
        }
      };
      emitDirectory(root, 'monaco/vs');
    },
  };
}
