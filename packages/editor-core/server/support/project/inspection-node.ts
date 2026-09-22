/** Node filesystem binding for the shared, read-only project inspector. */

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { resolveManifestPath } from '@volter/editor-project/manifest/locate';
import {
  createIngestManifest,
  inspectProject,
  type ProjectInspection,
  type ProjectInspectionReader,
  type SuggestedAdapterSurface,
} from '@volter/editor-project/inspection';
import { resolveProjectPath } from './shared.js';

export type { SuggestedAdapterSurface } from '@volter/editor-project/inspection';

export function nodeProjectInspectionReader(root: string): ProjectInspectionReader {
  return {
    async exists(path) {
      try {
        await stat(resolveProjectPath(root, path));
        return true;
      } catch {
        return false;
      }
    },
    read(path) {
      return readFile(resolveProjectPath(root, path), 'utf-8');
    },
    async list(path) {
      const entries = await readdir(resolveProjectPath(root, path), { withFileTypes: true });
      return entries
        .filter((entry) => !entry.isSymbolicLink())
        .map((entry) => ({
          name: entry.name,
          path: path ? `${path.replace(/\\/g, '/')}/${entry.name}` : entry.name,
          type: entry.isDirectory() ? ('dir' as const) : ('file' as const),
        }));
    },
  };
}

export async function inspectProjectFolderPath(path: string): Promise<{
  path: string;
  report: ProjectInspection;
}> {
  const root = resolve(path);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) throw new Error(`Project path is not a directory: ${root}`);
  return { path: root, report: await inspectProject(nodeProjectInspectionReader(root)) };
}

export async function adaptProjectFolderPath(
  path: string,
  options: {
    engineVersion: string;
    surface?: SuggestedAdapterSurface | undefined;
    entry?: string | undefined;
  },
): Promise<{ path: string; writes: ['vgai.project.json']; manifest: Record<string, unknown> }> {
  const preview = await previewAdaptProjectFolderPath(path, options);
  await writeFile(
    resolveManifestPath(preview.path),
    `${JSON.stringify(preview.manifest, null, 2)}\n`,
    {
      encoding: 'utf-8',
      flag: 'wx',
    },
  );
  return { path: preview.path, writes: ['vgai.project.json'], manifest: preview.manifest };
}

/** Build the exact proposed sidecar without writing it. */
export async function previewAdaptProjectFolderPath(
  path: string,
  options: {
    engineVersion: string;
    surface?: SuggestedAdapterSurface | undefined;
    entry?: string | undefined;
  },
): Promise<{
  path: string;
  report: ProjectInspection;
  writes: [];
  manifest: Record<string, unknown>;
}> {
  const root = resolve(path);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) throw new Error(`Project path is not a directory: ${root}`);
  const report = await inspectProject(nodeProjectInspectionReader(root));
  if (report.hasManifest) throw new Error('This folder already has a vgai.project.json manifest.');
  let name = basename(root);
  try {
    const packageJson = JSON.parse(
      await readFile(resolveProjectPath(root, 'package.json'), 'utf-8'),
    ) as {
      name?: unknown;
    };
    if (typeof packageJson.name === 'string' && packageJson.name.length > 0)
      name = packageJson.name;
  } catch {}
  const selectedEntry = options.entry ?? report.entryCandidates[0];
  if (selectedEntry !== undefined) {
    const entryPath = resolveProjectPath(root, selectedEntry);
    let entryStat: Awaited<ReturnType<typeof stat>>;
    try {
      entryStat = await stat(entryPath);
    } catch {
      throw new Error(`Adapter entry does not exist: ${selectedEntry}`);
    }
    if (!entryStat.isFile()) throw new Error(`Adapter entry is not a file: ${selectedEntry}`);
  }
  const manifest = createIngestManifest(report, {
    name,
    ...options,
    ...(selectedEntry !== undefined ? { entry: selectedEntry } : {}),
  });
  return { path: root, report, writes: [], manifest };
}
