/**
 * `<Frozen>` — the DECLARATION that a subtree is mount-static scenery, and the
 * one line that turns it into a handful of draw calls.
 *
 * ```tsx
 * <Frozen name="Terminal">
 *   {panels.map((p) => (
 *     <mesh key={p.id} position={p.at} castShadow receiveShadow>
 *       <boxGeometry args={[p.w, p.h, 0.1]} />
 *       <meshStandardMaterial color="#c8ccd0" />
 *     </mesh>
 *   ))}
 * </Frozen>
 * ```
 *
 * Eight hundred panels stay eight hundred authored, named, selectable nodes —
 * and become one or two draws. Nothing about how the scenery is WRITTEN
 * changes; the wrapper is a statement about its lifetime, not a different way
 * to build a world. `freeze.ts` is the mechanism and the place to read what
 * gets collapsed and what is refused.
 *
 * ── THE CONTRACT ────────────────────────────────────────────────────────────
 * Nothing under a `<Frozen>` may move, re-colour, unmount, or conditionally
 * appear after mount. The batched copies are what you see; the originals are
 * hidden, so a later change to one is simply never drawn. Reactive scenery —
 * a signal that changes colour, a door that opens, anything driven by state —
 * belongs OUTSIDE the wrapper, and the callsite splits exactly on that line.
 * In a dev build, `mutation-watch.ts` samples the hidden originals and says so
 * once if the contract breaks; a ship build pays nothing for that.
 *
 * A subtree inside the wrapper that must NOT be batched declares itself:
 * `userData={{ staticBatch: false }}`. That is a statement of intent, so it is
 * silent — unlike a mesh the batcher refuses on its own (transparent, skinned,
 * multi-material…), which is aggregated into one console line per wrapper.
 *
 * The wrapper itself stays mobile: products are baked into ITS local space, so
 * moving or rotating the `<Frozen>` group still moves the whole assembly.
 */

import type { ThreeElements } from '@react-three/fiber';
import { type ReactNode, useLayoutEffect, useRef } from 'react';
import type * as THREE from 'three';
import { activateFrozenBatch, describeFrozenSkips, freezeSubtree, restoreFrozen } from './freeze';
import { watchFrozenMutations } from './mutation-watch';

export type FrozenProps = ThreeElements['group'] & {
  /** Names the group, every console line about it, and the census row you
   *  would drill into. Worth setting: the advisory that sends people here
   *  names a subtree, and this is what makes that name resolve. */
  readonly name?: string;
  readonly children?: ReactNode;
};

export function Frozen({ name = 'Frozen', children, ...props }: FrozenProps) {
  const group = useRef<THREE.Group>(null);

  // useLayoutEffect, not useEffect: this runs AFTER the children have been
  // attached to the group and BEFORE the browser paints, so no frame is ever
  // drawn with both the originals and the batched copies visible.
  useLayoutEffect(() => {
    const root = group.current;
    if (!root) return;

    const batch = freezeSubtree(root, name);
    // Degrade LOUDLY — a wrapper that silently declined most of its subtree
    // looks identical to one that worked. Under the dev gate, though: this is
    // an authoring signal (`vgai status` reports console warnings, which is
    // where the building agent already looks), and a player's console is not
    // where it belongs.
    if (import.meta.env.DEV) {
      const skips = describeFrozenSkips(batch);
      // biome-ignore lint/suspicious/noConsole: see above — this is the channel.
      if (skips) console.warn(skips);
    }
    const watch = watchFrozenMutations(batch);
    const deactivate = activateFrozenBatch(batch);

    return () => {
      watch.stop();
      deactivate();
      restoreFrozen(batch);
    };
  }, [name]);

  return (
    <group ref={group} name={name} {...props}>
      {children}
    </group>
  );
}
