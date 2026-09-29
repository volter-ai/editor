import { dirname as posixDirname, relative as posixRelative } from 'node:path/posix';
import { createHash } from 'node:crypto';
import type { DirectJsonValue } from '../data/direct-project-data-plan';
import { plannedArtifactIdentity, structuralDigest } from './identity';
import type { GodotPlannedProjectDataArtifact, GodotProjectDataOrigin } from './types';

function origin(
  sourcePaths: readonly string[],
  toolchainSources: GodotProjectDataOrigin['toolchainSources'] = [],
): GodotProjectDataOrigin {
  return { kind: 'project-data', sourcePaths, toolchainSources };
}

/** Plan one importer-owned TypeScript module without constructing or printing target syntax. */
export function projectDataGeneratedModuleArtifact(
  path: string,
  module: 'world' | 'ui',
  inputDigest: string,
  sourcePaths: readonly string[],
): GodotPlannedProjectDataArtifact {
  const artifactOrigin = origin(sourcePaths);
  return {
    kind: 'project-data',
    path,
    content: { kind: 'generated-target-ts', module, inputDigest },
    origin: artifactOrigin,
    planIdentity: plannedArtifactIdentity(
      'project-data',
      path,
      structuralDigest({ module, inputDigest }),
      artifactOrigin,
    ),
  };
}

/** Plan an image by its pixels, which emit writes as a PNG. */
export function projectDataImageArtifact(
  path: string,
  width: number,
  height: number,
  channels: number,
  pixels: Uint8Array,
  sourcePaths: readonly string[],
): GodotPlannedProjectDataArtifact {
  const artifactOrigin = origin(sourcePaths);
  const payload = structuralDigest({ width, height, channels, pixels: createHash('sha256').update(pixels).digest('hex') });
  return {
    kind: 'project-data',
    path,
    content: { kind: 'image', width, height, channels, pixels },
    origin: artifactOrigin,
    planIdentity: plannedArtifactIdentity('project-data', path, payload, artifactOrigin),
  };
}

/** Plan importer-owned native JSON data without serializing it. */
export function projectDataJsonArtifact(
  path: string,
  value: DirectJsonValue,
  sourcePaths: readonly string[],
  toolchainSources: GodotProjectDataOrigin['toolchainSources'] = [],
): GodotPlannedProjectDataArtifact {
  const artifactOrigin = origin(sourcePaths, toolchainSources);
  return {
    kind: 'project-data',
    path,
    content: { kind: 'json', value },
    origin: artifactOrigin,
    planIdentity: plannedArtifactIdentity(
      'project-data',
      path,
      structuralDigest(value),
      artifactOrigin,
    ),
  };
}

/**
 * A data file as a typed module: the value checked against the compat interface that reads it
 * (`export default value satisfies T`), so every field has the exact type compat declares.
 */
export function projectDataTypedModuleArtifact(
  path: string,
  value: unknown,
  sourcePaths: readonly string[],
  type: { readonly module: string; readonly name: string },
): GodotPlannedProjectDataArtifact {
  let specifier = posixRelative(posixDirname(path), `src/lib/godot-compat/${type.module}`);
  if (!specifier.startsWith('.')) specifier = `./${specifier}`;
  const text = `import type { ${type.name} } from '${specifier}';\n\nconst data = ${JSON.stringify(value, null, 2)} satisfies ${type.name};\n\nexport default data;\n`;
  return projectDataBytesArtifact(path, new TextEncoder().encode(text), sourcePaths);
}

/** Plan already-final importer-owned opaque bytes. */
export function projectDataBytesArtifact(
  path: string,
  bytes: Uint8Array,
  sourcePaths: readonly string[],
): GodotPlannedProjectDataArtifact {
  const artifactOrigin = origin(sourcePaths);
  const digest = createHash('sha256').update(bytes).digest('hex');
  return {
    kind: 'project-data',
    path,
    content: { kind: 'bytes', bytes },
    digest,
    origin: artifactOrigin,
    planIdentity: plannedArtifactIdentity('project-data', path, digest, artifactOrigin),
  };
}
