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
import { MIDIBuilder, SoundBankLoader, SpessaSynthProcessor } from 'spessasynth_core';

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
export function pieceToMidi(piece: Piece, passes = 1, only?: ReadonlySet<string>): MIDIBuilder {
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
    // A file for another DAW carries the channel's level and pan as CC7/CC10.
    const volume = Math.max(0, Math.min(127, Math.round(127 * 10 ** ((track.channel?.volume ?? 0) / 40))));
    midi.controllerChange(0, trackIndex, channel, 7, volume);
    midi.controllerChange(0, trackIndex, channel, 10, Math.max(0, Math.min(127, Math.round(64 + (track.channel?.pan ?? 0) * 63))));
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

/** Every MIDI channel of the piece rendered once, dry, for the requested passes and a tail. */
export interface RenderedChannels {
  readonly piece: Piece;
  readonly sampleRate: number;
  readonly loopSeconds: number;
  readonly channels: readonly [Float32Array, Float32Array][];
  readonly irs: ReadonlyMap<string, ImpulseResponse>;
}

/** One thing the synth does, at one sample: a note, a controller, a channel's setup. */
interface SynthEvent {
  readonly sample: number;
  /** Among events on one sample: setup first, then controllers, note-offs, note-ons. */
  readonly rank: number;
  readonly apply: (synth: SpessaSynthProcessor) => void;
}

/** A stretch of the piece, in beats: a section from its marker to the next. */
export interface BeatWindow {
  readonly fromBeat: number;
  readonly toBeat: number;
}

/**
 * The piece's performance as synth events at exact samples, `passes` times through. Each audible
 * track's channel is set up at sample 0 (bank, program, and unity level and centre: the mix's
 * faders and panners apply the channel's own, once, exactly as the editor does); then every
 * controller and note at the sample its performed second falls on.
 *
 * A `window` is that stretch of the SAME performance, not a performance of a shorter piece: the
 * notes that start in it, played exactly as they are in the whole piece (the humanize drift is a
 * walk over the whole track, so a section performed on its own would drift differently), and each
 * controller's value at the window's start carried in.
 */
function synthEvents(
  piece: Piece,
  passes: number,
  sampleRate: number,
  window: BeatWindow | undefined,
  bankOffset: ReadonlyMap<string, number>,
): { events: SynthEvent[]; loopSeconds: number } {
  const performance = perform(piece);
  const assignments = assignChannels(piece);
  const channelOf = new Map([...assignments].map(([trackId, assignment]) => [trackId, assignment.channel]));
  const from = window ? performance.secondsAt(window.fromBeat) : 0;
  const to = window ? performance.secondsAt(window.toBeat) : performance.secondsAt(Math.max(1, piece.length));
  const loopSeconds = to - from;
  const inWindow = (second: number): boolean => second >= from - 1e-9 && second < to - 1e-9;
  // Each controller's last value before the window, sounding from its first sample.
  const carried = new Map<string, (typeof performance.controls)[number]>();
  for (const control of performance.controls) {
    if (control.time >= from - 1e-9) continue;
    const key = `${control.track}:${control.controller}`;
    const held = carried.get(key);
    if (!held || held.time <= control.time) carried.set(key, control);
  }
  const controls = [...[...carried.values()].map((control) => ({ ...control, time: 0 })), ...performance.controls.filter((control) => inWindow(control.time)).map((control) => ({ ...control, time: control.time - from }))];
  const notes = performance.notes.filter((note) => inWindow(note.start)).map((note) => ({ ...note, start: note.start - from, end: note.end - from }));
  const events: SynthEvent[] = [];
  for (const track of audibleTracks(piece)) {
    const assignment = assignments.get(track.id)!;
    const { channel } = assignment;
    events.push({
      sample: 0,
      rank: 0,
      apply: (synth) => {
        if (channel !== DRUM_CHANNEL) {
          synth.controllerChange(channel, 0 as never, (bankOffset.get(assignment.bank) ?? 0) + assignment.bankNumber);
          synth.programChange(channel, assignment.program);
        }
        synth.controllerChange(channel, 7 as never, 127);
        synth.controllerChange(channel, 10 as never, 64);
      },
    });
  }
  const audible = new Set(audibleTracks(piece).map((track) => track.id));
  for (let pass = 0; pass < passes; pass++) {
    const at = (seconds: number): number => Math.round((pass * loopSeconds + seconds) * sampleRate);
    for (const control of controls) {
      const channel = channelOf.get(control.track);
      if (channel === undefined || !audible.has(control.track)) continue;
      if (control.controller === 'pitchbend') {
        const value = Math.max(0, Math.min(16383, Math.round(8192 + control.value * 8191)));
        events.push({ sample: at(control.time), rank: 1, apply: (synth) => synth.pitchWheel(channel, value) });
      } else {
        const controller = control.controller;
        const value = Math.max(0, Math.min(127, Math.round(control.value * 127)));
        events.push({ sample: at(control.time), rank: 1, apply: (synth) => synth.controllerChange(channel, controller as never, value) });
      }
    }
    for (const note of notes) {
      const channel = channelOf.get(note.track);
      if (channel === undefined || !audible.has(note.track)) continue;
      const velocity = Math.max(1, Math.min(127, Math.round(note.velocity * 127)));
      const on = at(note.start);
      events.push({ sample: on, rank: 3, apply: (synth) => synth.noteOn(channel, note.pitch, velocity) });
      events.push({ sample: Math.max(on + 1, at(note.end)), rank: 2, apply: (synth) => synth.noteOff(channel, note.pitch) });
    }
  }
  return { events: events.sort((a, b) => a.sample - b.sample || a.rank - b.rank), loopSeconds };
}

/**
 * Run the synth once over the whole piece (two passes by default, plus a tail), each MIDI channel
 * into its own stereo buffer with the synth's own effects off. The mix and every stem are then
 * mixed from these buffers (`mixLoop`), so a stem is exactly its track's share of the mix.
 *
 * The synth is driven from the performance directly, every event on its exact sample: the audio
 * is rendered up to an event, the event applied, and on. Through a MIDI file and a sequencer
 * ticked once per 128-sample block, each note landed up to 2.7 ms late, differently for every
 * pass and every section; measured on one slice rendered twice, the two passes nulled at +1.8 dB
 * when the loop was not a whole number of blocks and −15.9 dB when it was.
 */
export async function renderChannels(
  piece: Piece,
  /** Every sound bank the piece's soundfont devices name, by project path. */
  soundBanks: ReadonlyMap<string, ArrayBuffer>,
  sampleRate = 48_000,
  tailSeconds = 4,
  irs: ReadonlyMap<string, ImpulseResponse> = new Map(),
  passes = 2,
  window?: BeatWindow,
): Promise<RenderedChannels> {
  const synth = new SpessaSynthProcessor(sampleRate, { eventsEnabled: false });
  // Each bank at its own offset, one above the highest bank number already loaded, so a track's
  // `params.bank` is the bank it plays: its channel selects `offset + bankNumber`.
  const bankOffset = new Map<string, number>();
  let next = 0;
  for (const path of new Set([...assignChannels(piece).values()].map((assignment) => assignment.bank))) {
    const bytes = soundBanks.get(path);
    if (!bytes) throw new Error(`The sound bank ${path} was not loaded.`);
    const bank = SoundBankLoader.fromArrayBuffer(bytes);
    synth.soundBankManager.addSoundBank(bank, path, next);
    bankOffset.set(path, next);
    next += Math.max(0, ...bank.presets.map((preset) => preset.bankMSB).filter((msb) => msb < 128)) + 1;
  }
  await synth.processorInitialized;
  synth.setSystemParameter('autoAllocateVoices', true);
  // The mix owns space and level (`mix/offline-mix.ts`): the synth's own reverb and chorus are off.
  synth.setSystemParameter('effectsEnabled', false);
  const { events, loopSeconds } = synthEvents(piece, passes, sampleRate, window, bankOffset);
  const total = Math.ceil(sampleRate * (passes * loopSeconds + tailSeconds));
  const channels = Array.from({ length: 16 }, () => [new Float32Array(total), new Float32Array(total)] as [Float32Array, Float32Array]);
  const effectsLeft = new Float32Array(total);
  const effectsRight = new Float32Array(total);
  const block = 128;
  let filled = 0;
  const renderTo = (sample: number): void => {
    while (filled < sample) {
      const count = Math.min(block, sample - filled);
      synth.processSplit(channels, effectsLeft, effectsRight, filled, count);
      filled += count;
    }
  };
  for (const event of events) {
    if (event.sample >= total) break;
    renderTo(event.sample);
    event.apply(synth);
  }
  renderTo(total);
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

/** Mix a single pass and its entire tail, with a 10 ms fade to silence at the end. */
export function mixOneShot(rendered: RenderedChannels, only?: ReadonlySet<string>): RenderedLoop {
  const { piece, sampleRate, irs } = rendered;
  const channelOf = new Map([...assignChannels(piece)].map(([id, assignment]) => [id, assignment.channel]));
  const [left, right] = mix(piece, { channels: rendered.channels, channelOf, sampleRate, irs, ...(only ? { only } : {}) });
  const fade = Math.min(Math.round(0.01 * sampleRate), left.length);
  for (const channel of [left, right]) {
    for (let i = 0; i < fade; i++) channel[channel.length - fade + i]! *= (fade - 1 - i) / Math.max(1, fade - 1);
  }
  return { sampleRate, left, right, loopSeconds: left.length / sampleRate };
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
