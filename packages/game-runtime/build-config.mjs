import { build } from 'esbuild';

await build({
  entryPoints: ['src/config.ts'],
  outfile: 'dist-config/config.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
});
