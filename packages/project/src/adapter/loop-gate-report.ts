/**
 * Capability-gate shortfall reporting (D10, T7.6) — the honesty half of the
 * play-control contract. §(d) draws the `loop` axis (`gated | self-driven`) on
 * its own: a `self-driven` world (an ingested game
 * driving its own rAF/ticker) pauses for real ONLY if its adapter implements an
 * explicit loop-gate capability (`MountedRootBase.setPaused`/`step`) —
 * otherwise it "honestly reports so" rather than a silent no-op (the
 * D5 §5.2 finding: gating a raw-rAF loop from outside was
 * demonstrated and REJECTED). The audio seam (`SystemAdapters.AudioAdapter`)
 * has the identical shape: absent or unable to silence a world's audio on pause
 * must report, not pretend.
 *
 * Pure compute + message-formatting — callers own the actual
 * `console.warn`/`editorConsole.warn` call; this module never logs.
 */

/** Greppable prefix for a loop-gate shortfall (pause requested, world's loop
 *  could not actually be gated). */
export const LOOP_GATE_PREFIX = 'loop-gate';

/** Greppable prefix for an audio-gate shortfall (pause requested, world's
 *  audio could not actually be silenced). */
export const AUDIO_GATE_PREFIX = 'audio-gate';

/** One shortfall instance: which world, and why the capability wasn't there. */
export interface CapabilityGateReport {
  readonly worldId: string;
  readonly reason: string;
}

function formatGateMessage(
  prefix: string,
  capability: string,
  report: CapabilityGateReport,
): string {
  return (
    `${prefix} world "${report.worldId}": pause requested but ${capability} cannot be gated ` +
    `(${report.reason}) — reporting honestly instead of silently no-op-ing. ` +
    `${prefix} ${JSON.stringify(report)}`
  );
}

/** Format a loop-gate shortfall message (a `self-driven` world with no
 *  working pause capability). */
export function formatLoopGateMessage(report: CapabilityGateReport): string {
  return formatGateMessage(LOOP_GATE_PREFIX, "this world's loop", report);
}

/** Format an audio-gate shortfall message (a world with no `AudioAdapter`, or
 *  whose adapter cannot actually silence it). */
export function formatAudioGateMessage(report: CapabilityGateReport): string {
  return formatGateMessage(AUDIO_GATE_PREFIX, "this world's audio", report);
}
