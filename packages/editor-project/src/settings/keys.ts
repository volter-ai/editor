/**
 * THE SETTINGS KEY TABLE — every setting there is, as ONE dotted `vgai.*` name
 * per leaf, with the type and the sentence a person reads beside it.
 *
 * ## Why it exists, and why it is DERIVED
 *
 * Under the Code-OSS frame (ARCHITECTURE-CORE §The core is Code-OSS, U7) the
 * settings layers are the configuration service's, and a configuration service
 * speaks FLAT DOTTED KEYS — `vgai.appearance.palette` — while
 * `schema.ts`'s document is a nested object. Something has to be the one place
 * those two spellings meet, and the same table is what the fork's
 * `contributes.configuration` is generated from, so VS Code's Settings editor
 * shows every vgai setting with the description its `.describe()` call already
 * carries.
 *
 * It is DERIVED from {@link EditorSettingsSchema} rather than written, for the
 * reason `PROVIDER_GAP` in `adapter-reach.ts` is a `Record` over a pinned key
 * union: a hand-kept second list of the same seventeen keys drifts the first
 * time somebody adds a field, and a settings key with no declaration is
 * invisible in the one settings UI rather than loud. The walk is over the JSON
 * Schema Zod itself produces (`z.toJSONSchema`) — the SAME derivation
 * `scripts/generate-schema.ts` commits as
 * `packages/project/schemas/vgai-settings.schema.json`, which is what the
 * fork's generator reads. One derivation, three consumers: this table, the
 * committed schema a person's editor autocompletes against, and the frame's
 * configuration contribution.
 *
 * ## The `vgai.` prefix is part of the key, everywhere
 *
 * Not a thing the frame adds on the way in. One spelling in the door
 * (`EditorHost.settings`), in `.vscode/settings.json`, in the Settings editor,
 * and in what `vgai eval` prints — because the moment there are two, a reader
 * has to know which side of which seam they are on to know which to type.
 */
import { z } from 'zod';
import { type EditorSettings, EditorSettingsSchema } from './schema';

/** The namespace every settings key carries. */
export const SETTINGS_KEY_PREFIX = 'vgai';

/** What a key is, and what the Settings editor shows for it. */
export interface SettingsKeyDescriptor {
  /** The dotted name, prefix included: `vgai.appearance.palette`. */
  readonly key: string;
  /** The path into the settings document: `['appearance', 'palette']`. */
  readonly path: readonly string[];
  /** JSON Schema `type`, when the field has exactly one. A nullable field
   *  (`devicePreview.touch`) has none, and the frame declares no type for it
   *  rather than picking one of the two. */
  readonly type?: string | undefined;
  /** The closed set of values, when the field is an enum. */
  readonly values?: readonly string[] | undefined;
  /** The field's own `.describe()` sentence — the one a person reads. */
  readonly description: string;
}

type JsonSchemaNode = {
  type?: string | string[];
  enum?: readonly string[];
  description?: string;
  properties?: Record<string, JsonSchemaNode>;
};

function walk(node: JsonSchemaNode, path: readonly string[], out: SettingsKeyDescriptor[]): void {
  if (node.properties) {
    for (const [name, child] of Object.entries(node.properties)) walk(child, [...path, name], out);
    return;
  }
  // `$schema` is the autocomplete pointer the document carries for a person
  // editing it by hand; it describes the file, not the editor, and there is
  // nothing for a settings UI to show.
  if (path.length === 1 && path[0] === '$schema') return;
  out.push({
    key: [SETTINGS_KEY_PREFIX, ...path].join('.'),
    path,
    type: typeof node.type === 'string' ? node.type : undefined,
    values: node.enum,
    description: node.description ?? '',
  });
}

let table: readonly SettingsKeyDescriptor[] | null = null;
let byKey: ReadonlyMap<string, SettingsKeyDescriptor> | null = null;

/** Every settings key, in the schema's own declaration order. */
export function settingsKeys(): readonly SettingsKeyDescriptor[] {
  if (!table) {
    const out: SettingsKeyDescriptor[] = [];
    walk(z.toJSONSchema(EditorSettingsSchema, { io: 'input' }) as JsonSchemaNode, [], out);
    table = out;
    byKey = new Map(out.map((entry) => [entry.key, entry]));
  }
  return table;
}

/** One key's declaration, or `null` for a name no schema field owns. A caller
 *  that gets `null` is holding a key nobody can read — never a silent miss. */
export function settingsKey(key: string): SettingsKeyDescriptor | null {
  settingsKeys();
  return byKey?.get(key) ?? null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read one key out of a settings document. `undefined` means the document
 *  does not carry it — which is what "this layer is silent about it" means. */
export function readSettingsValue(document: EditorSettings, key: string): unknown {
  const descriptor = settingsKey(key);
  if (!descriptor) return undefined;
  let cursor: unknown = document;
  for (const segment of descriptor.path) {
    if (!isPlainObject(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

/** A settings document built from dotted keys — the inverse of
 *  {@link flattenSettings}, and what turns a per-key configuration service back
 *  into the nested document every reader in the editor already speaks. */
export function settingsFromEntries(entries: Iterable<readonly [string, unknown]>): EditorSettings {
  const document: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    const descriptor = settingsKey(key);
    if (!descriptor) continue;
    let cursor = document;
    for (const segment of descriptor.path.slice(0, -1)) {
      const next = cursor[segment];
      if (!isPlainObject(next)) cursor[segment] = {};
      cursor = cursor[segment] as Record<string, unknown>;
    }
    const leaf = descriptor.path[descriptor.path.length - 1];
    if (leaf !== undefined) cursor[leaf] = value;
  }
  return document as EditorSettings;
}

/** A settings document as dotted key/value pairs, skipping keys it is silent
 *  about. A value at a path no schema field owns is DROPPED rather than
 *  carried: the document is `.strict()`, so such a path can only come from a
 *  layer this build does not understand. */
export function flattenSettings(document: EditorSettings): ReadonlyMap<string, unknown> {
  const out = new Map<string, unknown>();
  for (const descriptor of settingsKeys()) {
    const value = readSettingsValue(document, descriptor.key);
    if (value !== undefined) out.set(descriptor.key, value);
  }
  return out;
}
