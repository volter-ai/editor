/**
 * THE `SystemAdapters` COVERAGE OF A NATIVE MOUNT — the live half of
 * `coverage/system-adapter-coverage.ts`.
 *
 * It reads the session's own singletons and hands the facts to the pure
 * derivation. The report goes out the two doors coverage already uses —
 * `vgai status`'s `systemCoverage` facet, and the editor console via
 * `coverage/session-coverage.ts`, which unions this family with the others so
 * one headline counts them all — so an unbound slot becomes a STANDING
 * condition rather than a one-off line. No new transport, no new panel, and no
 * dismiss: the console sync forwards every warning to the server's unresolved
 * ledger, which is what makes it persistent.
 *
 * ## Why this is a separate report from `coverage/root-coverage.ts`
 *
 * A `SystemAdapters` slot is GAME-scoped, not root-scoped:
 * `runtime/game.ts`'s `computeSystemAdapters` merges every mounted root's bag
 * into ONE registry, and `authoring/active-systems.ts` is the single object the
 * editor's panels call. Deriving it per root would print the same six rows once
 * per root and invent a per-root ownership the engine does not have.
 *
 * ## Why it stands down for an ingested mount
 *
 * `ingest/mount-coverage.ts` already measures the same slots for an ingest,
 * against the game's DECLARED carrier — strictly stronger evidence, because a
 * declaration can distinguish "I have no physics" from "nobody looked". Where
 * that measurement exists it is the one that runs; this module is the answer
 * for the mounts that have no contract to read.
 */

import { getActiveSystems } from '@volter/editor-core/authoring/active-systems';
import { mountedRootSubjects } from '@volter/editor-core/authoring/mounted-root-subjects';
import {
  type CapabilityCoverageReport,
  deriveCapabilityCoverage,
} from '../host/coverage/capability-coverage';
import { measureNativeSystemAdapters } from '../host/coverage/system-adapter-coverage';
import { liveCoverage } from '@volter/editor-core/live-session-registry';
import { getCurrentProject } from '@volter/editor-core/project-manager';
import { toolContributionPlay } from '@volter/editor-core/tool-contribution-play';
import type { DeclaredSystemAbsence, Game } from '@volter/game-runtime/runtime/game';
import { projectDependencyNames } from './live-project-verbs';

/**
 * What the mounted roots' `systems` tables declared ABSENT, read off the live
 * Game — the DETECT-OR-DECLARE input that turns a derived excuse into the
 * game's own answer.
 *
 * Reached through `tool-contribution-play.ts` rather than `play-mode.ts` on
 * purpose: importing play-mode here would drag the whole runtime boot chain
 * into every consumer of this module (its own header states the rule).
 *
 * While a Game is live its declarations are read directly. While stopped, the
 * last mount's reading is retained per project and labeled as such — the
 * declaration is a static fact about the entry's `systems` table, and
 * forgetting it at stop demoted the game's own answer to a host inference.
 * `[]` only when this project has never mounted in this session.
 */
function declaredAbsences(): {
  absences: readonly DeclaredSystemAbsence[];
  fromLastMount: boolean;
} {
  const game = toolContributionPlay()?.game as Game | undefined;
  const projectPath = getCurrentProject()?.rootPath ?? null;
  if (game) {
    if (projectPath !== null) {
      lastMountAbsences = { projectPath, absences: game.declaredSystemAbsences ?? [] };
    }
    return { absences: game.declaredSystemAbsences ?? [], fromLastMount: false };
  }
  // Stopped. The declaration is a static fact about the entry's `systems`
  // table, so the LAST mount's reading remains the game's own answer — the
  // probe-measured failure was this very row demoting to "the HOST's
  // observation" the moment play stopped, silently understating the game's
  // declared answer as an inference. Retained per project, labeled as the
  // last-mount reading by the derivation.
  if (lastMountAbsences !== null && lastMountAbsences.projectPath === projectPath) {
    return { absences: lastMountAbsences.absences, fromLastMount: true };
  }
  return { absences: [], fromLastMount: false };
}

/** The last play mount's declared absences, per project — see above. */
let lastMountAbsences: {
  projectPath: string;
  absences: readonly DeclaredSystemAbsence[];
} | null = null;

/**
 * The native system-adapter report, or `null` when this session is not the one
 * being described: an ingested mount (whose own measurement is better) or a
 * session with no open project (nothing to read a `server` block from, and
 * guessing would be the fabrication the anti-shim rule forbids).
 *
 * Re-derived on every read. The registry gains and loses adapters across a play
 * enter/exit, so a cached answer would start lying.
 */
export function nativeSystemCoverage(): CapabilityCoverageReport | null {
  // A lane grading its own contracts (an ingested game) owns this family.
  if (liveCoverage() !== null) return null;
  const project = getCurrentProject();
  if (!project) return null;
  const mounted = mountedRootSubjects();
  // Nothing mounted ⇒ the registry has not been ASKED, and "a probe that has
  // not run yet reports info, never gap" (the derivation's own rule). The
  // measured violation: a pre-mount session emitted "7 of 7 system seams
  // MISSING" into the server's unresolved ledger — seven gaps against a mount
  // that did not exist — and the entry stood beside the real post-mount report
  // forever. An unasked question is not a family with something to say.
  if (mounted.length === 0) return null;
  // An isolated foreign document is a real AUTHORING mount, so root coverage
  // must grade its editor providers, but it is not a native engine Game and
  // owns no game-scoped SystemAdapters registry. Treating that document as a
  // native mount fabricated a `system.debug` failure the moment an adapter-
  // owned scene was opened. Stand down only when every mounted subject says it
  // is foreign; a mixed project with any native root still has a real native
  // game registry to measure.
  if (mounted.every((subject) => subject.adapter.provenance?.source === 'foreign')) return null;
  const declared = declaredAbsences();
  return deriveCapabilityCoverage({
    worldId: project.config.name,
    systemAdapters: measureNativeSystemAdapters(getActiveSystems(), {
      // A `process` configuration WITH A PORT — the same rule
      // `edit-mode-networking.ts`'s `readServerConfig` already used, and the
      // one this line was missing. `process` is the general "a process the
      // project runs beside the host" kind, not a synonym for "Colyseus
      // server": the `arena` example declares two port-less ones that choose
      // a camera, and grading on `kind` alone reported a missing
      // NetworkingAdapter for a single-player game, telling its author to
      // register one because "this project declares a `server` block" when it
      // declares nothing of the sort. A matchmaker is a listener; no port, no
      // server. (`vgai edit`'s auto-boot had the identical bug — see
      // `packages/vgai-cli/src/colyseus-autoboot.ts`'s `readDeclaredProcess`.)
      declaresServer: (project.config.configurations ?? []).some(
        (c) => c.kind === 'process' && typeof (c as { port?: unknown }).port === 'number',
      ),
      mounted: true,
      declaredAbsences: declared.absences,
      absencesFromLastMount: declared.fromLastMount,
      dependencies: projectDependencyNames(),
    }),
  });
}
