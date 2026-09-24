/**
 * The CANVAS surface's transform vocabulary, as pure functions.
 *
 * Pixi's transform is `x`, `y`, `rotation` (a scalar, radians, about the
 * screen normal) and `scale` — there is no z and no quaternion. The editor's
 * neutral {@link Transform} is 3D by construction, so the canvas adapter has to
 * translate in both directions. It used to carry that `angleToQuat`/
 * `quatToAngle` pair inline (extraction cited: `pixi-live-write-target.ts`'s
 * own header records where the code it was lifted out of lived). This module
 * is that pair plus the SOURCE half the write path needs, in one place, so the
 * live and source targets can never disagree about what "rotation" means.
 *
 * ## Why the source half is pure, and lives here
 *
 * Deciding which `@pixi/react` PROP a transform channel writes is the whole
 * literal-vs-dynamic contract of the canvas lane, and it is decidable from two
 * inputs alone: the channel, and the JSX attributes already on the tag. No
 * live tree, no network, no adapter. Keeping it here is what makes it testable
 * without mounting Pixi (`packages/editor/test/pixi-transform-channels.test.ts`).
 *
 * ## The scale rule, stated once
 *
 * `<pixiContainer scale={0.5}>` is the shipped idiom (see any prefab under an
 * example project's `prefabs/`), and Pixi's own setter takes a number or a
 * `PointData` — never an array. So a UNIFORM scale writes the scalar back, and
 * a NON-UNIFORM one is only expressible through `@pixi/react`'s dashed-prop
 * piercing (`scale-x`/`scale-y`, which land on `container.scale.x`/`.y`). This
 * module writes the dashed pair when the tag already authors it, and otherwise
 * REFUSES a non-uniform scale in a sentence naming the pair — never a silently
 * lossy uniform write, and never an array literal Pixi would reject at
 * runtime.
 */

import type { Transform2DValue } from '@volter/game-runtime/pixi/authoring';
import type { Transform } from '@volter/editor-project/adapter';

/** Quaternion (xyzw) about Z ⇄ scalar radians — the one mapping both canvas
 *  adapters use. */
export function angleToQuat(a: number): [number, number, number, number] {
  return [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
}

export function quatToAngle(q: readonly [number, number, number, number]): number {
  return 2 * Math.atan2(q[2], q[3]);
}

/** Pixi's own 2D transform → the editor's neutral 3D one (z pinned). */
export function toNeutralTransform(t: Transform2DValue): Transform {
  return {
    position: [t.position[0], t.position[1], 0],
    rotation: angleToQuat(t.rotation),
    scale: [t.scale[0], t.scale[1], 1],
  };
}

/** …and back. The z channel is DROPPED rather than folded in anywhere: a
 *  canvas world has no depth axis, so carrying one would fabricate a value. */
export function fromNeutralTransform(t: Transform): Transform2DValue {
  return {
    position: [t.position[0], t.position[1]],
    rotation: quatToAngle(t.rotation),
    scale: [t.scale[0], t.scale[1]],
  };
}

/** The subset of `JsxAttrInfo` this planner reads — declared structurally so a
 *  test can hand it plain objects. */
export interface PixiAttr {
  readonly name: string;
  readonly rawValue: string;
  readonly isExpression: boolean;
  readonly isLiteral: boolean;
}

/** One `prop={value}` write the plan resolves to. `value` is SOURCE TEXT. */
export interface PixiPropWrite {
  readonly prop: string;
  readonly value: string;
}

export type PixiChannelPlan =
  | { readonly writable: true; readonly writes: readonly PixiPropWrite[] }
  | { readonly writable: false; readonly reason: string };

const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const EPS = 1e-6;

/** ≤4 decimals, no trailing zeros, no negative zero — the same source-number
 *  formatting the R3F writer uses. */
export function formatSourceNumber(n: number): string {
  const rounded = Math.round(n * 1e4) / 1e4;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function attr(attrs: readonly PixiAttr[], name: string): PixiAttr | undefined {
  return attrs.find((candidate) => candidate.name === name);
}

/**
 * A prop is writable when it is ABSENT (the writer appends it) or authored as
 * a literal. An expression-bound prop (`x={grunt.x}`) is the sacred refusal:
 * the game computes it every frame, so writing a number there would be a
 * two-truths divergence the next tick erases.
 */
function propRefusal(attrs: readonly PixiAttr[], prop: string): string | null {
  const found = attr(attrs, prop);
  if (!found) return null;
  if (found.isExpression && !found.isLiteral) {
    return `${prop} is controlled by the JSX expression {${found.rawValue}}.`;
  }
  return null;
}

/**
 * Which props one transform channel writes, given what the tag already says.
 *
 * `next` is the DESIRED transform in Pixi's own vocabulary. Returns the exact
 * `prop={value}` writes to make, or one sentence saying why the channel is not
 * writable here.
 */
export function planChannelWrite(
  channel: 'position' | 'rotation' | 'scale',
  next: Transform2DValue,
  attrs: readonly PixiAttr[],
): PixiChannelPlan {
  if (channel === 'position') {
    for (const prop of ['x', 'y'] as const) {
      const refusal = propRefusal(attrs, prop);
      if (refusal) return { writable: false, reason: refusal };
    }
    return {
      writable: true,
      writes: [
        { prop: 'x', value: formatSourceNumber(next.position[0]) },
        { prop: 'y', value: formatSourceNumber(next.position[1]) },
      ],
    };
  }

  if (channel === 'rotation') {
    const refusal = propRefusal(attrs, 'rotation');
    if (refusal) return { writable: false, reason: refusal };
    return {
      writable: true,
      writes: [{ prop: 'rotation', value: formatSourceNumber(next.rotation) }],
    };
  }

  // --- scale (see this module's header for the rule) ---
  const dashed = attr(attrs, 'scale-x') ?? attr(attrs, 'scale-y');
  if (dashed) {
    for (const prop of ['scale-x', 'scale-y'] as const) {
      const refusal = propRefusal(attrs, prop);
      if (refusal) return { writable: false, reason: refusal };
    }
    return {
      writable: true,
      writes: [
        { prop: 'scale-x', value: formatSourceNumber(next.scale[0]) },
        { prop: 'scale-y', value: formatSourceNumber(next.scale[1]) },
      ],
    };
  }

  const refusal = propRefusal(attrs, 'scale');
  if (refusal) return { writable: false, reason: refusal };
  const authored = attr(attrs, 'scale');
  if (authored && !NUMBER_RE.test(authored.rawValue.trim())) {
    return {
      writable: false,
      reason:
        `scale is authored as {${authored.rawValue}} — this editor writes the scalar ` +
        'shorthand or the `scale-x`/`scale-y` pair, not an object literal.',
    };
  }
  const [sx, sy] = next.scale;
  if (Math.abs(sx - sy) >= EPS) {
    return {
      writable: false,
      reason:
        'A non-uniform scale needs the `scale-x`/`scale-y` props — this tag authors the ' +
        'uniform `scale` shorthand, which cannot hold two values.',
    };
  }
  return { writable: true, writes: [{ prop: 'scale', value: formatSourceNumber(sx) }] };
}

/** Whether two 2D transforms differ enough to be worth a source write. */
export function transform2DChanged(
  channel: 'position' | 'rotation' | 'scale',
  before: Transform2DValue,
  after: Transform2DValue,
): boolean {
  if (channel === 'position') {
    return (
      Math.abs(before.position[0] - after.position[0]) >= EPS ||
      Math.abs(before.position[1] - after.position[1]) >= EPS
    );
  }
  if (channel === 'rotation') return Math.abs(before.rotation - after.rotation) >= EPS;
  return (
    Math.abs(before.scale[0] - after.scale[0]) >= EPS ||
    Math.abs(before.scale[1] - after.scale[1]) >= EPS
  );
}
