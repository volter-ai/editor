/**
 * WHAT TO DO ABOUT WHAT PLAYS ONLY IN BLENDER, said after a warning that names it. Pure, so the
 * Timeline (`blender-runtime-skin.ts`), a game in the editor and a game exported to the web
 * (`blender-play-skin.ts`) say the same thing without the export pulling in the Blender host.
 */
export function remedy(unsupported: readonly string[]): string {
  const out: string[] = [];
  if (unsupported.some((thing) => thing.includes(' constraint ') || thing.includes('drivers')))
    out.push('Bake a constraint or driver into the action (Pose ▸ Animation ▸ Bake Action, Visual Keying), or aim with a Damped Track.');
  if (unsupported.some((thing) => thing.includes('curves on ')))
    out.push("Key the motion on a bone (the root bone) instead of the armature object, or move the object from the game.");
  if (unsupported.some((thing) => thing.includes('interpolation') || thing.includes(' modifier')))
    out.push('Use Bezier, Linear or Constant keys and the Cycles modifier only, or bake the curves (Key ▸ Bake Keyframes).');
  return out.length ? ` ${out.join(' ')}` : '';
}
