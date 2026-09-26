/**
 * Asset packs — `asset-manifest.json` (D-AP1) and the pure sync/check planner
 * behind `npm run asset-packs:sync` (D-AP2)..
 *
 * A PACK is a named list of `{ key, dest }`: library asset keys and the
 * project-relative paths their bytes are copied to. It is an INPUT TO
 * MATERIALIZATION, never a runtime concept — nothing in a running game or a
 * scaffolded project resolves a pack. It is deliberately NOT a `vgai.project.json`
 * field: the manifest says what a project IS, a pack says how its reference
 * material was PRODUCED.
 *
 * The file lives beside `vgai.project.json` in `packages/editor/template/` and each
 * `examples/<id>/`. A scaffolded user project does not carry it; its record is
 * the ledger (`asset-ledger.ts`, D-AP3).
 *
 * The binaries stay COMMITTED — creating a project must work offline and CI must stay
 * hermetic (D-AP2/D-AP6). What the pack adds is that they are now GENERATED: the
 * library is the origin, and `--check` re-verifies the committed bytes against
 * the library's own `sourceHash` without touching the network.
 *
 * On KEYS: a key is `source:id`, the same identity as `onlineAssetKey`. For the
 * SSD/cloud catalog the source name is `local`, and the id is a VARIANT id
 * (`local:a7c5288306d9e98cb7dbdbd2`), not a family id — a family has several
 * format variants, so only the variant pins bytes. `findLocalAsset` /
 * `findCloudAsset` both resolve variant ids, so this is an ordinary library key.
 */

import { z } from 'zod';

export const AssetPackEntrySchema = z
  .object({
    /** `source:id` — the library's identity for the asset (variant-precise). */
    key: z.string().regex(/^[^:]+:.+$/, 'An asset key must be "source:id"'),
    /** Project-relative destination for the asset's main file. */
    dest: z.string().min(1),
    /**
     * The PIN: sha256 of the bytes this entry declares, bare lowercase hex.
     *
     * Required, and the reason is trust-on-first-use. A materializer that
     * learns the expected digest from the same response that delivers the
     * bytes has authenticated nothing on the first fetch — a bad or moved
     * answer is self-consistent, gets written, and its digest becomes the
     * project's permanent `sourceHash` in the ledger. A pin is a CHECKED-IN
     * fact reviewed in a diff, so the first fetch is verified like every
     * later one. `asset-packs:sync --check` cross-checks it against
     * `catalog/cloud/manifest.json` (hermetic — both sides are repo files),
     * and `asset-pack-manifest.test.ts` asserts no in-repo pin was invented.
     */
    sha256: z
      .string()
      .regex(
        /^[a-f0-9]{64}$/,
        'A pack entry must pin the sha256 of its bytes as 64 lowercase hex digits',
      ),
  })
  .strict();

export const AssetPackManifestSchema = z
  .object({
    packs: z.record(z.string().min(1), z.array(AssetPackEntrySchema)),
  })
  .strict();

export type AssetPackEntry = z.infer<typeof AssetPackEntrySchema>;
export type AssetPackManifest = z.infer<typeof AssetPackManifestSchema>;

/** Parse an `asset-manifest.json`. Throws loudly — a half-read pack
 *  declaration would silently stop guarding the files it dropped. */
export function parseAssetPackManifest(input: unknown): AssetPackManifest {
  return AssetPackManifestSchema.parse(input);
}

export interface FlattenedPackEntry extends AssetPackEntry {
  readonly pack: string;
}

/** Flatten every pack to a single entry list, rejecting two packs that claim
 *  the same destination (whichever ran last would silently win). */
export function flattenAssetPacks(manifest: AssetPackManifest): FlattenedPackEntry[] {
  const flattened: FlattenedPackEntry[] = [];
  const byDest = new Map<string, string>();
  for (const [pack, entries] of Object.entries(manifest.packs)) {
    for (const entry of entries) {
      const owner = byDest.get(entry.dest);
      if (owner !== undefined) {
        throw new Error(
          `Two packs declare the same destination "${entry.dest}": "${owner}" and "${pack}".`,
        );
      }
      byDest.set(entry.dest, pack);
      flattened.push({ ...entry, pack });
    }
  }
  return flattened;
}

/**
 * Build the library index `planAssetPackSync` needs from a parsed
 * `catalog/cloud/manifest.json`.
 *
 * That file has TWO shapes on disk and both are live. v1 is a flat `assets`
 * array; v2 is the canonical `families` graph whose `variants` are the assets
 * (a family holds several format variants, and only a variant pins bytes).
 * The checked-in snapshot is still v1 while `scripts/cloud-asset-library.ts`
 * already emits v2, so the FIRST regeneration of that file — which ingesting
 * anything into the library requires — flips the shape under this reader.
 * `packages/cloud-asset-library/src/worker.ts` accepts both for exactly this
 * reason; so does this. A reader that understood only the shape it happened to
 * be born with would turn `asset-packs:sync --check` red on a correct tree.
 *
 * Throws on anything else rather than returning an empty index: an index that
 * silently came back empty would report every declared asset as an unknown key.
 */
export function libraryIndexFromCloudManifest(
  manifest: unknown,
  source: string,
): Map<string, LibraryAsset> {
  const root = manifest as {
    version?: unknown;
    assets?: unknown;
    families?: unknown;
  } | null;
  const flat = Array.isArray(root?.families)
    ? (root.families as ManifestFamily[]).flatMap((family) =>
        (family.variants ?? []).map((variant) => ({ ...family, ...variant })),
      )
    : Array.isArray(root?.assets)
      ? (root.assets as ManifestAsset[])
      : null;
  if (!flat) {
    throw new Error(
      'A cloud asset manifest must have a v1 "assets" array or a v2 "families" array; ' +
        `this one has neither (version ${JSON.stringify(root?.version)}).`,
    );
  }

  const index = new Map<string, LibraryAsset>();
  for (const asset of flat) {
    const file = asset.files?.[0];
    if (!file) continue;
    const key = `${source}:${asset.id}`;
    index.set(key, {
      key,
      name: asset.name,
      license: asset.license,
      sourceSha256: file.main.sha256,
      sizeBytes: file.main.sizeBytes,
      relativePath: file.main.relativePath,
      dependencyCount: file.dependencies.length,
    });
  }
  return index;
}

interface ManifestObject {
  sha256: string;
  sizeBytes: number;
  relativePath: string;
}
interface ManifestAsset {
  id: string;
  name: string;
  license: string;
  files?: { main: ManifestObject; dependencies: ManifestObject[] }[];
}
interface ManifestFamily extends Omit<ManifestAsset, 'id' | 'files'> {
  variants?: Omit<ManifestAsset, 'name' | 'license'>[];
}

/** One asset as the LIBRARY describes it — the only source of `sourceSha256`. */
export interface LibraryAsset {
  readonly key: string;
  readonly name: string;
  readonly license: string;
  readonly sourceSha256: string;
  readonly sizeBytes: number;
  /** The library's own filename for the main file. */
  readonly relativePath: string;
  /** Sibling files the main file needs. See `unsupported-dependencies` below. */
  readonly dependencyCount: number;
}

export type AssetPackDecision =
  /** Committed bytes are the library's bytes. Nothing to do. */
  | { readonly status: 'match'; readonly entry: FlattenedPackEntry }
  /** Declared but not committed — materialize it. */
  | { readonly status: 'missing'; readonly entry: FlattenedPackEntry; readonly asset: LibraryAsset }
  /** Committed but not the library's bytes — hand-edited, or the library moved. */
  | {
      readonly status: 'stale';
      readonly entry: FlattenedPackEntry;
      readonly asset: LibraryAsset;
      readonly committedSha256: string;
    }
  /** The key names nothing in the library. Never guessed around. */
  | { readonly status: 'unresolved-key'; readonly entry: FlattenedPackEntry }
  /**
   * The declaration's pin and the library index disagree about the asset's
   * bytes. Two independent CHECKED-IN facts contradict each other, so neither
   * can be assumed: copying library bytes would silently overrule a reviewed
   * pin, and trusting the pin would hide a library that moved. A human
   * resolves it; sync never does.
   */
  | {
      readonly status: 'pin-mismatch';
      readonly entry: FlattenedPackEntry;
      readonly asset: LibraryAsset;
    }
  /** Multi-file assets are not expressible as one `dest`; refuse rather than
   *  silently drop the siblings the main file needs. */
  | {
      readonly status: 'unsupported-dependencies';
      readonly entry: FlattenedPackEntry;
      readonly asset: LibraryAsset;
    };

export interface AssetPackSyncInputs {
  /** Library index by `source:id`. */
  readonly library: ReadonlyMap<string, LibraryAsset>;
  /** sha256 of each declared dest as committed, or null when absent. */
  readonly committed: ReadonlyMap<string, string | null>;
}

/**
 * Decide what each declared entry needs. Pure: the caller supplies the library
 * index and the committed hashes, so this is testable without fs or network.
 */
export function planAssetPackSync(
  entries: readonly FlattenedPackEntry[],
  inputs: AssetPackSyncInputs,
): AssetPackDecision[] {
  return entries.map((entry) => {
    const asset = inputs.library.get(entry.key);
    if (!asset) return { status: 'unresolved-key', entry } as const;
    if (asset.dependencyCount > 0) {
      return { status: 'unsupported-dependencies', entry, asset } as const;
    }
    // The pin is checked BEFORE anything about the committed copy: while the
    // two checked-in facts disagree there is no defensible expected digest to
    // judge the copy against.
    if (entry.sha256 !== asset.sourceSha256) {
      return { status: 'pin-mismatch', entry, asset } as const;
    }
    const committedSha256 = inputs.committed.get(entry.dest) ?? null;
    if (committedSha256 === null) return { status: 'missing', entry, asset } as const;
    return committedSha256 === entry.sha256
      ? ({ status: 'match', entry } as const)
      : ({ status: 'stale', entry, asset, committedSha256 } as const);
  });
}

/** Decisions `--check` must fail on. A `missing`/`stale` copy means the
 *  committed tree no longer matches what the library says it is. */
export function assetPackCheckFailures(
  decisions: readonly AssetPackDecision[],
): AssetPackDecision[] {
  return decisions.filter((decision) => decision.status !== 'match');
}

/**
 * Decisions sync can NEITHER accept nor repair — it must stop on them.
 *
 * Derived, not hand-listed: anything that is not already correct (`match`) and
 * is not a work item is by definition a refusal. The hand-written version of
 * this list silently omitted `pin-mismatch` the day that status was added, and
 * the consequence was not a missed error but a FABRICATED one — sync would
 * have gone on to record a `sourceHash` for bytes it never fetched or
 * verified, which is exactly what the anti-shim rule forbids.
 */
export function assetPackBlockingDecisions(
  decisions: readonly AssetPackDecision[],
): AssetPackDecision[] {
  const repairable = new Set<AssetPackDecision>(assetPackWorkItems(decisions));
  return decisions.filter((decision) => decision.status !== 'match' && !repairable.has(decision));
}

/** Decisions `assets:sync` can fix by copying library bytes in. */
export function assetPackWorkItems(
  decisions: readonly AssetPackDecision[],
): Extract<AssetPackDecision, { status: 'missing' | 'stale' }>[] {
  return decisions.flatMap((decision) =>
    decision.status === 'missing' || decision.status === 'stale' ? [decision] : [],
  );
}

/** One line explaining a decision, for both `--check` failures and sync logs. */
export function describeAssetPackDecision(decision: AssetPackDecision): string {
  const where = `${decision.entry.dest} (pack "${decision.entry.pack}", key ${decision.entry.key})`;
  switch (decision.status) {
    case 'match':
      return `ok        ${where}`;
    case 'missing':
      return `MISSING   ${where} — declared but not committed`;
    case 'stale':
      return (
        `STALE     ${where} — committed bytes are sha256:${decision.committedSha256.slice(0, 12)}…, ` +
        `the library has sha256:${decision.asset.sourceSha256.slice(0, 12)}… ` +
        '(either the copy was hand-edited or the library moved)'
      );
    case 'unresolved-key':
      return `UNKNOWN   ${where} — no such asset in the library index`;
    case 'pin-mismatch':
      return (
        `PIN       ${where} — the declaration pins sha256:${decision.entry.sha256.slice(0, 12)}… ` +
        `but the library index says sha256:${decision.asset.sourceSha256.slice(0, 12)}… ` +
        '(re-pin the declaration only after confirming the library moved deliberately; ' +
        'nothing is fetched or copied while these disagree)'
      );
    case 'unsupported-dependencies':
      return (
        `MULTIFILE ${where} — the library asset has ${decision.asset.dependencyCount} ` +
        'dependency file(s); a pack entry declares exactly one destination file'
      );
  }
}

/** Where a project declares its library asset packs. Lives here, beside the
 *  manifest's shape, so a reader of the PATH (the seed) does not carry the
 *  materializer (the cloud client, the ledger, its locks). */
export const ASSET_MANIFEST_PATH = 'asset-manifest.json';
