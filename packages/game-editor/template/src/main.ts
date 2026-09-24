/**
 * Standalone entry point.
 *
 * One `mountGameFromManifest` call mounts every explicit adapter root in the
 * v2 `vgai.project.json`. Roots are required; the default scaffold declares
 * one Three.js world, while composition templates may rewrite that list.
 * The selected built-in adapter owns each root's document and lifecycle.
 *
 * `host.loadEntryModule` resolves an explicitly declared `entry` through a
 * Vite-generated virtual module containing exactly the manifest's entry
 * paths. The manifest remains the sole source of truth—filenames are
 * arbitrary, while the bundler still sees static imports.
 *
 */

import { manifestEntryModules } from 'virtual:vgai-manifest-entries';
import type { ManifestHost } from '@volter/game-runtime/runtime/mount-game';
import {
  isAdapterRegistered,
  mountGameFromManifest,
  registerAdapter,
} from '@volter/game-runtime/runtime/mount-game';
import { r3fRootFactory } from '@volter/game-runtime/world3d-react';
import manifest from '../vgai.project.json';
import { registerReactAdapter } from './lib/react-root';

// Three roots resolve through `r3fRootFactory`: the world entry module
// DEFAULT-EXPORTS its React component (src/world.tsx), the same contract dom
// roots already use. An `adapter` export still wins if a world needs full
// control over its own RootAdapter.
if (!isAdapterRegistered('three')) {
  registerAdapter('three', r3fRootFactory);
}

// Keep the optional DOM adapter available for a project that later adds a UI
// root; the neutral scaffold itself declares only the Three world.
registerReactAdapter();

async function main() {
  document.title = manifest.name;

  const container = document.getElementById('game-canvas') as HTMLElement;
  const host: ManifestHost = {
    container,
    async loadEntryModule(path) {
      const entryModule = manifestEntryModules[path];
      if (!entryModule) {
        throw new Error(
          `main.ts: entry module "${path}" was not generated from vgai.project.json.`,
        );
      }
      return entryModule;
    },
  };
  const session = await mountGameFromManifest(manifest, host);
  session.resize(window.innerWidth, window.innerHeight);

  window.addEventListener('resize', () => {
    session.resize(window.innerWidth, window.innerHeight);
  });
}

main().catch(console.error);
