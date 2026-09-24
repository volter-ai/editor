/**
 * The module the animation stamp imports into a project's modules (`animation-stamp.ts`), served
 * as source into the GAME's own graph. It imports no three: it wraps the mixer the game's own
 * three built, so the game keeps exactly the library it installed.
 *
 * A stamped mixer lists itself with every clip the game plays through it (`clipAction`) and every
 * root those actions animate, so a mixer drei's `useAnimations` makes without a root is still
 * found by the object it moves. The registry lives on `globalThis` under a `Symbol.for` key, where
 * the editor's bundle reads it (`src/animation/live-mixers.ts`).
 */

export const ANIMATION_LIVE_MODULE_ID = 'virtual:vgai-three-animation-live';

export const animationLiveModuleSource = `
const live = (globalThis[Symbol.for('volter.three.animation.live')] ??= {
  mixers: new Map(),
  listeners: new Set(),
  version: 0,
});
function notify() {
  live.version++;
  for (const listener of live.listeners) {
    try { listener(); } catch (error) { console.error(error); }
  }
}
export function __vgaiMixer(mixer, key) {
  if (!mixer || typeof mixer.clipAction !== 'function') return mixer;
  if (mixer.__vgaiMixerKey) return mixer;
  Object.defineProperty(mixer, '__vgaiMixerKey', { value: key });
  const entry = { key, mixer, clips: new Map(), roots: new Set() };
  live.mixers.set(mixer, entry);
  const clipAction = mixer.clipAction;
  mixer.clipAction = function (clip, root, blendMode) {
    const action = clipAction.call(this, clip, root, blendMode);
    if (action) {
      const played = action.getClip();
      const target = action.getRoot();
      let changed = false;
      if (played && !entry.clips.has(played.name)) { entry.clips.set(played.name, played); changed = true; }
      if (target && !entry.roots.has(target)) { entry.roots.add(target); changed = true; }
      if (changed) notify();
    }
    return action;
  };
  const uncacheRoot = mixer.uncacheRoot;
  mixer.uncacheRoot = function (root) {
    const result = uncacheRoot.call(this, root);
    entry.roots.delete(root);
    if (root === this.getRoot()) live.mixers.delete(this);
    notify();
    return result;
  };
  notify();
  return mixer;
}
/** drei's \`useAnimations\` result: its mixer, and the clips it was handed. */
export function __vgaiAnimations(result, key) {
  if (!result || !result.mixer) return result;
  __vgaiMixer(result.mixer, key);
  const entry = live.mixers.get(result.mixer);
  if (entry && Array.isArray(result.clips)) {
    let changed = false;
    for (const clip of result.clips) {
      if (clip && clip.name && !entry.clips.has(clip.name)) { entry.clips.set(clip.name, clip); changed = true; }
    }
    if (changed) notify();
  }
  return result;
}
`;
