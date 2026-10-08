import { writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const result = await build({
  metafile: true,
  entryPoints: ['create', 'cli'].map(name => fileURLToPath(new URL(`../node/${name}.ts`, import.meta.url))),
  outdir: fileURLToPath(new URL('../dist-node', import.meta.url)),
  // `typescript` stays OUT: its CommonJS build requires node's own modules, which the ESM bundle
  // cannot, and a bundle that took it in died on its first line (#296).
  external: ['@volter/live', '@modelcontextprotocol/sdk', 'undici', 'typescript'],
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
});

if (process.env["VOLTER_BUILD_METAFILE"]) await writeFile(process.env["VOLTER_BUILD_METAFILE"], JSON.stringify(result.metafile, null, 2));
