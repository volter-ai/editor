/**
 * `file#key` refs — the resolvable half.
 *
 * Cross-asset references (`"enemies#goblin"`, `"tuning#economy.slotGrowth"`)
 * have been DETECTED and VALIDATED since W5 (`data-check-core.ts`'s
 * `DATA_REF_PATTERN` + `findDanglingDataRefs`, enforced by both `vgai doctor`
 * and the build plugin) — but nothing could actually RESOLVE one at runtime,
 * and nothing declared a field AS a ref in its schema (detection was by
 * string-shape convention alone). This module closes both halves:
 *
 * - {@link dataRef} — a typed Zod schema for a ref FIELD. Stamps the emitted
 *   JSON Schema with a precise `pattern` (the target stem is baked into the
 *   regex, so VS Code validates the prefix for free) and a machine-readable
 *   `"x-vgai-ref": target` marker (a Zod `.meta()` that survives
 *   `toDataJsonSchema`, including inside a table's `additionalProperties` row
 *   schema — no emitter changes needed). The editor's Data panel
 *   (`json-schema-fields.ts`'s `'ref'` kind) reads that marker to render a
 *   `stem#key` PICKER instead of free text.
 * - {@link getRef} — lazy, read-time resolution. The caller names the target
 *   HANDLE explicitly (`getRef(items, goblin.drop)`), so the resolved type is
 *   the handle's own row type — no stem→handle registry, no load-order
 *   problem, no cycle hazard (nothing walks a graph; two refs resolved when
 *   you choose to resolve them isn't a cycle), and it's HMR-correct for free
 *   (it reads `target.get()` at CALL time, same doctrine as every other data
 *   read — "read every frame", never cache across frames).
 *
 * Deliberately NOT built (and the design note this module's history carries):
 * eager resolution inside `defineData` (would change `get()`'s shipped output
 * type and entangle HMR — an edit to `enemies.data.json` would have to
 * re-notify every OTHER asset that references it), and a global
 * `resolveRef(addressString)` (needs a runtime stem→handle registry that
 * `src/data/assets.ts` — side-effect-free, config-load-time, schemas-only by
 * its own module doc — must not become).
 */

import { z } from 'zod';
import type { DataHandle } from './data-asset';
import { DATA_REF_PATTERN } from './data-check-core';

/** An asset-stem-tagged `file#key` string — `` `${Stem}#${string}` ``. */
export type DataRef<Stem extends string = string> = `${Stem}#${string}`;

/** Prefix/key-path grammar a ref must match, parameterized by target stem (mirrors `DATA_REF_PATTERN` in `data-check-core.ts`, minus the alternation — this one is anchored to ONE target). */
function refPattern(target: string): RegExp {
  return new RegExp(`^${target}#[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*$`);
}

/**
 * A Zod schema for a data-asset FIELD that references another asset by
 * `"<target>#<key>(.<field>)*"`. Use it in a `.schema.ts`:
 *
 * ```ts
 * export const EnemyRowSchema = z.object({
 *   name: z.string(),
 *   drop: dataRef('items'), // -> "items#potion"
 * });
 * ```
 *
 * The emitted JSON Schema (`toDataJsonSchema`) carries both a precise
 * `pattern` (VS Code validates the target-stem prefix for free) and
 * `"x-vgai-ref": target` (the editor's Data panel picker keys off this).
 * Detection by `data-check-core.ts`'s conventional-string calibration still
 * applies at the VALUE level (a `dataRef` field's actual string still has to
 * look like `target#key` to resolve) — this only makes the field's INTENT
 * declared in the schema, closing the §9.4 "renamed target file silently
 * un-checks its refs" hole for anything that adopts it (see
 * `collectDeclaredRefFields`/`findMissingRefTargets` in `data-check-core.ts`).
 */
export function dataRef<Stem extends string>(target: Stem): z.ZodType<DataRef<Stem>> {
  return z
    .string()
    .regex(refPattern(target), {
      message:
        `must be a "${target}#<key>" reference — ` +
        `expected the target asset stem "${target}", e.g. "${target}#some-key".`,
    })
    .meta({ 'x-vgai-ref': target }) as z.ZodType<DataRef<Stem>>;
}

/** First failing key-path segment, or `null` if the whole path resolves — same walk `data-check-core.ts`'s `firstUnresolvedSegment` does over parsed JSON, here over a live handle's value. */
function firstMissingSegment(root: unknown, keyPath: readonly string[]): string | null {
  let node: unknown = root;
  for (const segment of keyPath) {
    if (node === null || typeof node !== 'object' || Array.isArray(node) || !(segment in node)) {
      return segment;
    }
    node = (node as Record<string, unknown>)[segment];
  }
  return null;
}

/**
 * Resolve a `"target#key(.field)*"` ref against the named target HANDLE,
 * read live (`target.get()` at call time — HMR-correct, no caching across
 * frames, same doctrine as any other data read).
 *
 * `ref`'s stem prefix should name `target`'s own asset — when `target` was
 * built with a `sourcePath` (every `defineData` call populates it), a
 * mismatch throws a teaching error instead of silently walking the wrong
 * handle's data. Without a `sourcePath` (a hand-rolled `DataHandle`, or an
 * older one built before this field existed) the mismatch check is skipped —
 * resolution still proceeds against `target`, since the caller named it
 * explicitly and that's the actual contract.
 *
 * Throws a teaching error naming the ref and the first key-path segment that
 * doesn't resolve (a deleted row, a typo'd key) — never returns `undefined`
 * silently, matching `parseDataJson`'s "errors teach" doctrine (§6.5).
 */
export function getRef<T>(target: DataHandle<Record<string, T>>, ref: string): T {
  const m = DATA_REF_PATTERN.exec(ref);
  if (!m) {
    throw new Error(
      `getRef: "${ref}" is not a "file#key" reference — ` +
        'expected a string shaped like "some-file#some-key".',
    );
  }
  const refStem = m[1] as string;
  const keyPathStr = m[2] as string;
  const targetStem = target.sourcePath
    ?.split('\\')
    .join('/')
    .split('/')
    .pop()
    ?.replace(/\.data\.json$/, '');
  if (targetStem !== undefined && targetStem !== refStem) {
    throw new Error(
      `getRef: ref "${ref}" names target asset "${refStem}", but the handle passed in is ` +
        `"${targetStem}" (${target.sourcePath}). Pass the handle ` +
        `"${refStem}#..." actually names — getRef(${refStem}, ...), not getRef(${targetStem}, ...).`,
    );
  }
  const keyPath = keyPathStr.split('.');
  const root = target.get();
  const missing = firstMissingSegment(root, keyPath);
  if (missing !== null) {
    throw new Error(
      `getRef: dangling ref "${ref}" — "${missing}" does not exist` +
        (targetStem ? ` in ${targetStem}.data.json` : '') +
        '. Fix the key or remove the ref (refs are "file#key" strings).',
    );
  }
  let node: unknown = root;
  for (const segment of keyPath) node = (node as Record<string, unknown>)[segment];
  return node as T;
}
