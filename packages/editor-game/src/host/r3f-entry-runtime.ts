/**
 * The React and Fiber a project's three world is mounted with. The packaged
 * editor's UI is prebuilt with its own React/Fiber instances, while project
 * modules are transformed by a separate project-rooted Vite server. Mounting a
 * project component with the UI bundle's copies crosses those graphs and
 * crashes Fiber hooks on a null React dispatcher, so under the packaged
 * runtime the mount takes the project's own through the R3F doorway
 * (`R3F_DOORWAY` in `vite-plugin-module-doorways.ts`); in a checkout one Vite
 * graph already shares them, and this module's own imports are they.
 */

import {
  advance,
  createRoot,
  events,
  extend,
  flushSync,
} from '@react-three/fiber';
import type { RootAdapter, ThreeHostContext } from '@volter/editor-project/adapter';
import { R3F_RUNTIME_PATH } from '@volter/editor-sdk/host';
import { isPackagedRuntime } from '@volter/editor-sdk/kit/packaged-runtime';
import { Component, createElement, Fragment, useEffect } from 'react';
import type * as THREE from 'three';
import { type R3FRuntime, resolveR3FEntryAdapter } from './roots/r3f-root';

const CHECKOUT_RUNTIME: R3FRuntime = {
  createElement,
  Fragment,
  Component,
  useEffect,
  createRoot,
  extend,
  advance,
  flushSync,
  events,
};

interface PackagedR3FRuntime {
  readonly runtime: R3FRuntime;
  readonly projectThree: typeof THREE;
}

let cachedPackagedRuntime: Promise<PackagedR3FRuntime> | null = null;

const RUNTIME_MEMBERS = [
  'createElement',
  'Fragment',
  'Component',
  'useEffect',
  'createR3FRoot',
  'extendThree',
  'advance',
  'flushSync',
  'events',
] as const;

async function packagedRuntime(): Promise<PackagedR3FRuntime> {
  const mod = (await import(/* @vite-ignore */ R3F_RUNTIME_PATH)) as Record<string, unknown>;
  const missing = RUNTIME_MEMBERS.filter((name) => mod[name] === undefined);
  if (missing.length > 0 || typeof mod['projectThree'] !== 'object' || mod['projectThree'] === null) {
    throw new Error(
      "The packaged runtime's synthetic R3F module did not export " +
        `${[...missing, ...(mod['projectThree'] ? [] : ['projectThree'])].join(', ')} — see ` +
        'R3F_DOORWAY in vite-plugin-module-doorways.ts.',
    );
  }
  return {
    runtime: {
      createElement: mod['createElement'] as R3FRuntime['createElement'],
      Fragment: mod['Fragment'] as R3FRuntime['Fragment'],
      Component: mod['Component'] as R3FRuntime['Component'],
      useEffect: mod['useEffect'] as R3FRuntime['useEffect'],
      createRoot: mod['createR3FRoot'] as R3FRuntime['createRoot'],
      extend: mod['extendThree'] as R3FRuntime['extend'],
      advance: mod['advance'] as R3FRuntime['advance'],
      flushSync: mod['flushSync'] as R3FRuntime['flushSync'],
      events: mod['events'] as R3FRuntime['events'],
    },
    projectThree: mod['projectThree'] as typeof THREE,
  };
}

/**
 * The packaged editor shell and project modules are separate Vite graphs. The
 * world's Fiber comes from the project graph, so its Three host namespace
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
  if (!(await isPackagedRuntime())) return resolveR3FEntryAdapter(entryModule, rootId, CHECKOUT_RUNTIME);
  if (!cachedPackagedRuntime) cachedPackagedRuntime = packagedRuntime();
  const { runtime, projectThree } = await cachedPackagedRuntime;
  const adapter = resolveR3FEntryAdapter(entryModule, rootId, runtime);
  return adapter ? withPackagedProjectThree(adapter, projectThree) : null;
}
