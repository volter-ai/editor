// The serving module runs in the session's Node process, which strips no types under
// node_modules, so it ships built: the Blender engine and file routes.
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // The session provides these; bundling a second copy would split their identity. The
  // `@volter` packages this reaches ship TypeScript source, which Node will not run from
  // node_modules, so they are bundled.
  external: ['vite'],
};
await build({ ...common, entryPoints: ["serving/index.ts"], outfile: "dist-node/serving.mjs" });
