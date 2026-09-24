/**
 * Data-asset integrity core — the PURE half of W5 enforcement ("dangling
 * `file#key` ref" / §6.7 build-path validation). No filesystem, no vite, no
 * zod: plain parsed-JSON in, findings out, so BOTH consumers — `vgai
 * doctor`'s data checks (`packages/editor/src/doctor/data-checks.ts`) and the
 * build-time plugin (`./vite-plugin-data.ts`) — share one definition of "what
 * is a ref" and "what counts as dangling" and can never drift apart.
 *
 * What is a ref (§2.2): a cross-asset reference is a plain string
 * `"file#key"` — optionally with a field path, `"tuning#economy.slotGrowth"`
 * (file `#` key `.` field-path). There is no branded-ref Zod helper shipped
 * yet (W1 deferred it), so ref DETECTION is by convention, tuned against
 * false positives: a string is treated as a ref IFF it matches
 * {@link DATA_REF_PATTERN} AND its `file` prefix names a data asset that
 * actually exists in the project (`src/data/<file>.data.json`). Strings that
 * merely contain `#` — hex colors (`"#ff0000"`, no prefix), URLs with
 * fragments (`/` and `:` never match), musical pitches (`"C#4"` only matches
 * if a `C.data.json` exists) — never fire. The flip side is deliberate and
 * honest: a ref whose file prefix names a NONEXISTENT asset is
 * indistinguishable from an arbitrary string and is NOT flagged ("error if
 * refs exist yet" — the check only bites once the target file exists).
 *
 * `dataRef` (`./data-ref.ts`) now exists, closing that flip side for anyone
 * who adopts it: a `dataRef(target)` field's EMITTED schema carries
 * `"x-vgai-ref": target` — a declared intent, independent of whether the
 * target file currently exists. {@link collectDeclaredRefFields} /
 * {@link findMissingRefTargets} below walk that (zod-free — plain emitted
 * JSON Schema in, findings out, same purity contract as the rest of this
 * module) to catch the §9.4 hole for DECLARED refs: renaming/deleting a
 * target file used to silently un-check every ref into it; now a declared
 * ref's target is checked by NAME, not by "does a string happen to look
 * like one right now." Undeclared conventional-string refs keep the
 * calibrated behavior above, unchanged.
 */

/**
 * `file#key(.field)*` — prefix must look like an asset stem (letters,
 * digits, `_`, `-`), key path is dot-separated segments of the same alphabet.
 */
export const DATA_REF_PATTERN = /^([A-Za-z0-9_-]+)#([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)$/;

/** One ref-shaped string found while walking a data file's parsed JSON. */
export interface DataRefOccurrence {
  /** Asset stem of the data file the ref string was found IN (e.g. `"tuning"`). */
  readonly inAsset: string;
  /** JSON path of the string inside that file (e.g. `"rows.goblin.drops[2]"`). */
  readonly atPath: string;
  /** The full ref string, verbatim (e.g. `"enemies#goblin"`). */
  readonly ref: string;
  /** Parsed target asset stem (`"enemies"`). */
  readonly targetAsset: string;
  /** Parsed dot-separated key path into the target (`["goblin"]`). */
  readonly targetKeyPath: readonly string[];
}

/** One dangling ref: the target FILE exists but the key path does not resolve in it. */
export interface DanglingRefFinding extends DataRefOccurrence {
  /** The first key-path segment that failed to resolve, for the teaching message. */
  readonly missingSegment: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Walk one data file's parsed JSON and collect every ref-shaped string whose
 * file prefix names an asset in `assetNames`. The top-level `"$schema"`
 * interchange line is skipped (it is wiring, not data — same special-casing
 * as `parseDataJson`'s strip).
 */
export function collectDataRefs(
  inAsset: string,
  json: unknown,
  assetNames: ReadonlySet<string>,
): DataRefOccurrence[] {
  const out: DataRefOccurrence[] = [];
  visitForRefs(json, '', true, (node, path) => {
    const occurrence = asRefOccurrence(inAsset, node, path, assetNames);
    if (occurrence) out.push(occurrence);
  });
  return out;
}

/** Depth-first walk over parsed JSON, calling `onString` for every string leaf with its JSON path. */
function visitForRefs(
  node: unknown,
  path: string,
  topLevel: boolean,
  onString: (value: string, path: string) => void,
): void {
  if (typeof node === 'string') {
    onString(node, path);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      visitForRefs(item, `${path}[${i}]`, false, onString);
    });
    return;
  }
  if (isPlainObject(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (topLevel && key === '$schema') continue;
      visitForRefs(value, path ? `${path}.${key}` : key, false, onString);
    }
  }
}

/** The string is a ref iff it matches the pattern AND its file prefix names a real asset. */
function asRefOccurrence(
  inAsset: string,
  value: string,
  path: string,
  assetNames: ReadonlySet<string>,
): DataRefOccurrence | null {
  const m = DATA_REF_PATTERN.exec(value);
  if (!m || !assetNames.has(m[1] as string)) return null;
  return {
    inAsset,
    atPath: path || '(root)',
    ref: value,
    targetAsset: m[1] as string,
    targetKeyPath: (m[2] as string).split('.'),
  };
}

/**
 * Find every dangling `file#key(.field)*` ref across a project's data assets.
 *
 * @param files parsed `.data.json` payloads keyed by asset stem (the
 *   filename minus `.data.json` — the same name the ref's prefix uses, §2.2).
 *   Pass only files that parsed as JSON; unparseable files are already an
 *   error in their own right and can't be resolved against anyway.
 * @returns one finding per ref whose target FILE is in `files` but whose key
 *   path does not fully resolve inside it (a table row that doesn't exist, a
 *   singleton field path that walks off the object).
 */
export function findDanglingDataRefs(files: ReadonlyMap<string, unknown>): DanglingRefFinding[] {
  const assetNames = new Set(files.keys());
  const findings: DanglingRefFinding[] = [];
  for (const [name, json] of files) {
    for (const occurrence of collectDataRefs(name, json, assetNames)) {
      const missing = firstUnresolvedSegment(files.get(occurrence.targetAsset), occurrence);
      if (missing !== null) findings.push({ ...occurrence, missingSegment: missing });
    }
  }
  return findings;
}

/** The first key-path segment that fails to resolve in the target payload, or `null` if the whole path resolves. */
function firstUnresolvedSegment(target: unknown, ref: DataRefOccurrence): string | null {
  let node: unknown = target;
  for (const segment of ref.targetKeyPath) {
    if (!isPlainObject(node) || !(segment in node)) return segment;
    node = node[segment];
  }
  return null;
}

/** One `dataRef` field declared in an emitted JSON Schema. */
export interface DeclaredRefField {
  /** Dot-separated field path within the schema (e.g. `"drop"`, `"loot.dropTable"`). A table's row-schema fields are reported WITHOUT a row-key segment — the declaration applies to every row alike. */
  readonly fieldPath: string;
  /** The asset stem the field's `dataRef(...)` call named. */
  readonly targetStem: string;
}

/** One declared ref whose target stem names no asset that currently exists. */
export interface MissingRefTargetFinding {
  readonly fieldPath: string;
  readonly targetStem: string;
}

/** Loosely-typed view of an emitted JSON Schema node — walked structurally, never through Zod (this module stays zod-free). */
interface JsonSchemaNode {
  properties?: Record<string, unknown>;
  additionalProperties?: unknown;
  'x-vgai-ref'?: unknown;
}

function asSchemaNode(value: unknown): JsonSchemaNode | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonSchemaNode)
    : null;
}

/**
 * Walk an emitted data-asset JSON Schema (`toDataJsonSchema`'s output, or the
 * committed `.schema.json` twin — same shape either way) and collect every
 * field stamped `"x-vgai-ref": <target>` by `dataRef` (`./data-ref.ts`).
 * Handles both blessed shapes (spec §2.1): a singleton's `properties`, and a
 * table's `additionalProperties` row schema — walked with the SAME field
 * path (a table's declared ref applies uniformly to every row, there is no
 * per-row schema variation). Nested `properties` inside a ref-declaring
 * field are not walked further (a ref leaf has no children); nested groups
 * elsewhere recurse via their own `properties`.
 */
export function collectDeclaredRefFields(schema: unknown): DeclaredRefField[] {
  const out: DeclaredRefField[] = [];
  walkForDeclaredRefs(schema, '', out);
  return out;
}

function walkForDeclaredRefs(raw: unknown, path: string, out: DeclaredRefField[]): void {
  const node = asSchemaNode(raw);
  if (!node) return;

  if (typeof node['x-vgai-ref'] === 'string') {
    out.push({ fieldPath: path || '(root)', targetStem: node['x-vgai-ref'] });
    return; // a ref leaf — nothing further to walk under it
  }

  if (isPlainObject(node.properties)) {
    for (const [key, child] of Object.entries(node.properties)) {
      if (key === '$schema') continue;
      walkForDeclaredRefs(child, path ? `${path}.${key}` : key, out);
    }
  }
  // A table's row schema (`z.record(rowSchema)` emits an object-valued
  // `additionalProperties`) — same field-path grammar, no row-key segment.
  if (isPlainObject(node.additionalProperties)) {
    walkForDeclaredRefs(node.additionalProperties, path, out);
  }
}

/**
 * Every declared ref field whose target stem names no asset in
 * `assetNames` — the §9.4 fix: a `dataRef('items')` field stays flagged if
 * `items.data.json` is renamed or deleted, independent of whether any
 * CURRENT value happens to look like an `items#...` string (the gap the
 * conventional-string calibration above deliberately leaves open).
 */
export function findMissingRefTargets(
  declared: readonly DeclaredRefField[],
  assetNames: ReadonlySet<string>,
): MissingRefTargetFinding[] {
  return declared
    .filter((d) => !assetNames.has(d.targetStem))
    .map((d) => ({ fieldPath: d.fieldPath, targetStem: d.targetStem }));
}
