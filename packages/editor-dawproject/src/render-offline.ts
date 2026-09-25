/**
 * OFFLINE RENDER: a piece to audio with the same engine and sound bank the editor plays it with
 * (SpessaSynth's core, which needs no browser), and to a Standard MIDI File on the way.
 *
 * The loop is rendered the way `volter-ai/music-engine` renders one: two passes and a tail, and
 * the SECOND pass is kept, so the reverb and release of the first pass sound under the start of
 * the loop, as they will when a game plays it on repeat. A short equal-power crossfade guards the
 * cut. Every value here comes from the piece; nothing is invented for it.
 */

import type { Piece } from '@volter/dawproject/piece';
import { secondsPerBeat } from '@volter/dawproject/piece';
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

/** The piece as a type-1 Standard MIDI File, `passes` times through. */
export function pieceToMidi(piece: Piece, passes = 1): MIDIBuilder {
  const midi = new MIDIBuilder({ timeDivision: PPQ, initialTempo: piece.transport.tempo, name: 'piece', format: 1 });
  const assignments = assignChannels(piece);
  const soloed = piece.tracks.some((track) => track.channel?.solo);
  const span = Math.max(1, piece.length);
  let trackIndex = 0;
  for (const track of piece.tracks) {
    const assignment = assignments.get(track.id);
    if (!assignment) continue;
    if (track.channel?.mute || (soloed && !track.channel?.solo)) continue;
    trackIndex++;
    midi.addTrack(track.name);
    const { channel } = assignment;
    if (channel !== DRUM_CHANNEL) {
      midi.controllerChange(0, trackIndex, channel, 0, assignment.bankNumber);
      midi.programChange(0, trackIndex, channel, assignment.program);
    }
    const volume = Math.max(0, Math.min(127, Math.round(127 * 10 ** ((track.channel?.volume ?? 0) / 40))));
    midi.controllerChange(0, trackIndex, channel, 7, volume);
    midi.controllerChange(0, trackIndex, channel, 10, Math.max(0, Math.min(127, Math.round(64 + (track.channel?.pan ?? 0) * 63))));
    for (let pass = 0; pass < passes; pass++) {
      for (const clip of track.clips) {
        for (const note of clip.notes) {
          const on = Math.round((pass * span + note.start) * PPQ);
          const off = Math.round((pass * span + note.start + Math.max(0.02, note.duration)) * PPQ);
          const velocity = Math.max(1, Math.min(127, Math.round(note.vel * 127)));
          midi.noteOn(on, trackIndex, channel, note.pitch, velocity);
          midi.noteOff(off, trackIndex, channel, note.pitch);
        }
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

/** Render one seamless loop of the piece: two passes and a tail, second pass kept. */
export async function renderLoop(piece: Piece, soundBank: ArrayBuffer, sampleRate = 48_000, tailSeconds = 4): Promise<RenderedLoop> {
  const synth = new SpessaSynthProcessor(sampleRate, { eventsEnabled: false });
  synth.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(soundBank), 'main');
  await synth.processorInitialized;
  synth.setSystemParameter('autoAllocateVoices', true);
  const sequencer = new SpessaSynthSequencer(synth);
  sequencer.loadNewSongList([pieceToMidi(piece, 2)]);
  sequencer.play();
  const loopSeconds = Math.max(1, piece.length) * secondsPerBeat(piece);
  const total = Math.ceil(sampleRate * (2 * loopSeconds + tailSeconds));
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const block = 128;
  for (let filled = 0; filled < total; filled += block) {
    sequencer.processTick();
    synth.process(left, right, filled, Math.min(block, total - filled));
  }
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

/** The loop seam: the step across the wrap against the typical sample-to-sample step. Under 1 means no click. */
export function seamRatio(loop: RenderedLoop): number {
  const steps: number[] = [];
  for (let i = 1; i < loop.left.length; i += 97) steps.push(Math.abs((loop.left[i] ?? 0) - (loop.left[i - 1] ?? 0)));
  steps.sort((a, b) => a - b);
  const typical = steps[Math.floor(steps.length * 0.99)] ?? 1e-9;
  const wrap = Math.abs((loop.left[0] ?? 0) - (loop.left[loop.left.length - 1] ?? 0));
  return wrap / Math.max(typical, 1e-9);
}
