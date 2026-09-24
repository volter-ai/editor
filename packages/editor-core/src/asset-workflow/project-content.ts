/**
 * WHAT THE CONTENT BROWSER SHOWS: the project's asset rows, their media
 * facets, spritesheet expansion, and the orderings the gallery sorts by — plus
 * the shapes the panel and its siblings type against.
 *
 * ITS OTHER HALF IS `project-source-index.ts`, and the split is load-bearing:
 * this module is in the shell's EAGER closure (the Content panel is a static
 * workspace panel), while indexing a project's own TSX for components and
 * regions is TypeScript-AST work nothing at boot asks for. Keeping the two
 * apart is what stops one panel's five presentation helpers from carrying
 * the source-authoring integration's JSX transform and the five R3F prop-contract bindings into
 * every editor boot — measured at EIGHT files, 2026-09-18. Add a discovery
 * function to the index file; add a row-shaping one here.
 *
 * The one edge back is `import type { ProjectComponentEntry }`, which is
 * erased at build and costs no closure. Never make it a value import.
 */

import type { R3fComponentContract } from '@volter/editor-sdk/source-authoring';
import { assetCapabilities } from '@volter/editor-sdk/kit/asset-capabilities';
import {
  parsePixiSpritesheet,
  sheetVariantsFor,
  spritesheetFamilyKey,
  spritesheetResolutionRank,
} from './pixi-spritesheet';
import { ASSET_ROOTS, type AssetRootId } from '@volter/editor-sdk/kit/project-asset-roots';

export interface ProjectComponentEntry {
  name: string;
  /** Project-root-relative source file. */
  path: string;
  line: number;
  exported: boolean;
  defaultExport: boolean;
  /** Declared in a manifest root's own source module. This is an intent
   * signal for file-local scene-building components without relying on a
   * conventional filename or directory layout. */
  declaredInRootEntry: boolean;
  /** Static JSX uses of this definition in its own module. Root-entry locals
   * need repeated/collection use as evidence that they are a reusable scene
   * building block rather than one-off composition machinery. */
  sourceUseCount: number;
  sourceCollectionUse: boolean;
  surface: 'three' | 'canvas' | 'dom' | 'unknown';
  /** Inline SVG components are image assets, not general UI components. */
  contentKind?: 'component' | 'image';
  contract: R3fComponentContract;
}

export interface ProjectContentSpritesheetFrame {
  readonly sheetPath: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotated: boolean;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly trimX: number;
  readonly trimY: number;
}

export interface ProjectContentAsset {
  /** Root-relative asset path (the root is {@link ProjectContentAsset.root}). */
  path: string;
  /** Which project asset root this row was listed from. `public` ships with the
   *  game; `references` is reference material the project keeps and no export
   *  copies — see `project-asset-roots.ts`. */
  root: AssetRootId;
  entry: ProjectContentAssetEntry;
  /** Present when this row is one frame of a Pixi/TexturePacker sheet. */
  spritesheet?: ProjectContentSpritesheetFrame;
}

export interface ProjectContentAssetEntry {
  name: string;
  type: 'file' | 'directory';
  /** Bytes, when the backend reports it. ABSENT means unmeasured — not zero. */
  size?: number;
  /** Epoch ms, when the backend reports it. ABSENT means unmeasured — not 1970. */
  modifiedAt?: number;
}

/** An asset medium, the component chip, or an OPEN document kind
 *  (ARCHITECTURE-CORE §The project model) — never a closed list. */
export type ProjectContentFacet = string;

/**
 * Flatten every project asset root for the semantic Content view. Browse Files
 * keeps using shallow listings and folder navigation.
 *
 * Both roots are walked the same way and their rows differ only by the `root`
 * they carry: reference media is ORDINARY FILES in the project, so it is
 * indexed by listing the directory, never by a side database or an import step.
 * A project with no `references/` folder simply contributes nothing — an absent
 * root lists empty (the server route's own rule), it does not fail.
 *
 * `failedListings` is returned beside the assets rather than folded into them:
 * a directory whose listing FAILED contributes nothing, exactly like an empty
 * one, and without this count the gallery cannot tell "the project has no
 * content" from "we could not read it".
 */
export async function collectProjectContentAssets(
  list: (
    root: string,
    directory: string,
  ) => Promise<{ ok: true; entries: ProjectContentAssetEntry[] } | { ok: false; reason: string }>,
  roots: readonly AssetRootId[] = ASSET_ROOTS,
): Promise<{ assets: ProjectContentAsset[]; failedListings: string[] }> {
  const walked = await Promise.all(roots.map((root) => collectAssetRoot(list, root)));
  return {
    assets: walked.flatMap((result) => result.assets),
    failedListings: walked.flatMap((result) => result.failedListings),
  };
}

async function collectAssetRoot(
  list: (
    root: string,
    directory: string,
  ) => Promise<{ ok: true; entries: ProjectContentAssetEntry[] } | { ok: false; reason: string }>,
  root: AssetRootId,
): Promise<{ assets: ProjectContentAsset[]; failedListings: string[] }> {
  const pending = [''];
  const assets: ProjectContentAsset[] = [];
  const failedListings: string[] = [];
  let listings = 0;
  while (pending.length > 0 && listings < 512) {
    const batch = pending.splice(0, 8);
    const results = await Promise.all(batch.map((directory) => list(root, directory)));
    listings += batch.length;
    results.forEach((result, index) => {
      const directory = batch[index]!;
      if (!result.ok) {
        failedListings.push(`${root}/${directory}: ${result.reason}`);
        return;
      }
      for (const entry of result.entries) {
        const path = directory ? `${directory}/${entry.name}` : entry.name;
        if (entry.type === 'directory') pending.push(path);
        else assets.push({ path, root, entry });
      }
    });
  }
  return { assets, failedListings };
}

/**
 * Replace packed atlas pages with the frames the game actually names.
 * Sidecars (`image.png.json`) are Pixi's spritesheet document; the PNG is
 * only the page. Resolution variants (`@0.5x`) of the same family collapse
 * to the preferred sidecar.
 *
 * SHIPPED ASSETS ONLY. An atlas is a thing the game loads, so this reads the
 * `public` root and leaves every other root's rows exactly as listed — a
 * reference `.json` beside a reference `.png` is two files someone put there,
 * not a sheet to unpack, and unpacking it would hide both behind frames that
 * name a sheet no game reads.
 */
export async function expandSpritesheetContentAssets(
  assets: readonly ProjectContentAsset[],
  readText: (path: string) => Promise<string | null>,
): Promise<ProjectContentAsset[]> {
  const shipped = assets.filter((asset) => asset.root === 'public');
  const preferred = preferredSpritesheetSidecars(shipped);
  const sheets = (
    await Promise.all(
      preferred.map(async (sidecar) => {
        const source = await readText(sidecar.path);
        if (!source) return null;
        const parsed = parsePixiSpritesheet(source);
        if (!parsed) return null;
        return { sidecar, parsed };
      }),
    )
  ).flatMap((entry) => (entry ? [entry] : []));

  const hidden = new Set<string>();
  for (const { sidecar, parsed } of sheets) {
    hidden.add(sidecar.path);
    const dir = parentDir(sidecar.path);
    for (const variant of sheetVariantsFor(parsed.image)) {
      hidden.add(dir ? `${dir}/${variant}` : variant);
    }
    for (const asset of shipped) {
      if (spritesheetFamilyKey(asset.path) === spritesheetFamilyKey(sidecar.path)) {
        hidden.add(asset.path);
      }
    }
  }

  const frames = sheets.flatMap(({ sidecar, parsed }) => {
    const dir = parentDir(sidecar.path);
    const sheetPath = dir ? `${dir}/${parsed.image}` : parsed.image;
    return parsed.frames.map((frame) => ({
      path: `${sheetPath}#${frame.name}`,
      root: sidecar.root,
      entry: {
        name: `${frame.name}.png`,
        type: 'file' as const,
        // The frame inherits the SHEET's measurements; when the sheet was not
        // measured, neither was the frame — it does not become 0 bytes here.
        ...(sidecar.entry.size === undefined ? {} : { size: sidecar.entry.size }),
        ...(sidecar.entry.modifiedAt === undefined ? {} : { modifiedAt: sidecar.entry.modifiedAt }),
      },
      spritesheet: {
        sheetPath,
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
        rotated: frame.rotated,
        sourceWidth: frame.sourceWidth,
        sourceHeight: frame.sourceHeight,
        trimX: frame.trimX,
        trimY: frame.trimY,
      },
    }));
  });

  // `hidden` holds PUBLIC paths, so the root is part of the test: a reference
  // file that happens to share a sheet's path is a different file.
  return [
    ...assets.filter((asset) => asset.root !== 'public' || !hidden.has(asset.path)),
    ...frames,
  ];
}

function preferredSpritesheetSidecars(
  assets: readonly ProjectContentAsset[],
): ProjectContentAsset[] {
  const best = new Map<string, ProjectContentAsset>();
  for (const asset of assets) {
    if (!/\.json$/i.test(asset.path)) continue;
    const key = spritesheetFamilyKey(asset.path);
    const current = best.get(key);
    if (
      !current ||
      spritesheetResolutionRank(asset.path) > spritesheetResolutionRank(current.path)
    ) {
      best.set(key, asset);
    }
  }
  return [...best.values()];
}

function parentDir(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

export function projectContentAssetFacet(name: string): ProjectContentFacet {
  const kind = assetCapabilities(name).kind;
  if (kind === 'model' || kind === 'image' || kind === 'video' || kind === 'audio') {
    return kind;
  }
  return 'other';
}

/** Lower values are more useful in the default gallery. */
export function projectContentAssetPriority(asset: ProjectContentAsset): number {
  const capability = assetCapabilities(asset.entry.name);
  if (capability.placeable && capability.runtimeReady) return 10;
  if (capability.kind === 'model' && capability.runtimeReady) return 15;
  if (capability.kind === 'prefab') return 25;
  if (capability.runtimeReady && (capability.kind === 'image' || capability.kind === 'audio')) {
    return 30;
  }
  if (capability.runtimeReady) return 40;
  if (capability.importable) return 70;
  return 90;
}

/** Lower values are more useful in the default Content gallery — a
 *  PRESENTATION rule, which is why it sits beside the gallery's other ordering
 *  helpers rather than with the discovery that produced the row. */
export function projectComponentPriority(component: ProjectComponentEntry): number {
  const surface =
    component.surface === 'three'
      ? 0
      : component.surface === 'canvas'
        ? 10
        : component.surface === 'dom'
          ? 20
          : 30;
  return surface + (component.exported ? 0 : 4);
}
