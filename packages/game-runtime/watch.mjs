import { spawn } from 'node:child_process';
import { context } from 'esbuild';

const typecheck = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsc', '-p', 'tsconfig.json', '--watch', '--preserveWatchOutput'],
  { cwd: import.meta.dirname, stdio: 'inherit' },
);

const config = await context({
  entryPoints: ['src/config.ts'],
  outfile: 'dist-config/config.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
});
await config.watch();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    typecheck.kill(signal);
    await config.dispose();
    process.exit(0);
  });
}

await new Promise((resolve) => typecheck.once('exit', resolve));
await config.dispose();
