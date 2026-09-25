/**
 * OFFLINE RENDER: a piece to audio with the same engine and sound bank the editor plays it with
 * (SpessaSynth's core, which needs no browser), and to a Standard MIDI File on the way.
 *
 * The loop is rendered the way `volter-ai/music-engine` renders one: two passes and a tail, and
 * the SECOND pass is kept, so the reverb and release of the first pass sound under the start of
 * the loop, as they will when a game plays it on repeat. A short equal-power crossfade guards the
 * cut. Every value here comes from the piece; nothing is invented for it.
 */

import { perform } from '@volter/dawproject/perform';
import type { Piece } from '@volter/dawproject/piece';
import { type ImpulseResponse, mix } from './mix/offline-mix';
import { MIDIBuilder, SoundBankLoader, SpessaSynthProcessor, SpessaSynthSequencer } from 'spessasynth_core';

const PPQ = 480;
const DRUM_CHANNEL = 9;

export interface TrackAssignment {
  readonly channel: number;
  readonly program: number;
  readonly bankNumber: number;
  readonly bank: string;
}

/** Each audible track's MIDI channel and preset, in track order (channel 10 kept for drums). */
export function assignChannels(piece: Piece): Map<string, TrackAssignment> {
  const out = new Map<string, TrackAssignment>();
  let next = 0;
  for (const track of piece.tracks) {
    const device = track.channel?.devices.find((candidate) => candidate.plugin === 'soundfont');
    const bank = device?.params['bank'];
    if (!device || typeof bank !== 'string') continue;
    const drums = device.params['drums'] === true;
    let channel = DRUM_CHANNEL;
    if (!drums) {
      if (next === DRUM_CHANNEL) next++;
      channel = next++ % 16;
    }
    out.set(track.id, {
      channel,
      bank,
      program: typeof device.params['program'] === 'number' ? device.params['program'] : 0,
      bankNumber: typeof device.params['bankNumber'] === 'number' ? device.params['bankNumber'] : 0,
    });
  }
  return out;
}

/** The tracks that sound in a full render: a soundfont device, not muted, and soloed when any track is. */
export function audibleTracks(piece: Piece): Piece['tracks'] {
  const assignments = assignChannels(piece);
  const soloed = piece.tracks.some((track) => track.channel?.solo);
  return piece.tracks.filter((track) => assignments.has(track.id) && !track.channel?.mute && (!soloed || track.channel?.solo));
}

/**
 * The piece as a type-1 Standard MIDI File, `passes` times through, from its PERFORMANCE
 * (`perform`): the same notes, lengths, velocities and controller events the editor plays.
 * Seconds go back to musical ticks through the tempo map's inverse, and the map itself is
 * written as tempo events (one per quarter beat where it moves), so another DAW sees the
 * ritardando on its grid.
 *
 * `only` (track ids) writes a subset of the audible tracks, on the channels they have in the
 * full piece: a stem is the same performance with the other tracks left out.
 */
export function pieceToMidi(piece: Piece, passes = 1, only?: ReadonlySet<string>, forMix = false): MIDIBuilder {
  const performance = perform(piece);
  const midi = new MIDIBuilder({ timeDivision: PPQ, initialTempo: piece.transport.tempo, name: 'piece', format: 1 });
  const assignments = assignChannels(piece);
  const audible = new Set(audibleTracks(piece).map((track) => track.id));
  const span = Math.max(1, piece.length);
  const tick = (seconds: number, pass: number): number => Math.max(0, Math.round((pass * span + performance.beatAt(seconds)) * PPQ));
  // Tempo events on the conductor track (track 0).
  for (let pass = 0; pass < passes; pass++) {
    let last = Number.NaN;
    for (let beat = 0; beat < span; beat += 0.25) {
      const bpm = (0.25 * 60) / (performance.secondsAt(beat + 0.25) - performance.secondsAt(beat));
      if (Number.isNaN(last) || Math.abs(bpm - last) > 0.05) {
        if (pass > 0 || beat > 0) midi.setTempo(Math.round((pass * span + beat) * PPQ), bpm);
        last = bpm;
      }
    }
  }
  let trackIndex = 0;
  for (const track of piece.tracks) {
    const assignment = assignments.get(track.id);
    if (!assignment || !audible.has(track.id)) continue;
    if (only && !only.has(track.id)) continue;
    trackIndex++;
    midi.addTrack(track.name);
    const { channel } = assignment;
    if (channel !== DRUM_CHANNEL) {
      midi.controllerChange(0, trackIndex, channel, 0, assignment.bankNumber);
      midi.programChange(0, trackIndex, channel, assignment.program);
    }
    // A file for another DAW carries the channel's level and pan as CC7/CC10. Rendered through the
    // mix (`forMix`), the synth channel stays at unity and centre: the mix's faders and panners
    // apply them, once, exactly as the editor does.
    const volume = forMix ? 127 : Math.max(0, Math.min(127, Math.round(127 * 10 ** ((track.channel?.volume ?? 0) / 40))));
    midi.controllerChange(0, trackIndex, channel, 7, volume);
    midi.controllerChange(0, trackIndex, channel, 10, forMix ? 64 : Math.max(0, Math.min(127, Math.round(64 + (track.channel?.pan ?? 0) * 63))));
    for (let pass = 0; pass < passes; pass++) {
      for (const control of performance.controls) {
        if (control.track !== track.id) continue;
        if (control.controller === 'pitchbend') {
          midi.pitchWheel(tick(control.time, pass), trackIndex, channel, Math.max(0, Math.min(16383, Math.round(8192 + control.value * 8191))));
        } else {
          midi.controllerChange(tick(control.time, pass), trackIndex, channel, control.controller, Math.max(0, Math.min(127, Math.round(control.value * 127))));
        }
      }
      for (const note of performance.notes) {
        if (note.track !== track.id) continue;
        const velocity = Math.max(1, Math.min(127, Math.round(note.velocity * 127)));
        midi.noteOn(tick(note.start, pass), trackIndex, channel, note.pitch, velocity);
        midi.noteOff(Math.max(tick(note.start, pass) + 1, tick(note.end, pass)), trackIndex, channel, note.pitch);
      }
    }
  }
  midi.flush();
  return midi;
}

export interface RenderedLoop {
  readonly sampleRate: number;
  readonly left: Float32Array;
  readonly right: Float32Array;
  readonly loopSeconds: number;
}

/** Every MIDI channel of the piece rendered once, dry, for two passes and a tail. */
export interface RenderedChannels {
  readonly piece: Piece;
  readonly sampleRate: number;
  readonly loopSeconds: number;
  readonly channels: readonly [Float32Array, Float32Array][];
  readonly irs: ReadonlyMap<string, ImpulseResponse>;
}

/**
 * Run the synth once over the whole piece (two passes and a tail), each MIDI channel into its own
 * stereo buffer with the synth's own effects off. The mix and every stem are then mixed from these
 * buffers (`mixLoop`), so a stem is exactly its track's share of the mix.
 */
export async function renderChannels(
  piece: Piece,
  soundBank: ArrayBuffer,
  sampleRate = 48_000,
  tailSeconds = 4,
  irs: ReadonlyMap<string, ImpulseResponse> = new Map(),
): Promise<RenderedChannels> {
  const synth = new SpessaSynthProcessor(sampleRate, { eventsEnabled: false });
  synth.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(soundBank), 'main');
  await synth.processorInitialized;
  synth.setSystemParameter('autoAllocateVoices', true);
  // The mix owns space and level (`mix/offline-mix.ts`): the synth's own reverb and chorus are off.
  synth.setSystemParameter('effectsEnabled', false);
  const sequencer = new SpessaSynthSequencer(synth);
  // The sequencer skips leading silence by default, which would slide a stem whose first note is
  // late (and a humanised mix by its first note's drift) off the piece's own clock.
  sequencer.skipToFirstNoteOn = false;
  sequencer.loadNewSongList([pieceToMidi(piece, 2, undefined, true)]);
  sequencer.play();
  const loopSeconds = perform(piece).secondsAt(Math.max(1, piece.length));
  const total = Math.ceil(sampleRate * (2 * loopSeconds + tailSeconds));
  const channels = Array.from({ length: 16 }, () => [new Float32Array(total), new Float32Array(total)] as [Float32Array, Float32Array]);
  const effectsLeft = new Float32Array(total);
  const effectsRight = new Float32Array(total);
  const block = 128;
  for (let filled = 0; filled < total; filled += block) {
    sequencer.processTick();
    synth.processSplit(channels, effectsLeft, effectsRight, filled, Math.min(block, total - filled));
  }
  return { piece, sampleRate, loopSeconds, channels, irs };
}

/**
 * One seamless loop from rendered channels: the mix (strips, sends, buses, master), second pass
 * kept. `only` (track ids) mixes just those tracks, with their buses (a stem).
 */
export function mixLoop(rendered: RenderedChannels, only?: ReadonlySet<string>): RenderedLoop {
  const { piece, sampleRate, loopSeconds, irs } = rendered;
  const channelOf = new Map([...assignChannels(piece)].map(([trackId, assignment]) => [trackId, assignment.channel]));
  const [left, right] = mix(piece, { channels: rendered.channels, channelOf, sampleRate, irs, ...(only ? { only } : {}) });
  const loopSamples = Math.round(loopSeconds * sampleRate);
  const start = loopSamples;
  const outLeft = left.slice(start, start + loopSamples);
  const outRight = right.slice(start, start + loopSamples);
  // What truly precedes the loop's first sample is the end of the FIRST pass. Crossfade the loop's
  // last 30 ms toward those samples, so on repeat the wrap lands exactly where the render continued.
  const fade = Math.min(Math.round(0.03 * sampleRate), loopSamples);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    const index = loopSamples - fade + i;
    const before = start - fade + i;
    outLeft[index] = (outLeft[index] ?? 0) * Math.cos((t * Math.PI) / 2) + (left[before] ?? 0) * Math.sin((t * Math.PI) / 2);
    outRight[index] = (outRight[index] ?? 0) * Math.cos((t * Math.PI) / 2) + (right[before] ?? 0) * Math.sin((t * Math.PI) / 2);
  }
  return { sampleRate, left: outLeft, right: outRight, loopSeconds };
}

/** Render one seamless loop of the piece (its channels, then the mix). */
export async function renderLoop(
  piece: Piece,
  soundBank: ArrayBuffer,
  sampleRate = 48_000,
  tailSeconds = 4,
  only?: ReadonlySet<string>,
  irs: ReadonlyMap<string, ImpulseResponse> = new Map(),
): Promise<RenderedLoop> {
  return mixLoop(await renderChannels(piece, soundBank, sampleRate, tailSeconds, irs), only);
}

/** The loop seam: the step across the wrap against the typical sample-to-sample step. Under 1 means no click. */
export function seamRatio(loop: RenderedLoop): number {
  const steps: number[] = [];
  for (let i = 1; i < loop.left.length; i += 97) steps.push(Math.abs((loop.left[i] ?? 0) - (loop.left[i - 1] ?? 0)));
  steps.sort((a, b) => a - b);
  const typical = steps[Math.floor(steps.length * 0.99)] ?? 1e-9;
  const wrap = Math.abs((loop.left[0] ?? 0) - (loop.left[loop.left.length - 1] ?? 0));
  return wrap / Math.max(typical, 1e-9);
}
