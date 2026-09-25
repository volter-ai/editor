// The serving module runs in the session's Node process, which strips no types under
// node_modules, so it ships built: the game-module-access resolution.
import { build } from 'esbuild';

await build({
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['vite'],
  entryPoints: ['serving/index.ts'],
  outfile: 'dist-node/serving.mjs',
});
