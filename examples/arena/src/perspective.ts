/**
 * WHICH CAMERA THIS ARENA IS PLAYED FROM — the one thing that differs between
 * first and third person, and the only thing.
 *
 * Owner direction, 2026-09-20: *"can we actually just make first person and
 * third person slight differences on the same game? That way we don't need to
 * maintain different enemies behaviors maps etc. for no reason."* This module
 * is that sentence as code. The arena, the hostiles and their behaviours, the
 * weapon table, the pickups, the jump pads, the HUD and the input map do not
 * read it and must never start: everything downstream of a shot is identical
 * in both perspectives, and a rule that branched on the camera would be the
 * second game the ruling exists to prevent.
 *
 * Exactly three things read it, all inside `<Player>`:
 *   - where the camera sits (eye, or a boom behind the shoulder);
 *   - whether the player's BODY renders (shadow-only silhouette, or lit);
 *   - whether the first-person weapon VIEW MODEL renders.
 *
 * It is an ordinary module store with an ordinary subscribe, like
 * `arena-state.ts` beside it — no vgai runtime, no context, no provider. The
 * initial value comes from `?perspective=` on the page the game is mounted in
 * (the URL-parameter pattern a game's boot options have always used here), so
 * a link, a `vgai edit` URL or a run configuration can open the arena already
 * in the other camera; absent or unrecognised, first person.
 */

export type Perspective = 'first' | 'third';

/** Every value the store accepts, for the refusals below and for a UI that
 *  wants to offer them. Order is the toggle's order. */
export const PERSPECTIVES: readonly Perspective[] = ['first', 'third'];

function isPerspective(value: unknown): value is Perspective {
  return value === 'first' || value === 'third';
}

/**
 * `?perspective=third` on the hosting page, or first person.
 *
 * Guarded: this module is imported by the bake tools and by stories, which
 * evaluate in Node where there is no `location` at all. An unrecognised value
 * is first person rather than a throw — a boot option is not a place to fail
 * a game to a black screen, and `getPerspective()` reports what actually took
 * effect.
 */
function readInitialPerspective(): Perspective {
  try {
    const search = globalThis.location?.search;
    if (typeof search !== 'string') return 'first';
    const declared = new URLSearchParams(search).get('perspective');
    return isPerspective(declared) ? declared : 'first';
  } catch {
    return 'first';
  }
}

let current: Perspective = readInitialPerspective();

const listeners = new Set<() => void>();

export function getPerspective(): Perspective {
  return current;
}

/** Subscribe to a change. Reads stay `getPerspective()`; there is no payload —
 *  the same shape `subscribeArenaState` uses. */
export function subscribePerspective(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Play from `next` from the very next frame.
 *
 * REFUSES an unknown value by name rather than silently keeping the current
 * one: this is the door `vgai eval` and the run configurations call, and a
 * typo that appears to succeed is how a caller concludes the feature is
 * broken.
 */
export function setPerspective(next: Perspective): Perspective {
  if (!isPerspective(next)) {
    throw new Error(
      `setPerspective: unknown perspective ${JSON.stringify(next)} — ` +
        `this arena plays from ${PERSPECTIVES.map((p) => `'${p}'`).join(' or ')}.`,
    );
  }
  if (next === current) return current;
  current = next;
  for (const listener of listeners) listener();
  return current;
}

/** The other one. `V` is bound to this (`public/inputmaps/default.inputmap.json`,
 *  action `perspective`), and `<Player>`'s frame callback is its reader. */
export function togglePerspective(): Perspective {
  return setPerspective(current === 'first' ? 'third' : 'first');
}
