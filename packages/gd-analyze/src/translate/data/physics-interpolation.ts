/**
 * translate/data/physics-interpolation.ts — Godot's `physics_interpolation_mode` enum as a number.
 *
 * Inherit / Off / On is 0 / 1 / 2 on Godot 3.6. The ROOT of a body-bearing scene refuses an
 * unlisted value; a child (CPUParticles) that authors Off is filtered without that throw, because
 * an invalid child mode historically compared `=== 1` and did not refuse.
 */
import { asNumber, type GodotValue } from '../../read/godot-value';
import { TranslateError } from './model';

export function readPhysicsInterpolationMode(
  props: Readonly<Record<string, GodotValue>>,
): number {
  return asNumber(props['physics_interpolation_mode']) ?? 0;
}

/** Inherit / Off / On. Throws the same sentence emit used to throw inline for a scene root. */
export function requirePhysicsInterpolationMode(
  props: Readonly<Record<string, GodotValue>>,
  at: string,
): 0 | 1 | 2 {
  const mode = readPhysicsInterpolationMode(props);
  if (mode !== 0 && mode !== 1 && mode !== 2) {
    throw new TranslateError(
      at,
      `physics_interpolation_mode=${mode} is not Godot 3.6's Inherit/Off/On enum.`,
    );
  }
  return mode;
}
