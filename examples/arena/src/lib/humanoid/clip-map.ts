import type * as THREE from 'three';

/** Common aliases used by many free humanoid packs. Scene-authored aliases override these. */
const DEFAULT_CLIP_ALIASES: Record<string, string> = {
  walking: 'walk',
  running: 'run',
};

/**
 * Build the clip lookup shared by runtime and editor.
 *
 * NOT the clip-name contract. This is a tolerant LOOKUP over whatever names a
 * GLTF file happens to carry (case, `Armature|` prefixes, pack aliases). The
 * names this lib's own clips SHIP under — the contract a game's animator and
 * its saves depend on — are `HUMANOID_CLIP_NAMES` in `locomotion-clips.ts`
 * (fork seam 3). Rename a clip there, not here.
 *
 * GLTF exporters disagree about case and may prefix animation names with an
 * armature (`Armature|Idle`). Keep the exact exported suffix while also
 * exposing a lowercase lookup, then apply aliases case-insensitively. This
 * lets authored graphs use either `Idle_Loop` or `idle_loop` without silently
 * falling back to the bind pose.
 */
export function buildClipMap(
  animations: THREE.AnimationClip[],
  aliases: Record<string, string> = {},
): Map<string, THREE.AnimationClip> {
  const clips = new Map<string, THREE.AnimationClip>();
  const canonical = new Map<string, THREE.AnimationClip>();

  for (const clip of animations) {
    const raw = clip.name.split('|').pop()?.trim() || clip.name;
    canonical.set(raw.toLowerCase(), clip);
    if (!clips.has(raw)) clips.set(raw, clip);
    if (!clips.has(raw.toLowerCase())) clips.set(raw.toLowerCase(), clip);
  }

  const mergedAliases = { ...DEFAULT_CLIP_ALIASES, ...aliases };
  for (const [source, alias] of Object.entries(mergedAliases)) {
    const clip = canonical.get(source.toLowerCase());
    if (!clip) continue;
    if (!clips.has(alias)) clips.set(alias, clip);
    if (!clips.has(alias.toLowerCase())) clips.set(alias.toLowerCase(), clip);
  }

  return clips;
}
