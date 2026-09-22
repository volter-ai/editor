/**
 * WHICH ROOT OWNS A POINT — the pure half of D5 §2a, a rule about how several
 * adapter roots share one surface, so it belongs beside the other seam
 * contracts rather than inside the runtime that first needed it.
 *
 * Two callers with nothing else in common depend on it: the engine's
 * `runtime/input-router.ts`, which wires it to real canvases and forwards
 * claimed events; and the EDITOR, which asks the same question at design time
 * with no game running (`authoring/layered-pick.ts` picks through stacked
 * authoring layers, `authoring/design-time-layers.ts` orders the layers it
 * mounts). That second caller is why the file moved here 2026-09-18
 * (WORK.md §The open-source launch, phase 1 unit 7): the host may import the
 * adapter CONTRACT and must not import the game runtime, and this was the one
 * `runtime/` module left in its closure. No DOM, no canvas, no mount.
 */

/** The pure decision inputs — no DOM. */
export interface ClaimEntry {
  readonly id: string;
  readonly zOrder: number;
  /**
   * Optional claim predicate over a point RELATIVE TO THE CONTAINER. Absent
   * means: "this world claims only if it is the bottom (lowest zOrder)
   * world" — D5 §2a's stated default ("transparent upper roots do not
   * claim, the bottom world claims everything").
   */
  readonly hitTest?: ((x: number, y: number) => boolean) | undefined;
}

/**
 * Bottom-to-top paint order: ascending `zOrder`, ties -> original array
 * order — the SAME rule `manifest/load.ts`'s `loadGameManifest` sorts
 * roots by, so a world's DOM stacking position always matches its
 * manifest-resolved zOrder. The last element is the topmost (visually on
 * top / highest z-index).
 */
export function stackOrder<T extends ClaimEntry>(entries: readonly T[]): T[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.zOrder - b.entry.zOrder || a.index - b.index)
    .map(({ entry }) => entry);
}

/**
 * Resolve which world's id claims a container-relative point `(x, y)` — D5
 * §2a: walk top-down (topmost first); the first world whose `hitTest`
 * returns true wins ("topmost-claim wins"). A world with no `hitTest` never
 * claims UNLESS it is the bottom-most world, which claims unconditionally
 * (or via its own `hitTest`, if it declares one) — "no-claim falls to
 * bottom". Returns `null` only when `entries` is empty.
 */
export function resolveClaimingRoot(
  entries: readonly ClaimEntry[],
  x: number,
  y: number,
): string | null {
  if (entries.length === 0) return null;
  const order = stackOrder(entries); // bottom -> top
  for (let i = order.length - 1; i >= 1; i--) {
    const entry = order[i]!;
    if (entry.hitTest?.(x, y)) return entry.id;
  }
  // No upper world claimed (or there is only one world) -> the bottom world
  // claims — honoring its own hitTest if it declares one (rare: the bottom
  // world usually claims everything unconditionally per D5 §2a's default).
  return order[0]!.id;
}
