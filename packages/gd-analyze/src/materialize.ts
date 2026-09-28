import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import * as path from 'node:path';
import type { GodotEmittedArtifactSet, GodotOutputArtifact } from './translate/emit';
import type { GodotTranslationPlan } from './translate/translation-plan';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeArtifactPath(relativePath: string): readonly string[] {
  const segments = relativePath.split('/');
  if (
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`unsafe output artifact path: ${relativePath}`);
  }
  return segments;
}

function assertArtifactSet(
  plan: GodotTranslationPlan,
  artifacts: readonly GodotOutputArtifact[],
): void {
  const planned = new Map<
    string,
    {
      readonly kind: GodotOutputArtifact['kind'];
      readonly role: GodotOutputArtifact['role'];
      readonly planIdentity: string;
    }
  >();
  for (const artifact of plan.artifacts) {
    planned.set(artifact.path, {
      kind: artifact.kind,
      role: 'primary',
      planIdentity: artifact.planIdentity,
    });
    if ('sourceMapPath' in artifact) {
      planned.set(artifact.sourceMapPath, {
        kind: artifact.kind,
        role: 'source-map',
        planIdentity: artifact.planIdentity,
      });
    }
  }
  const emitted = new Set<string>();
  for (const artifact of artifacts) {
    if (emitted.has(artifact.path)) throw new Error(`${artifact.path}: emitted more than once`);
    emitted.add(artifact.path);
    const expected = planned.get(artifact.path);
    if (
      expected?.kind !== artifact.kind ||
      expected.role !== artifact.role ||
      expected.planIdentity !== artifact.planIdentity
    ) {
      throw new Error(`${artifact.path}: artifact is absent from the accepted translation plan`);
    }
    planned.delete(artifact.path);
  }
  if (planned.size > 0) {
    throw new Error(`accepted artifacts are absent: ${[...planned.keys()].join(', ')}`);
  }
}

/** Write and read back only the complete emitted artifact set into an importer-owned empty root. */
export function writeGodotTranslationArtifacts(
  emittedSet: GodotEmittedArtifactSet,
  emptyRoot: string,
): void {
  if (!existsSync(emptyRoot)) throw new Error(`${emptyRoot}: staging root does not exist`);
  if (readdirSync(emptyRoot).length !== 0) {
    throw new Error(`${emptyRoot}: materialization requires an empty importer-owned staging root`);
  }
  assertArtifactSet(emittedSet.acceptedPlan, emittedSet.artifacts);
  for (const artifact of emittedSet.artifacts) {
    if (sha256(artifact.bytes) !== artifact.digest) {
      throw new Error(`${artifact.path}: emitted bytes do not match their planned digest`);
    }
    const target = path.join(emptyRoot, ...safeArtifactPath(artifact.path));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, artifact.bytes);
    if (sha256(readFileSync(target)) !== artifact.digest) {
      throw new Error(`${artifact.path}: materialized bytes do not match their planned digest`);
    }
  }
}

/** Restore the importer-owned candidate to the exact accepted artifact set after acceptance. */
export function restoreGodotTranslationArtifacts(
  artifacts: readonly GodotOutputArtifact[],
  projectRoot: string,
): void {
  const planned = new Set(artifacts.map((artifact) => artifact.path));
  // Planned bytes are checked BEFORE any cleanup. Acceptance may create disposable state in this
  // importer-owned candidate, but it may never change source or another planned artifact and have
  // the restoration step hide that mutation.
  for (const artifact of artifacts) {
    const target = path.join(projectRoot, ...safeArtifactPath(artifact.path));
    if (!existsSync(target) || sha256(readFileSync(target)) !== artifact.digest) {
      throw new Error(`acceptance changed planned project artifact: ${artifact.path}`);
    }
  }
  const clean = (relativeDirectory: string): void => {
    const absoluteDirectory = path.join(projectRoot, relativeDirectory);
    for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
      const relative = path.posix.join(relativeDirectory, entry.name);
      const absolute = path.join(absoluteDirectory, entry.name);
      if (entry.isDirectory()) {
        clean(relative);
        if (readdirSync(absolute).length === 0) rmSync(absolute, { recursive: true, force: true });
      } else if (!entry.isFile() || !planned.has(relative)) {
        rmSync(absolute, { recursive: true, force: true });
      }
    }
  };
  clean('');
  const visit = (relativeDirectory: string): void => {
    const absoluteDirectory = path.join(projectRoot, relativeDirectory);
    for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
      const relative = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) visit(relative);
      else if (!entry.isFile() || !planned.has(relative)) {
        throw new Error(`acceptance produced an unplanned project artifact: ${relative}`);
      }
    }
  };
  visit('');
}

/** One atomic promotion; a destination that appeared after planning is never replaced. */
export function promoteGodotTranslation(stagingRoot: string, targetRoot: string): void {
  if (existsSync(targetRoot)) {
    throw new Error(
      `${targetRoot} appeared while import was running; refusing to replace a user-owned destination.`,
    );
  }
  renameSync(stagingRoot, targetRoot);
}
