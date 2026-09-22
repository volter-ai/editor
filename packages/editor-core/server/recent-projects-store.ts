/**
 * The launcher's recent-projects list (`~/.vgai/recent-projects.json`) and the
 * slug rule every project-derived filename shares.
 *
 * User-global, not project state: a session that is nobody's launcher does not
 * write here at all (`recordsRecentProjects`).
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { canonicalProjectRoot } from './canonical-path';
import { readProjectView } from './project-view';

interface RecentProject {
  name: string;
  path: string;
  lastOpened: string;
  thumbnail?: string;
}

export const RECENT_PROJECTS_PATH = join(homedir(), '.vgai', 'recent-projects.json');
const MAX_RECENT_PROJECTS = 20;

export async function loadRecentProjects(path = RECENT_PROJECTS_PATH): Promise<RecentProject[]> {
  try {
    const raw = await readFile(path, 'utf-8');
    const projects = JSON.parse(raw) as RecentProject[];
    // Filter out projects whose paths no longer exist, populate thumbnails
    const valid: RecentProject[] = [];
    const seen = new Set<string>();
    for (const p of projects) {
      const canonicalPath = canonicalProjectRoot(p.path);
      if (seen.has(canonicalPath)) continue;
      // A folder with a valid v2 manifest is a project; readProjectView is
      // the one place this rule lives.
      const view = await readProjectView(canonicalPath);
      if (!view) continue; // Path no longer exists / neither file describes it — skip
      seen.add(canonicalPath);
      // Check for thumbnail
      try {
        await stat(join(canonicalPath, '.vgai', 'thumbnail.png'));
        p.thumbnail = `/__editor/project-thumbnail?path=${encodeURIComponent(canonicalPath)}`;
      } catch {
        delete p.thumbnail;
      }
      valid.push({ ...p, path: canonicalPath });
    }
    return valid;
  } catch {
    return [];
  }
}

export async function saveRecentProjects(
  projects: RecentProject[],
  path = RECENT_PROJECTS_PATH,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(projects, null, 2), 'utf-8');
}

export async function addToRecentProjects(
  name: string,
  projectPath: string,
  path = RECENT_PROJECTS_PATH,
): Promise<void> {
  const canonicalPath = canonicalProjectRoot(projectPath);
  const projects = await loadRecentProjects(path);
  // Remove existing entry for this path
  const filtered = projects.filter((p) => p.path !== canonicalPath);
  // Add at the front
  filtered.unshift({ name, path: canonicalPath, lastOpened: new Date().toISOString() });
  // Trim to max
  await saveRecentProjects(filtered.slice(0, MAX_RECENT_PROJECTS), path);
}

// The naming scheme moved to `src/play-log/log-naming.ts` so the browser
// tier mints byte-identical filenames; re-exported here for the existing
// server importers.
export { playLogFilename, playRunSlug, slugify } from './support/project/log-naming';

/**
 * How long a coding agent stays the attributed author of host filesystem
 * writes after its turn was last OBSERVED running.
 *
 * This is a LEASE, not a latch. The window used to be opened with
 * `Number.POSITIVE_INFINITY` and closed only by the matching turn-ended
 * observation, so a harness that died mid-turn — crash, kill, closed terminal —
 * left every later host write in the project credited forever to an agent that
 * was no longer there. The lease is renewed by each FRESH harness snapshot that
 * still reports a running turn (`syncHarnessParticipant`), which is precisely
 * the signal a dead harness stops producing. It is deliberately NOT renewed
 * from a cached snapshot on a timer: the last snapshot of a dead harness still
 * says `running`, so a poller reading it would renew forever and reinstate the
 * bug the lease exists to kill.
 */
export const AGENT_AUTHOR_LEASE_MS = 60_000;
