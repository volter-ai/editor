import { plannedArtifactIdentity, structuralDigest } from './identity';
import type { GodotPlannedSourceTranslationArtifact, GodotSourceTranslationOrigin } from './types';

/** The only planner for generated source owned by one foreign source document. */
export function sourceTranslationArtifact(
  path: string,
  emission: GodotPlannedSourceTranslationArtifact['emission'],
  origin: GodotSourceTranslationOrigin,
): GodotPlannedSourceTranslationArtifact {
  const sourceMapPath = `${path}.map`;
  return {
    kind: 'source-translation',
    path,
    sourceMapPath,
    emission,
    origin,
    planIdentity: plannedArtifactIdentity(
      'source-translation',
      path,
      sourceMapPath,
      structuralDigest(emission),
      origin,
    ),
  };
}
