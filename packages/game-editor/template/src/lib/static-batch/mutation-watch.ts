/**
 * THE TRIPWIRE for the one rule `<Frozen>` cannot enforce: its children must
 * be MOUNT-STATIC.
 *
 * A freeze draws the batched products and hides the originals. React still
 * owns those originals, so nothing stops a game from moving one, re-colouring
 * it, or un-hiding it — and nothing HAPPENS when it does. The mesh is
 * invisible; the picture comes from the product; the edit is simply lost. That
 * is the worst possible failure shape: silent, and indistinguishable from the
 * mechanic being wrong. An author who animates a door under a `<Frozen>` will
 * spend an afternoon in the wrong file.
 *
 * The contract used to live in a docblock. A docblock describes intent; only a
 * measurement describes status. So the hidden originals are SAMPLED — the
 * cheapest reading that catches all three drifts:
 *   - `matrixWorld`, hashed: it moved, was scaled, or was re-parented;
 *   - `material.version`, which three bumps on `needsUpdate`: it was re-styled;
 *   - `visible`, restored to `true` by the game: it thinks it is showing.
 *
 * ── COST, AND WHY IT IS A TIMER ─────────────────────────────────────────────
 * ~1 Hz, and only in a dev build (`import.meta.env.DEV`). A per-frame check would be a
 * real cost added by a feature whose entire job is removing cost; a `Proxy` or
 * accessor trap over every node would change the objects the game is holding.
 * A second of latency on a diagnostic nobody is waiting for is free, and 4,000
 * hashes once a second is a rounding error against one frame of the draw calls
 * this replaced.
 *
 * It fires ONCE. The first drift is the finding; a mechanic that runs every
 * frame would otherwise fill the console with the same line, and the watch
 * stops itself rather than becoming the noise it exists to prevent.
 *
 * ── RESOURCE OWNERSHIP, STATED ONCE ─────────────────────────────────────────
 * OWNER: the handle {@link watchFrozenMutations} returns, which owns exactly
 * one interval. SHARERS: none — `Frozen.tsx` holds it and nothing else sees
 * it. TEARDOWN: that handle's `stop()`, the ONE path that clears the interval,
 * called from the wrapper's own effect cleanup and by the watch itself after
 * it warns. Idempotent.
 */

import type * as THREE from 'three';
import type { FrozenBatch } from './freeze';

/** Samples per second. See the module note for why this is a timer at all. */
export const MUTATION_SAMPLE_MS = 1000;

interface Sample {
  matrix: number;
  materialVersions: string;
  visible: boolean;
}

/** A cheap order-sensitive fold of the 16 world-matrix elements. Collisions
 *  are possible in principle and irrelevant in practice: this compares a value
 *  against ITS OWN previous value, not against another node's. */
function hashMatrix(mesh: THREE.Object3D): number {
  const elements = mesh.matrixWorld.elements;
  let hash = 0;
  for (let i = 0; i < 16; i++) hash = (hash * 31 + (elements[i] ?? 0)) % 1e12;
  return hash;
}

function sample(mesh: THREE.Mesh): Sample {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return {
    matrix: hashMatrix(mesh),
    materialVersions: materials.map((material) => material?.version ?? -1).join(','),
    visible: mesh.visible,
  };
}

/** What changed, in the words of the thing that changed it. */
function drift(before: Sample, after: Sample): string | null {
  if (after.visible !== before.visible) return 'was made visible again';
  if (after.matrix !== before.matrix) return 'moved (its world matrix changed)';
  if (after.materialVersions !== before.materialVersions) return 'had its material changed';
  return null;
}

export interface FrozenMutationWatch {
  /** See the ownership note — the ONE path that ends the watch. Idempotent. */
  stop(): void;
}

function warnOnConsole(message: string): void {
  // biome-ignore lint/suspicious/noConsole: console is this tripwire's vgai-status channel.
  console.warn(message);
}

/**
 * Watch a freeze's hidden originals for the mutations the contract forbids,
 * and say so once. A no-op outside a dev context, and a no-op when the freeze
 * hid nothing.
 */
export function watchFrozenMutations(
  batch: FrozenBatch,
  options: {
    /** Injectable so the tripwire is provable without a console. */
    readonly warn?: (message: string) => void;
    /** Injectable so a test can step time instead of waiting a second. */
    readonly schedule?: (tick: () => void) => () => void;
    /** Overrides the dev gate — a headless test passes `true`. */
    readonly dev?: boolean;
  } = {},
): FrozenMutationWatch {
  const warn = options.warn ?? warnOnConsole;
  if (!(options.dev ?? import.meta.env.DEV) || batch.sources.length === 0) {
    return { stop: () => {} };
  }

  const baseline = batch.sources.map((source) => sample(source.mesh));
  let stopped = false;
  let release: (() => void) | null = null;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    release?.();
    release = null;
  };

  const tick = (): void => {
    if (stopped) return;
    for (let i = 0; i < batch.sources.length; i++) {
      const source = batch.sources[i];
      const before = baseline[i];
      if (!source || !before) continue;
      const change = drift(before, sample(source.mesh));
      if (!change) continue;
      const node = source.mesh.name || '(unnamed)';
      warn(
        `[static-batch] "${node}" ${change} while frozen under <Frozen name="${batch.name}"> — ` +
          'the change will never be visible, because the picture comes from the batched copy ' +
          'and the original is hidden. Everything under a <Frozen> must be mount-static: move ' +
          'this node OUT of the wrapper, or mark its subtree userData={{ staticBatch: false }}.',
      );
      stop();
      return;
    }
  };

  if (options.schedule) {
    release = options.schedule(tick);
  } else {
    const timer = setInterval(tick, MUTATION_SAMPLE_MS);
    release = () => clearInterval(timer);
  }
  return { stop };
}
