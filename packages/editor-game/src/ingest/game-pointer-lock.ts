/**
 * POINTER LOCK IS A PAGE-WIDE SINGLETON, AND TWO THINGS WANT IT.
 *
 * The editor viewport takes pointer lock for its own camera drag
 * (`editor-viewport.ts`). An ingested first-person game takes it the moment
 * its canvas is clicked — unconditionally, from a listener it installed on its
 * OWN element. Only one element can hold the lock, so in-realm those
 * two fight: click the game canvas while merely INSPECTING it in Edit and the
 * mouse disappears into a game that is not even playing.
 *
 * `gated-globals.ts` cannot see this. Its whole mechanism is a scoped
 * `window`/`document`, and `requestPointerLock` is called on neither — it is
 * an `Element` method invoked on the game's own canvas. So the gate goes on
 * the method, ONCE, and is SCOPED BY ELEMENT: a request from inside a
 * registered game surface (`gated-globals.ts`'s `gameSurfaces`) obeys that
 * realm's input gate — the same predicate that decides whether the game's
 * keydown listeners fire, so pointer lock and input can never disagree.
 * A request from anywhere else — the editor's own viewport canvas, which is
 * not inside any game surface — passes through untouched.
 *
 * Refused, never silent: the console line names the element, the gate and the
 * one thing that makes it open (play running, Game tab active), because a
 * mouse that silently does not capture reads as a broken game.
 */

import { gameSurfaces } from '../host/gated-globals';

/** The real method, captured at install time so a refusal can still call
 *  through and a double install is impossible. */
let realRequestPointerLock: ((this: Element, options?: unknown) => unknown) | null = null;

/** The surface a pointer-lock request came from, or null when the element
 *  belongs to the editor rather than to any mounted game. */
function gameSurfaceOf(el: Element): { surface: HTMLElement; gate: () => boolean } | null {
  for (const entry of gameSurfaces()) {
    if (entry.surface.contains(el)) return entry;
  }
  return null;
}

/**
 * Install the gate. Idempotent and process-wide — there is ONE
 * `Element.prototype`, and scoping is by element, not by installation.
 * Called by the ingest mount; never uninstalled, because the predicate it
 * consults (`gameSurfaces()`) is empty when no game is mounted, which makes
 * the patch a pure pass-through rather than something to unwind.
 */
export function installGamePointerLockGate(): void {
  if (realRequestPointerLock !== null) return;
  if (typeof Element === 'undefined') return;
  const proto = Element.prototype as unknown as {
    requestPointerLock?: (this: Element, options?: unknown) => unknown;
  };
  const real = proto.requestPointerLock;
  if (typeof real !== 'function') return;
  realRequestPointerLock = real;
  proto.requestPointerLock = function (this: Element, options?: unknown): unknown {
    const entry = gameSurfaceOf(this);
    if (entry && !entry.gate()) {
      // A NEW native console.error site, suppressed to keep this task's diff at
      // zero new lint warnings — and native on purpose: this fires from a game's
      // own click handler in the page, and the page console is what `vgai
      // status` reads.
      // biome-ignore lint/suspicious/noConsole: see comment above
      console.error(
        'Ingested game requested pointer lock while its input gate is closed — refused. ' +
          'A game only captures the mouse while play is running AND the Game tab is active ' +
          '(the same predicate that gates its keyboard listeners); the editor viewport owns ' +
          'pointer lock otherwise. See packages/editor/src/ingest/game-pointer-lock.ts.',
      );
      // Match the spec's failure shape rather than throwing: the browser
      // rejects a disallowed request, and a throw would abort the game's own
      // click handler mid-way.
      return Promise.reject(new Error('pointer lock refused: game input gate is closed'));
    }
    return real.call(this, options);
  };
}

/**
 * Drop pointer lock if a GAME element holds it. Called when a mount disposes —
 * a lock outliving the game that took it leaves the editor with a captured,
 * invisible cursor and nothing left to release it.
 */
export function releaseGamePointerLock(): void {
  if (typeof document === 'undefined') return;
  const locked = document.pointerLockElement;
  if (locked && gameSurfaceOf(locked)) document.exitPointerLock();
}
