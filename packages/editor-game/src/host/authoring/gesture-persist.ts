/**
 * PERSIST ONE CHANNEL WRITE — a kit piece of the live-adapter toolbox
 * (ARCHITECTURE-CORE §Roots, the four kit rules).
 *
 * Extracted from the cited twins `ThreeAuthoringAdapter.pipedWrite` and
 * `pixi-live-write-target`'s `persistOrJournal` resolution (whose own header
 * declares the transcription). The core is the ONE decision every live lane
 * must make identically when a gesture closes on a single property: resolve
 * the subject, ask the backend's GATE first — because it names the precise
 * reason (no source stamp, an expression-bound prop, a game that is playing
 * rather than held) — then honor the planned LANE second, as the structural
 * guarantee that a subject classified `live-only` can never reach a dialect
 * writer even if a gate waved it through. The two copies had drifted on
 * exactly this order (the canvas copy checked the lane first), so live-only
 * subjects earned different refusal sentences per lane; the documented order
 * wins and is now the only spelling.
 *
 * The LIVE-ONLY path stays fully SYNCHRONOUS through the pipe: `runWritePipe`
 * awaits nothing before `record` on that arm, so an `endEdit(); undo()`
 * sequence still finds its history entry. A cheap-gate refusal is reported on
 * the same surface as the deep ones, and only while the backend is armed — a
 * refusal on every frame of a game somebody is playing is noise.
 *
 * What stays per-lane, by the kit rules: the gesture-close POLICY (which
 * channels count as changed — the canvas lane's origin-move rule is
 * load-bearing and different), the history journaling itself (`journal` is
 * the lane's own push), and every identity/anchor hop (`subject` is resolved
 * lazily, inside the pipe, by the lane's own planner).
 */

import type { WriteAck, WriteAnchorKind } from '@volter/editor-project/adapter';
import type { ChannelValue } from '@volter/editor-core/creation-site-edit';
import type { SourcePersistenceBackend, SourceWriteSubject } from './source-persistence-backend';
import { resolvesLiveOnly, runWritePipe, type WriteResolution } from '@volter/editor-sdk/kit/write-pipe';

/** The one-property-per-gesture refusal, spelled once — it is the persistence
 *  pipeline's own rule, not any substrate's voice. */
export function multiChannelRefusal(changed: readonly string[]): string {
  return (
    `this gesture changed ${changed.length} properties at once (${changed.join(', ')}), and ` +
    'creation-site write-back plans one property per gesture'
  );
}

export interface ChannelWriteRequest {
  readonly backend: SourcePersistenceBackend;
  /** The lane's own id+property → subject hop, resolved INSIDE the pipe. */
  readonly subject: () => SourceWriteSubject;
  readonly baseline: ChannelValue;
  readonly next: ChannelValue;
  /** History label for the transaction ("Transform Sun"). */
  readonly label: string;
  /** The lane's own live-only journal push (captures its `before` snapshot). */
  readonly journal: () => void;
}

/** One channel write through the pipe: `resolve → write → record`. The
 *  persisted path's own transaction carries BOTH halves (the file and the
 *  live value), so the journal fires only when nothing persisted. */
export function persistChannelWrite(request: ChannelWriteRequest): Promise<WriteAck> {
  const { backend, label } = request;
  return runWritePipe({
    resolve: (): WriteResolution => {
      const subject = request.subject();
      const verdict = backend.gate(subject);
      if (!verdict.ok) return resolvesLiveOnly(verdict.reason);
      const kind: WriteAnchorKind = subject.anchorKind;
      if (kind === 'live-only') return resolvesLiveOnly(backend.describe(subject));
      return {
        reaches: 'writer',
        anchorKind: kind,
        destination: backend.destination(),
        write: () =>
          backend.write({ ...subject, baseline: request.baseline, next: request.next, label }),
      };
    },
    record: (persisted) => {
      if (!persisted) request.journal();
    },
    report: (reason) => {
      if (backend.armed()) backend.report(label, reason);
    },
  });
}
