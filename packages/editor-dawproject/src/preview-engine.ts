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
 * The mix is `mix/live-mix.ts`: each channel's own output through its strip, buses and master,
 * the same graph the export renders. `mute`/`solo` also leave notes unscheduled.
 */

import { type Performance, perform } from '@volter/dawproject/perform';
import type { Piece, PieceTrack } from '@volter/dawproject/piece';
import { projectModuleUrl } from '@volter/editor-sdk/contributions';
import { WorkletSynthesizer } from 'spessasynth_lib';
import { LiveMix, mixSignature, servedIrLoader } from './mix/live-mix';
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
  /** The mix graph the synth's channel outputs feed (`mix/live-mix.ts`). */
  private mix: LiveMix | null = null;
  private mixBuiltFor = '';
  private readonly loadedBanks = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private piece: Piece | null = null;
  /** The piece's performance (`perform`): what the export renders, scheduled here live. */
  private performance: Performance | null = null;
  /** Audio time at which piece-second `originSecond` sounded. */
  private originTime = 0;
  private originSecond = 0;
  /** Piece-seconds (counting up across loop passes) already handed to the synth. */
  private scheduledTo = 0;
  private listeners = new Set<(state: EngineState) => void>();
  private state: EngineState = { kind: 'idle' };

  /** The engine's state now (a subscriber hears each change; this answers a read). */
  get current(): EngineState {
    return this.state;
  }

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
    this.performance = perform(piece);
    if (this.synth && this.state.kind === 'playing') {
      this.applyMix(piece);
      void this.rebuildMix(piece).catch((error: unknown) =>
        this.setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) }),
      );
    }
  }

  /** Rebuild the mix graph when the piece's strips, devices or sends changed. */
  private async rebuildMix(piece: Piece): Promise<void> {
    const synth = this.synth;
    const mix = this.mix;
    if (!synth || !mix) return;
    const signature = mixSignature(piece);
    if (signature === this.mixBuiltFor) return;
    this.mixBuiltFor = signature;
    if (mix.channelInputs.length > 0) synth.disconnectIndividualOutputs(mix.channelInputs);
    const channelOf = new Map<string, number>();
    for (const [trackId, voice] of trackVoices(piece)) if (voice) channelOf.set(trackId, voice.channel);
    await mix.build(piece, channelOf);
    synth.connectIndividualOutputs(mix.channelInputs);
  }

  /** The beat under the playhead, or `null` when stopped. */
  playhead(): number | null {
    const performance = this.performance;
    if (!this.context || this.state.kind !== 'playing' || !performance || performance.seconds <= 0) return null;
    const elapsed = this.originSecond + (this.context.currentTime - this.originTime);
    return performance.beatAt(((elapsed % performance.seconds) + performance.seconds) % performance.seconds);
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
        await this.synth.isReady;
        // The mix owns space and level: the synth's own reverb and chorus are off, and each MIDI
        // channel comes out separately into its track's strip.
        this.synth.setSystemParameter('effectsEnabled', false);
        const context = this.context;
        this.mix = new LiveMix(context, servedIrLoader(context));
      }
      await this.rebuildMix(piece);
      await this.loadBanks(piece);
      this.stopTimer();
      this.synth?.stopAll(true);
      this.performance = perform(piece);
      this.originSecond = this.performance.secondsAt(fromBeat);
      this.originTime = this.context.currentTime + 0.05;
      this.scheduledTo = this.originSecond;
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
    this.mix?.dispose();
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
      // Level and pan are the mix's faders and panners (`mix/live-mix.ts`), not the synth's
      // controllers, so they are applied once; the synth channel stays at unity and centre.
      synth.controllerChange(voice.channel, 7, 127);
      synth.controllerChange(voice.channel, 10, 64);
    }
  }

  private tick(): void {
    const context = this.context;
    const synth = this.synth;
    const piece = this.piece;
    const performance = this.performance;
    if (!context || !synth || !piece || !performance || performance.seconds <= 0) return;
    const span = performance.seconds;
    const horizon = this.originSecond + (context.currentTime + LOOKAHEAD_S - this.originTime);
    if (horizon <= this.scheduledTo) return;
    const voices = trackVoices(piece);
    const audibleTracks = new Map(piece.tracks.map((track) => [track.id, audible(piece, track)]));
    const at = (second: number): number => this.originTime + (second - this.originSecond);
    let from = this.scheduledTo;
    while (from < horizon) {
      // Piece-seconds count up across passes; each pass is folded into the loop to find its events.
      const passStart = Math.floor(from / span) * span;
      const to = Math.min(horizon, passStart + span);
      const localFrom = from - passStart;
      const localTo = to - passStart;
      for (const control of performance.controls) {
        if (control.time < localFrom || control.time >= localTo) continue;
        const voice = voices.get(control.track);
        if (!voice || !audibleTracks.get(control.track)) continue;
        const when = { time: at(passStart + control.time) };
        if (control.controller === 'pitchbend') {
          synth.pitchWheel(voice.channel, Math.max(0, Math.min(16383, Math.round(8192 + control.value * 8191))), when);
        } else {
          synth.controllerChange(voice.channel, control.controller as never, Math.max(0, Math.min(127, Math.round(control.value * 127))), when);
        }
      }
      for (const note of performance.notes) {
        if (note.start < localFrom || note.start >= localTo) continue;
        const voice = voices.get(note.track);
        if (!voice || !audibleTracks.get(note.track)) continue;
        const velocity = Math.max(1, Math.min(127, Math.round(note.velocity * 127)));
        synth.noteOn(voice.channel, note.pitch, velocity, { time: at(passStart + note.start) });
        synth.noteOff(voice.channel, note.pitch, { time: at(passStart + note.end) });
      }
      from = to;
    }
    this.scheduledTo = horizon;
  }
}
