/**
 * CLIP LAYERING — additive clips and per-bone masks, for any rigged asset.
 *
 * This is the family-level animation floor: a humanoid layers an expression or
 * an aim pose over a walk, and a walking castle layers a drawbridge over its
 * gait, by the same mechanism. It lives here in `lib/bake` — the
 * procedural-asset family's shared home, required by `humanoid` and `castle`
 * alike — precisely so the castle never has to import humanoid code to get it.
 * Nothing in this file knows what a spine is.
 *
 * HELPERS, NOT A SYSTEM. Every function returns a real `THREE.AnimationClip`
 * you then hand to a real `THREE.AnimationMixer` and drive with three's own
 * API (`action.blendMode`, `.weight`, `.play()`). There is no layer manager,
 * no rig-agnostic state machine, no registry — three already has the runtime
 * (`AdditiveAnimationBlendMode` and one action per layer). What was missing was
 * the two PREPARATION steps three makes you write by hand each time, and both
 * are traps:
 *
 *   - `AnimationUtils.makeClipAdditive` MUTATES the clip you pass it, so
 *     calling it on a clip that is also playing as a base layer silently turns
 *     that layer into deltas about a reference pose. {@link additiveClip}
 *     clones first.
 *   - masking means filtering `clip.tracks` by node name, and a typo'd bone
 *     name filters to nothing and animates nothing, silently.
 *     {@link maskClip} throws instead.
 *
 * TYPICAL USE — an upper-body additive layer over a full-body base:
 *
 *   const base = mixer.clipAction(walk);
 *   const layer = mixer.clipAction(
 *     additiveClip(maskClip(aim, boneSubtreeNames(root, ['chest'], { animatedIn: aim }))),
 *   );
 *   layer.blendMode = THREE.AdditiveAnimationBlendMode;
 *   base.play();
 *   layer.setEffectiveWeight(0.8).play();
 *
 * REMOVAL LINE: delete this file. Nothing else in the family imports it — a
 * game that does not layer clips loses nothing, and a game that does can write
 * the four lines each helper wraps.
 */

import * as THREE from 'three';

/** Every node name the clip animates, in first-appearance order. */
export function clipAnimatedNodes(clip: THREE.AnimationClip): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const track of clip.tracks) {
    const { nodeName } = THREE.PropertyBinding.parseTrackName(track.name);
    if (!nodeName || seen.has(nodeName)) continue;
    seen.add(nodeName);
    out.push(nodeName);
  }
  return out;
}

export interface AdditiveClipOptions {
  /** Name for the returned clip (default: `${clip.name}_Additive`). */
  name?: string;
  /** Frame of `reference` to subtract — the pose the layer is a DELTA FROM.
   *  Default 0. */
  referenceFrame?: number;
  /** Clip the reference pose is sampled from (default: `clip` itself, i.e. the
   *  layer is a delta from its own first frame). Pass the BASE clip's rest
   *  frame when the layer was authored against a different neutral pose. */
  reference?: THREE.AnimationClip;
  /** Frames per second used to turn `referenceFrame` into a time. Default 30. */
  fps?: number;
}

/**
 * `THREE.AnimationUtils.makeClipAdditive`, on a CLONE.
 *
 * Three's own function converts in place and returns the same object, which is
 * the sharp edge: the clip you passed is now deltas, and any action already
 * playing it as a normal (base) layer is now playing a broken pose. This
 * returns a new clip and leaves the input untouched, so the same source clip
 * can be both a base layer and the source of an additive one.
 *
 * The returned clip is only meaningful on an action whose `blendMode` is
 * `THREE.AdditiveAnimationBlendMode` — that is three's contract, not this
 * helper's, and this helper deliberately does not create the action for you.
 */
export function additiveClip(
  clip: THREE.AnimationClip,
  options: AdditiveClipOptions = {},
): THREE.AnimationClip {
  const additive = clip.clone();
  additive.name = options.name ?? `${clip.name}_Additive`;
  THREE.AnimationUtils.makeClipAdditive(
    additive,
    options.referenceFrame ?? 0,
    options.reference ?? additive,
    options.fps ?? 30,
  );
  return additive;
}

export interface MaskClipOptions {
  /** Name for the returned clip (default: `${clip.name}_Masked`). */
  name?: string;
  /** Keep the tracks that do NOT target the named nodes instead — the
   *  complementary half of the same split. Default false. */
  invert?: boolean;
}

/**
 * A copy of `clip` carrying only the tracks that target the named nodes (or,
 * with `invert`, only the tracks that do not).
 *
 * BOUNDARY SEMANTICS — the part that decides what a "split" actually means:
 * a mask is a FLAT SET OF NODE NAMES, never a subtree. Naming a node puts THAT
 * node on the mask's side and says nothing about its children, its parent, or
 * its siblings. Use {@link boneSubtreeNames} to turn a split node into its
 * subtree when that is what you want — and note what that does NOT include:
 * a chain that hangs off an ANCESTOR of your split node is on the other side,
 * even if it is anatomically "above" it. (Concretely for a humanoid rig: the
 * clavicles hang off the chest vertebra, so an upper-body mask rooted at the
 * ARM bones leaves clavicle motion on the TORSO side. That is usually right —
 * see this lib's humanoid notes on the retargeter's clavicle pass-through —
 * but it is a decision, so it is spelled out rather than implied.)
 *
 * Loud on a name the clip does not animate: a mask is written by hand against
 * a rig, so a typo or a mask copied from a different skeleton is the expected
 * failure, and silently filtering to nothing is the expected symptom.
 */
export function maskClip(
  clip: THREE.AnimationClip,
  nodes: Iterable<string>,
  options: MaskClipOptions = {},
): THREE.AnimationClip {
  const wanted = new Set(nodes);
  if (wanted.size === 0) {
    throw new Error(`clip-layering: maskClip('${clip.name}') was given no node names`);
  }
  const animated = new Set(clipAnimatedNodes(clip));
  const unknown = [...wanted].filter((name) => !animated.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `clip-layering: maskClip('${clip.name}') names ${unknown.length} node(s) the clip does ` +
        `not animate: ${unknown.slice(0, 12).join(', ')} (it animates: ` +
        `${[...animated].slice(0, 12).join(', ')}${animated.size > 12 ? ', …' : ''})`,
    );
  }
  const invert = options.invert ?? false;
  const tracks = clip.tracks.filter((track) => {
    const { nodeName } = THREE.PropertyBinding.parseTrackName(track.name);
    return wanted.has(nodeName) !== invert;
  });
  if (tracks.length === 0) {
    throw new Error(
      `clip-layering: maskClip('${clip.name}') kept no tracks — the mask covers ` +
        `${invert ? 'every' : 'no'} animated node`,
    );
  }
  return new THREE.AnimationClip(
    options.name ?? `${clip.name}_Masked`,
    clip.duration,
    tracks.map((track) => track.clone()),
    clip.blendMode,
  );
}

export interface BoneSubtreeOptions {
  /** Keep only the names this clip actually animates. Without it the result is
   *  the full subtree, which {@link maskClip} will reject if the clip animates
   *  only part of it — so pass the clip you are about to mask. */
  animatedIn?: THREE.AnimationClip;
}

/**
 * Every node name at or under each named split node, found by traversing
 * `root`. The ergonomic way to build a mask from a handful of split points
 * ("everything from the chest up") instead of listing forty bones.
 *
 * Loud on a split node that is not in `root`: naming a bone the rig does not
 * have is the same authoring mistake {@link maskClip} guards, one step earlier.
 */
export function boneSubtreeNames(
  root: THREE.Object3D,
  splitNodes: Iterable<string>,
  options: BoneSubtreeOptions = {},
): string[] {
  const requested = [...splitNodes];
  if (requested.length === 0) {
    throw new Error('clip-layering: boneSubtreeNames was given no split nodes');
  }
  const missing = requested.filter((name) => !root.getObjectByName(name));
  if (missing.length > 0) {
    throw new Error(
      `clip-layering: boneSubtreeNames: '${root.name || 'root'}' has no node(s) ` +
        `${missing.slice(0, 12).join(', ')}`,
    );
  }
  const keep = options.animatedIn ? new Set(clipAnimatedNodes(options.animatedIn)) : null;
  const out = new Set<string>();
  for (const name of requested) {
    root.getObjectByName(name)?.traverse((node) => {
      if (node.name && (!keep || keep.has(node.name))) out.add(node.name);
    });
  }
  return [...out];
}
