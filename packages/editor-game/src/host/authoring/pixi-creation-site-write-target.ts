/**
 * CREATION-SITE SOURCE PERSISTENCE for a canvas world — the canvas surface's
 * third {@link CanvasWriteTarget}, and the one an ingested PixiJS game mounts
 * with.
 *
 * WHAT IT IS. `createLiveCanvasWriteTarget` parameterized by the shared
 * persistence backend (`source-persistence-backend.ts`), exactly the way the
 * three lane's `structuralThree` is `ThreeAuthoringAdapter`
 * parameterized by `createCreationSitePersistence`. The gesture, the physics
 * handshake, the session journal and the reflected inspector rows are the live
 * target's, unchanged; the destination is this file's whole contribution.
 *
 * WHY NOT A THIRD IMPLEMENTATION OF THE INTERFACE. Everything a separate class
 * would have to carry — freeze/commit/unfreeze, the overlay-keyed session
 * journal, `writeProp`'s label/tint/visible/alpha mapping — is identical on both
 * sides of the persistence question, and the codebase has already paid for what
 * happens when one behaviour is written twice: `IngestSourcePersistence.gate`'s
 * comment records a live bug caused by two condition lists that disagreed. The
 * axis that genuinely differs is the destination, so the destination is the
 * parameter.
 *
 * ONE WIRING, NO HOST PROBE, and that is deliberate. There is no branch here
 * on "is the source-write route reachable": `createCreationSitePersistence`
 * answers that itself, becoming an honest live-only-with-reason where no
 * `/__ingest-source/*` route exists. A client-side guess would be a second
 * answer to a question the backend already owns — and it would be the one
 * place a fallback could quietly pretend to persist.
 */

import type { PhysicsAdapter2D } from '@volter/game-runtime/pixi/system-adapters';
import type { HistoryService } from '@volter/editor-core/history/history-service';
import type { IngestSourcePersistence } from './ingest-source-persistence';
import type { CanvasWriteTarget } from './pixi-authoring-adapter';
import { createLiveCanvasWriteTarget } from './pixi-live-write-target';
import { createCreationSitePersistence } from './source-persistence-backend';

export interface CreationSiteCanvasWriteTargetOptions {
  /** Transform ownership + the freeze/commit/unfreeze handshake — the live
   *  target's own requirement, passed straight through. */
  readonly physics: PhysicsAdapter2D;
  /** The project history a persisted edit's ONE transaction is recorded into.
   *  `null` is a real state (a session with no project open) and the backend
   *  refuses with that reason rather than writing an unundoable edit. */
  readonly history: HistoryService | null;
  /** Injectable writer, so a unit test can drive the whole gesture without a
   *  dev server. Absent in production. */
  readonly writer?: IngestSourcePersistence | undefined;
}

export function createCreationSiteCanvasWriteTarget(
  options: CreationSiteCanvasWriteTargetOptions,
): CanvasWriteTarget {
  return createLiveCanvasWriteTarget({
    physics: options.physics,
    persistence: createCreationSitePersistence({
      history: options.history,
      writer: options.writer,
    }),
  });
}
