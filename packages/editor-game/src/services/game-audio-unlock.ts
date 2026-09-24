/**
 * HOST-LEVEL audio unlock for game-created AudioContexts.
 *
 * A game running in the editor's page can create its AudioContext before the
 * visitor's first gesture (survivor's auto-attack lands kills while they are
 * still reading), and browsers with a strict autoplay policy then hold it
 * suspended until `resume()` runs INSIDE a trusted input handler. The game's
 * own unlock listeners go through the realm's gated re-dispatch, which is no
 * longer that trusted stack — two human passes heard both flagship canvas
 * games silent on first load and cured them only by restarting under a
 * gesture (runhuman 23/33).
 *
 * The EDITOR owns the page, so it does what a game cannot: wrap the page's
 * AudioContext constructor once at boot to track instances, and resume any
 * suspended one from capture-phase pointerdown/keydown handlers — the real,
 * trusted stack. Contexts already running are untouched; the listeners stay
 * (cheap) so a context created later unlocks on the next gesture.
 */

const tracked = new Set<WeakRef<AudioContext>>();

function resumeSuspended(): void {
  for (const ref of tracked) {
    const ctx = ref.deref();
    if (!ctx || ctx.state === 'closed') {
      tracked.delete(ref);
      continue;
    }
    if (ctx.state === 'suspended') void ctx.resume();
  }
}

/** Install once at editor boot (main.tsx). Idempotent. */
export function installGameAudioUnlock(): void {
  const host = window as unknown as { __vgaiAudioUnlock?: boolean } & typeof window;
  if (host.__vgaiAudioUnlock) return;
  host.__vgaiAudioUnlock = true;
  const Orig = window.AudioContext;
  if (typeof Orig !== 'function') return;
  window.AudioContext = class extends Orig {
    constructor(...args: ConstructorParameters<typeof AudioContext>) {
      super(...args);
      tracked.add(new WeakRef(this));
    }
  };
  window.addEventListener('pointerdown', resumeSuspended, { capture: true });
  window.addEventListener('keydown', resumeSuspended, { capture: true });
}
