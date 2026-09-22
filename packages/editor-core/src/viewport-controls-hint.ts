/**
 * Whether this user has learned the editor camera — the fact the viewport's
 * on-canvas controls hint keys on.
 *
 * A 30-minute human build session (2026-08-28) asked "how do I move the
 * camera" six-plus times and never found right-drag, on a build where
 * right-drag orbit measured working: the gap was teaching, not mechanics.
 * The hint carries the bindings until the user has REALLY learned them —
 * three distinct orbit gestures, not one: dismissing on the first orbit
 * meant one accidental right-drag hid the teaching before it was read
 * (three human passes looked for the hint and found it gone — runhuman
 * 15/17/31). Persisted per-user in localStorage like the inspector
 * presentation; how you learned the camera is not a property of any game.
 */

const STORAGE_KEY = 'vgai-viewport-orbit-gestures-v1';
const LEGACY_LEARNED_KEY = 'vgai-viewport-orbit-learned-v1';
const LEARNED_AFTER_GESTURES = 3;
const listeners = new Set<() => void>();
let gestures: number | null = null;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function count(): number {
  if (gestures === null) {
    const store = storage();
    // A user the one-gesture era already marked stays learned.
    if (store?.getItem(LEGACY_LEARNED_KEY) === '1') gestures = LEARNED_AFTER_GESTURES;
    else gestures = Number(store?.getItem(STORAGE_KEY) ?? 0) || 0;
  }
  return gestures;
}

export function orbitLearned(): boolean {
  return count() >= LEARNED_AFTER_GESTURES;
}

/** One distinct orbit gesture (one pointer-down-to-up that moved the camera). */
export function recordOrbitGesture(): void {
  if (orbitLearned()) return;
  gestures = count() + 1;
  storage()?.setItem(STORAGE_KEY, String(gestures));
  if (orbitLearned()) for (const listener of listeners) listener();
}

export function subscribeOrbitLearned(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
