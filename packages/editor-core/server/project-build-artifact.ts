/**
 * Packages the OPEN PROJECT'S native `dist/` after its own `npm run build`.
 * The zip is an ordinary web artifact and the report is ephemeral editor
 * telemetry — neither creates an editor-private project format.
 */

import type { Dirent } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import {
  type BuildReport,
  type BuildReportFile,
  WEB_BUILD_ARTIFACT,
} from '@volter/editor-sdk/session/build-report';
import { zipSync } from 'fflate';
import { resolveManifestPath } from '@volter/editor-project/manifest/locate';

interface OutputFile extends BuildReportFile {
  readonly absolutePath: string;
}

function portablePath(path: string): string {
  return path.split(sep).join('/');
}

async function collectFiles(root: string, directory = root): Promise<OutputFile[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(
        `The project's build completed without creating ${root}. ` +
          'Its native build script must emit a static dist/ directory.',
      );
    }
    throw error;
  }

  const files: OutputFile[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(root, absolutePath)));
    } else if (entry.isFile()) {
      files.push({
        absolutePath,
        path: portablePath(relative(root, absolutePath)),
        bytes: (await stat(absolutePath)).size,
      });
    }
  }
  return files;
}

/** The ignored, machine-local artifact used by the editor's Download action. */
export function projectBuildArtifactPath(projectRoot: string): string {
  return resolve(projectRoot, '.vgai', 'tmp', 'build', WEB_BUILD_ARTIFACT);
}

export async function packageProjectWebBuild(projectRoot: string): Promise<BuildReport> {
  const distRoot = resolve(projectRoot, 'dist');
  const files = await collectFiles(distRoot);
  if (files.length === 0) {
    throw new Error(`The project's native build emitted an empty ${distRoot}.`);
  }

  const archive: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  for (const file of files) archive[file.path] = await readFile(file.absolutePath);

  // Keep the native manifest beside the static output, matching the existing
  // deploy staging contract. If a custom build already emitted one, the source
  // manifest is the authority and intentionally replaces it.
  archive['vgai.project.json'] = await readFile(resolveManifestPath(projectRoot));

  const bytes = zipSync(archive, { level: 6 });
  const artifactPath = projectBuildArtifactPath(projectRoot);
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, bytes);

  const outputBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const largestFiles = files
    .map(({ path, bytes }) => ({ path, bytes }))
    .sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path))
    .slice(0, 12);

  return {
    artifact: WEB_BUILD_ARTIFACT,
    artifactBytes: bytes.byteLength,
    outputBytes,
    fileCount: files.length,
    largestFiles,
  };
}
