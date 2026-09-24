import { writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const result = await build({
  metafile: true,
  entryPoints: ['create', 'cli'].map(name => fileURLToPath(new URL(`../node/${name}.ts`, import.meta.url))),
  outdir: fileURLToPath(new URL('../dist-node', import.meta.url)),
  external: ['@volter/editor-live', '@modelcontextprotocol/sdk', 'undici', 'typescript'],
  // jsonc-parser's `main` is a UMD build whose relative requires an ESM bundle
  // cannot resolve; its `module` build bundles cleanly.
  mainFields: ['module', 'main'],
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
});

if (process.env["VOLTER_BUILD_METAFILE"]) await writeFile(process.env["VOLTER_BUILD_METAFILE"], JSON.stringify(result.metafile, null, 2));
