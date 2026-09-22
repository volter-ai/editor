import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
await build({
  entryPoints: ['frame-proxy', 'process-shutdown', 'session-registry', 'worktree-identity', 'open-browser', 'spawn-opener'].map(
    name => fileURLToPath(new URL(`server/${name}.ts`, root))),
  outdir: fileURLToPath(new URL('dist/server/', root)),
  bundle: true, splitting: true, platform: 'node', target: 'node22', format: 'esm', sourcemap: true,
});
