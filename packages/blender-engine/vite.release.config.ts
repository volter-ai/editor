/**
 * THE RELEASE BUILD OF THE TRANSLATION (WS-AC, cut 4).
 *
 *     npm run build:blender-three -w @volter/blender-engine
 *
 * One entry (`browser/three/release.ts`) and one output module
 * (`dist/release/blender-three.mjs`) with three, zod and the four display
 * tables INLINED. A host fetches it from the artifact base beside
 * `blender.wasm`, imports it, and attaches one presenter to the Blender it
 * started.
 *
 * THE TABLES ARE BASE64 IN THE MODULE, AND THAT IS MEASURED RATHER THAN
 * CHOSEN. `displayTableUrl` resolves a table with
 * `new URL(`./${name}.lut`, import.meta.url)`; Vite answers a template it
 * cannot evaluate by globbing the siblings that match, and in LIBRARY MODE it
 * inlines every asset it finds -- `build.assetsInlineLimit: 0` does not change
 * it (tried, 2026-09-20). So the module is 6.1 MB and genuinely
 * self-contained: nothing beside it to publish, nothing to get out of step
 * with the pin. Over the wire it is ~1.5 MB, the artifact base compressing
 * text as it serves it.
 *
 * NOTHING HERE IS EXTERNAL. The output is loaded by `import(url)` in a host
 * that has no import map and no node_modules -- a bare specifier left in it
 * would be a runtime failure at the first render.
 *
 * THE SKY WORKER IS THE ONE SECOND FILE, because a worker is a second module
 * by construction (`sky-worker.ts` builds one for a Sky Texture world). It is
 * emitted beside the module under a hashed name and published with it.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  worker: { format: 'es' },
  build: {
    outDir: 'dist/release',
    emptyOutDir: true,
    target: 'es2022',
    // MINIFIED, because this is a download and not a source: the readable copy
    // is this repository.
    minify: 'esbuild',
    // The worker chunk goes BESIDE the module rather than under `assets/`, so
    // the whole release is one flat directory the publish step uploads.
    assetsDir: '.',
    lib: {
      entry: join(here, 'browser/three/release.ts'),
      formats: ['es'],
      fileName: () => 'blender-three.mjs',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
