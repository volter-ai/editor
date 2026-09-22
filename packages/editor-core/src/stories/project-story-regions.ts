/**
 * The open project's regions, as story classification reads them.
 *
 * Filled from `/__editor/story-files` (the same fetch that lists CSF modules)
 * so presence and board membership answer from the adapter + manifest the
 * server already read, not from a second walk. Tests inject a table directly.
 */

import type { ProjectRegionEntry } from '../asset-workflow/project-source-index';

let _regions: readonly ProjectRegionEntry[] = [];

export function getProjectStoryRegions(): readonly ProjectRegionEntry[] {
  return _regions;
}

export function setProjectStoryRegions(regions: readonly ProjectRegionEntry[]): void {
  _regions = regions;
}

/** Test-only. */
export function __resetProjectStoryRegionsForTest(): void {
  _regions = [];
}
