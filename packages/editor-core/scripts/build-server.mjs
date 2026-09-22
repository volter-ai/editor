import { access, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(join(root, 'package.json'));
// This classic script is served as a file, so esbuild's import graph cannot
// discover it. Refuse an incomplete package before a browser gets a 500.
await access(join(root, 'src/tab-bootstrap.js'));
// Select jsonc-parser's ESM implementation; its UMD entry cannot be inlined
// safely into this ESM server bundle.
const result = await build({
  entryPoints: [join(root, 'server/packaged.ts')],
  outfile: join(root, 'dist-server/packaged.mjs'),
  metafile: true,
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  mainFields: ['module', 'main'],
  alias: { 'jsonc-parser': join(dirname(require.resolve('jsonc-parser/package.json')), 'lib/esm/main.js') },
  external: ['express', 'chokidar', 'vite', 'esbuild', 'typescript', 'ws', 'postcss',
    '@napi-rs/keyring', '@volter-ai-dev/supercode-client',
    '@volter-ai-dev/supercode-harness-sdk', 'ztrack', 'ztrack/*'],
});

if (process.env["VOLTER_BUILD_METAFILE"]) await writeFile(process.env["VOLTER_BUILD_METAFILE"], JSON.stringify(result.metafile, null, 2));
