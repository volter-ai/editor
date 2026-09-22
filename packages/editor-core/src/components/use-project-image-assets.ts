/**
 * The project's own IMAGE assets, for the inspector's `asset` slots.
 *
 * This is the existing asset-workflow seam and nothing new: the same
 * `listAssets` walk over `public/` that the Asset Browser's Content gallery
 * runs (`collectProjectContentAssets`), narrowed with the same facet
 * classifier (`projectContentAssetFacet`). A texture slot must offer the same
 * files the Asset Browser shows, so it reads them from the same place rather
 * than growing a second listing.
 *
 * ONE scan is shared by every slot on screen — a `MeshStandardMaterial`
 * publishes six of them, and six independent walks of `public/` per selection
 * is the kind of quiet cost a panel never recovers from. The cached scan
 * expires so an asset imported mid-session shows up on the next selection
 * without a reload; the Asset Browser is still the surface that IMPORTS.
 */

import { useEffect, useState } from 'react';
import {
  collectProjectContentAssets,
  projectContentAssetFacet,
} from '../asset-workflow/project-content';
import { listAssets } from '../editor-api';

/** How long a scan is reused. Long enough to cover one selection's worth of
 *  slots mounting together, short enough that a just-imported texture appears
 *  without a reload. */
const CACHE_MS = 10_000;

export interface ProjectImageAssets {
  /** Public-root-relative paths, sorted. */
  readonly paths: readonly string[];
  /** Directories whose listing FAILED — an empty picker over a failed scan
   *  would tell the author their project has no textures. */
  readonly failures: readonly string[];
}

const EMPTY: ProjectImageAssets = { paths: [], failures: [] };

let cached: { at: number; scan: Promise<ProjectImageAssets> } | null = null;

async function scanProjectImageAssets(): Promise<ProjectImageAssets> {
  // SHIPPED IMAGES ONLY. A material slot names a file the GAME loads at
  // runtime, and reference material is never exported — offering a moodboard
  // plate here would author a texture path that 404s in the built game.
  const listed = await collectProjectContentAssets(listAssets, ['public']);
  return {
    paths: listed.assets
      .filter((asset) => projectContentAssetFacet(asset.entry.name) === 'image')
      .map((asset) => asset.path)
      .sort((a, b) => a.localeCompare(b)),
    failures: listed.failedListings,
  };
}

/** The shared scan, refreshed when the cached one has expired. */
export function projectImageAssets(): Promise<ProjectImageAssets> {
  const now = Date.now();
  if (!cached || now - cached.at > CACHE_MS) {
    cached = {
      at: now,
      scan: scanProjectImageAssets().catch((error: unknown) => {
        cached = null;
        return { paths: [], failures: [error instanceof Error ? error.message : String(error)] };
      }),
    };
  }
  return cached.scan;
}

/** Read the shared scan into a component. `enabled: false` skips it entirely,
 *  so a panel with no asset row never walks `public/`. */
export function useProjectImageAssets(enabled: boolean): ProjectImageAssets {
  const [assets, setAssets] = useState<ProjectImageAssets>(EMPTY);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void projectImageAssets().then((next) => {
      if (live) setAssets(next);
    });
    return () => {
      live = false;
    };
  }, [enabled]);
  return assets;
}
