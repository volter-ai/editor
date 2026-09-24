/**
 * G1 — typed loader for the template registry (`templates.json`).
 *
 * Templates are a small curated registry of pointers — each entry references
 * either a composition template in `packages/editor/template/` (`source:
 * "template:<id>"`) or a promoted example (`source: "example:<id>"`), plus
 * display metadata. The sibling `templates.json` is the SINGLE source of
 * truth; the CLI, the editor server (`GET /__editor/templates`), and the New
 * Project wizard all consume it through this loader so no second list can
 * rot.
 *
 * The registry is imported so bundled consumers carry the same data.
 * Browser surfaces get it over HTTP from the editor server route.
 */

import registry from './templates.json' with { type: 'json' };
import type { ProductCreateDeclaration } from './product.js';

/**
 * Retired presentation vocabulary accepted while older editor clients drain.
 * `blank` is now an identity because `template:game` is the blank scene.
 */
export const SCAFFOLD_PRESENTATIONS = ['blank'] as const;
export type ScaffoldPresentation = (typeof SCAFFOLD_PRESENTATIONS)[number];

/** A parsed entry `source` — what the scaffolder should copy. The preset name
 *  is an OPEN string: which presets exist is a PRODUCT's declaration
 *  (`./product.ts`), so an entry naming one this product does not offer is not
 *  scaffoldable rather than malformed ({@link isEntryScaffoldable}). */
export type TemplateSource =
  | { readonly type: 'template'; readonly template: string }
  | { readonly type: 'example'; readonly exampleId: string };

export interface TemplateRegistryEntry {
  /** Stable registry id (for promoted examples this equals the example id,
   *  keeping `--example <id>` parity). */
  readonly id: string;
  /** Display title (gallery card headline), e.g. "Blank Scene". */
  readonly title: string;
  /** One-line display description (gallery card body). */
  readonly description: string;
  /** `template:<compositionId>` or `example:<exampleId>` — parse with
   *  {@link parseTemplateSource}. */
  readonly source: string;
  /** Optional thumbnail reference, engine-repo-relative. Generated per
   *  FT-11 by the thumbnail generator (G3). */
  readonly thumbnail?: string;
  /** Optional "what's inside" bullets for the wizard's preview pane (§5 —
   *  "neutral daylight scene · source-owned prefabs").
   *  Curated here ONLY for composition templates, which have no `learn`
   *  block to draw on; promoted examples get theirs from the source
   *  example's `learn.features` instead — never duplicate those here. */
  readonly whatsInside?: readonly string[];
  /** Retired compatibility field. Active registry entries do not set it. */
  readonly presentation?: string;
}

export interface TemplateRegistry {
  readonly registryVersion: 1;
  readonly templates: readonly TemplateRegistryEntry[];
}

/** Parse an entry's `source` string into its typed form. Throws on any shape
 *  this registry does not define — a malformed source is a registry bug, not
 *  an input condition to degrade on. */
export function parseTemplateSource(source: string): TemplateSource {
  const exampleId = source.startsWith('example:') ? source.slice('example:'.length) : undefined;
  if (exampleId !== undefined) {
    if (exampleId.length === 0) throw new Error('Template registry: empty example id in source');
    return { type: 'example', exampleId };
  }
  const template = source.startsWith('template:') ? source.slice('template:'.length) : undefined;
  if (template !== undefined) {
    if (template.length === 0) throw new Error('Template registry: empty preset name in source');
    return { type: 'template', template };
  }
  throw new Error(
    `Template registry: unparseable source "${source}" (expected "template:<id>" or "example:<id>")`,
  );
}

function assertEntry(value: unknown, index: number): TemplateRegistryEntry {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Template registry: entry ${index} is not an object`);
  }
  const entry = value as Record<string, unknown>;
  for (const field of ['id', 'title', 'description', 'source'] as const) {
    if (typeof entry[field] !== 'string' || (entry[field] as string).length === 0) {
      throw new Error(`Template registry: entry ${index} is missing a non-empty "${field}"`);
    }
  }
  if (entry['thumbnail'] !== undefined && typeof entry['thumbnail'] !== 'string') {
    throw new Error(`Template registry: entry ${index} has a non-string "thumbnail"`);
  }
  if (entry['whatsInside'] !== undefined) {
    const bullets = entry['whatsInside'];
    if (
      !Array.isArray(bullets) ||
      bullets.length === 0 ||
      bullets.some((item) => typeof item !== 'string' || item.length === 0)
    ) {
      throw new Error(
        `Template registry: entry ${index} has an invalid "whatsInside" (non-empty string array expected)`,
      );
    }
  }
  if (entry['presentation'] !== undefined) {
    const presentation = entry['presentation'];
    if (
      typeof presentation !== 'string' ||
      !(SCAFFOLD_PRESENTATIONS as readonly string[]).includes(presentation)
    ) {
      throw new Error(
        `Template registry: entry ${index} declares presentation "${String(presentation)}" ` +
          `(expected one of ${SCAFFOLD_PRESENTATIONS.join(', ')})`,
      );
    }
  }
  parseTemplateSource(entry['source'] as string); // throws on a malformed source
  return entry as unknown as TemplateRegistryEntry;
}

/**
 * G4 capability gate: can THIS PRODUCT actually produce the given registry
 * entry? Availability is derived, never hardcoded — pass the product's own
 * create declaration (`./product.ts`), which is where the preset names live:
 *
 *  - `example:<id>` sources ride the `--example` copy path, so they are
 *    scaffoldable exactly when the product takes examples;
 *  - `template:<id>` sources are scaffoldable only when the product declares a
 *    preset of that name — a registry entry listed ahead of a product's
 *    support stays hidden with zero dead tiles, and surfaces the moment that
 *    product declares the preset.
 */
export function isEntryScaffoldable(
  entry: Pick<TemplateRegistryEntry, 'source'>,
  product: Pick<ProductCreateDeclaration, 'templates' | 'examples'>,
): boolean {
  const source = parseTemplateSource(entry.source);
  return source.type === 'example'
    ? product.examples
    : Object.hasOwn(product.templates, source.template);
}

/** Load + validate `templates.json`. Throws a descriptive error on any
 *  malformed entry or duplicate id (the registry ships with the package —
 *  a failure here is a build defect, never a runtime input condition). */
export function loadTemplateRegistry(): TemplateRegistry {
  const raw: unknown = registry;
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Template registry: templates.json is not an object');
  }
  const doc = raw as Record<string, unknown>;
  if (doc['registryVersion'] !== 1) {
    throw new Error(
      `Template registry: unsupported registryVersion ${String(doc['registryVersion'])}`,
    );
  }
  if (!Array.isArray(doc['templates']) || doc['templates'].length === 0) {
    throw new Error('Template registry: "templates" must be a non-empty array');
  }
  const templates = doc['templates'].map((entry, index) => assertEntry(entry, index));
  const seen = new Set<string>();
  for (const entry of templates) {
    if (seen.has(entry.id)) throw new Error(`Template registry: duplicate id "${entry.id}"`);
    seen.add(entry.id);
  }
  return { registryVersion: 1, templates };
}
