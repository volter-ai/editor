import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
await build({
  entryPoints: ['frame-proxy', 'process-shutdown', 'session-registry', 'worktree-identity', 'open-browser', 'spawn-opener', 'launcher/launch', 'launcher/control', 'launcher/hosted', 'hosted-attachment-relay', 'hosted-attachment-vite', 'launcher/session-verbs', 'launcher/view-build'].map(
    name => fileURLToPath(new URL(`server/${name}.ts`, root))),
  outdir: fileURLToPath(new URL('dist/server/', root)),
  bundle: true, splitting: true, platform: 'node', target: 'node22', format: 'esm', sourcemap: true,
  // The session client is its own installed package, not a copy inside the kit;
  // undici's CommonJS requires Node built-ins, which an ESM bundle cannot inline.
  // `launcher/view-build` reaches the session's toolchain; TypeScript's CommonJS cannot be inlined
  // into an ESM bundle, and esbuild resolves its own binary. Both stay the installed packages.
  external: ['@volter/live', 'undici', 'ws', 'typescript', 'esbuild'],
});

await build({
  entryPoints: [fileURLToPath(new URL('../sdk/src/session/hosted-attachment.ts', root))],
  outfile: fileURLToPath(new URL('dist/server/hosted-attachment-client.js', root)),
  bundle: true, platform: 'browser', target: 'es2022', format: 'esm',
});
