/** Source-exact decode of an authored AnimatedTexture Resource into its retained Pixi carrier. */
import type { ResourceDocument } from '../../read/godot-types';
import { resourceRefId } from '../../read/godot-value';
import { TranslateError } from './model';

export interface AuthoredAnimatedTextureFrame {
  readonly texturePath: string | null;
  /** Godot 3 delay_sec, or Godot 4 duration. */
  readonly time: number;
}

export interface AuthoredAnimatedTexturePlan {
  readonly major: 3 | 4;
  readonly frames: readonly AuthoredAnimatedTextureFrame[];
  readonly currentFrame: number;
  readonly paused: boolean;
  readonly oneShot: boolean;
  /** Godot 3 fps, or Godot 4 speed_scale. */
  readonly speed: number;
}

function integer(value: unknown, fallback: number, at: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'object' || value === null || !('kind' in value) ||
      (value as { kind?: unknown }).kind !== 'number') throw new TranslateError(at, 'must be an integer.');
  const number = (value as { value: number }).value;
  if (!Number.isSafeInteger(number)) throw new TranslateError(at, 'must be an integer.');
  return number;
}

function numberValue(value: unknown, fallback: number, at: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'object' || value === null || !('kind' in value) ||
      (value as { kind?: unknown }).kind !== 'number') throw new TranslateError(at, 'must be numeric.');
  const number = (value as { value: number }).value;
  if (!Number.isFinite(number)) throw new TranslateError(at, 'must be finite.');
  return number;
}

function bool(value: unknown, fallback: boolean, at: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'object' || value === null || !('kind' in value) ||
      (value as { kind?: unknown }).kind !== 'bool') throw new TranslateError(at, 'must be bool.');
  return (value as { value: boolean }).value;
}

export function readAuthoredAnimatedTexture(
  document: ResourceDocument,
  major: 3 | 4,
): AuthoredAnimatedTexturePlan {
  const at = document.resPath;
  if (document.type !== 'AnimatedTexture') throw new TranslateError(at, `expected AnimatedTexture, found ${document.type}.`);
  const props = document.properties;
  const count = integer(props['frames'], 1, `${at}.frames`);
  if (count < 1 || count > 256) throw new TranslateError(`${at}.frames`, 'must be in 1..256.');
  const currentFrame = integer(props['current_frame'], 0, `${at}.current_frame`);
  if (currentFrame < 0 || currentFrame >= count) throw new TranslateError(`${at}.current_frame`, `must be in 0..${count - 1}.`);
  const speedKey = major === 3 ? 'fps' : 'speed_scale';
  const oneShotKey = major === 3 ? 'oneshot' : 'one_shot';
  const timeSuffix = major === 3 ? 'delay_sec' : 'duration';
  const speed = numberValue(props[speedKey], major === 3 ? 4 : 1, `${at}.${speedKey}`);
  if (major === 3 ? speed < 0 || speed >= 1000 : speed < -1000 || speed >= 1000) {
    throw new TranslateError(
      `${at}.${speedKey}`,
      major === 3 ? 'must be in [0, 1000).' : 'must be in [-1000, 1000).',
    );
  }
  const frames = Array.from({ length: count }, (_, index): AuthoredAnimatedTextureFrame => {
    const texture = props[`frame_${index}/texture`];
    let texturePath: string | null = null;
    if (texture !== undefined && texture.kind !== 'null') {
      const id = resourceRefId(texture, 'ExtResource');
      const ext = id === undefined ? undefined : document.extResources.find((entry) => entry.id === id);
      if (ext === undefined || (ext.type !== 'Texture' && ext.type !== 'Texture2D' && ext.type !== 'CompressedTexture2D')) {
        throw new TranslateError(`${at}.frame_${index}/texture`, 'must resolve to a file-backed Texture resource.');
      }
      texturePath = ext.resPath;
    }
    const time = numberValue(props[`frame_${index}/${timeSuffix}`], major === 3 ? 0 : 1, `${at}.frame_${index}/${timeSuffix}`);
    return { texturePath, time };
  });
  const admitted = new Set([
    'frames', 'current_frame', 'pause', speedKey, oneShotKey,
    ...frames.flatMap((_, index) => [`frame_${index}/texture`, `frame_${index}/${timeSuffix}`]),
  ]);
  if (major === 3) {
    // Godot 3.6 AnimatedTexture::set_flags(uint32_t) is deliberately empty and get_flags()
    // delegates to the current frame. The serialized compatibility property therefore has no
    // state to copy onto the proxy; validate its Variant shape and preserve the source no-op.
    integer(props['flags'], 7, `${at}.flags`);
    admitted.add('flags');
  }
  const script = props['script'];
  if (script !== undefined) {
    const id = resourceRefId(script, 'SubResource');
    const sub = id === undefined ? undefined : document.subResources.find((entry) => entry.id === id);
    const source = sub?.properties['script/source'];
    if (
      sub?.type !== 'GDScript' || source?.kind !== 'string' ||
      source.value.trim() !== 'extends AnimatedTexture'
    ) {
      throw new TranslateError(
        `${at}.script`,
        'AnimatedTexture script attachment must be the source-proven empty `extends AnimatedTexture` class.',
      );
    }
    // The corpus' Godot 4 resource was saved with an empty inline derived class. It adds no state,
    // methods, or notifications; native construction is therefore the same AnimatedTexture value.
    admitted.add('script');
  }
  for (const key of Object.keys(props)) {
    if (admitted.has(key)) continue;
    throw new TranslateError(`${at}.${key}`, 'has no retained AnimatedTexture carrier.');
  }
  return {
    major,
    frames,
    currentFrame,
    paused: bool(props['pause'], false, `${at}.pause`),
    oneShot: bool(props[oneShotKey], false, `${at}.${oneShotKey}`),
    speed,
  };
}
