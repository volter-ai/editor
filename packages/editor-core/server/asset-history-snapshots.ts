import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { PROJECT_PROVENANCE_PATH } from './support/project/provenance';
import { isPathInside } from './server-utils';

interface AssetHistorySnapshotMetadata {
  version: 1;
  assetPath: string;
  destination: string;
  assetPresent: boolean;
  provenancePresent: boolean;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function normalizedAssetPath(assetPath: string): string {
  const normalized = assetPath.replaceAll('\\', '/').replace(/^\/+/, '');
  if (
    !normalized.startsWith('asset-library/') ||
    normalized.includes('\0') ||
    normalized.split('/').includes('..') ||
    basename(normalized) === ''
  ) {
    throw new Error('Asset history paths must name a file under public/asset-library/.');
  }
  return normalized;
}

async function hashFile(hash: ReturnType<typeof createHash>, path: string): Promise<void> {
  const info = await stat(path);
  hash.update(`file:${info.size}:`);
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
}

async function hashDirectory(
  hash: ReturnType<typeof createHash>,
  root: string,
  directory: string,
): Promise<void> {
  const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    const path = relative(root, absolute).split(sep).join('/');
    if (entry.isDirectory()) {
      hash.update(`directory:${path}\0`);
      await hashDirectory(hash, root, absolute);
    } else if (entry.isFile()) {
      hash.update(`path:${path}\0`);
      await hashFile(hash, absolute);
    } else {
      throw new Error(`Asset history cannot snapshot special filesystem entry ${absolute}.`);
    }
  }
}

/**
 * Content-addressed, server-resident snapshots for one imported asset directory.
 * History stores only the stable digest token in browser memory; exact model,
 * dependency, recipe, thumbnail, and provenance bytes stay under `.vgai/tmp`.
 */
export class AssetHistorySnapshots {
  private readonly projectRoot: string;
  private readonly snapshotRoot: string;

  constructor(private readonly publicRoot: string) {
    this.projectRoot = dirname(publicRoot);
    this.snapshotRoot = resolve(this.projectRoot, '.vgai', 'tmp', 'asset-history-snapshots');
  }

  async capture(assetPath: string): Promise<string> {
    const normalized = normalizedAssetPath(assetPath);
    const destination = resolve(this.publicRoot, dirname(normalized));
    if (!isPathInside(this.publicRoot, destination)) {
      throw new Error('Asset history destination escapes public/.');
    }
    const provenance = resolve(this.projectRoot, PROJECT_PROVENANCE_PATH);
    const metadata: AssetHistorySnapshotMetadata = {
      version: 1,
      assetPath: normalized,
      destination: relative(this.projectRoot, destination).split(sep).join('/'),
      assetPresent: await pathExists(destination),
      provenancePresent: await pathExists(provenance),
    };
    const hash = createHash('sha256');
    hash.update(JSON.stringify(metadata));
    if (metadata.assetPresent) await hashDirectory(hash, destination, destination);
    if (metadata.provenancePresent) {
      hash.update('provenance\0');
      await hashFile(hash, provenance);
    }
    const token = hash.digest('hex');
    const snapshot = resolve(this.snapshotRoot, token);
    if (await pathExists(snapshot)) return token;

    await mkdir(this.snapshotRoot, { recursive: true });
    const staging = await mkdtemp(resolve(this.snapshotRoot, `.capture-${randomUUID()}-`));
    try {
      if (metadata.assetPresent)
        await cp(destination, resolve(staging, 'asset'), { recursive: true });
      if (metadata.provenancePresent) await cp(provenance, resolve(staging, 'provenance.json'));
      await writeFile(resolve(staging, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
      try {
        await rename(staging, snapshot);
      } catch (error) {
        if (!(await pathExists(snapshot))) throw error;
      }
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
    return token;
  }

  async restore(assetPath: string, token: string): Promise<void> {
    const normalized = normalizedAssetPath(assetPath);
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid asset history snapshot token.');
    const snapshot = resolve(this.snapshotRoot, token);
    const metadata = JSON.parse(
      await readFile(resolve(snapshot, 'metadata.json'), 'utf8'),
    ) as AssetHistorySnapshotMetadata;
    if (metadata.version !== 1 || metadata.assetPath !== normalized) {
      throw new Error('Asset history snapshot identity does not match the selected asset.');
    }
    const destination = resolve(this.projectRoot, metadata.destination);
    const expectedDestination = resolve(this.publicRoot, dirname(normalized));
    if (destination !== expectedDestination || !isPathInside(this.publicRoot, destination)) {
      throw new Error('Asset history snapshot destination is invalid.');
    }
    const provenance = resolve(this.projectRoot, PROJECT_PROVENANCE_PATH);
    const transaction = await mkdtemp(
      resolve(this.projectRoot, '.vgai', 'tmp', `.asset-history-restore-${randomUUID()}-`),
    );
    const stagedAsset = resolve(transaction, 'staged-asset');
    const backupAsset = resolve(transaction, 'backup-asset');
    const stagedProvenance = resolve(transaction, 'staged-provenance.json');
    const backupProvenance = resolve(transaction, 'backup-provenance.json');
    let assetBackedUp = false;
    let assetInstalled = false;
    let provenanceBackedUp = false;
    let provenanceInstalled = false;
    try {
      if (metadata.assetPresent)
        await cp(resolve(snapshot, 'asset'), stagedAsset, { recursive: true });
      if (metadata.provenancePresent) {
        await cp(resolve(snapshot, 'provenance.json'), stagedProvenance);
      }
      await mkdir(dirname(destination), { recursive: true });
      if (await pathExists(destination)) {
        await rename(destination, backupAsset);
        assetBackedUp = true;
      }
      if (metadata.assetPresent) {
        await rename(stagedAsset, destination);
        assetInstalled = true;
      }
      await mkdir(dirname(provenance), { recursive: true });
      if (await pathExists(provenance)) {
        await rename(provenance, backupProvenance);
        provenanceBackedUp = true;
      }
      if (metadata.provenancePresent) {
        await rename(stagedProvenance, provenance);
        provenanceInstalled = true;
      }
    } catch (error) {
      if (provenanceInstalled) await rm(provenance, { force: true });
      if (provenanceBackedUp) await rename(backupProvenance, provenance);
      if (assetInstalled) await rm(destination, { recursive: true, force: true });
      if (assetBackedUp) await rename(backupAsset, destination);
      throw error;
    } finally {
      await rm(transaction, { recursive: true, force: true });
    }
  }
}
