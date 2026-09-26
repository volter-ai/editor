/** Pure authored data for Godot 3 CollisionPolygon / Godot 4 CollisionPolygon3D. */
import type { GodotValue } from '../../read/godot-value';
import { TranslateError } from './model';

export interface CollisionPolygon3DPoint {
  readonly x: number;
  readonly y: number;
}

export interface CollisionPolygon3DSpec {
  readonly polygon: readonly CollisionPolygon3DPoint[];
  readonly depth: number;
  readonly margin: number;
  readonly disabled: boolean;
}

export function readCollisionPolygon3D(
  properties: Readonly<Record<string, GodotValue>>,
  at: string,
): CollisionPolygon3DSpec {
  const value = properties['polygon'];
  if (
    value !== undefined &&
    (value.kind !== 'ctor' ||
      (value.name !== 'PoolVector2Array' && value.name !== 'PackedVector2Array'))
  ) {
    throw new TranslateError(
      at,
      'a CollisionPolygon without a PoolVector2Array/PackedVector2Array `polygon`.',
    );
  }
  const args = value?.kind === 'ctor' ? value.args : [];
  if (args.length % 2 !== 0) {
    throw new TranslateError(
      at,
      `CollisionPolygon.polygon has ${args.length} scalar values; Vector2 pairs are required.`,
    );
  }
  const polygon: CollisionPolygon3DPoint[] = [];
  for (let index = 0; index < args.length; index += 2) {
    const x = args[index];
    const y = args[index + 1];
    if (
      x?.kind !== 'number' || y?.kind !== 'number' ||
      !Number.isFinite(x.value) || !Number.isFinite(y.value)
    ) {
      throw new TranslateError(
        at,
        `CollisionPolygon.polygon point ${index / 2} is not a finite Vector2 pair.`,
      );
    }
    polygon.push({ x: x.value, y: y.value });
  }
  const number = (name: 'depth' | 'margin', fallback: number): number => {
    const authored = properties[name];
    if (authored === undefined) return fallback;
    if (authored.kind !== 'number' || !Number.isFinite(authored.value)) {
      throw new TranslateError(at, `CollisionPolygon.${name} must be finite numeric data.`);
    }
    return authored.value;
  };
  const authoredDisabled = properties['disabled'];
  if (authoredDisabled !== undefined && authoredDisabled.kind !== 'bool') {
    throw new TranslateError(at, 'CollisionPolygon.disabled must be boolean data.');
  }
  return {
    polygon,
    depth: number('depth', 1),
    margin: number('margin', 0.04),
    disabled: authoredDisabled?.kind === 'bool' ? authoredDisabled.value : false,
  };
}
