/**
 * WORLD-ADOPTION AMBIGUITY — the reader for what the capture trap decided, and
 * for every world it saw afterwards and did not adopt.
 *
 * `@volter/editor-threejs/adapter/ingest/scene-capture` adopts a self-booting game's world on
 * the first non-host render. That is a sound MEASURED default and a permanent,
 * silent commitment: a splash scene, a shadow pre-pass or a render-to-texture
 * warm-up that happens to draw first is adopted as the game forever, and the
 * real world drawing one frame later reached nobody.
 *
 * This module does not change the decision (ARCHITECTURE-CORE §The editor
 * protocol: a diagnostic diagnoses; it does not silently re-pick). It records
 * the adoption's PROVENANCE — `declared` when the game's contract named the
 * scene, `measured` when first-render-wins ran — and every distinct
 * (scene, camera) pair seen after it, and publishes both as the `worldAdoption`
 * facet of `/__editor/state`.
 *
 * Alternates are INFORMATION, not an error: a post-processing chain renders
 * several pairs per frame by design. The facet says how many and which, and the
 * `ambiguity` sentence exists so a reader chasing "the editor is showing the
 * wrong scene" has one place that already knows there was a choice.
 */

import type { WorldAdoptionEvent } from '@volter/editor-sdk/kit/world-adoption-event';

export interface WorldAdoptionAlternate {
  readonly sceneId: string;
  readonly cameraId: string;
  /** `false` ⇒ a SECOND renderer is drawing — the stronger signal that the
   *  adopted world may not be the one on screen. */
  readonly sameRenderer: boolean;
  readonly drawCount: number;
}

export interface WorldAdoption {
  readonly rootId: string;
  /** `declared` = the game's contract named this scene; `measured` = the trap's
   *  first-non-host-render default decided. */
  readonly source: 'declared' | 'measured';
  readonly sceneId: string;
  readonly cameraId: string;
  /** Distinct worlds seen AFTER the adopted one, capped by the trap's own
   *  `MAX_RECORDED_ALTERNATES`. */
  readonly alternates: readonly WorldAdoptionAlternate[];
  /** Present iff `alternates` is non-empty — the one sentence, spelled once. */
  readonly ambiguity?: string;
}

/** RESOURCE OWNERSHIP: one entry per self-booting root, written through
 *  {@link worldAdoptionRecorder} by the mount that installed the capture trap,
 *  and dropped by that mount's teardown ({@link clearWorldAdoption}). */
const _adoptions = new Map<
  string,
  {
    source: 'declared' | 'measured';
    sceneId: string;
    cameraId: string;
    alternates: WorldAdoptionAlternate[];
  }
>();

/**
 * The `onWorldAdoption` handler a mount hands to `installSceneCapture`, bound
 * to one root id. One door: the mount passes this straight through, so nothing
 * in the editor transcribes the engine's event shape a second time.
 */
export function worldAdoptionRecorder(rootId: string): (event: WorldAdoptionEvent) => void {
  return (event) => {
    if (event.phase === 'adopted') {
      _adoptions.set(rootId, {
        source: event.source,
        sceneId: event.sceneId,
        cameraId: event.cameraId,
        alternates: [],
      });
      return;
    }
    // An alternate before an adoption cannot happen (the trap only reports one
    // after it has committed), so a missing entry here means this root's
    // adoption was already torn down — drop it rather than resurrect the root.
    const entry = _adoptions.get(rootId);
    if (!entry) return;
    entry.alternates.push({
      sceneId: event.sceneId,
      cameraId: event.cameraId,
      sameRenderer: event.sameRenderer,
      drawCount: event.drawCount,
    });
  };
}

export function clearWorldAdoption(rootId: string): void {
  _adoptions.delete(rootId);
}

export function worldAdoptionFacet(): readonly WorldAdoption[] {
  return [..._adoptions].map(([rootId, entry]) => ({
    rootId,
    source: entry.source,
    sceneId: entry.sceneId,
    cameraId: entry.cameraId,
    alternates: [...entry.alternates],
    ...(entry.alternates.length > 0
      ? {
          ambiguity:
            `"${rootId}" rendered ${entry.alternates.length} other world(s) after the one the ` +
            `editor adopted (${entry.source}: ${entry.sceneId}). The adopted world is unchanged; ` +
            'if the editor is showing the wrong scene, one of these is it: ' +
            entry.alternates
              .map((alt) => `${alt.sceneId}${alt.sameRenderer ? '' : ' (a SECOND renderer)'}`)
              .join(', '),
        }
      : {}),
  }));
}
