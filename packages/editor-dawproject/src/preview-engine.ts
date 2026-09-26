/**
 * PLAYBACK: the piece's notes scheduled ahead of the audio clock into a SoundFont synthesizer
 * (SpessaSynth, an SF2/SF3 engine in an AudioWorklet), the way a DAW's engine runs a lookahead
 * scheduler. Every tick reads the LATEST piece, so an edit (the agent's or a person's) is heard
 * the next time the playhead reaches it, without stopping.
 *
 * The instrument is the track's `<Device plugin="soundfont">`: `params.bank` is a project path
 * to an .sf2/.sf3 file and `params.program`/`params.bankNumber` pick the preset (General MIDI
 * numbering). One MIDI channel per track, in track order, skipping channel 10 unless a device
 * asks for it (`params.drums`). A track with no soundfont device, or one naming no bank, is silent
 * and says so in the track header; nothing is substituted for it (the export's `assignChannels`
 * skips the same tracks, so every later track sits on the same channel in both).
 *
 * The mix is `mix/live-mix.ts`: each channel's own output through its strip, buses and master,
 * the same graph the export renders. `mute`/`solo` also leave notes unscheduled.
 */

import { type Performance, perform } from '@volter/dawproject/perform';
import type { Piece, PieceTrack } from '@volter/dawproject/piece';
import { projectModuleUrl } from '@volter/editor-sdk/contributions';
import { WorkletSynthesizer } from 'spessasynth_lib';
import { type NotePatch, notePatches } from './articulations';
import { roundRobins } from './sfz-bank';
import { LiveMix, mixSignature, servedIrLoader } from './mix/live-mix';
import { stripLevels } from './mix/offline-mix';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';

const LOOKAHEAD_S = 0.2;

/**
 * Each track's channel set to its preset, at unity level and centre (the mix's strips apply the
 * channel's own). `bankOffset` is where each bank was loaded: the channel selects its offset plus
 * the device's `bankNumber`, so a track plays the bank its device names.
 */
export function setUpVoices(synth: WorkletSynthesizer, piece: Piece, bankOffset: ReadonlyMap<string, number>): void {
  const voices = trackVoices(piece);
  for (const track of piece.tracks) {
    const voice = voices.get(track.id);
    if (!voice) continue;
    // On the drum channel the program is the kit (GS numbering); bank offsets do not separate
    // kits, so a bank's kit is chosen by its own program number.
    if (voice.channel !== DRUM_CHANNEL) {
      synth.controllerChange(voice.channel, 0, (bankOffset.get(voice.bank) ?? 0) + voice.bankNumber);
    }
    synth.programChange(voice.channel, voice.program);
    // Level and pan are the mix's faders and panners (`mix/live-mix.ts`), not the synth's
    // controllers, so they are applied once; the synth channel stays at unity and centre.
    synth.controllerChange(voice.channel, 7, 127);
    synth.controllerChange(voice.channel, 10, 64);
  }
}

/** The stretch of the piece that repeats, in piece-seconds: the whole piece, or the loop region. */
export interface Region {
  readonly start: number;
  readonly end: number;
}

/** A stretch of playing time as the piece plays it: piece-seconds [from, to), heard at `offset` + piece-second. */
export interface Pass {
  readonly offset: number;
  readonly from: number;
  readonly to: number;
}

/**
 * Playing time [from, to) (seconds counting up from the piece's start, never wrapping) folded into
 * the piece: before the region it is the piece itself; from the region's start on, each pass
 * through the region is shifted back by the passes before it. So a play that starts ahead of a
 * loop region plays into it and then repeats it; the whole piece is the region that starts at 0.
 */
export function passes(from: number, to: number, region: Region): Pass[] {
  const length = region.end - region.start;
  if (length <= 0 || to <= from) return [];
  const found: Pass[] = [];
  let at = from;
  while (at < to) {
    if (at < region.start) {
      const end = Math.min(to, region.start);
      found.push({ offset: 0, from: at, to: end });
      at = end;
      continue;
    }
    const offset = Math.floor((at - region.start) / length) * length;
    const end = Math.min(to, region.end + offset);
    found.push({ offset, from: at - offset, to: end - offset });
    at = end;
  }
  return found;
}

/** Playing time as the piece-second it sounds (`passes`' fold, for one instant). */
export function foldSecond(second: number, region: Region): number {
  const length = region.end - region.start;
  if (second < region.start || length <= 0) return second;
  return region.start + ((((second - region.start) % length) + length) % length);
}

/**
 * Hand the synth every note and controller of the performance whose playing time falls in
 * [from, to), folded into the repeating `region` (`passes`), each timestamped `at(second)` on the
 * audio clock. The engine's timer calls it for the stretch ahead of the playhead.
 */
export function scheduleSpan(
  synth: WorkletSynthesizer,
  piece: Piece,
  performance: Performance,
  fromSecond: number,
  toSecond: number,
  at: (second: number) => number,
  /** Each note's bank and program where they change note by note (`patchesFor`). */
  patches: ReadonlyMap<object, NotePatch> = new Map(),
  region: Region = { start: 0, end: performance.seconds },
): void {
  if (performance.seconds <= 0) return;
  const voices = trackVoices(piece);
  const audibleTracks = new Map(piece.tracks.map((track) => [track.id, audible(piece, track)]));
  for (const pass of passes(fromSecond, toSecond, region)) {
    const passStart = pass.offset;
    const localFrom = pass.from;
    const localTo = pass.to;
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
      const patch = patches.get(note);
      if (patch) {
        synth.controllerChange(voice.channel, 0, patch.bankSelect, { time: at(passStart + note.start) });
        synth.programChange(voice.channel, patch.program, { time: at(passStart + note.start) });
      }
      synth.noteOn(voice.channel, note.pitch, velocity, { time: at(passStart + note.start) });
      synth.noteOff(voice.channel, note.pitch, { time: at(passStart + note.end) });
    }
  }
}

const TICK_MS = 25;
const DRUM_CHANNEL = 9;

export interface TrackVoice {
  readonly channel: number;
  readonly bank: string;
  readonly program: number;
  readonly bankNumber: number;
}

/** The MIDI channel and preset each track plays on, or `null` when it has no soundfont bank. */
export function trackVoices(piece: Piece): Map<string, TrackVoice | null> {
  const voices = new Map<string, TrackVoice | null>();
  let next = 0;
  for (const track of piece.tracks) {
    const device = track.channel?.devices.find((candidate) => candidate.plugin === 'soundfont');
    const bank = device?.params['bank'];
    if (!device || typeof bank !== 'string') {
      voices.set(track.id, null);
      continue;
    }
    const drums = device.params['drums'] === true;
    let channel = drums ? DRUM_CHANNEL : next;
    if (!drums) {
      if (next === DRUM_CHANNEL) next++;
      channel = next++;
    }
    const program = typeof device.params['program'] === 'number' ? device.params['program'] : 0;
    const bankNumber = typeof device.params['bankNumber'] === 'number' ? device.params['bankNumber'] : 0;
    voices.set(track.id, { channel: channel % 16, bank, program, bankNumber });
  }
  return voices;
}

/** Whether a track's notes are scheduled: its strip sounds (`stripLevels`: its mute, and solo on instrument strips). */
function audible(piece: Piece, track: PieceTrack): boolean {
  return stripLevels(piece, track).sounding;
}

export type EngineState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly detail: string }
  | { readonly kind: 'playing' }
  | { readonly kind: 'error'; readonly message: string };

/**
 * Each performed note's bank and program where they change note by note (articulations, round
 * robins), from the banks as loaded: `bankOffset` is where each sits and `presets` the synth's
 * list, whose bank numbers already carry the offsets.
 */
export function patchesFor(
  piece: Piece,
  performance: Performance,
  bankOffset: ReadonlyMap<string, number>,
  presets: readonly { readonly name: string; readonly bankMSB: number; readonly program: number }[],
): Map<object, NotePatch> {
  const voices = trackVoices(piece);
  return notePatches(
    piece,
    performance.notes,
    (track) => {
      const voice = voices.get(track);
      return voice && voice.channel !== DRUM_CHANNEL ? (bankOffset.get(voice.bank) ?? 0) + voice.bankNumber : null;
    },
    (_track, bankSelect, program) => roundRobins(presets, bankSelect, program),
  );
}

/** Each soundfont track's MIDI channel, as the mix graph wants it. */
function channelsOf(piece: Piece): Map<string, number> {
  const channelOf = new Map<string, number>();
  for (const [trackId, voice] of trackVoices(piece)) if (voice) channelOf.set(trackId, voice.channel);
  return channelOf;
}

/**
 * The engine. Everything that waits on the network or the audio thread (loading a bank, building
 * the mix graph) runs on ONE serialized chain (`sync`), each run for the latest piece: a newer
 * request supersedes the one in flight, which abandons its work at its next step and never swaps
 * a graph in. So two quick edits during a slow first build leave one graph sounding, and a failed
 * run records nothing, so the next play or edit tries again.
 */
export class PreviewEngine {
  private context: AudioContext | null = null;
  private synth: WorkletSynthesizer | null = null;
  /** The mix graph the synth's channel outputs feed (`mix/live-mix.ts`). */
  private mix: LiveMix | null = null;
  /** The `mixSignature` of the graph now sounding; set only when a build succeeded and was swapped in. */
  private mixBuiltFor = '';
  /** Each note's bank and program where they change note by note, for the scheduled performance. */
  private patches: ReadonlyMap<object, NotePatch> = new Map();
  /** Each loaded bank's offset: one above the highest bank number loaded before it, for this synth's life. */
  private readonly bankOffsets = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  /** The latest piece handed to the engine. */
  private piece: Piece | null = null;
  /**
   * The piece being SCHEDULED, and its performance (`perform`: what the export renders): the latest
   * piece once every bank it names is loaded, so a track on a bank still loading is not played on
   * whatever bank sits at its number meanwhile.
   */
  private scheduled: Piece | null = null;
  private performance: Performance | null = null;
  /** Audio time at which piece-second `originSecond` sounded. */
  private originTime = 0;
  private originSecond = 0;
  /** Piece-seconds (counting up across loop passes) already handed to the synth. */
  private scheduledTo = 0;
  /** The synth and graph being started, awaited by every play() that arrives meanwhile. */
  private starting: Promise<void> | null = null;
  /** The serialized chain of sync runs, and the number of the latest request. */
  private work: Promise<void> = Promise.resolve();
  private request = 0;
  /** The latest play() or stop(): an earlier play() that finishes starting after it does nothing. */
  private transport = 0;
  /** Bumped by dispose(): work begun before it throws away what it made. */
  private epoch = 0;
  private listeners = new Set<(state: EngineState) => void>();
  private state: EngineState = { kind: 'idle' };
  /** The loop region in beats (`setLoop`), or `null` to repeat the whole piece. */
  private loopBeats: { readonly from: number; readonly to: number } | null = null;

  /** Whether the metronome clicks each beat while playing (`setMetronome`). */
  private metronomeOn = false;
  /** Where the clicks go: straight to the context's destination, past the mix. Exists while the metronome is on. */
  private clickOut: GainNode | null = null;

  get metronome(): boolean {
    return this.metronomeOn;
  }

  /** Click every beat from the next tick on (the downbeat higher and louder), or stop clicking. */
  setMetronome(on: boolean): void {
    this.metronomeOn = on;
    if (!on) {
      this.clickOut?.disconnect();
      this.clickOut = null;
    }
  }

  /** One click: a short sine blip at `when` on the audio clock, enveloped so it never pops. */
  private blip(context: AudioContext, when: number, accent: boolean): void {
    if (!this.clickOut) {
      this.clickOut = context.createGain();
      this.clickOut.connect(context.destination);
    }
    const oscillator = context.createOscillator();
    oscillator.frequency.value = accent ? 1760 : 1320;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(accent ? 0.5 : 0.3, when);
    envelope.gain.exponentialRampToValueAtTime(0.001, when + 0.04);
    oscillator.connect(envelope).connect(this.clickOut);
    oscillator.start(when);
    oscillator.stop(when + 0.05);
  }

  /** The loop region the transport repeats, in beats, or `null` when it repeats the whole piece. */
  get loop(): { readonly from: number; readonly to: number } | null {
    return this.loopBeats;
  }

  /**
   * Repeat `range` (beats, from < to) instead of the whole piece, or the whole piece again for
   * `null`. A playing transport carries on from where it is, folded into the new region.
   */
  setLoop(range: { readonly from: number; readonly to: number } | null): void {
    const next = range && range.to > range.from ? { from: range.from, to: range.to } : null;
    if (next?.from === this.loopBeats?.from && next?.to === this.loopBeats?.to) return;
    const beat = this.playhead();
    this.loopBeats = next;
    if (beat !== null) void this.play(beat);
  }

  /**
   * What repeats, in piece-seconds, for a play that started at piece-second `origin`: the loop
   * region when the play starts before its end (a play started past it runs on to the piece's
   * end, as a DAW's does), else the whole piece.
   */
  private region(performance: Performance, origin: number): Region {
    const whole = { start: 0, end: performance.seconds };
    const loop = this.loopBeats;
    if (!loop) return whole;
    const start = performance.secondsAt(loop.from);
    const end = Math.min(performance.secondsAt(loop.to), performance.seconds);
    return end > start && origin < end ? { start, end } : whole;
  }

  /** The engine's state now (a subscriber hears each change; this answers a read). */
  get current(): EngineState {
    return this.state;
  }

  /**
   * What the engine has built, for a reader: whether a synth and graph exist, the signature of the
   * graph sounding, whether the synth feeds it, the banks loaded, and whether the metronome's
   * output node exists.
   */
  get wiring(): { readonly synth: boolean; readonly mixBuiltFor: string; readonly connected: boolean; readonly banks: readonly string[]; readonly metronome: boolean } {
    return { synth: this.synth !== null, mixBuiltFor: this.mixBuiltFor, connected: this.mix?.connected ?? false, banks: [...this.bankOffsets.keys()], metronome: this.clickOut !== null };
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

  /**
   * Hand the engine the latest piece. A level change reaches the sounding graph at once; the
   * piece is scheduled from the next tick when its banks are loaded, and otherwise once the sync
   * it starts has loaded them; a change of the graph's shape rebuilds it on the same chain.
   */
  update(piece: Piece): void {
    this.piece = piece;
    if (!this.synth) {
      this.adopt(piece);
      return;
    }
    this.mix?.apply(piece);
    if (!this.missingBanks(piece)) this.adopt(piece);
    this.sync().catch((error: unknown) => this.fail(error));
  }

  /** Schedule `piece` from now on: its performance, note patches and channel presets. */
  private adopt(piece: Piece): void {
    this.scheduled = piece;
    this.performance = perform(piece);
    const synth = this.synth;
    this.patches = synth ? patchesFor(piece, this.performance, this.bankOffsets, synth.presetList) : new Map();
    if (synth) setUpVoices(synth, piece, this.bankOffsets);
  }

  private missingBanks(piece: Piece): boolean {
    for (const voice of trackVoices(piece).values()) if (voice && !this.bankOffsets.has(voice.bank)) return true;
    return false;
  }

  /**
   * Bring the synth and graph to the latest piece, on the serialized chain: load the banks it
   * names, schedule it, and rebuild the graph when its shape changed. Resolves when the run for
   * THIS request is done (or superseded); rejects with the reason it failed.
   */
  private sync(): Promise<void> {
    const token = ++this.request;
    const wanted = (): boolean => token === this.request;
    const run = async (): Promise<void> => {
      const piece = this.piece;
      const synth = this.synth;
      const mix = this.mix;
      if (!wanted() || !piece || !synth || !mix) return;
      try {
        await this.loadBanks(synth, piece, wanted);
        if (!wanted()) return;
        if (this.scheduled !== piece) this.adopt(piece);
        const signature = mixSignature(piece);
        if (signature !== this.mixBuiltFor) {
          const swapped = await mix.build(piece, channelsOf(piece), () => wanted() && this.mix === mix);
          if (!swapped) return;
          this.mixBuiltFor = signature;
        }
        // A failure before, or a bank loaded while stopped, is over: the engine is ready again.
        if (this.state.kind === 'error' || this.state.kind === 'loading') this.setState({ kind: 'idle' });
      } catch (error) {
        // A superseded run's failure is not the engine's: the run after it tries the latest piece.
        if (wanted() && this.mix === mix) throw error;
      }
    };
    const job = this.work.then(run);
    this.work = job.catch(() => undefined);
    return job;
  }

  /** Resolves when no sync run is pending or running. */
  private async settled(): Promise<void> {
    let seen: number;
    do {
      seen = this.request;
      await this.work;
    } while (seen !== this.request);
  }

  /** A sync failed: the transport stops and the engine says why. The next play or edit retries. */
  private fail(error: unknown): void {
    this.stopTimer();
    this.synth?.stopAll(true);
    this.mix?.cancelAutomation();
    this.setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }

  /** The beat under the playhead, or `null` when stopped. */
  playhead(): number | null {
    const performance = this.performance;
    if (!this.context || this.state.kind !== 'playing' || !performance || performance.seconds <= 0) return null;
    const elapsed = this.originSecond + (this.context.currentTime - this.originTime);
    return performance.beatAt(foldSecond(Math.max(0, elapsed), this.region(performance, this.originSecond)));
  }

  async play(fromBeat = 0): Promise<void> {
    if (!this.piece) return;
    const turn = ++this.transport;
    try {
      if (!this.context) {
        this.setState({ kind: 'loading', detail: 'Starting the audio engine' });
        this.context = new AudioContext();
      }
      const context = this.context;
      // Resume INSIDE the gesture that called play, before any await: the browser grants audio to
      // the click itself (autoplay policy), and a context that is still suspended after a moment
      // was not granted one; that is said plainly instead of waiting forever.
      const resumed = context.resume();
      if (!this.starting) {
        const starting: Promise<void> = this.start(context, resumed).finally(() => {
          if (this.starting === starting) this.starting = null;
        });
        this.starting = starting;
      }
      await this.starting;
      await this.sync();
      // An edit that arrived meanwhile superseded this sync; its own run finishes first.
      await this.settled();
      const piece = this.piece;
      if (turn !== this.transport || !this.synth || !piece || this.state.kind === 'error') return;
      this.stopTimer();
      this.synth.stopAll(true);
      this.mix?.cancelAutomation();
      this.adopt(piece);
      const performance = this.performance!;
      this.originSecond = performance.secondsAt(fromBeat);
      this.originTime = context.currentTime + 0.05;
      this.scheduledTo = this.originSecond;
      this.setState({ kind: 'playing' });
      this.tick();
      this.timer = setInterval(() => this.tick(), TICK_MS);
    } catch (error) {
      if (turn === this.transport) this.fail(error);
    }
  }

  /** The synth in the worklet and the mix it feeds, made once per context. */
  private async start(context: AudioContext, resumed: Promise<void>): Promise<void> {
    const epoch = this.epoch;
    if (context.state !== 'running') {
      const granted = await Promise.race([resumed.then(() => true), new Promise<boolean>((done) => setTimeout(() => done(false), 1500))]);
      if (!granted) {
        throw new Error('The browser is holding audio until you click in the editor (autoplay policy). Click Play.');
      }
    }
    if (this.synth) return;
    await context.audioWorklet.addModule(processorUrl);
    const synth = new WorkletSynthesizer(context);
    await synth.isReady;
    if (epoch !== this.epoch) {
      synth.destroy();
      return;
    }
    // The mix owns space and level: the synth's own reverb and chorus are off, and each MIDI
    // channel comes out separately into its track's strip.
    synth.setSystemParameter('effectsEnabled', false);
    this.synth = synth;
    this.mix = new LiveMix(context, servedIrLoader(context));
    this.mix.attach(synth);
  }

  stop(): void {
    this.transport++;
    this.stopTimer();
    this.synth?.stopAll(true);
    this.mix?.cancelAutomation();
    // Clicks already scheduled ahead go with their node; the next tick makes a new one.
    this.clickOut?.disconnect();
    this.clickOut = null;
    if (this.state.kind === 'playing' || this.state.kind === 'loading') this.setState({ kind: 'idle' });
  }

  /**
   * Take everything down, and forget everything a later play() would otherwise trust: the graph's
   * signature, the banks and their offsets, the patches. A disposed engine that is played again
   * starts from nothing, as a new one would.
   */
  dispose(): void {
    this.stop();
    this.epoch++;
    this.request++;
    this.mix?.dispose();
    this.clickOut?.disconnect();
    this.clickOut = null;
    this.synth?.destroy();
    void this.context?.close();
    this.mix = null;
    this.synth = null;
    this.context = null;
    this.starting = null;
    this.work = Promise.resolve();
    this.mixBuiltFor = '';
    this.bankOffsets.clear();
    this.patches = new Map();
    this.scheduled = null;
    if (this.piece) this.adopt(this.piece);
    if (this.state.kind !== 'idle') this.setState({ kind: 'idle' });
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Load every bank `piece` names that this synth lacks; stops early when `wanted()` turns false. */
  private async loadBanks(synth: WorkletSynthesizer, piece: Piece, wanted: () => boolean): Promise<void> {
    for (const voice of trackVoices(piece).values()) {
      if (!voice || this.bankOffsets.has(voice.bank)) continue;
      if (this.state.kind !== 'playing') this.setState({ kind: 'loading', detail: `Loading ${voice.bank}` });
      const url = projectModuleUrl(voice.bank);
      if (!url) throw new Error(`No served address for ${voice.bank}.`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${voice.bank}: ${response.status} ${response.statusText}`);
      const bytes = await response.arrayBuffer();
      if (!wanted() || this.synth !== synth) return;
      const offset = Math.max(-1, ...synth.presetList.map((preset) => preset.bankMSB).filter((msb) => msb < 128)) + 1;
      await synth.soundBankManager.addSoundBank(bytes, voice.bank, offset);
      if (this.synth !== synth) return;
      this.bankOffsets.set(voice.bank, offset);
    }
  }

  private tick(): void {
    const context = this.context;
    const synth = this.synth;
    const piece = this.scheduled;
    const performance = this.performance;
    if (!context || !synth || !piece || !performance || performance.seconds <= 0) return;
    const horizon = this.originSecond + (context.currentTime + LOOKAHEAD_S - this.originTime);
    if (horizon <= this.scheduledTo) return;
    const at = (second: number): number => this.originTime + (second - this.originSecond);
    const region = this.region(performance, this.originSecond);
    scheduleSpan(synth, piece, performance, this.scheduledTo, horizon, at, this.patches, region);
    // The tracks' mixer automation, for the same passes the notes were scheduled for.
    for (const pass of passes(this.scheduledTo, horizon, region)) this.mix?.automate(piece, performance.beatAt, pass, at);
    if (this.metronomeOn) {
      // Every beat whose piece-second falls in each pass, the bar's first one accented.
      const beatsPerBar = piece.transport.beatsPerBar;
      for (const pass of passes(this.scheduledTo, horizon, region)) {
        for (let beat = Math.ceil(performance.beatAt(pass.from) - 1e-6); ; beat++) {
          const second = performance.secondsAt(beat);
          if (second >= pass.to - 1e-9) break;
          if (second < pass.from - 1e-9) continue;
          const inBar = beat % beatsPerBar;
          this.blip(context, at(pass.offset + second), Math.min(inBar, beatsPerBar - inBar) < 1e-6);
        }
      }
    }
    this.scheduledTo = horizon;
  }
}
