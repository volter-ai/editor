/**
 * Standard-clip playback for generated humanoids: map Mixamo-named
 * `AnimationClip`s (from any GLB/FBX-derived source) onto the engine's
 * standard skeleton, across naming variants, with the translation-track
 * policy body-type rescaling requires.
 *
 * TRANSLATION-TRACK POLICY (the reviewer-flagged trap, documented choice):
 * humanoid clips carry per-bone `.position` tracks baked for the SOURCE
 * rig's segment lengths — played raw on a rescaled skeleton they snap limb
 * proportions back to the source's. `retargetClipToHumanoid` therefore
 *   - DROPS every non-hips `.position` track (bones keep the generated
 *     rig's rest translations — segment lengths come from the body params),
 *   - KEEPS the hips `.position` track but multiplies it by the rig's
 *     `hipsPositionScale` (root motion / bob authored for the reference
 *     hip height lands at the generated hip height),
 *   - DROPS `.scale` tracks (rest scale is always 1), and
 *   - KEEPS every `.quaternion` track verbatim — rotations are
 *     proportion-independent, which is the whole point of a shared rest
 *     pose. This is the standard humanoid-retarget policy (the alternative,
 *     per-bone translation rescale, would re-derive segment lengths the rig
 *     already owns — the generated body is lofted around THIS skeleton's
 *     rest joints, so the clip's source proportions are exactly what must
 *     not survive — and it reintroduces per-bone coupling).
 *
 * NAME VARIANTS: track node names resolve across the three spellings in the
 * wild — sanitized `mixamorigHips` (what GLTFLoader yields), raw
 * `mixamorig:Hips` / `mixamorig_Hips` (FBX-side exports), and bare `Hips`
 * (renamed rigs). A track whose node cannot be resolved to a standard bone
 * — or whose property is neither a bone TRS channel nor a declared morph
 * channel (below) — is collected, and `retargetClipToHumanoid` throws ONE
 * hard error listing every unresolved track (degrade loudly, never a
 * silently-frozen limb).
 *
 * MORPH-CHANNEL POLICY (a deliberate reversal, 2026-08-01, the face phase):
 * `morphTargetInfluences` tracks were rejected outright here, because nothing
 * on a generated humanoid could consume one. A generated humanoid now can —
 * the face ships NAMED morph targets (blink, jaw/mouth shapes, brow poses) —
 * so a clip animating one carries real animation, and rejecting it would
 * itself be the silent freeze this file exists to prevent. The policy is
 * therefore: a track named `<node>.morphTargetInfluences[<morphName>]`
 * resolves when `target.morphs` declares that name, and is rebound to the
 * target's morph-owning mesh (the source's node name is a source fact, the
 * way bone spellings are). What did NOT change, and must not: an UNKNOWN
 * morph name is still collected and still throws with every offender named,
 * a target that declares no morphs still rejects every morph track exactly as
 * before, and the POSITIONAL forms — the whole-array `.morphTargetInfluences`
 * that `GLTFLoader` emits, and `[3]` — are still rejected, because an index
 * means whatever the SOURCE rig's target order meant and would land on a
 * different expression here. Loud still beats silent; the carve-out is for
 * channels we can name, not for channels we can only guess at.
 */

import * as THREE from 'three';
import { buildClipMap } from './clip-map';
import { HUMANOID_HIPS_BONE } from './skeleton';

/** What retargeting needs to know about a generated rig — `HumanoidRig`
 *  satisfies this structurally. */
export interface HumanoidClipTarget {
  /** Bone lookup by canonical (sanitized-Mixamo) name. */
  bonesByName: ReadonlyMap<string, THREE.Bone>;
  /** Hips-height ratio vs the reference rig (see `ScaledSkeletonDef`). */
  hipsPositionScale: number;
  /** The morph channels this rig can actually play (see MORPH-CHANNEL POLICY
   *  above). Absent — the case for every rig without a face — means every
   *  morph track is unresolved and throws. */
  morphs?: {
    /** Name of the mesh that owns the morph targets; resolved morph tracks
     *  are rebound to it. */
    meshName: string;
    /** Morph target names present on that mesh (its
     *  `morphTargetDictionary` keys). */
    names: readonly string[];
  };
}

function preserveQuaternionHemisphere(track: THREE.KeyframeTrack): THREE.KeyframeTrack {
  const values = track.values;
  for (let offset = 4; offset < values.length; offset += 4) {
    const dot =
      Number(values[offset - 4]) * Number(values[offset]) +
      Number(values[offset - 3]) * Number(values[offset + 1]) +
      Number(values[offset - 2]) * Number(values[offset + 2]) +
      Number(values[offset - 1]) * Number(values[offset + 3]);
    if (dot >= 0) continue;
    values[offset] = -Number(values[offset]);
    values[offset + 1] = -Number(values[offset + 1]);
    values[offset + 2] = -Number(values[offset + 2]);
    values[offset + 3] = -Number(values[offset + 3]);
  }
  return track;
}

/** Resolve a clip-track node name to a canonical bone name, or null. */
export function resolveHumanoidBoneName(
  nodeName: string,
  bonesByName: ReadonlyMap<string, THREE.Bone>,
): string | null {
  if (bonesByName.has(nodeName)) return nodeName;
  // `mixamorig:Hips` → `mixamorigHips` (what GLTFLoader itself does).
  const sanitized = THREE.PropertyBinding.sanitizeNodeName(nodeName);
  if (bonesByName.has(sanitized)) return sanitized;
  // `mixamorig_Hips` → `Hips`; bare `Hips` passes through unchanged.
  const bare = sanitized.replace(/^mixamorig_?/i, '');
  const canonical = `mixamorig${bare}`;
  if (bonesByName.has(canonical)) return canonical;
  return null;
}

/** Retarget a `morphTargetInfluences[<name>]` track onto the target's own
 *  morph-owning mesh, per the MORPH-CHANNEL POLICY at the top of this file:
 *  named-and-declared resolves, anything else stays unresolved (and throws). */
function retargetMorphTrack(
  track: THREE.KeyframeTrack,
  property: string,
  target: HumanoidClipTarget,
): THREE.KeyframeTrack | 'unresolved' {
  const morphs = target.morphs;
  if (!morphs) return 'unresolved';
  const named = /^morphTargetInfluences\[(.+)\]$/.exec(property);
  if (!named) return 'unresolved'; // positional (whole-array or [index])
  const name = named[1]!;
  if (!morphs.names.includes(name)) return 'unresolved';
  const kept = track.clone();
  kept.name = `${morphs.meshName}.morphTargetInfluences[${name}]`;
  return kept;
}

/** Retarget one track: a rebuilt track to keep, 'drop' (by policy), or
 *  'unresolved' (neither a standard bone TRS channel nor a declared morph
 *  channel). */
function retargetTrack(
  track: THREE.KeyframeTrack,
  target: HumanoidClipTarget,
): THREE.KeyframeTrack | 'drop' | 'unresolved' {
  const dot = track.name.lastIndexOf('.');
  if (dot <= 0) return 'unresolved';
  const property = track.name.slice(dot + 1);
  // Morph channels bind to a MESH, not a bone, so they resolve before (and
  // never through) the bone lookup.
  if (property.startsWith('morphTargetInfluences')) {
    return retargetMorphTrack(track, property, target);
  }
  const bone = resolveHumanoidBoneName(track.name.slice(0, dot), target.bonesByName);
  if (!bone) return 'unresolved';
  if (property === 'quaternion') {
    const kept = track.clone();
    kept.name = `${bone}.quaternion`;
    return preserveQuaternionHemisphere(kept);
  }
  if (property === 'position') {
    if (bone !== HUMANOID_HIPS_BONE) return 'drop'; // policy: rest owns segment lengths
    const kept = track.clone();
    kept.name = `${bone}.position`;
    const s = target.hipsPositionScale;
    if (s !== 1) kept.values = kept.values.map((v) => v * s);
    return kept;
  }
  if (property === 'scale') return 'drop'; // policy: rest scale is always 1
  // A bone channel this rig has no way to play (`.material.opacity`, a custom
  // property, a mis-split name): loud beats silent.
  return 'unresolved';
}

/**
 * Rebuild `clip` for a generated humanoid: node names canonicalized, the
 * translation policy above applied. The input clip is never mutated. Throws
 * (listing every offender) if any track fails to resolve to a standard bone
 * TRS channel or to a morph channel the target declares.
 */
export function retargetClipToHumanoid(
  clip: THREE.AnimationClip,
  target: HumanoidClipTarget,
): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  const unresolved: string[] = [];

  for (const track of clip.tracks) {
    const result = retargetTrack(track, target);
    if (result === 'unresolved') unresolved.push(track.name);
    else if (result !== 'drop') tracks.push(result);
  }

  if (unresolved.length > 0) {
    throw new Error(
      `humanoid: clip '${clip.name}' has ${unresolved.length} track(s) that do not resolve ` +
        `to standard humanoid bones or declared morph channels: ${unresolved.join(', ')}`,
    );
  }

  return new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
}

/**
 * Build a name → clip library from a loaded GLB's `animations` array —
 * `buildClipMap` semantics (exact names, case-insensitive lookup,
 * armature-prefix stripping, `walking`→`walk`-style aliases), plus a
 * loud getter.
 */
export function createHumanoidClipLibrary(
  animations: THREE.AnimationClip[],
  aliases: Record<string, string> = {},
): HumanoidClipLibrary {
  const map = buildClipMap(animations, aliases);
  return {
    clips: map,
    get(name: string): THREE.AnimationClip {
      const clip = map.get(name) ?? map.get(name.toLowerCase());
      if (!clip) {
        const have = [...new Set(animations.map((c) => c.name))].join(', ');
        throw new Error(`humanoid: no clip named '${name}' in library (have: ${have})`);
      }
      return clip;
    },
  };
}

export interface HumanoidClipLibrary {
  /** The full lookup map (exact + lowercase + aliased names). */
  clips: ReadonlyMap<string, THREE.AnimationClip>;
  /** Resolve a clip by name — throws listing available clips if absent. */
  get(name: string): THREE.AnimationClip;
}
