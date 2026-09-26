/**
 * translate/data/sprite-3d.ts — Sprite3D / Label3D carry ceilings.
 *
 * Sprite3D is a retained Mesh whose compat binding carries its authored plane, billboard and
 * material modes. Label3D uses its retained troika binding for billboard/fixed-size rendering and
 * keeps a separate refusal boundary for shaded text.
 */
import { TranslateError } from './model';

export function requireSprite3DTexture(at: string, resPath: string | undefined): string {
  if (resPath !== undefined) return resPath;
  throw new TranslateError(
    at,
    'a Sprite3D whose `texture` is not an ExtResource of this document. The 4.7 dump declares ' +
      'Sprite3D.texture as Texture2D; a sprite with no picture draws nothing, which looks ' +
      'exactly like a node this emitter failed to carry.',
  );
}

export function refuseLabel3DRoot(resPath: string, isRoot: boolean): void {
  if (!isRoot) return;
  throw new TranslateError(
    resPath,
    'a scene rooted at Label3D needs its text Mesh to be the class-owned root object; this project only authors nested Label3D nodes.',
  );
}

export function refuseLabel3DUncarriedModes(
  at: string,
  billboard: number,
  fixedSize: boolean,
  shaded: boolean,
): void {
  if ((billboard === 0 || billboard === 1 || billboard === 2) && !shaded) return;
  throw new TranslateError(
    at,
    `authors a Label3D mode this native fixed-plane unlit Mesh does not share (` +
      `billboard=${billboard}, fixed_size=${String(fixedSize)}, shaded=${String(shaded)}). ` +
      'The native text carry supports all three billboard modes and fixed-size projection, but ' +
      'not Godot\'s lit Label3D material.',
  );
}

export function refuseLabel3DFadeMode(at: string, fadeMode: number): void {
  if (fadeMode === 0 || fadeMode === 1) return;
  throw new TranslateError(
    at,
    `visibility_range_fade_mode=${fadeMode} is not DISABLED (0) or SELF (1). ` +
      'Dependency fading changes a separate visibility subtree and cannot be represented by this label alone.',
  );
}
