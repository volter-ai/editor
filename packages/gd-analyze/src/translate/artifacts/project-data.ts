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
  module: 'world',
  inputDigest: string,
  sourcePaths: readonly string[],
): GodotPlannedProjectDataArtifact {
  const artifactOrigin = origin(sourcePaths);
  const sourceMapPath = `${path}.map`;
  return {
    kind: 'project-data',
    path,
    content: { kind: 'generated-target-ts', module, inputDigest },
    sourceMapPath,
    origin: artifactOrigin,
    planIdentity: plannedArtifactIdentity(
      'project-data',
      path,
      sourceMapPath,
      structuralDigest({ module, inputDigest }),
      artifactOrigin,
    ),
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
      undefined,
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
    planIdentity: plannedArtifactIdentity('project-data', path, undefined, digest, artifactOrigin),
  };
}
