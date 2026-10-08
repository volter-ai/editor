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

// AND NO ENTRY MAY START IT. External, an import of `typescript` would no longer crash the CLI; it
// would load all of TypeScript on every command, `--help` included. Said here, by name, at build time.
const startsTypeScript = Object.entries(result.metafile.outputs)
  .filter(([, output]) => output.imports.some((imported) => imported.path === 'typescript'))
  .map(([file]) => file);
if (startsTypeScript.length > 0) {
  throw new Error(`The CLI imports typescript on its start path (${startsTypeScript.join(', ')}). Take what it needs from a module that does not import typescript (as #296 did with @volter/sdk/kit/adapter-module).`);
}

if (process.env["VOLTER_BUILD_METAFILE"]) await writeFile(process.env["VOLTER_BUILD_METAFILE"], JSON.stringify(result.metafile, null, 2));
