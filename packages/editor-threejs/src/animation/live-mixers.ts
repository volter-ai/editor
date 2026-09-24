/**
 * The mixers a running world animates with, as the editor reads them: the registry the served
 * animation stamp fills (`serving/animation-live-module.ts`) in the game's graph. An instrument
 * that drives time on an object asks here for the mixer the game already made for it, so the
 * skeleton keeps one writer.
 */

import type * as THREE from 'three';

export interface LiveMixer {
  /** The call site that made it (`src/prefabs/Player.tsx:358:37`). */
  readonly key: string;
  readonly mixer: THREE.AnimationMixer;
  /** Every clip the game has played through it, and every clip `useAnimations` was handed. */
  readonly clips: ReadonlyMap<string, THREE.AnimationClip>;
  /** The objects its actions animate. */
  readonly roots: ReadonlySet<unknown>;
}

interface Registry {
  readonly mixers: Map<unknown, LiveMixer>;
  readonly listeners: Set<() => void>;
  version: number;
}

const REGISTRY = Symbol.for('volter.three.animation.live');

function registry(): Registry {
  const holder = globalThis as unknown as Record<symbol, Registry | undefined>;
  return (holder[REGISTRY] ??= { mixers: new Map(), listeners: new Set(), version: 0 });
}

/** The live mixer that animates `object`, or null when the game animates it with none. */
export function liveMixerFor(object: THREE.Object3D): LiveMixer | null {
  for (const entry of registry().mixers.values()) {
    if (entry.clips.size === 0) continue;
    if (entry.mixer.getRoot() === object || entry.roots.has(object)) return entry;
  }
  return null;
}

/** Every mixer the running world's code has made, in the order it made them. */
export function liveMixers(): LiveMixer[] {
  return [...registry().mixers.values()];
}

export function subscribeLiveMixers(listener: () => void): () => void {
  const listeners = registry().listeners;
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function liveMixersVersion(): number {
  return registry().version;
}
