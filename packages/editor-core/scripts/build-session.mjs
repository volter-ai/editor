import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
await build({
  entryPoints: ['frame-proxy', 'process-shutdown', 'session-registry', 'worktree-identity', 'open-browser', 'spawn-opener', 'launcher/launch', 'launcher/control', 'launcher/hosted', 'hosted-attachment-relay', 'hosted-attachment-vite', 'launcher/session-verbs'].map(
    name => fileURLToPath(new URL(`server/${name}.ts`, root))),
  outdir: fileURLToPath(new URL('dist/server/', root)),
  bundle: true, splitting: true, platform: 'node', target: 'node22', format: 'esm', sourcemap: true,
  // The session client is its own installed package, not a copy inside the kit;
  // undici's CommonJS requires Node built-ins, which an ESM bundle cannot inline.
  external: ['@volter/editor-live', 'undici', 'ws'],
});

await build({
  entryPoints: [fileURLToPath(new URL('../editor-sdk/src/session/hosted-attachment.ts', root))],
  outfile: fileURLToPath(new URL('dist/server/hosted-attachment-client.js', root)),
  bundle: true, platform: 'browser', target: 'es2022', format: 'esm',
});
