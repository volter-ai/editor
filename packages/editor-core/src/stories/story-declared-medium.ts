/**
 * A story's MEDIUM is a declaration, never a mount.
 *
 * ARCHITECTURE-CORE §Zero inference: the system answers a question by reading
 * a declaration, walking ground truth, or diagnosing declared-vs-measured
 * drift loudly. Mounting a story to guess whether it is a DOM / three /
 * canvas member is the third thing that section forbids.
 *
 * The ONE rung: **the story file's region** — `resolveFileRegion` over the
 * project's adapter `include` / `mounts` and the manifest root entries. Prefab
 * stories match the adapter's `src/prefabs` include glob because that glob is
 * an adapter-selected finder, not because a sibling file exists.
 *
 * Anything it cannot place is {@link DeclaredStoryMedium.via}
 * `'undeclared'` — a named gap, never a candidate on any board, never a
 * mount. Presence names it; board membership skips it.
 */

import type { ProjectRegionEntry } from '../asset-workflow/project-source-index';
import {
  type FileRegionAnswer,
  type RegionBinding,
  resolveFileRegion,
} from '../ui-source/file-region-resolver';

/** The three boards a declared story can belong to. */
export type StoryMedium = 'three' | 'canvas' | 'dom';

export type DeclaredStoryVia = 'declared-include' | 'root-entry' | 'undeclared';

export interface DeclaredStoryMedium {
  readonly medium?: StoryMedium;
  readonly via: DeclaredStoryVia;
  /** Set only when {@link DeclaredStoryVia} is `'undeclared'`. */
  readonly reason?: string;
}

function normalizeRelative(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\//, '');
}

function regionOfEntryLookup(
  regions: readonly ProjectRegionEntry[],
): (file: string) => RegionBinding | undefined {
  const byEntry = new Map<string, ProjectRegionEntry>();
  for (const region of regions) {
    if (region.entry) byEntry.set(normalizeRelative(region.entry), region);
  }
  return (file) => byEntry.get(normalizeRelative(file));
}

function resolvePath(
  projectRelative: string,
  regions: readonly ProjectRegionEntry[],
): FileRegionAnswer {
  const file = normalizeRelative(projectRelative);
  return resolveFileRegion({
    file,
    projectRelative: file,
    regions,
    regionOfEntry: regionOfEntryLookup(regions),
  });
}

function surfaceAsMedium(surface: FileRegionAnswer['surface']): StoryMedium | undefined {
  return surface === 'three' || surface === 'canvas' || surface === 'dom' ? surface : undefined;
}

function viaForAnswer(
  answer: FileRegionAnswer,
): Exclude<DeclaredStoryVia, 'undeclared'> | undefined {
  if (answer.via === 'declared-include') return 'declared-include';
  if (answer.via === 'root-entry') return 'root-entry';
  return undefined;
}

/**
 * Read the declared medium of one story. Pure: regions and the CSF identity
 * are the only inputs. Does not import, compose, or mount anything.
 */
export function declaredStoryMedium(input: {
  readonly modulePath?: string | undefined;
  readonly regions?: readonly ProjectRegionEntry[] | undefined;
}): DeclaredStoryMedium {
  const regions = input.regions ?? [];
  const modulePath = input.modulePath ? normalizeRelative(input.modulePath) : '';
  if (!modulePath) {
    return { via: 'undeclared', reason: 'story has no module path' };
  }

  const own = resolvePath(modulePath, regions);
  const ownMedium = surfaceAsMedium(own.surface);
  const ownVia = viaForAnswer(own);
  if (ownMedium && ownVia) return { medium: ownMedium, via: ownVia };

  return {
    via: 'undeclared',
    reason: `${modulePath} is not named by a region include/mount and is not a manifest root entry`,
  };
}

const reportedUndeclared = new Set<string>();

/** Name an undeclared story once. Nothing may mount it to guess a medium. */
export function reportUndeclaredStoryMedium(modulePath: string, reason?: string): void {
  const key = normalizeRelative(modulePath);
  if (reportedUndeclared.has(key)) return;
  reportedUndeclared.add(key);
  // biome-ignore lint/suspicious/noConsole: declared-vs-measured gap — the doctrine's third arm, same instrument as reportUnreadableRegions.
  console.warn(
    `[story-media] ${key} has no declared medium` +
      (reason ? ` — ${reason}` : '') +
      '. It is not a candidate on any board. Declare it via ' +
      '`vgai.adapter.ts` regionIncludes or a manifest root entry.',
  );
}

/** Forget which gaps have already been named — project switch, or a test. */
export function resetUndeclaredStoryMediumReports(): void {
  reportedUndeclared.clear();
}

/** Test-only alias. */
export function __resetUndeclaredStoryMediumReportsForTest(): void {
  resetUndeclaredStoryMediumReports();
}
