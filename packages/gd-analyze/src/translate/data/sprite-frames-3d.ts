/**
 * translate/data/sprite-frames-3d.ts — SpriteFrames / AtlasTexture cells this lane carries.
 */
import type { GodotValue } from '../../read/godot-value';
import { TranslateError } from './model';

export function requireSpriteFramesAnimationList(
  value: GodotValue | undefined,
  at: string,
): readonly GodotValue[] {
  if (value?.kind !== 'array') {
    throw new TranslateError(at, 'a SpriteFrames with no `animations` array.');
  }
  return value.items;
}

export function refuseEmptySpriteFrames(at: string, animationCount: number): void {
  if (animationCount === 0) {
    throw new TranslateError(at, 'a SpriteFrames with no animations.');
  }
}

export function requireAnimatedSprite3DFinished<T>(at: string, sprite: T | undefined): T {
  if (sprite !== undefined) return sprite;
  throw new TranslateError(
    at,
    'the `animation_finished` signal is connected on a node that is not an emitted ' +
      'AnimatedSprite3D, so there is no SpriteFrames playhead to watch.',
  );
}

export function refuseAnimatedSpriteWithoutFrames(at: string, hasFrames: boolean): void {
  if (hasFrames) return;
  throw new TranslateError(
    at,
    'an AnimatedSprite with no `frames` SubResource. Godot renders nothing for one and ' +
      'compat refuses to guess which texture list is which animation.',
  );
}

export function requireAnimatedSprite3DExtFrames(
  at: string,
  resPath: string | undefined,
): string {
  if (resPath !== undefined) return resPath;
  throw new TranslateError(
    at,
    'an AnimatedSprite3D with no `sprite_frames` ExtResource or SubResource. Godot renders ' +
      'nothing for one and compat refuses to guess which texture list is which animation.',
  );
}

export function requireOpenedSpriteFrames<T extends { readonly type: string }>(
  at: string,
  resPath: string,
  document: T | undefined,
): T {
  if (document !== undefined && document.type === 'SpriteFrames') return document;
  throw new TranslateError(
    at,
    `\`sprite_frames\` names \`${resPath}\`, which this project did not open as a ` +
      'SpriteFrames resource.',
  );
}
