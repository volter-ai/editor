/**
 * Reading a declared params schema as tuning controls.
 *
 * The parameterization contract (the `vgai-3d-assets` skill,
 * "Parametric asset libs") says a
 * parametric asset lib exports a PAIR — a declared parameter object and the
 * function that takes it — and that any tuning UI is DERIVED from that
 * declaration, never hand-mirrored. A hand-kept control table is a second
 * list of the same facts, and second lists rot: a knob added to the schema
 * gets no control, and a bound changed there silently leaves a slider driving
 * values the generator would reject at parse.
 *
 * `z.toJSONSchema` is zod's own public projection of exactly what was
 * declared — bounds, defaults, and `.describe()` prose — so this file is the
 * whole mechanism. Both shipped libs (`lib/humanoid`, `lib/castle`)
 * bind their Builder controls to it; a lib of your own gets a tuning UI by
 * declaring a schema and nothing else.
 */

import type { z } from 'zod';
import * as zod from 'zod';

/** One numeric knob, read off a declared params schema. */
export interface NumericParamDescriptor {
  readonly key: string;
  readonly min: number;
  readonly max: number;
  /** The declared default; absent for an optional param that has none. */
  readonly default?: number;
  /** The field's `.describe()` prose — control hint / tooltip copy. */
  readonly description: string;
  /** True when the param may be omitted (it has no default). */
  readonly optional: boolean;
}

/** Every bounded numeric field of a params schema, in declaration order.
 *  Fields without both bounds are skipped: an unbounded number has no slider
 *  range, so a UI must decide what to do with it explicitly. */
export function describeNumericParams(schema: z.ZodType): readonly NumericParamDescriptor[] {
  const json = zod.toJSONSchema(schema) as {
    properties?: Record<
      string,
      { type?: string; minimum?: number; maximum?: number; default?: unknown; description?: string }
    >;
    required?: string[];
  };
  const required = new Set(json.required ?? []);
  return Object.entries(json.properties ?? {}).flatMap(([key, property]) => {
    const { minimum, maximum } = property;
    if (property.type !== 'number' || minimum === undefined || maximum === undefined) return [];
    return [
      {
        key,
        min: minimum,
        max: maximum,
        ...(typeof property.default === 'number' ? { default: property.default } : {}),
        description: property.description ?? '',
        optional: !required.has(key),
      },
    ];
  });
}

/** Descriptor defaults as a plain params object — the initial state of a
 *  control set. Params with no declared default are omitted (the generator's
 *  own "natural" behavior stands until the user types a value). */
export function defaultParams(
  descriptors: readonly NumericParamDescriptor[],
): Record<string, number> {
  return Object.fromEntries(
    descriptors
      .filter((descriptor) => descriptor.default !== undefined)
      .map((descriptor) => [descriptor.key, descriptor.default as number]),
  );
}
