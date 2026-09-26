import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'vite';
// Config-relative TS imports get bundled the same way — that is what lets the
// project's executable Zod schemas reach the build-time check below.
import { manifestEntryModulesPlugin } from './manifest-entry-modules-plugin';
import manifest from './vgai.project.json';

/** A vgai runtime package served as SOURCE, the way the editor serves it. */
const packageSource = (name: string) =>
  path.join(path.dirname(createRequire(import.meta.url).resolve(`${name}/package.json`)), 'src');

/**
 * Run-4 dry-run friction #2 — auto-detect drvfs the SAME way the editor dev
 * server does (`packages/editor/server/server-utils.ts`'s
 * `resolveWatcherPollOptions`, and `dev.ts`'s own `projectOnDrvfs` check):
 * on WSL, a project living on a Windows drive (`/mnt/<drive>/…`) never fires
 * inotify, so without polling this standalone server (`npm run dev:standalone`)
 * silently misses every external file edit — the same failure mode
 * `dev.ts`'s comment documents for the editor. Before this fix, this file
 * read ONLY `VGAI_WATCH_POLL`, so a project on drvfs polled in the editor
 * but NOT in the standalone server — the two disagreed for no reason a
 * developer could see.
 *
 * The editor's server utilities are not part of the project's package
 * contract, so this
 * duplicates the tiny drvfs check rather than reaching across a package
 * boundary that doesn't exist here — same contract as the editor's own
 * helper: `VGAI_WATCH_POLL=0` forces polling off anywhere, `=1`/`=<ms>`
 * forces it on with that interval, unset auto-enables on a drvfs mount.
 */
function resolveWatchOption(): { usePolling: true; interval: number } | undefined {
  const raw = process.env['VGAI_WATCH_POLL'];
  if (raw !== undefined && raw !== '') {
    if (raw === '0') return undefined;
    const ms = Number(raw);
    return { usePolling: true, interval: Number.isFinite(ms) && ms > 1 ? ms : 1000 };
  }
  const onDrvfs = process.platform === 'linux' && /^\/mnt\/[a-z]\//i.test(__dirname);
  return onDrvfs ? { usePolling: true, interval: 1000 } : undefined;
}

/**
 * `VITE_ALLOWED_HOSTS` — `all` allows any Host header, a comma list allows
 * exactly those, unset leaves Vite's own default alone.
 *
 * Returned as a SPREADABLE fragment rather than a value, because the "unset"
 * case must omit the key entirely: this project compiles under
 * `exactOptionalPropertyTypes`, where `allowedHosts: undefined` is a type
 * error against `ServerOptions`'s optional `allowedHosts?: true | string[]`.
 * Vite reads an absent key and an explicitly-undefined one identically, so
 * the spread is behavior-preserving and the types now agree.
 */
function resolveAllowedHosts(): { allowedHosts?: true | string[] } {
  const raw = process.env['VITE_ALLOWED_HOSTS'];
  if (raw === 'all') return { allowedHosts: true };
  const hosts = raw?.split(',').filter(Boolean);
  return hosts ? { allowedHosts: hosts } : {};
}

export default defineConfig({
  // Build-path validation (build-only): every
  // registered data asset must still parse through its schema (the EXACT
  // parse defineData runs at load), every `"file#key"` ref must resolve, and
  // no `src/tools/` module may reach the shipped bundle (§4: tools are
  // editor-only — never serve testers a build with dev/cheat surfaces).
  // The AUTOMATIC JSX runtime, set here rather than left to tsconfig.
  //
  // This project has no `@vitejs/plugin-react`; Vite's built-in esbuild does
  // the JSX transform, and it picks the runtime from the tsconfig nearest the
  // FILE. That covers `src/**`, but the vgai runtime packages are served as
  // source out of their installed directories (see the aliases below), where
  // the project's tsconfig does not reach — so their `.tsx` compiled with the CLASSIC runtime, emitting
  // bare `React.createElement` calls into a module that never imports React.
  // The scaffold's game page died on `ReferenceError: React is not defined`.
  esbuild: { jsx: 'automatic' },
  plugins: [manifestEntryModulesPlugin(manifest)],
  resolve: {
    alias: {
      '@volter/editor-project': packageSource('@volter/editor-project'),
      '@volter/threejs-runtime': packageSource('@volter/threejs-runtime'),
      '@volter/game-runtime': packageSource('@volter/game-runtime'),
    },
    // The aliases above serve the runtime packages as SOURCE from their
    // installed directories, where module resolution walks up to a physical
    // react, three or fiber other than this project's own. Two copies in one
    // page split React context ("Invalid hook call", drei's "Hooks can only be
    // used within the Canvas component!") and three's class identity, so
    // `dedupe` collapses every import onto this project's copy.
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber', 'pixi.js', '@pixi/react'],
  },
  optimizeDeps: {
    // Top-level `esbuild.jsx` does not govern dependency optimization. The
    // source-served runtime packages carry TSX, so their cold prebundle needs
    // the automatic runtime too or it emits a bare `React`.
    esbuildOptions: { jsx: 'automatic' },
    // Pre-bundle deps that are only reached through the dynamically imported
    // example modules (or injected by the JSX transform, like the React
    // runtimes) so Vite does not discover them at runtime, re-optimize, and
    // hard-reload the standalone runtime the first time a game selects them —
    // that mid-session reload resets `window.__vgaiScene`/the menu out from
    // under whatever is driving the page (the dep-optimize-reload flake the
    // 04 spec hit: the first cold select of `editor-tutorial` reloaded on
    // `react/jsx-dev-runtime`). Verified against a cold scaffold: with these
    // listed, a full sweep of the switcher games triggers zero page reloads.
    include: [
      // BARE `react`/`react-dom`, not just the jsx-runtime subpaths below.
      // The engine is served as SOURCE to a scaffolded project, so Vite's
      // startup dep scan does not walk far enough to discover engine modules
      // that do `import { createElement } from 'react'`. Unoptimized, Vite
      // serves React's raw CJS `index.js`, which has no named ESM exports, and
      // the game page dies before boot with
      //   The requested module '/node_modules/react/index.js' does not
      //   provide an export named 'createElement'
      // A fresh scaffold + a live bot run hit exactly this against
      // the published 0.5.1 CLI: the shipped bot failed on its own
      // scaffold. Listing them here forces the same pre-bundle pass as the
      // subpaths, which also keeps them in ONE React instance (see `dedupe`
      // above) rather than a second copy behind a different optimized chunk.
      'react',
      'react-dom',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-dom/client',
      // Reached through the generated manifest-entry module after startup;
      // listing them prevents a first-boot optimizer reload.
      'three',
      'zod',
      // The R3F default world: prebundle fiber and drei in the SAME
      // optimizer pass so they share one fiber chunk. Split instances = drei
      // hooks outside `<Canvas>`'s root context (see the dedupe note above).
      '@react-three/fiber',
      '@react-three/drei',
    ],
  },
  server: {
    port: 5180,
    // Fail loudly instead of silently rebinding to 5181+ if 5180 is still
    // held by a lingering prior instance. Without this, a stale server left
    // over from an earlier run answers the NEW server's readiness
    // probe (which targets the fixed 5180 URL) while the real new instance
    // sits on a different port nobody is talking to -- a hazard previously
    // observed causing a browser-lane spec to hang waiting on the wrong server. See
    // packages/editor/e2e/helpers/server.ts's `startStandaloneServer`.
    strictPort: true,
    // Poll for file changes instead of relying on inotify — AUTO-ENABLED on
    // WSL when the project lives on a Windows drive (/mnt/c, drvfs: inotify
    // never fires there), or edits to src/data/ or src/ generally silently never
    // hot-reload into the running game.
    // `VGAI_WATCH_POLL` is an explicit override (`=0` off anywhere, `=1`/
    // `=<ms>` on anywhere) — see `resolveWatchOption` above, which the
    // EDITOR dev server's own auto-detect mirrors, so one behavior covers
    // both surfaces without the developer having to set anything. Safe to
    // enable here: this standalone server only watches the project tree,
    // which is small.
    //
    // VGAI_NO_WATCH=1 (set by a harness driving this page):
    // disable watching entirely — a mid-run Vite reload resets
    // `window.__vgai`/whatever is driving the standalone page out from under
    // an in-flight run (the hollowstone reload-kills-the-run
    // lesson). Mutually exclusive with the poll option (same `server.watch`
    // key) — NO_WATCH wins when both would otherwise apply.
    ...(process.env['VGAI_NO_WATCH']
      ? { watch: null }
      : // Watch source; never watch output: a build (`npm run build`,
        // `vercel build`) rewriting dist/ or .vercel/output/ inside the
        // project root would otherwise read as a source change and reload
        // the page out from under an in-flight run.
        { watch: { ...resolveWatchOption(), ignored: ['**/.vercel/**', '**/dist/**'] } }),
    ...resolveAllowedHosts(),
  },
  build: {
    target: 'es2022',
    // The engine has several independently cacheable heavyweight domains. Keep
    // them out of one 4+ MiB entry chunk so browsers can fetch/cache them in
    // parallel and a change to game code does not invalidate every vendor byte.
    // 2.25 MiB is the measured raw ceiling for the largest unavoidable vendor
    // domain (Rapier); a game/engine chunk reaching it still warns.
    chunkSizeWarningLimit: 2304,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return undefined;
          if (id.includes('/@dimforge/rapier3d')) return 'vendor-physics';
          if (id.includes('/three/') || id.includes('/postprocessing/')) return 'vendor-three';
          if (id.includes('/three.quarks/') || id.includes('/quarks.core/')) {
            return 'vendor-particles';
          }
          if (id.includes('/recast-navigation')) return 'vendor-navigation';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
            return 'vendor-react';
          }
          if (id.includes('/tone/') || id.includes('/standardized-audio-context/')) {
            return 'vendor-audio';
          }
          if (id.includes('/xstate/') || id.includes('/gsap/')) return 'vendor-animation';
          if (id.includes('/colyseus') || id.includes('/@colyseus/')) return 'vendor-network';
          return undefined;
        },
      },
    },
  },
});
