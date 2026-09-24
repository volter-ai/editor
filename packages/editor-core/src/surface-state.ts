import type { MountFailureReport } from '@volter/editor-sdk/kit/mount-failure-report';
import type { RootReadiness } from './readiness';

export type SurfaceContentState = 'unknown' | 'present' | 'empty';
export type SurfacePhase = 'loading' | 'ready';

export interface SurfaceExplanation {
  readonly tone: 'loading' | 'error' | 'neutral';
  readonly title: string;
  readonly description: string;
}

export interface ExplainSurfaceInput {
  /** Human name of the surface, e.g. Scene, Game, or Story. */
  readonly surface: string;
  /** True when the surface's design mount is DELIBERATELY suspended because
   *  the game is playing — the wait is not progress and must not read as one
   *  (a human sat on "waiting for world to finish mounting" on an auto-played
   *  example and reported the Scene tab broken — runhuman pass 37). */
  readonly playSuspended?: boolean;
  /** Exact root identities owned by this surface. Empty means not identified yet. */
  readonly rootIds: readonly string[];
  readonly phase: SurfacePhase;
  readonly content: SurfaceContentState;
  readonly readiness?: readonly RootReadiness[];
  readonly failures?: readonly MountFailureReport[];
}

function quoted(ids: readonly string[]): string {
  return ids.map((id) => `“${id}”`).join(', ');
}

function failureExplanation(
  surface: string,
  failures: readonly MountFailureReport[],
): SurfaceExplanation {
  const failedIds = failures.map((failure) => failure.worldId);
  return {
    tone: 'error',
    title:
      failedIds.length === 1
        ? `${surface} root ${quoted(failedIds)} failed`
        : `${failedIds.length} ${surface} roots failed`,
    description: `${failures
      .map(
        (failure) =>
          `${failure.worldId} (${failure.kind}, ${failure.identity}): ${failure.message}`,
      )
      .join(
        '\n',
      )}\nIf this followed an edit, Undo (Ctrl+Z) restores the previous source and remounts.`,
  };
}

function loadingExplanation(surface: string, rootIds: readonly string[]): SurfaceExplanation {
  const title =
    rootIds.length === 0
      ? `Loading ${surface}`
      : rootIds.length === 1
        ? `Loading ${surface} root ${quoted(rootIds)}`
        : `Loading ${rootIds.length} ${surface} roots`;
  return {
    tone: 'loading',
    title,
    description:
      rootIds.length === 0
        ? 'Reading the project declaration to identify the root that belongs here.'
        : `Waiting for ${quoted(rootIds)} to finish mounting.`,
  };
}

function emptyExplanation(surface: string, rootIds: readonly string[]): SurfaceExplanation {
  if (rootIds.length === 0) {
    return {
      tone: 'neutral',
      title: `No ${surface} root`,
      description: 'No declared root belongs to this surface.',
    };
  }
  return {
    tone: 'neutral',
    title: 'No renderable content',
    // The second sentence is load-bearing: a world whose content exists only
    // under its game systems (the shipped shooters and strategy examples all
    // do this) presents exactly this card the moment Play stops, and a human
    // tester read it as breakage ("why did it stop? no renderable content" —
    // runhuman pass 13, 2026-08-28). Name the way forward on the card itself.
    description:
      (rootIds.length === 1
        ? `Root ${quoted(rootIds)} mounted successfully but currently produces no renderable content.`
        : `Roots ${quoted(rootIds)} mounted successfully but currently produce no renderable content.`) +
      ' If this world builds its content under its game systems, press Play (▶) to run it.',
  };
}

/**
 * The one precedence rule for a surface which otherwise has nothing to draw.
 * A real rendered result always wins. When there is no result, a named failure
 * wins over a named wait, which wins over the honest successful-empty state.
 */
export function explainSurface(input: ExplainSurfaceInput): SurfaceExplanation | null {
  if (input.content === 'present') return null;

  if (input.playSuspended) {
    return {
      tone: 'neutral',
      title: 'Editing paused during Play',
      description: `${quoted(input.rootIds)} is running in the Game tab. Press Stop (⏹) to edit it here.`,
    };
  }

  const owned = new Set(input.rootIds);
  const scopedFailures = (input.failures ?? []).filter((failure) => owned.has(failure.worldId));
  if (scopedFailures.length > 0) return failureExplanation(input.surface, scopedFailures);

  const waitingIds = (input.readiness ?? [])
    .filter((entry) => entry.state === 'waiting' && owned.has(entry.rootId))
    .map((entry) => entry.rootId);
  const loadingIds = waitingIds.length > 0 ? waitingIds : input.rootIds;
  if (input.phase === 'loading' || waitingIds.length > 0 || input.content === 'unknown') {
    return loadingExplanation(input.surface, loadingIds);
  }
  return emptyExplanation(input.surface, input.rootIds);
}
