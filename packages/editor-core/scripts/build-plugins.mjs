import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
await build({
  entryPoints: ['product-contributions', 'shared-react', 'shared-three'].map(
    name => fileURLToPath(new URL(`vite-plugin-${name}.ts`, root))),
  outdir: fileURLToPath(new URL('dist/build/', root)),
  bundle: true,
  splitting: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
});
