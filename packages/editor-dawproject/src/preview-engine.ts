/**
 * PLAYBACK: the piece's notes scheduled ahead of the audio clock into a SoundFont synthesizer
 * (SpessaSynth, an SF2/SF3 engine in an AudioWorklet), the way a DAW's engine runs a lookahead
 * scheduler. Every tick reads the LATEST piece, so an edit (the agent's or a person's) is heard
 * the next time the playhead reaches it, without stopping.
 *
 * The instrument is the track's `<Device plugin="soundfont">`: `params.bank` is a project path
 * to an .sf2/.sf3 file and `params.program`/`params.bankNumber` pick the preset (General MIDI
 * numbering). One MIDI channel per track, in track order, skipping channel 10 unless a device
 * asks for it (`params.drums`). A track with no soundfont device is silent and says so in the
 * track header; nothing is substituted for it.
 *
 * The mixer maps onto the channel's own controllers: `volume` (dB) to CC7 on General MIDI's
 * 40·log10 curve, `pan` to CC10, `mute`/`solo` by leaving notes unscheduled.
 */

import type { Piece, PieceTrack } from '@volter/dawproject/piece';
import { secondsPerBeat } from '@volter/dawproject/piece';
import { projectModuleUrl } from '@volter/editor-sdk/contributions';
import { WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';

const LOOKAHEAD_S = 0.2;
const TICK_MS = 25;
const DRUM_CHANNEL = 9;

export interface TrackVoice {
  readonly channel: number;
  readonly bank: string | null;
  readonly program: number;
  readonly bankNumber: number;
}

/** The MIDI channel and preset each track plays on, or `null` when it has no soundfont. */
export function trackVoices(piece: Piece): Map<string, TrackVoice | null> {
  const voices = new Map<string, TrackVoice | null>();
  let next = 0;
  for (const track of piece.tracks) {
    const device = track.channel?.devices.find((candidate) => candidate.plugin === 'soundfont');
    if (!device) {
      voices.set(track.id, null);
      continue;
    }
    const drums = device.params['drums'] === true;
    let channel = drums ? DRUM_CHANNEL : next;
    if (!drums) {
      if (next === DRUM_CHANNEL) next++;
      channel = next++;
    }
    const bank = typeof device.params['bank'] === 'string' ? device.params['bank'] : null;
    const program = typeof device.params['program'] === 'number' ? device.params['program'] : 0;
    const bankNumber = typeof device.params['bankNumber'] === 'number' ? device.params['bankNumber'] : 0;
    voices.set(track.id, { channel: channel % 16, bank, program, bankNumber });
  }
  return voices;
}

function volumeCc(db: number): number {
  return Math.max(0, Math.min(127, Math.round(127 * 10 ** (db / 40))));
}

function panCc(pan: number): number {
  return Math.max(0, Math.min(127, Math.round(64 + pan * 63)));
}

function audible(piece: Piece, track: PieceTrack): boolean {
  const soloed = piece.tracks.some((candidate) => candidate.channel?.solo);
  if (track.channel?.mute) return false;
  return !soloed || track.channel?.solo === true;
}

export type EngineState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly detail: string }
  | { readonly kind: 'playing' }
  | { readonly kind: 'error'; readonly message: string };

export class PreviewEngine {
  private context: AudioContext | null = null;
  private synth: WorkletSynthesizer | null = null;
  private readonly loadedBanks = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private piece: Piece | null = null;
  /** Audio time at which beat `originBeat` sounded. */
  private originTime = 0;
  private originBeat = 0;
  /** Beat up to which notes have been handed to the synth. */
  private scheduledTo = 0;
  private loopStart = 0;
  private loopEnd = 0;
  private listeners = new Set<(state: EngineState) => void>();
  private state: EngineState = { kind: 'idle' };

  subscribe(listener: (state: EngineState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private setState(state: EngineState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  /** Hand the engine the latest piece; a playing engine picks it up on its next tick. */
  update(piece: Piece): void {
    this.piece = piece;
    this.loopEnd = Math.max(this.loopStart + 1, piece.length);
    if (this.synth && this.state.kind === 'playing') this.applyMix(piece);
  }

  /** The beat under the playhead, or `null` when stopped. */
  playhead(): number | null {
    if (!this.context || this.state.kind !== 'playing' || !this.piece) return null;
    const spb = secondsPerBeat(this.piece);
    const beat = this.originBeat + (this.context.currentTime - this.originTime) / spb;
    const span = this.loopEnd - this.loopStart;
    return span > 0 ? this.loopStart + ((((beat - this.loopStart) % span) + span) % span) : beat;
  }

  async play(fromBeat = 0): Promise<void> {
    const piece = this.piece;
    if (!piece) return;
    try {
      if (!this.context) {
        this.setState({ kind: 'loading', detail: 'Starting the audio engine' });
        this.context = new AudioContext();
      }
      // Resume INSIDE the gesture that called play, before any await: the browser grants audio to
      // the click itself (autoplay policy), and a context that is still suspended after a moment
      // was not granted one; that is said plainly instead of waiting forever.
      const resumed = this.context.resume();
      if (this.context.state !== 'running') {
        const granted = await Promise.race([resumed.then(() => true), new Promise<boolean>((done) => setTimeout(() => done(false), 1500))]);
        if (!granted) {
          throw new Error('The browser is holding audio until you click in the editor (autoplay policy). Click Play.');
        }
      }
      if (!this.synth) {
        await this.context.audioWorklet.addModule(processorUrl);
        this.synth = new WorkletSynthesizer(this.context);
        this.synth.connect(this.context.destination);
        await this.synth.isReady;
      }
      await this.loadBanks(piece);
      this.stopTimer();
      this.synth?.stopAll(true);
      this.loopStart = 0;
      this.loopEnd = Math.max(1, piece.length);
      this.originBeat = fromBeat;
      this.originTime = this.context.currentTime + 0.05;
      this.scheduledTo = fromBeat;
      this.applyMix(piece);
      this.setState({ kind: 'playing' });
      this.tick();
      this.timer = setInterval(() => this.tick(), TICK_MS);
    } catch (error) {
      this.setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  stop(): void {
    this.stopTimer();
    this.synth?.stopAll(true);
    if (this.state.kind === 'playing') this.setState({ kind: 'idle' });
  }

  dispose(): void {
    this.stop();
    this.synth?.destroy();
    void this.context?.close();
    this.synth = null;
    this.context = null;
    this.listeners.clear();
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async loadBanks(piece: Piece): Promise<void> {
    const synth = this.synth;
    if (!synth) return;
    for (const voice of trackVoices(piece).values()) {
      if (!voice?.bank || this.loadedBanks.has(voice.bank)) continue;
      this.setState({ kind: 'loading', detail: `Loading ${voice.bank}` });
      const url = projectModuleUrl(voice.bank);
      if (!url) throw new Error(`No served address for ${voice.bank}.`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${voice.bank}: ${response.status} ${response.statusText}`);
      await synth.soundBankManager.addSoundBank(await response.arrayBuffer(), voice.bank);
      this.loadedBanks.add(voice.bank);
    }
  }

  private applyMix(piece: Piece): void {
    const synth = this.synth;
    if (!synth) return;
    const voices = trackVoices(piece);
    for (const track of piece.tracks) {
      const voice = voices.get(track.id);
      if (!voice) continue;
      if (voice.channel !== DRUM_CHANNEL) {
        synth.controllerChange(voice.channel, 0, voice.bankNumber);
        synth.programChange(voice.channel, voice.program);
      }
      synth.controllerChange(voice.channel, 7, volumeCc(track.channel?.volume ?? 0));
      synth.controllerChange(voice.channel, 10, panCc(track.channel?.pan ?? 0));
    }
  }

  private tick(): void {
    const context = this.context;
    const synth = this.synth;
    const piece = this.piece;
    if (!context || !synth || !piece) return;
    const spb = secondsPerBeat(piece);
    const span = this.loopEnd - this.loopStart;
    if (span <= 0) return;
    // Absolute beats count up forever; each is folded into the loop to find its notes.
    const horizonBeat = this.originBeat + (context.currentTime + LOOKAHEAD_S - this.originTime) / spb;
    if (horizonBeat <= this.scheduledTo) return;
    const voices = trackVoices(piece);
    let from = this.scheduledTo;
    while (from < horizonBeat) {
      const passStart = this.loopStart + Math.floor((from - this.loopStart) / span) * span;
      const to = Math.min(horizonBeat, passStart + span);
      const localFrom = from - passStart + this.loopStart;
      const localTo = to - passStart + this.loopStart;
      for (const track of piece.tracks) {
        const voice = voices.get(track.id);
        if (!voice || !audible(piece, track)) continue;
        for (const clip of track.clips) {
          for (const note of clip.notes) {
            if (note.start < localFrom || note.start >= localTo) continue;
            const absoluteBeat = passStart + (note.start - this.loopStart);
            const onAt = this.originTime + (absoluteBeat - this.originBeat) * spb;
            const offAt = onAt + Math.max(0.01, note.duration * spb);
            const velocity = Math.max(1, Math.min(127, Math.round(note.vel * 127)));
            synth.noteOn(voice.channel, note.pitch, velocity, { time: onAt });
            synth.noteOff(voice.channel, note.pitch, { time: offAt });
          }
        }
      }
      from = to;
    }
    this.scheduledTo = horizonBeat;
  }
}
