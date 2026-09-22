import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { resolveManifestPath } from '@volter/editor-project/manifest/locate';
import type { ProjectComponentEntry } from '../src/asset-workflow/project-content';
import {
  compareProjectComponents,
  discoverComponentsInSource,
  type IndexedProjectSource,
  omitRootDocumentComponents,
  projectFileSurfaces,
  projectRegionEntries,
  projectRootEntries,
  reportUnreadableRegions,
} from '../src/asset-workflow/project-source-index';
import { ADAPTER_MODULE_FILENAME } from '../src/ui-source/adapter-region-includes';

/**
 * ABSENT resolves `null`; every OTHER failure rejects — the contract
 * {@link projectRegionEntries} reads, and the classification only this side
 * (which knows the backend is Node's fs) can make. A blanket
 * `.catch(() => '')` here would report a permissions error or a corrupt file
 * as "this project declares nothing", which is a declaration it never made.
 */
async function readOptionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx)$/i;
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', '.git', '.vgai', 'tools']);

function indexSourceEntry(
  directory: string,
  entry: Dirent,
  pending: string[],
  files: string[],
): void {
  const absolute = join(directory, entry.name);
  if (entry.isDirectory()) {
    if (!SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) {
      pending.push(absolute);
    }
    return;
  }
  if (entry.isFile() && SOURCE_EXTENSION.test(entry.name)) files.push(absolute);
}

export async function discoverProjectComponents(
  projectRoot: string,
): Promise<ProjectComponentEntry[]> {
  const pending = [join(projectRoot, 'src')];
  const files: string[] = [];
  // Same ENOENT-only rule as `readOptionalFile` above: a missing directory
  // is an honest "nothing declared here"; a permissions error or I/O failure
  // is NOT — swallowing it would render a short component list as a fact
  // about the project.
  const enoentEmpty = (error: unknown): never[] => {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw error;
  };
  while (pending.length > 0 && files.length < 512) {
    const directory = pending.shift()!;
    const entries = await readdir(directory, { withFileTypes: true }).catch(enoentEmpty);
    for (const entry of entries) indexSourceEntry(directory, entry, pending, files);
  }
  const sources = (
    await Promise.all(
      files.map(async (absolute): Promise<IndexedProjectSource[]> => {
        const path = relative(projectRoot, absolute).split(sep).join('/');
        return readFile(absolute, 'utf8')
          .then((source) => [{ path, source }])
          .catch(enoentEmpty);
      }),
    )
  ).flat();
  // A file's surface is its REGION, resolved by the one shared resolver from
  // this project's declarations and its own import edges — never from whichever
  // library a file happens to name in its text.
  const { regions, unreadable } = await projectRegionEntries(
    () => readOptionalFile(resolveManifestPath(projectRoot)),
    () => readOptionalFile(join(projectRoot, ADAPTER_MODULE_FILENAME)),
  );
  // Never dropped: the real loader evaluates the module and WOULD honor an
  // `include` this static read could not see, so an unreported `unreadable`
  // is the two readers disagreeing with nobody told.
  if (unreadable) reportUnreadableRegions(projectRoot, unreadable);
  const surfaces = projectFileSurfaces(sources, regions);
  const discovered = sources.flatMap((file) =>
    discoverComponentsInSource(file.source, file.path, surfaces.get(file.path) ?? 'unknown'),
  );
  const rootEntries = await projectRootEntries(() =>
    readFile(resolveManifestPath(projectRoot), 'utf8'),
  );
  return omitRootDocumentComponents(discovered, rootEntries).sort(compareProjectComponents);
}
