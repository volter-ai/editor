/**
 * Render-mode AUDIO control seam (I6, "Encode and Mux" + the audio-capture
 * half of §13 G4). This is `render-control.ts`'s sibling for the audio side:
 * where that module publishes `window.__vgaiRender` (exact-time seeks +
 * composited frame passes), THIS module publishes `window.__vgaiRenderAudio` —
 * an OPT-IN surface a render-mode page installs only when it declares a score,
 * so `vgai render-cinematic` (`packages/vgai-cli/src/render-cinematic.ts`) can
 * detect "this cinematic has a deterministic audio track" with a single
 * property check (`__vgaiRenderAudio?.hasAudio === true`) rather than needing
 * a schema field threaded through every fixture.
 *
 * Deliberately a SEPARATE global from `__vgaiRender`/`VgaiRenderHarness`
 * (`render-control.ts`), not an extra method bolted onto that interface:
 * every existing render-mode page (I0's `render-cinematic` fixture, I8's
 * `reference-cinematic`) has no score at all, and this keeps their
 * bundles/tests completely untouched — `render-control.ts` itself is not
 * modified by this unit.
 *
 * ## What this module is, and what it deliberately is not
 *
 * `window.__vgaiRenderAudio` is a PROTOCOL — the surface the Node-side capture
 * driver reads through `page.evaluate`, the audio counterpart to a debug
 * adapter. That is why it stays in the engine. Producing the samples is not a
 * protocol, so it does not: {@link RenderAudioControlOptions.render} is
 * supplied by the caller and hands back a native `AudioBuffer`. This module
 * owns the render-mode gate, the WAV encoding, and the base64 wire format.
 *
 * It used to call `renderToneOffline` itself, which put `tone` in the engine's
 * dependency list for a page that merely wanted to publish a global. The
 * offline renderer moved to the `music` capability (`src/lib/music/
 * tone-offline-render.ts`); a fixture composes the two in one line, and a page
 * scoring with anything else — a pre-rendered WAV decoded into an
 * `AudioBuffer`, a WebAudio `OfflineAudioContext` graph, another library —
 * satisfies the same contract without touching Tone at all.
 *
 * ## Why `renderAudio` takes `(start, end)` — the offset trap
 *
 * An offline render of `[10, 10.72)` schedules its first event at LOCAL time
 * 0, not absolute time 10. A render-mode page authors its score in
 * ABSOLUTE/canonical time (e.g. "a note at the same t=1.2s the video's
 * Director cut happens"), so whatever the caller's `render` does internally
 * must subtract the requested range's `start` from every scheduled event time.
 * With Tone that means building the `Tone.Offline` callback per call, closed
 * over `start` — see `renderToneOffline`'s own doc. This was the G12 review
 * follow-up named in the unit's build brief ("renderToneOffline gives the
 * composition LOCAL time 0 at `start`, so your composition must close over the
 * range/offset"); it is now the caller's to honour, and the capability's
 * fixture shows it.
 *
 * ## Wire format — why WAV bytes cross as base64, not a raw sample array
 *
 * `page.evaluate`'s return value is JSON-serialized; a `Float32Array`/
 * typed-array result would either fail to serialize or be coerced into a
 * verbose `{ "0": ..., "1": ... }` object, and a plain JS number array of
 * (potentially) hundreds of thousands of floats is slow to serialize and
 * bloats the IPC payload. Encoding the FULL WAV file (header + 16-bit PCM
 * data, `audio/wav-encode.ts`) to a single base64 string in-page keeps the
 * Node-side capture driver (`render-cinematic.ts`) to one
 * `Buffer.from(wavBase64, 'base64')` + one `writeFile` — no PCM assembly
 * logic duplicated on the Node side at all.
 */

import type { OfflineAudioRenderer } from '@volter/editor-project/adapter/render-audio';
import { encodeWav16, pcmStats } from '../audio/wav-encode';
import { isRenderModeRequested } from './render-control';

export type { OfflineAudioRenderer, RenderedAudio } from '@volter/editor-project/adapter/render-audio';

export interface RenderAudioControlOptions {
  /** See {@link OfflineAudioRenderer}. With the `music` capability this is one
   *  line over `renderToneOffline`; nothing here knows or cares that it is. */
  readonly render: OfflineAudioRenderer;
  /** Where to publish the harness. Defaults to the real `window` — override in a unit test. */
  readonly target?: Record<string, unknown>;
  /** Where to read `?vgai-render=1` from. Defaults to `window.location`. */
  readonly location?: { readonly search: string };
}

/** One offline audio render, encoded as a complete WAV file — the exact
 *  shape `render-cinematic.ts`'s capture driver reads back via `page.evaluate`. */
export interface RenderAudioResult {
  /** Base64 of a complete little-endian 16-bit-PCM RIFF/WAVE file (see
   *  `audio/wav-encode.ts`) — decode with `Buffer.from(wavBase64, 'base64')`. */
  readonly wavBase64: string;
  readonly sampleRate: number;
  readonly channels: number;
  readonly durationSeconds: number;
  /** RMS/peak over the raw PCM, BEFORE 16-bit quantization — lets a caller
   *  assert "genuinely non-silent audio, not a muxed-in silent track"
   *  without re-decoding the WAV it just received. */
  readonly rms: number;
  readonly peak: number;
}

/** The `window.__vgaiRenderAudio` surface. Presence of this global (guarded
 *  by `hasAudio: true`, never a bare `undefined`/`false` value on a present
 *  object) IS the "this cinematic declares a score" signal `render-
 *  cinematic.ts` checks — see this module's own top doc comment. */
export interface VgaiRenderAudioHarness {
  readonly hasAudio: true;
  /** Render `[start, end)` (absolute/canonical seconds, exactly the same
   *  range `window.__vgaiRender`'s frame walk covers), returning a complete
   *  WAV file. Deterministic: identical `(start, end)` on an unchanged score
   *  produces byte-identical `wavBase64` every call — this module adds no
   *  source of nondeterminism, so the property is exactly whatever the
   *  supplied {@link OfflineAudioRenderer} guarantees (with the `music`
   *  capability, the `Tone.Offline` determinism G2 already proves). */
  renderAudio(start: number, end: number): Promise<RenderAudioResult>;
}

/**
 * Build (and, when render mode is actually requested, publish) the
 * `window.__vgaiRenderAudio` harness — same AC-4-shaped production
 * protection as `installRenderControlHarness`: even called unconditionally
 * on every boot, this only ever constructs/attaches the harness when
 * `isRenderModeRequested(location)` is true, so a normal production gameplay
 * page never gets `window.__vgaiRenderAudio` (and normal play never
 * re-renders its music through an offline context — that would be a
 * separate, much stranger bug).
 */
export function installRenderAudioHarness(
  opts: RenderAudioControlOptions,
): VgaiRenderAudioHarness | undefined {
  const location = opts.location ?? window.location;
  if (!isRenderModeRequested(location)) return undefined;

  const target = opts.target ?? (window as unknown as Record<string, unknown>);
  const { render } = opts;

  const harness: VgaiRenderAudioHarness = {
    hasAudio: true,
    async renderAudio(start: number, end: number): Promise<RenderAudioResult> {
      const rendered = await render(start, end);
      const channelData: Float32Array[] = [];
      for (let ch = 0; ch < rendered.buffer.numberOfChannels; ch++) {
        channelData.push(rendered.buffer.getChannelData(ch));
      }
      const wavBytes = encodeWav16({ channelData, sampleRate: rendered.buffer.sampleRate });
      const stats = pcmStats(channelData);
      return {
        wavBase64: uint8ArrayToBase64(wavBytes),
        sampleRate: rendered.buffer.sampleRate,
        channels: rendered.buffer.numberOfChannels,
        durationSeconds: rendered.durationSeconds,
        rms: stats.rms,
        peak: stats.peak,
      };
    },
  };

  target['__vgaiRenderAudio'] = harness;
  return harness;
}

/** Browser-native base64 encode (`btoa`) over a `Uint8Array`, chunked so a
 *  multi-second stereo WAV doesn't blow `String.fromCharCode`'s argument-count
 *  limit in one call. Node has no `btoa` for arbitrary bytes reliably across
 *  versions, but this module only ever runs in the browser (render-mode
 *  pages), matching `tone-offline-render.ts`'s own "browser-only" contract. */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
