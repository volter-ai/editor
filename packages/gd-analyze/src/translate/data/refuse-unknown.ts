/**
 * translate/data/refuse-unknown.ts — one unknown-authored-key refusal.
 *
 * `emit/` used to inline the same filter at three sites (3D dropped-property notes, 2D dropped-
 * property notes, mesh-resource throws). The MESSAGE is the caller's — note text is part of the
 * regenerated coverage report — and this helper only answers "which keys are not in the known
 * set". Scoped exceptions that are NOT a fixed set (script members, `anims/`, `parameters/`,
 * `bones/`, a regex family) stay at the call site as {@link refuseUnknown}'s `ignore` predicate;
 * flattening them into a global key list would claim an unrelated class authoring the same
 * spelling is carried too.
 */
import type { GodotValue } from '../../read/godot-value';
import { TranslateError } from './model';

function knownSet(knownKeys: ReadonlySet<string> | readonly string[]): ReadonlySet<string> {
  return knownKeys instanceof Set ? knownKeys : new Set(knownKeys);
}

/**
 * Authored keys that are not in `knownKeys`, in sorted order. `ignore` is the scoped-exception
 * filter: a key it returns true for is treated as known (script members, prefix families, …).
 *
 * When any remain, `note` is called once with that list. The caller owns the sentence.
 */
export function refuseUnknown(
  props: Readonly<Record<string, GodotValue>>,
  knownKeys: ReadonlySet<string> | readonly string[],
  note: (dropped: readonly string[]) => void,
  ignore?: (key: string) => boolean,
): readonly string[] {
  const known = knownSet(knownKeys);
  const dropped = Object.keys(props)
    .filter((key) => !known.has(key) && ignore?.(key) !== true)
    .sort();
  if (dropped.length > 0) note(dropped);
  return dropped;
}

/**
 * The throw sibling of {@link refuseUnknown}: an unknown key is a {@link TranslateError}, not a
 * note. Used for a resource whose silently-dropped property would reshape geometry
 * (`assertOnlyProperties`).
 */
export function refuseUnknownOrThrow(
  props: Readonly<Record<string, GodotValue>>,
  knownKeys: ReadonlySet<string> | readonly string[],
  at: string,
  message: (dropped: readonly string[]) => string,
  ignore?: (key: string) => boolean,
): void {
  refuseUnknown(
    props,
    knownKeys,
    (dropped) => {
      throw new TranslateError(at, message(dropped));
    },
    ignore,
  );
}
