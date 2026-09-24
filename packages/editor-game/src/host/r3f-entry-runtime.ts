/**
 * Resolve the R3F entry factory from the same module graph as project worlds.
 * The packaged editor's UI is prebuilt with its own React/Fiber instances,
 * while project modules are transformed by a separate project-rooted Vite
 * server. Building a project component's adapter with the UI bundle's factory
 * crosses those graphs and crashes Fiber hooks on a null React dispatcher.
 */

import { resolveR3FEntryAdapter } from '@volter/game-runtime/world3d-react';
import type { RootAdapter, ThreeHostContext } from '@volter/editor-project/adapter';
import type * as THREE from 'three';
import {
  R3F_ENTRY_RUNTIME_PATH,
  R3F_RUNTIME_PATH,
} from '@volter/editor-sdk/host';
import { isPackagedRuntime } from '@volter/editor-core/packaged-runtime';

type R3FEntryResolver = typeof resolveR3FEntryAdapter;

interface PackagedR3FRuntime {
  readonly resolve: R3FEntryResolver;
  readonly projectThree: typeof THREE;
}

let cachedPackagedRuntime: Promise<PackagedR3FRuntime> | null = null;

async function packagedRuntime(): Promise<PackagedR3FRuntime> {
  const [entry, mod] = await Promise.all([
    import(/* @vite-ignore */ R3F_ENTRY_RUNTIME_PATH) as Promise<{
      resolveR3FEntryAdapter?: unknown;
    }>,
    import(/* @vite-ignore */ R3F_RUNTIME_PATH) as Promise<{ projectThree?: unknown }>,
  ]);
  if (typeof entry.resolveR3FEntryAdapter !== 'function') {
    throw new Error(
      "The packaged runtime's synthetic R3F entry module did not export " +
        '`resolveR3FEntryAdapter` — see R3F_ENTRY_DOORWAY in vite-plugin-module-doorways.ts.',
    );
  }
  if (typeof mod.projectThree !== 'object' || mod.projectThree === null) {
    throw new Error(
      "The packaged runtime's synthetic R3F module did not export " +
        '`projectThree` — see R3F_DOORWAY in vite-plugin-module-doorways.ts.',
    );
  }
  return {
    resolve: entry.resolveR3FEntryAdapter as R3FEntryResolver,
    projectThree: mod.projectThree as typeof THREE,
  };
}

/**
 * The packaged editor shell and project modules are separate Vite graphs. The
 * adapter itself comes from the project graph, so its Three host namespace
 * must come from there too: Fiber seeds its intrinsic catalogue from
 * `host.three`, and mixing in the shell's constructors makes applyProps turn a
 * typed `DirectionalLight.color` into the raw JSX string.
 */
export function withPackagedProjectThree(
  adapter: RootAdapter,
  projectThree: typeof THREE,
): RootAdapter {
  return {
    id: adapter.id,
    mount(host: ThreeHostContext) {
      return adapter.mount({ ...host, three: projectThree });
    },
  };
}

export async function resolveR3FEntryAdapterForEditor(entryModule: unknown, rootId: string) {
  if (!(await isPackagedRuntime())) return resolveR3FEntryAdapter(entryModule, rootId);
  if (!cachedPackagedRuntime) cachedPackagedRuntime = packagedRuntime();
  const runtime = await cachedPackagedRuntime;
  const adapter = runtime.resolve(entryModule, rootId);
  return adapter ? withPackagedProjectThree(adapter, runtime.projectThree) : null;
}
