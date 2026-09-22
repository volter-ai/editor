/**
 * Launcher settings — the small set of preferences that belong to the PERSON,
 * not to any one project, and therefore cannot live in a project's
 * `vgai.project.json` (unit G5).
 *
 * Today that is exactly one preference: "Reopen last project on launch". It is
 * stored next to the recents list in `~/.vgai/`, because the two are the same
 * kind of state — launcher memory, machine-local, survives every project — and
 * splitting them across two homes would be arbitrary.
 *
 * Deliberately NOT a general settings system. Fields land here only when a
 * preference is genuinely user-global; anything project-scoped belongs in the
 * manifest or the workspace layout that already persists per project. Unknown
 * keys in the file are preserved on write so a newer editor's settings survive
 * a round-trip through an older one.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface LauncherSettings {
  /** UE's "Always load last project on startup". Default OFF — see
   *  `boot-routing.ts` for why the front door is not silently skipped. */
  reopenLastProject: boolean;
}

export const DEFAULT_LAUNCHER_SETTINGS: LauncherSettings = {
  reopenLastProject: false,
};

export const LAUNCHER_SETTINGS_PATH = join(homedir(), '.vgai', 'launcher.json');

/**
 * Project a raw parsed file onto the settings shape.
 *
 * Anti-shim: a malformed or missing field falls back to its DOCUMENTED default
 * rather than being invented or guessed from neighbouring state. A corrupt file
 * therefore degrades to "the defaults", never to a half-applied mix — and
 * never throws, because a launcher that refuses to boot over a bad preferences
 * file is a worse failure than one that boots with defaults.
 */
export function projectLauncherSettings(raw: unknown): LauncherSettings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_LAUNCHER_SETTINGS };
  const record = raw as Record<string, unknown>;
  return {
    reopenLastProject:
      typeof record['reopenLastProject'] === 'boolean'
        ? record['reopenLastProject']
        : DEFAULT_LAUNCHER_SETTINGS.reopenLastProject,
  };
}

export async function loadLauncherSettings(
  path = LAUNCHER_SETTINGS_PATH,
): Promise<LauncherSettings> {
  try {
    return projectLauncherSettings(JSON.parse(await readFile(path, 'utf-8')));
  } catch {
    return { ...DEFAULT_LAUNCHER_SETTINGS };
  }
}

/**
 * Merge a partial update over what is on disk and write it back, preserving any
 * keys this build does not know about (forward compatibility — an older editor
 * must not silently drop a newer one's preference).
 */
export async function saveLauncherSettings(
  update: Partial<LauncherSettings>,
  path = LAUNCHER_SETTINGS_PATH,
): Promise<LauncherSettings> {
  let existing: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf-8'));
    if (typeof parsed === 'object' && parsed !== null) existing = parsed as Record<string, unknown>;
  } catch {
    // No file yet, or unreadable — the merge base is simply empty.
  }
  const merged = { ...existing, ...update };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8');
  return projectLauncherSettings(merged);
}
