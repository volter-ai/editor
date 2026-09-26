import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  type AssetCatalog,
  type AssetFamily,
  AssetFileSchema,
  type AssetVariant,
  parseAssetCatalog,
} from '@volter/editor-sdk/kit/asset-workflow/asset-types';

/**
 * ONE catalog record — the generator's intermediate representation, produced
 * by `scripts/sync-asset-library.ts` while it walks the SSD library and
 * folded into families by `buildAssetCatalogV2`. It is NOT a persisted format:
 * the only on-disk catalog is v2 (`AssetCatalogEnvelopeSchema`).
 */
export const CatalogRecordSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{24}$/),
    source: z.string().min(1),
    name: z.string().min(1),
    type: z.enum(['model', 'animation', 'source']),
    categories: z.array(z.string()),
    tags: z.array(z.string()),
    license: z.string().min(1),
    author: z.string().min(1),
    sourceUrl: z.string().url(),
    thumbnail: z.string().min(1).optional(),
    files: z.array(AssetFileSchema).min(1),
    animationCount: z.number().int().nonnegative().optional(),
    clipNames: z.array(z.string()).optional(),
  })
  .strict();

export type CatalogRecord = z.infer<typeof CatalogRecordSchema>;

/**
 * REMOVED-FORMAT guard. `catalog.json` v1 — `{ version: 1, generatedAt,
 * assets: [...] }`, a flat variant list with no families — was accepted on
 * read and migrated in memory by `migrateLegacyAssetCatalog`. Both are
 * deleted: v2 is the only catalog format, and `scripts/sync-asset-library.ts`
 * writes v2 directly.
 *
 * Zod's envelope would reject a v1 file anyway, but with `version: expected 2,
 * received 1` and no hint about what happened — so this runs FIRST and names
 * the removal, the same way every other retired on-disk format in this repo
 * does.
 */
export function assertNoRemovedAssetCatalogV1(input: unknown, path: string): void {
  if (
    input &&
    typeof input === 'object' &&
    'version' in input &&
    (input as { version: unknown }).version !== 2
  ) {
    throw new Error(
      `Asset catalog "${path}" declares version ` +
        `${JSON.stringify((input as { version: unknown }).version)}. The v1 catalog format ` +
        '(`{ version: 1, assets: [...] }`) and its read-time migration ' +
        '(`migrateLegacyAssetCatalog`) were REMOVED — v2 (`{ version: 2, families: [...] }`) ' +
        'is the only format. Re-run `scripts/sync-asset-library.ts`, which writes v2 directly.',
    );
  }
}

function normalizeFamilyName(name: string): string {
  return name
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ')
    .replace(/\s+\(final\)$/, '');
}

/**
 * Generator-only semantic key. It is persisted as an explicit family id in v2;
 * search/preview code never reconstructs it. Collection segments prevent two
 * unrelated packs with the same display name from aliasing.
 */
export function catalogFamilyKey(asset: CatalogRecord): string {
  const segments = asset.files[0]!.path.replaceAll('\\', '/').split('/');
  return JSON.stringify([
    asset.source,
    segments[1] ?? '',
    segments[2] ?? '',
    normalizeFamilyName(asset.name),
  ]);
}

export function makeCatalogFamilyId(key: string): string {
  return createHash('sha256').update(`family\0${key}`).digest('hex').slice(0, 24);
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function familyType(records: readonly CatalogRecord[]): AssetFamily['type'] {
  if (records.some((record) => record.type === 'model')) return 'model';
  if (records.some((record) => record.type === 'animation')) return 'animation';
  return 'source';
}

function variantFromRecord(record: CatalogRecord): AssetVariant {
  return {
    id: record.id,
    label: record.files.map((file) => file.label).join(' + '),
    type: record.type,
    files: record.files,
    deliveries: [
      {
        id: `local:${record.id}`,
        kind: 'local-ssd',
        available: true,
        fileIndexes: record.files.map((_, index) => index),
      },
    ],
    thumbnail: {
      path: record.thumbnail ?? `thumbnails/${record.id}.webp`,
      state: 'generated',
      profileVersion: 'thumbnail-v1',
    },
    ...(record.animationCount !== undefined ? { animationCount: record.animationCount } : {}),
    ...(record.clipNames !== undefined ? { clipNames: record.clipNames } : {}),
  };
}

export function buildAssetCatalogV2(
  records: readonly CatalogRecord[],
  generatedAt: string,
): AssetCatalog {
  const grouped = new Map<string, CatalogRecord[]>();
  for (const record of records) {
    const key = catalogFamilyKey(record);
    const siblings = grouped.get(key);
    if (siblings) siblings.push(record);
    else grouped.set(key, [record]);
  }

  const seenFamilyIds = new Map<string, string>();
  const seenVariantIds = new Set<string>();
  const families: AssetFamily[] = [];
  for (const [key, siblings] of grouped) {
    siblings.sort((left, right) => left.id.localeCompare(right.id));
    const first = siblings[0]!;
    const id = makeCatalogFamilyId(key);
    const priorKey = seenFamilyIds.get(id);
    if (priorKey && priorKey !== key) throw new Error(`Catalog family id collision: ${id}`);
    seenFamilyIds.set(id, key);
    for (const sibling of siblings) {
      if (seenVariantIds.has(sibling.id))
        throw new Error(`Duplicate catalog variant id: ${sibling.id}`);
      seenVariantIds.add(sibling.id);
    }
    families.push({
      id,
      source: first.source,
      name: first.name.replace(/\s+\(final\)$/, ''),
      type: familyType(siblings),
      categories: uniqueSorted(siblings.flatMap((record) => record.categories)),
      tags: uniqueSorted(siblings.flatMap((record) => record.tags)),
      license: first.license,
      author: first.author,
      sourceUrl: first.sourceUrl,
      variants: siblings.map(variantFromRecord),
    });
  }
  families.sort(
    (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
  return parseAssetCatalog({ version: 2, generatedAt, families });
}

export function serializableAssetCatalog(catalog: AssetCatalog): object {
  return { version: 2, generatedAt: catalog.generatedAt, families: catalog.families };
}
