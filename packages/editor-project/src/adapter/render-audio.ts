/**
 * The offline-audio seam: what a caller's renderer hands back, and the
 * function shape that produces it. The contract owns both because
 * `SystemAdapters`'s audio door names them; the harness that drives a renderer
 * is the game runtime's (`@vgai/game-runtime/runtime/render-audio-control`).
 */

/** What a caller's renderer hands back: real PCM in a native `AudioBuffer`.
 *  `AudioBuffer` — not a vgai type — is the point: any offline audio path in
 *  the platform already produces one. */
export interface RenderedAudio {
  readonly buffer: AudioBuffer;
  readonly durationSeconds: number;
}

/** Render `[start, end)` (absolute/canonical seconds) offline and
 *  deterministically. The offset trap in the module doc is the renderer's to
 *  honour: identical `(start, end)` on an unchanged score must produce
 *  identical samples, since the capture driver relies on it. */
export type OfflineAudioRenderer = (start: number, end: number) => Promise<RenderedAudio>;
