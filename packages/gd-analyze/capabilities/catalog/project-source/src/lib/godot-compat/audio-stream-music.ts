/** Godot interactive-music AudioStreams over caller-owned Web Audio voices and clock. */
import { dbToLinear } from '@volter/game-runtime/audio/bus-mixer';
import { audioStreamBuffer, audioStreamLength, audioStreamLoopOffset, audioStreamLoops, type GodotAudioStream } from './audio-stream';
import { selectGodotPlayableAudioStream, type GodotAudioStreamRandomizer, type GodotPlayableAudioStream } from './audio-stream-composition';
import { registerGodotObjectIdentity } from './object';

export type GodotMusicClipStream = AudioBuffer | GodotAudioStream | GodotAudioStreamRandomizer;

export interface GodotAudioStreamPlayback {
  /** Engine/caller clock. This alone advances game-visible playback state. */
  tick(deltaSeconds: number): void;
  pause(): void;
  resume(): void;
  set_pitch_scale(scale: number): void;
  start(fromPosition?: number): void;
  stop(): void;
  is_playing(): boolean;
  get_loop_count(): number;
  get_playback_position(): number;
  seek(position: number): void;
  dispose(): void;
}

function finite(value: number, member: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${member} requires a finite number.`);
  return value;
}
function boundedIndex(value: number, member: string, size: number, any = false): number {
  if (!Number.isSafeInteger(value) || value < (any ? -1 : 0) || value >= size) throw new RangeError(`${member} index ${value} is outside the authored stream array.`);
  return value;
}
function boundedCount(value: number, member: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new RangeError(`${member} must be an integer in [0, ${maximum}].`);
  return value;
}

function musicStreamLength(stream: GodotMusicClipStream): number {
  if (stream instanceof AudioBuffer) return audioStreamLength(stream);
  if (stream.kind !== 'AudioStreamRandomizer') return audioStreamLength(stream);
  let longest = 0;
  for (let at = 0; at < stream.get_streams_count(); at += 1) {
    const child = stream.get_stream(at);
    if (child !== null) longest = Math.max(longest, musicStreamLength(child));
  }
  return longest;
}

function playlistStreamLength(stream: GodotMusicClipStream): number {
  const timing = musicStreamTiming(stream);
  return timing.bpm > 0 && timing.beatCount > 0 ? timing.beatCount * 60 / timing.bpm : musicStreamLength(stream);
}

function musicStreamLoops(stream: GodotMusicClipStream): boolean {
  if (stream instanceof AudioBuffer || stream.kind !== 'AudioStreamRandomizer') return audioStreamLoops(stream);
  for (let at = 0; at < stream.get_streams_count(); at += 1) {
    const child = stream.get_stream(at);
    if (child !== null && musicStreamLoops(child)) return true;
  }
  return false;
}

interface MusicTiming { readonly bpm: number; readonly beatCount: number; readonly barBeats: number }
function musicStreamTiming(stream: GodotMusicClipStream): MusicTiming {
  if (stream instanceof AudioBuffer) return { bpm: 0, beatCount: 0, barBeats: 0 };
  if (stream.kind !== 'AudioStreamRandomizer') return { bpm: stream.bpm, beatCount: stream.beatCount, barBeats: stream.barBeats };
  let timing: MusicTiming = { bpm: 0, beatCount: 0, barBeats: 0 };
  for (let at = 0; at < stream.get_streams_count(); at += 1) {
    const child = stream.get_stream(at); if (child === null) continue;
    const candidate = musicStreamTiming(child);
    timing = { bpm: timing.bpm || candidate.bpm, beatCount: Math.max(timing.beatCount, candidate.beatCount), barBeats: timing.barBeats || candidate.barBeats };
  }
  return timing;
}

interface NativeVoice {
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
  readonly stream: AudioBuffer | GodotAudioStream;
  readonly startedAt: number;
  readonly offset: number;
  readonly streamPitch: number;
  readonly nominalGain: number;
  stopped: boolean;
  stopScheduled: boolean;
}

function createVoice(
  context: AudioContext,
  destination: AudioNode,
  stream: GodotMusicClipStream,
  random: () => number,
  at: number,
  offset: number,
  volumeDb = 0,
  rateScale = 1,
): NativeVoice | undefined {
  const selected = selectGodotPlayableAudioStream(stream as GodotPlayableAudioStream, random);
  if (selected === undefined) return undefined;
  const buffer = audioStreamBuffer(selected.stream);
  const source = context.createBufferSource(), gain = context.createGain();
  source.buffer = buffer;
  source.loop = audioStreamLoops(selected.stream);
  source.loopStart = audioStreamLoopOffset(selected.stream);
  source.playbackRate.value = selected.pitchScale * rateScale;
  const nominalGain = dbToLinear(volumeDb + selected.volumeDb);
  gain.gain.value = nominalGain;
  source.connect(gain); gain.connect(destination);
  const normalized = source.loop
    ? Math.max(0, offset) % Math.max(buffer.duration, Number.EPSILON)
    : Math.min(Math.max(0, offset), buffer.duration);
  source.start(at, normalized);
  return { source, gain, stream: selected.stream, startedAt: at, offset: normalized, streamPitch: selected.pitchScale, nominalGain, stopped: false, stopScheduled: false };
}

function stopVoice(voice: NativeVoice | undefined, at?: number): void {
  if (voice === undefined || voice.stopped || (voice.stopScheduled && at !== undefined)) return;
  if (at === undefined) voice.stopped = true;
  else voice.stopScheduled = true;
  try { voice.source.stop(at); } catch { /* A naturally ended AudioBufferSource is already stopped. */ }
  if (at === undefined) { voice.source.disconnect(); voice.gain.disconnect(); }
  else voice.source.addEventListener('ended', () => { voice.stopped = true; voice.stopScheduled = false; voice.source.disconnect(); voice.gain.disconnect(); }, { once: true });
}

export interface GodotAudioStreamPlaylist {
  readonly kind: 'AudioStreamPlaylist';
  set_stream_count(count: number): void; get_stream_count(): number;
  set_list_stream(index: number, stream: GodotMusicClipStream | null): void; get_list_stream(index: number): GodotMusicClipStream | null;
  set_shuffle(shuffle: boolean): void; get_shuffle(): boolean;
  set_loop(loop: boolean): void; has_loop(): boolean;
  set_fade_time(seconds: number): void; get_fade_time(): number;
  get_length(): number; get_bpm(): number; get_beat_count(): number; get_bar_beats(): number;
  _subscribe_stream_changes(listener: () => void): () => void;
}

export function createGodotAudioStreamPlaylist(): GodotAudioStreamPlaylist {
  const streams: (GodotMusicClipStream | null)[] = [];
  const listeners = new Set<() => void>();
  let shuffle = false, loop = true, fadeTime = 0.3;
  const resource: GodotAudioStreamPlaylist = {
    kind: 'AudioStreamPlaylist',
    set_stream_count(count) { streams.length = boundedCount(count, 'AudioStreamPlaylist.stream_count', 64); for (let i = 0; i < streams.length; i += 1) streams[i] ??= null; },
    get_stream_count: () => streams.length,
    set_list_stream(at, stream) { boundedIndex(at, 'AudioStreamPlaylist.set_list_stream', 64); streams[at] = stream; for (const listener of [...listeners]) listener(); },
    get_list_stream(at) { boundedIndex(at, 'AudioStreamPlaylist.get_list_stream', 64); return streams[at] ?? null; },
    set_shuffle(value) { shuffle = Boolean(value); }, get_shuffle: () => shuffle,
    set_loop(value) { loop = Boolean(value); }, has_loop: () => loop,
    set_fade_time(value) { fadeTime = Math.max(0, finite(value, 'AudioStreamPlaylist.fade_time')); }, get_fade_time: () => fadeTime,
    get_length: () => streams.reduce((total, stream) => total + (stream === null ? 0 : playlistStreamLength(stream)), 0),
    get_bpm() { for (const child of streams) { if (child === null) continue; const bpm = musicStreamTiming(child).bpm; if (bpm !== 0) return bpm; } return 0; },
    get_beat_count: () => 0,
    get_bar_beats: () => 0,
    _subscribe_stream_changes(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  registerGodotObjectIdentity(resource, 'AudioStreamPlaylist');
  return resource;
}

export function createGodotAudioStreamPlaybackPlaylist(
  context: AudioContext, destination: AudioNode, playlist: GodotAudioStreamPlaylist, random: () => number,
): GodotAudioStreamPlayback {
  let voice: NativeVoice | undefined;
  const fadingVoices = new Set<NativeVoice>();
  let order: number[] = [], orderIndex = 0, loops = 0, position = 0, streamPosition = 0, streamLength = 0, active = false, paused = false, rateScale = 1;
  const updateOrder = (): void => {
    order = Array.from({ length: playlist.get_stream_count() }, (_, at) => at);
    if (!playlist.get_shuffle()) return;
    for (let at = 0; at < order.length; at += 1) {
      const draw = random();
      if (!Number.isFinite(draw)) throw new Error('AudioStreamPlaylist random source returned a non-finite value.');
      const swap = Math.min(order.length - 1, Math.max(0, Math.floor(Math.min(1 - Number.EPSILON, Math.max(0, draw)) * order.length)));
      [order[at], order[swap]] = [order[swap]!, order[at]!];
    }
  };
  const findNext = (from: number): number => {
    for (let step = 1; step <= order.length; step += 1) {
      const candidate = from + step;
      if (candidate >= order.length && !playlist.has_loop()) return -1;
      const at = candidate % Math.max(1, order.length);
      if (playlist.get_list_stream(order[at]!) !== null) return at;
    }
    return -1;
  };
  const startAt = (at: number, offset: number, fadeIn: boolean, fadeSeconds = playlist.get_fade_time()): boolean => {
    const child = playlist.get_list_stream(order[at]!); if (child === null) return false;
    const next = createVoice(context, destination, child, random, context.currentTime, offset, 0, rateScale); if (next === undefined) return false;
    const target = next.nominalGain;
    if (fadeIn && fadeSeconds > 0) {
      next.gain.gain.setValueAtTime(0, context.currentTime);
      next.gain.gain.linearRampToValueAtTime(target, context.currentTime + fadeSeconds);
    }
    voice = next;
    return true;
  };
  const playback: GodotAudioStreamPlayback = {
    start(from = 0) {
      playback.stop(); updateOrder(); loops = 0; paused = false;
      let remaining = Math.max(0, finite(from, 'AudioStreamPlaybackPlaylist.start'));
      const total = playlist.get_length();
      if (remaining >= total) { if (!playlist.has_loop() || total <= 0) return; remaining %= total; }
      orderIndex = 0; active = true; position = remaining;
      for (let at = 0; at < order.length; at += 1) {
        const child = playlist.get_list_stream(order[at]!);
        if (child === null) continue;
        const length = playlistStreamLength(child);
        if (remaining < length) {
          orderIndex = at; streamPosition = remaining; streamLength = length;
          if (!startAt(at, remaining, false)) active = false;
          return;
        }
        remaining -= length;
      }
      active = false;
    },
    tick(delta) {
      if (!active || paused) return;
      let remaining = Math.max(0, finite(delta, 'AudioStreamPlaybackPlaylist.tick')) * rateScale;
      while (remaining > 0 && active) {
        const toEnd = Math.max(0, streamLength - streamPosition);
        const step = Math.min(remaining, toEnd || remaining);
        streamPosition += step; position += step; remaining -= step;
        if (streamPosition < streamLength) break;
        const oldVoice = voice;
        let next = findNext(orderIndex);
        if (next < 0) { active = false; stopVoice(oldVoice); voice = undefined; break; }
        if (next <= orderIndex) { loops += 1; position = Math.max(0, remaining); updateOrder(); next = findNext(-1); }
        orderIndex = next;
        const child = playlist.get_list_stream(order[orderIndex]!);
        if (child === null) { active = false; break; }
        streamLength = playlistStreamLength(child); streamPosition = 0;
        voice = undefined;
        if (!startAt(orderIndex, 0, false)) active = false;
        const fade = playlist.get_fade_time();
        if (oldVoice !== undefined && fade > 0) {
          oldVoice.gain.gain.setValueAtTime(oldVoice.gain.gain.value, context.currentTime);
          oldVoice.gain.gain.linearRampToValueAtTime(0, context.currentTime + fade);
          stopVoice(oldVoice, context.currentTime + fade);
          fadingVoices.add(oldVoice);
          oldVoice.source.addEventListener('ended', () => fadingVoices.delete(oldVoice), { once: true });
        } else stopVoice(oldVoice);
      }
    },
    pause() { if (!active || paused) return; paused = true; stopVoice(voice); for (const tail of fadingVoices) stopVoice(tail); fadingVoices.clear(); voice = undefined; },
    resume() { if (!active || !paused) return; paused = false; startAt(orderIndex, streamPosition, false); },
    set_pitch_scale(scale) { rateScale = Math.max(0.01, finite(scale, 'AudioStreamPlaybackPlaylist.pitch_scale')); if (voice !== undefined) voice.source.playbackRate.value = voice.streamPitch * rateScale; },
    stop() { active = false; stopVoice(voice); for (const tail of fadingVoices) stopVoice(tail); fadingVoices.clear(); voice = undefined; },
    is_playing: () => active,
    get_loop_count: () => loops,
    get_playback_position: () => active ? position : 0,
    seek(position) { playback.start(position); },
    dispose() { unsubscribe(); playback.stop(); },
  };
  const unsubscribe = playlist._subscribe_stream_changes(() => playback.stop());
  registerGodotObjectIdentity(playback, 'AudioStreamPlaybackPlaylist');
  return playback;
}

export interface GodotAudioStreamSynchronized {
  readonly kind: 'AudioStreamSynchronized';
  set_stream_count(count: number): void; get_stream_count(): number;
  set_sync_stream(index: number, stream: GodotMusicClipStream | null): void; get_sync_stream(index: number): GodotMusicClipStream | null;
  set_sync_stream_volume(index: number, volumeDb: number): void; get_sync_stream_volume(index: number): number;
  get_length(): number; has_loop(): boolean; get_bpm(): number; get_beat_count(): number; get_bar_beats(): number;
  _subscribe_stream_changes(listener: () => void): () => void;
}

export function createGodotAudioStreamSynchronized(): GodotAudioStreamSynchronized {
  const streams: { stream: GodotMusicClipStream | null; volumeDb: number }[] = [];
  const listeners = new Set<() => void>();
  const resource: GodotAudioStreamSynchronized = {
    kind: 'AudioStreamSynchronized',
    set_stream_count(count) { streams.length = boundedCount(count, 'AudioStreamSynchronized.stream_count', 32); for (let i = 0; i < streams.length; i += 1) streams[i] ??= { stream: null, volumeDb: 0 }; },
    get_stream_count: () => streams.length,
    set_sync_stream(at, stream) { boundedIndex(at, 'AudioStreamSynchronized.set_sync_stream', 32); streams[at] ??= { stream: null, volumeDb: 0 }; streams[at]!.stream = stream; for (const listener of [...listeners]) listener(); },
    get_sync_stream(at) { boundedIndex(at, 'AudioStreamSynchronized.get_sync_stream', 32); return streams[at]?.stream ?? null; },
    set_sync_stream_volume(at, db) { boundedIndex(at, 'AudioStreamSynchronized.set_sync_stream_volume', 32); streams[at] ??= { stream: null, volumeDb: 0 }; streams[at]!.volumeDb = finite(db, 'AudioStreamSynchronized stream volume'); },
    get_sync_stream_volume(at) { boundedIndex(at, 'AudioStreamSynchronized.get_sync_stream_volume', 32); return streams[at]?.volumeDb ?? 0; },
    get_length: () => streams.reduce((longest, item) => item.stream === null ? longest : Math.max(longest, musicStreamLength(item.stream)), 0),
    has_loop: () => streams.some((item) => item.stream !== null && musicStreamLoops(item.stream)),
    get_bpm() { for (const item of streams) { if (item.stream === null) continue; const bpm = musicStreamTiming(item.stream).bpm; if (bpm !== 0) return bpm; } return 0; },
    get_beat_count: () => streams.reduce((maximum, item) => item.stream === null ? maximum : Math.max(maximum, musicStreamTiming(item.stream).beatCount), 0),
    get_bar_beats() { for (const item of streams) { if (item.stream === null) continue; const beats = musicStreamTiming(item.stream).barBeats; if (beats !== 0) return beats; } return 0; },
    _subscribe_stream_changes(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  registerGodotObjectIdentity(resource, 'AudioStreamSynchronized');
  return resource;
}

export function createGodotAudioStreamPlaybackSynchronized(
  context: AudioContext, destination: AudioNode, stream: GodotAudioStreamSynchronized, random: () => number,
): GodotAudioStreamPlayback {
  let voices: NativeVoice[] = [], position = 0, loops = 0, active = false, paused = false, rateScale = 1;
  const startVoices = (): void => {
    for (let at = 0; at < stream.get_stream_count(); at += 1) {
      const child = stream.get_sync_stream(at); if (child === null) continue;
      const voice = createVoice(context, destination, child, random, context.currentTime, position, stream.get_sync_stream_volume(at), rateScale);
      if (voice !== undefined) voices.push(voice);
    }
  };
  const playback: GodotAudioStreamPlayback = {
    start(from = 0) {
      playback.stop(); position = Math.max(0, finite(from, 'AudioStreamPlaybackSynchronized.start')); loops = 0; paused = false; startVoices();
      active = voices.length > 0;
    },
    tick(delta) {
      if (!active || paused) return;
      const previous = position; position += Math.max(0, finite(delta, 'AudioStreamPlaybackSynchronized.tick')) * rateScale;
      const length = stream.get_length();
      if (stream.has_loop() && length > 0) loops += Math.max(0, Math.floor(position / length) - Math.floor(previous / length));
      else if (length <= 0 || position >= length) playback.stop();
    },
    pause() { if (!active || paused) return; paused = true; for (const voice of voices) stopVoice(voice); voices = []; },
    resume() { if (!active || !paused) return; paused = false; startVoices(); },
    set_pitch_scale(scale) { rateScale = Math.max(0.01, finite(scale, 'AudioStreamPlaybackSynchronized.pitch_scale')); for (const voice of voices) voice.source.playbackRate.value = voice.streamPitch * rateScale; },
    stop() { for (const voice of voices) stopVoice(voice); voices = []; active = false; },
    is_playing: () => active,
    get_loop_count: () => loops,
    get_playback_position: () => active ? position : 0,
    seek(position) { playback.start(position); },
    dispose() { unsubscribe(); playback.stop(); },
  };
  const unsubscribe = stream._subscribe_stream_changes(() => playback.stop());
  registerGodotObjectIdentity(playback, 'AudioStreamPlaybackSynchronized');
  return playback;
}

export const INTERACTIVE_CLIP_ANY = -1;
export const INTERACTIVE_FROM_IMMEDIATE = 0, INTERACTIVE_FROM_NEXT_BEAT = 1, INTERACTIVE_FROM_NEXT_BAR = 2, INTERACTIVE_FROM_END = 3;
export const INTERACTIVE_TO_SAME_POSITION = 0, INTERACTIVE_TO_START = 1, INTERACTIVE_TO_PREVIOUS_POSITION = 2;
export const INTERACTIVE_FADE_DISABLED = 0, INTERACTIVE_FADE_IN = 1, INTERACTIVE_FADE_OUT = 2, INTERACTIVE_FADE_CROSS = 3, INTERACTIVE_FADE_AUTOMATIC = 4;
export const INTERACTIVE_AUTO_ADVANCE_DISABLED = 0, INTERACTIVE_AUTO_ADVANCE_ENABLED = 1, INTERACTIVE_AUTO_ADVANCE_RETURN_TO_HOLD = 2;

export interface GodotInteractiveTransition { readonly fromTime: number; readonly toTime: number; readonly fadeMode: number; readonly fadeBeats: number; readonly useFillerClip: boolean; readonly fillerClip: number; readonly holdPrevious: boolean }
interface InteractiveClip { name: string; stream: GodotMusicClipStream | null; autoAdvance: number; nextClip: number }
export interface GodotAudioStreamInteractive {
  readonly kind: 'AudioStreamInteractive';
  set_clip_count(count: number): void; get_clip_count(): number;
  set_initial_clip(clip: number): void; get_initial_clip(): number;
  set_clip_name(clip: number, name: string): void; get_clip_name(clip: number): string;
  set_clip_stream(clip: number, stream: GodotMusicClipStream | null): void; get_clip_stream(clip: number): GodotMusicClipStream | null;
  set_clip_auto_advance(clip: number, mode: number): void; get_clip_auto_advance(clip: number): number;
  set_clip_auto_advance_next_clip(clip: number, next: number): void; get_clip_auto_advance_next_clip(clip: number): number;
  add_transition(from: number, to: number, fromTime: number, toTime: number, fadeMode: number, fadeBeats: number, useFillerClip?: boolean, fillerClip?: number, holdPrevious?: boolean): void;
  has_transition(from: number, to: number): boolean; erase_transition(from: number, to: number): void; get_transition_list(): number[];
  get_transition_from_time(from: number, to: number): number; get_transition_to_time(from: number, to: number): number;
  get_transition_fade_mode(from: number, to: number): number; get_transition_fade_beats(from: number, to: number): number;
  is_transition_using_filler_clip(from: number, to: number): boolean; get_transition_filler_clip(from: number, to: number): number; is_transition_holding_previous(from: number, to: number): boolean;
  transition(from: number, to: number): GodotInteractiveTransition | undefined;
  get_length(): number; get_bpm(): number; get_beat_count(): number; get_bar_beats(): number; has_loop(): boolean;
  _get_version(): number;
}

export function createGodotAudioStreamInteractive(): GodotAudioStreamInteractive {
  const clips: InteractiveClip[] = [], transitions = new Map<string, GodotInteractiveTransition>(); let initialClip = 0, version = 1;
  const key = (from: number, to: number) => `${from}:${to}`;
  const resource: GodotAudioStreamInteractive = {
    kind: 'AudioStreamInteractive',
    set_clip_count(count) { const next = boundedCount(count, 'AudioStreamInteractive.clip_count', 63); if (next < clips.length) version += 1; clips.length = next; for (let i = 0; i < clips.length; i += 1) clips[i] ??= { name: '', stream: null, autoAdvance: 0, nextClip: 0 }; if (initialClip >= clips.length) initialClip = 0; },
    get_clip_count: () => clips.length,
    set_initial_clip(at) { initialClip = boundedIndex(at, 'AudioStreamInteractive.initial_clip', clips.length); }, get_initial_clip: () => initialClip,
    set_clip_name(at, name) { boundedIndex(at, 'AudioStreamInteractive.set_clip_name', 63); clips[at] ??= { name: '', stream: null, autoAdvance: 0, nextClip: 0 }; clips[at]!.name = String(name); },
    get_clip_name(at) { if (at === -1) return 'All Clips'; boundedIndex(at, 'AudioStreamInteractive.get_clip_name', 63); return clips[at]?.name ?? ''; },
    set_clip_stream(at, stream) { boundedIndex(at, 'AudioStreamInteractive.set_clip_stream', 63); clips[at] ??= { name: '', stream: null, autoAdvance: 0, nextClip: 0 }; if (clips[at]!.stream !== null) version += 1; clips[at]!.stream = stream; },
    get_clip_stream(at) { boundedIndex(at, 'AudioStreamInteractive.get_clip_stream', 63); return clips[at]?.stream ?? null; },
    set_clip_auto_advance(at, mode) { boundedIndex(at, 'AudioStreamInteractive.set_clip_auto_advance', 63); if (!Number.isSafeInteger(mode) || mode < 0 || mode > 2) throw new RangeError('AudioStreamInteractive auto advance mode is outside AutoAdvanceMode.'); clips[at]!.autoAdvance = mode; },
    get_clip_auto_advance(at) { boundedIndex(at, 'AudioStreamInteractive.get_clip_auto_advance', 63); return clips[at]?.autoAdvance ?? 0; },
    set_clip_auto_advance_next_clip(at, next) { boundedIndex(at, 'AudioStreamInteractive.set_clip_auto_advance_next_clip', 63); clips[at]!.nextClip = Number.isSafeInteger(next) ? next : 0; },
    get_clip_auto_advance_next_clip(at) { boundedIndex(at, 'AudioStreamInteractive.get_clip_auto_advance_next_clip', 63); return clips[at]?.nextClip ?? -1; },
    add_transition(from, to, fromTime, toTime, fadeMode, fadeBeats, useFillerClip = false, fillerClip = -1, holdPrevious = false) {
      boundedIndex(from, 'AudioStreamInteractive.add_transition from', clips.length, true); boundedIndex(to, 'AudioStreamInteractive.add_transition to', clips.length, true);
      if (!Number.isSafeInteger(fromTime) || fromTime < 0 || fromTime > 3 || !Number.isSafeInteger(toTime) || toTime < 0 || toTime > 2 || !Number.isSafeInteger(fadeMode) || fadeMode < 0 || fadeMode > 4) throw new RangeError('AudioStreamInteractive transition enum is outside its Godot range.');
      transitions.set(key(from, to), { fromTime, toTime, fadeMode, fadeBeats: Math.max(0, finite(fadeBeats, 'AudioStreamInteractive.fade_beats')), useFillerClip: Boolean(useFillerClip), fillerClip, holdPrevious: Boolean(holdPrevious) });
    },
    has_transition: (from, to) => transitions.has(key(from, to)),
    erase_transition(from, to) { if (!transitions.delete(key(from, to))) throw new Error(`AudioStreamInteractive transition ${from}:${to} does not exist.`); },
    get_transition_list: () => [...transitions.keys()].flatMap((value) => value.split(':').map(Number)),
    get_transition_from_time: (from, to) => transitions.get(key(from, to))?.fromTime ?? INTERACTIVE_FROM_END,
    get_transition_to_time: (from, to) => transitions.get(key(from, to))?.toTime ?? INTERACTIVE_TO_START,
    get_transition_fade_mode: (from, to) => transitions.get(key(from, to))?.fadeMode ?? INTERACTIVE_FADE_DISABLED,
    get_transition_fade_beats: (from, to) => transitions.get(key(from, to))?.fadeBeats ?? -1,
    is_transition_using_filler_clip: (from, to) => transitions.get(key(from, to))?.useFillerClip ?? false,
    get_transition_filler_clip: (from, to) => transitions.get(key(from, to))?.fillerClip ?? -1,
    is_transition_holding_previous: (from, to) => transitions.get(key(from, to))?.holdPrevious ?? false,
    transition(from, to) { for (const pair of [[from, to], [from, -1], [-1, to], [-1, -1]] as const) { const found = transitions.get(key(pair[0], pair[1])); if (found !== undefined) return found; } return undefined; },
    get_length: () => 0, get_bpm: () => 0, get_beat_count: () => 0, get_bar_beats: () => 0, has_loop: () => false,
    _get_version: () => version,
  };
  registerGodotObjectIdentity(resource, 'AudioStreamInteractive');
  return resource;
}

export interface GodotAudioStreamPlaybackInteractive extends GodotAudioStreamPlayback {
  switch_to_clip_by_name(name: string): void; switch_to_clip(index: number): void; get_current_clip_index(): number;
}

export function createGodotAudioStreamPlaybackInteractive(
  context: AudioContext, destination: AudioNode, stream: GodotAudioStreamInteractive, random: () => number,
): GodotAudioStreamPlaybackInteractive {
  const defaultTransition: GodotInteractiveTransition = { fromTime: INTERACTIVE_FROM_NEXT_BEAT, toTime: INTERACTIVE_TO_START, fadeMode: INTERACTIVE_FADE_AUTOMATIC, fadeBeats: 1, useFillerClip: false, fillerClip: -1, holdPrevious: false };
  let current = -1, voice: NativeVoice | undefined, active = false, paused = false, loops = 0, clipPosition = 0, returnMemory = -1, rateScale = 1;
  let version = stream._get_version();
  let pending: { to: number; wait: number; transition: GodotInteractiveTransition; auto: boolean } | undefined;
  let fillerVoice: NativeVoice | undefined, fillerRemaining = 0, fillerClipIndex = -1;
  let fillerTargetRequest: { to: number; transition: GodotInteractiveTransition; auto: boolean } | undefined;
  const previousPositions = new Map<number, number>();

  const retireCurrent = (transition: GodotInteractiveTransition): void => {
    if (current < 0) return;
    const oldVoice = voice, sourceStream = stream.get_clip_stream(current);
    previousPositions.set(current, clipPosition);
    if (transition.holdPrevious) returnMemory = current;
    const timing = sourceStream === null ? { bpm: 0, beatCount: 0, barBeats: 0 } : musicStreamTiming(sourceStream);
    const fadeDuration = transition.fadeBeats * (timing.bpm > 0 ? 60 / timing.bpm : 1);
    let mode = transition.fadeMode;
    if (mode === INTERACTIVE_FADE_AUTOMATIC) mode = transition.toTime === INTERACTIVE_TO_START ? INTERACTIVE_FADE_OUT : INTERACTIVE_FADE_CROSS;
    if (oldVoice !== undefined && (mode === INTERACTIVE_FADE_OUT || mode === INTERACTIVE_FADE_CROSS) && fadeDuration > 0) {
      oldVoice.gain.gain.setValueAtTime(oldVoice.gain.gain.value, context.currentTime);
      oldVoice.gain.gain.linearRampToValueAtTime(0, context.currentTime + fadeDuration);
      stopVoice(oldVoice, context.currentTime + fadeDuration);
    } else stopVoice(oldVoice);
    voice = undefined;
  };

  const startClip = (to: number, transition?: GodotInteractiveTransition, auto = false, oldAlreadyRetired = false): void => {
    const target = stream.get_clip_stream(to); if (target === null) return;
    const from = current, oldPosition = clipPosition;
    let offset = 0;
    if (transition?.toTime === INTERACTIVE_TO_PREVIOUS_POSITION) offset = previousPositions.get(to) ?? 0;
    else if (transition?.toTime === INTERACTIVE_TO_SAME_POSITION && transition.fromTime !== INTERACTIVE_FROM_END) offset = oldPosition;
    const targetLength = musicStreamLength(target); if (targetLength > 0 && offset > targetLength) offset = 0;
    const next = createVoice(context, destination, target, random, context.currentTime, offset, 0, rateScale); if (next === undefined) return;
    const sourceStream = from < 0 ? null : stream.get_clip_stream(from);
    const timing = sourceStream === null ? { bpm: 0, beatCount: 0, barBeats: 0 } : musicStreamTiming(sourceStream);
    const fadeDuration = transition === undefined ? 0 : transition.fadeBeats * (timing.bpm > 0 ? 60 / timing.bpm : 1);
    let mode = transition?.fadeMode ?? INTERACTIVE_FADE_DISABLED;
    if (mode === INTERACTIVE_FADE_AUTOMATIC) mode = transition?.toTime === INTERACTIVE_TO_START ? INTERACTIVE_FADE_OUT : INTERACTIVE_FADE_CROSS;
    if ((mode === INTERACTIVE_FADE_IN || mode === INTERACTIVE_FADE_CROSS) && fadeDuration > 0) {
      next.gain.gain.setValueAtTime(0, context.currentTime); next.gain.gain.linearRampToValueAtTime(next.nominalGain, context.currentTime + fadeDuration);
    }
    if (transition !== undefined && !oldAlreadyRetired) retireCurrent(transition);
    else if (transition === undefined) stopVoice(voice);
    current = to; voice = next; clipPosition = offset; active = true;
  };

  const applyPending = (request: { to: number; transition: GodotInteractiveTransition; auto: boolean }): void => {
    const filler = request.transition.fillerClip;
    if (request.transition.useFillerClip && filler >= 0 && filler < stream.get_clip_count() && filler !== request.to && stream.get_clip_stream(filler) !== null) {
      retireCurrent(request.transition);
      fillerTargetRequest = { ...request, transition: { ...request.transition, useFillerClip: false } };
      const fillerStream = stream.get_clip_stream(filler)!;
      fillerClipIndex = filler;
      fillerVoice = createVoice(context, destination, fillerStream, random, context.currentTime, 0, 0, rateScale);
      fillerRemaining = musicStreamLength(fillerStream);
      return;
    }
    startClip(request.to, request.transition, request.auto);
  };

  const queue = (to: number, auto = false): void => {
    boundedIndex(to, 'AudioStreamPlaybackInteractive.switch_to_clip', stream.get_clip_count());
    if (stream.get_clip_stream(to) === null) return;
    if (current < 0 || voice === undefined) { startClip(to, undefined, auto); return; }
    let transition = stream.transition(current, to) ?? defaultTransition;
    if (auto) transition = { ...transition, fromTime: INTERACTIVE_FROM_END, toTime: transition.toTime === INTERACTIVE_TO_SAME_POSITION ? INTERACTIVE_TO_START : transition.toTime };
    const source = stream.get_clip_stream(current)!;
    const timing = musicStreamTiming(source), length = timing.bpm > 0 && timing.beatCount > 0 ? timing.beatCount * 60 / timing.bpm : musicStreamLength(source);
    let wait = 0;
    if (transition.fromTime === INTERACTIVE_FROM_END) wait = Math.max(0, length - clipPosition);
    else if ((transition.fromTime === INTERACTIVE_FROM_NEXT_BEAT || transition.fromTime === INTERACTIVE_FROM_NEXT_BAR) && timing.bpm > 0) {
      const beat = 60 / timing.bpm;
      const unit = transition.fromTime === INTERACTIVE_FROM_NEXT_BAR ? beat * timing.barBeats : beat;
      if (unit <= 0) { wait = 0; } else
      wait = unit - clipPosition % unit;
    }
    const request = { to, wait, transition, auto };
    if (wait <= 0) applyPending(request); else pending = request;
  };

  const autoAdvance = (): void => {
    const mode = stream.get_clip_auto_advance(current), next = stream.get_clip_auto_advance_next_clip(current);
    if (mode === INTERACTIVE_AUTO_ADVANCE_RETURN_TO_HOLD && returnMemory >= 0) { const target = returnMemory; returnMemory = -1; queue(target, true); }
    else if (mode === INTERACTIVE_AUTO_ADVANCE_ENABLED && next >= 0 && next < stream.get_clip_count() && next !== current) queue(next, true);
    else { active = false; stopVoice(voice); voice = undefined; current = -1; }
  };
  const playback: GodotAudioStreamPlaybackInteractive = {
    start() { playback.stop(); version = stream._get_version(); active = true; paused = false; queue(stream.get_initial_clip()); },
    tick(delta) {
      if (!active || paused) return;
      if (version !== stream._get_version()) { playback.stop(); return; }
      let remaining = Math.max(0, finite(delta, 'AudioStreamPlaybackInteractive.tick')) * rateScale;
      // Consume one caller step across every logical boundary it crosses. Hardware voices are
      // recreated at the current hardware instant, but transition decisions remain sim-clock only.
      for (let transitions = 0; remaining > 0 && active && transitions < 256; transitions += 1) {
        if (fillerTargetRequest !== undefined && fillerRemaining > 0) {
          const consumed = Math.min(remaining, fillerRemaining);
          fillerRemaining -= consumed; remaining -= consumed;
          if (fillerRemaining > 0) break;
          stopVoice(fillerVoice); fillerVoice = undefined; fillerRemaining = 0; fillerClipIndex = -1;
          const request = fillerTargetRequest; fillerTargetRequest = undefined;
          startClip(request.to, request.transition, request.auto, true);
          continue;
        }
        if (pending !== undefined) {
          if (pending.wait <= 0) {
            const request = pending; pending = undefined; applyPending(request); continue;
          }
          const consumed = Math.min(remaining, pending.wait);
          clipPosition += consumed; pending.wait -= consumed; remaining -= consumed;
          if (pending.wait <= 0) {
            const request = pending; pending = undefined; applyPending(request);
          }
          continue;
        }
        const child = current < 0 ? null : stream.get_clip_stream(current);
        if (child === null) return;
        const length = musicStreamLength(child);
        if (length <= 0) { clipPosition += remaining; remaining = 0; continue; }
        const toEnd = Math.max(0, length - clipPosition);
        if (toEnd > remaining) { clipPosition += remaining; remaining = 0; continue; }
        clipPosition += toEnd; remaining -= toEnd;
        if (musicStreamLoops(child) && stream.get_clip_auto_advance(current) === INTERACTIVE_AUTO_ADVANCE_DISABLED) {
          loops += 1; clipPosition = 0; continue;
        }
        autoAdvance();
      }
    },
    pause() { if (!active || paused) return; paused = true; stopVoice(voice); stopVoice(fillerVoice); voice = undefined; fillerVoice = undefined; },
    resume() { if (!active || !paused || current < 0) return; paused = false; if (fillerRemaining > 0 && fillerClipIndex >= 0) { const filler = stream.get_clip_stream(fillerClipIndex); if (filler !== null) fillerVoice = createVoice(context, destination, filler, random, context.currentTime, Math.max(0, musicStreamLength(filler) - fillerRemaining), 0, rateScale); return; } const child = stream.get_clip_stream(current); if (child !== null) voice = createVoice(context, destination, child, random, context.currentTime, clipPosition, 0, rateScale); },
    set_pitch_scale(scale) { rateScale = Math.max(0.01, finite(scale, 'AudioStreamPlaybackInteractive.pitch_scale')); if (voice !== undefined) voice.source.playbackRate.value = voice.streamPitch * rateScale; if (fillerVoice !== undefined) fillerVoice.source.playbackRate.value = fillerVoice.streamPitch * rateScale; },
    stop() { stopVoice(voice); stopVoice(fillerVoice); voice = undefined; fillerVoice = undefined; current = -1; active = false; pending = undefined; fillerTargetRequest = undefined; fillerRemaining = 0; fillerClipIndex = -1; clipPosition = 0; },
    is_playing: () => active,
    get_loop_count: () => loops,
    get_playback_position: () => clipPosition,
    seek(_to) { /* Godot AudioStreamPlaybackInteractive::seek is explicitly unsupported. */ },
    switch_to_clip_by_name(name) { for (let at = 0; at < stream.get_clip_count(); at += 1) if (stream.get_clip_name(at) === String(name)) { queue(at); return; } },
    switch_to_clip: (at) => queue(at),
    get_current_clip_index: () => current,
    dispose() { playback.stop(); previousPositions.clear(); },
  };
  registerGodotObjectIdentity(playback, 'AudioStreamPlaybackInteractive');
  return playback;
}
