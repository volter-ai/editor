/** Godot VideoPlayer over one retained HTMLVideoElement and Pixi VideoTexture. */

import { Container, Sprite, Texture } from 'pixi.js';
import {
  assertGodotVideoCodec,
  bindGodotVideoStreamPlayer,
  getGodotVideoStreamPlayerAutoplay,
  getGodotVideoStreamPlayerAudioTrack,
  getGodotVideoStreamPlayerLoop,
  getGodotVideoStreamPlayerPaused,
  getGodotVideoStreamPlayerPosition,
  getGodotVideoStreamPlayerStream,
  getGodotVideoStreamPlayerStreamLength,
  getGodotVideoStreamPlayerStreamName,
  getGodotVideoStreamPlayerTexture,
  getGodotVideoStreamPlayerVolume,
  getGodotVideoStreamPlayerVolumeDb,
  godotVideoStreamPlayerFinishedSignal,
  isGodotVideoStreamPlayerPlaying,
  markInternalCanvasChild,
  playGodotVideoStreamPlayer,
  registerCanvasNodeRelease,
  releaseGodotVideoStreamPlayer,
  setGodotVideoStreamPlayerAutoplay,
  setGodotVideoStreamPlayerAudioTrack,
  setGodotVideoStreamPlayerLoop,
  setGodotVideoStreamPlayerPaused,
  setGodotVideoStreamPlayerPosition,
  setGodotVideoStreamPlayerStream,
  setGodotVideoStreamPlayerVolume,
  setGodotVideoStreamPlayerVolumeDb,
  stopGodotVideoStreamPlayer,
} from './node';
import type { GodotControl } from './control-state';
import type { GodotAudioGraph } from './audio-graph';
import { godotObjectGetClass, registerGodotObjectIdentity } from './object';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';

export interface GodotVideoStreamResource {
  file: string;
  browser_url: string;
  set_file(file: string): void;
  get_file(): string;
}

function browserVideoUrl(file: string): string {
  if (file === '') return '';
  if (file.startsWith('res://')) return `/${file.slice('res://'.length)}`;
  if (file.startsWith('/') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(file)) return file;
  throw new TypeError('VideoStream.file requires res://, an absolute browser path, or an absolute URL.');
}

/** One retained VideoStream resource whose file is already the emitted browser asset URL. */
export function createGodotVideoStream(
  file = '',
  godotClass: 'VideoStream' | 'VideoStreamTheora' = 'VideoStream',
): GodotVideoStreamResource {
  if (typeof file !== 'string') throw new TypeError('VideoStream.file requires String.');
  const stream = {
    file,
    browser_url: browserVideoUrl(file),
    set_file(value: string): void { setGodotVideoStreamFile(stream, value); },
    get_file(): string { return getGodotVideoStreamFile(stream); },
  };
  registerGodotObjectIdentity(stream, godotClass);
  bindGodotResourceProtocol(stream, {
    createDuplicate(source) {
      return createGodotVideoStream(source.file, godotClass) as typeof source;
    },
  });
  return stream;
}

function videoStreamResource(value: unknown, member: string): GodotVideoStreamResource & object {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`VideoStream.${member} requires a retained VideoStream Resource.`);
  }
  const className = godotObjectGetClass(value);
  if (className !== 'VideoStream' && className !== 'VideoStreamTheora') {
    throw new TypeError(`VideoStream.${member} requires VideoStream; received ${className}.`);
  }
  return value as GodotVideoStreamResource & object;
}

/** The authored browser URL consumed by VideoStreamPlayer's retained HTMLVideoElement. */
export function setGodotVideoStreamFile(stream: unknown, file: unknown): void {
  const resource = videoStreamResource(stream, 'set_file');
  if (typeof file !== 'string') throw new TypeError('VideoStream.file requires String.');
  const browserUrl = browserVideoUrl(file);
  if (resource.file === file && resource.browser_url === browserUrl) return;
  resource.file = file;
  resource.browser_url = browserUrl;
  godotResourceEmitChanged(resource);
}

export function getGodotVideoStreamFile(stream: unknown): string {
  const file = videoStreamResource(stream, 'get_file').file;
  return typeof file === 'string' ? file : '';
}

export interface GodotVideoPlayer extends Container {
  stream: unknown | null;
  autoplay: boolean;
  paused: boolean;
  loop: boolean;
  stream_position: number;
  volume: number;
  volume_db: number;
  audio_track: number;
  expand: boolean;
  buffering_msec: number;
  bus: string;
  speed_scale: number;
  readonly finished: GodotSignal<readonly []>;
  play(): void;
  stop(): void;
  is_playing(): boolean;
  set_stream(value: unknown | null): void;
  get_stream(): unknown | null;
  set_autoplay(value: boolean): void;
  has_autoplay(): boolean;
  set_paused(value: boolean): void;
  is_paused(): boolean;
  set_loop(value: boolean): void;
  has_loop(): boolean;
  set_stream_position(value: number): void;
  get_stream_position(): number;
  set_volume(value: number): void;
  get_volume(): number;
  set_volume_db(value: number): void;
  get_volume_db(): number;
  set_audio_track(value: number): void;
  get_audio_track(): number;
  set_expand(value: boolean): void;
  has_expand(): boolean;
  set_buffering_msec(value: number): void;
  get_buffering_msec(): number;
  set_bus(value: string): void;
  get_bus(): string;
  set_speed_scale(value: number): void;
  get_speed_scale(): number;
  get_stream_length(): number;
  get_stream_name(): string;
  get_video_texture(): Texture | null;
}

interface VideoState {
  readonly video: HTMLVideoElement;
  readonly sprite: Sprite;
  readonly context: AudioContext | null;
  readonly gain: GainNode | null;
  readonly finished: SignalHandle<readonly []>;
  readonly releaseMediaEvents: () => void;
  stream: unknown | null;
  autoplay: boolean;
  pausedByUser: boolean;
  started: boolean;
  audioTrack: number;
  volume: number;
  asyncState: 'idle' | 'pending' | 'ready' | 'error';
  lastAsyncError: unknown | null;
  expand: boolean;
  bufferingMsec: number;
  bus: string;
  speedScale: number;
}

const VIDEOS = new WeakMap<Container, VideoState>();

export interface GodotVideoStreamPlayerNode {
  readonly name: string;
  readonly siblingIndex: number;
  stream: unknown | null;
  autoplay: boolean;
  paused: boolean;
  loop: boolean;
  stream_position: number;
  volume: number;
  volume_db: number;
  audio_track: number;
  readonly finished: GodotSignal<readonly []>;
  play(): void;
  stop(): void;
  is_playing(): boolean;
  set_stream(value: unknown | null): void;
  get_stream(): unknown | null;
  set_autoplay(value: boolean): void;
  has_autoplay(): boolean;
  set_paused(value: boolean): void;
  is_paused(): boolean;
  set_loop(value: boolean): void;
  has_loop(): boolean;
  set_stream_position(value: number): void;
  get_stream_position(): number;
  set_volume(value: number): void;
  get_volume(): number;
  set_volume_db(value: number): void;
  get_volume_db(): number;
  set_audio_track(value: number): void;
  get_audio_track(): number;
  get_stream_length(): number;
  get_stream_name(): string;
  get_video_texture(): Texture | null;
}

interface VideoStreamPlayerTree {
  registerNonDisplayChild(parent: object, child: object, siblingIndex?: number): () => void;
}

/**
 * Godot 4 VideoStreamPlayer is a non-visual Node. The native HTMLVideoElement remains a private
 * playback carrier until get_video_texture() gives an explicit renderer consumer its VideoTexture.
 */
export function createGodotVideoStreamPlayer(
  options: {
    readonly name?: string;
    readonly siblingIndex?: number;
    readonly audioGraph?: GodotAudioGraph;
  } = {},
): GodotVideoStreamPlayerNode {
  const siblingIndex = options.siblingIndex ?? 0;
  if (!Number.isSafeInteger(siblingIndex) || siblingIndex < 0) {
    throw new RangeError('VideoStreamPlayer siblingIndex requires a non-negative safe integer.');
  }
  const audioGraph = (): GodotAudioGraph => {
    if (options.audioGraph === undefined) {
      throw new Error('VideoStreamPlayer volume routing requires the owning AudioServer graph.');
    }
    return options.audioGraph;
  };
  const node = { name: options.name ?? '', siblingIndex } as GodotVideoStreamPlayerNode;
  Object.defineProperties(node, {
    stream: { configurable: true, enumerable: true, get: () => getGodotVideoStreamPlayerStream(node), set: (value: unknown | null) => setGodotVideoStreamPlayerStream(node, value) },
    autoplay: { configurable: true, enumerable: true, get: () => getGodotVideoStreamPlayerAutoplay(node), set: (value: boolean) => setGodotVideoStreamPlayerAutoplay(node, value) },
    paused: { configurable: true, enumerable: true, get: () => getGodotVideoStreamPlayerPaused(node), set: (value: boolean) => setGodotVideoStreamPlayerPaused(node, value) },
    loop: { configurable: true, enumerable: true, get: () => getGodotVideoStreamPlayerLoop(node), set: (value: boolean) => setGodotVideoStreamPlayerLoop(node, value) },
    stream_position: { configurable: true, enumerable: true, get: () => getGodotVideoStreamPlayerPosition(node), set: (value: number) => setGodotVideoStreamPlayerPosition(node, value) },
    volume: { configurable: true, enumerable: true, get: () => getGodotVideoStreamPlayerVolume(node), set: (value: number) => setGodotVideoStreamPlayerVolume(node, value, audioGraph()) },
    volume_db: { configurable: true, enumerable: true, get: () => getGodotVideoStreamPlayerVolumeDb(node), set: (value: number) => setGodotVideoStreamPlayerVolumeDb(node, value, audioGraph()) },
    audio_track: { configurable: true, enumerable: true, get: () => getGodotVideoStreamPlayerAudioTrack(node), set: (value: number) => setGodotVideoStreamPlayerAudioTrack(node, value) },
    finished: { configurable: true, enumerable: true, get: () => godotVideoStreamPlayerFinishedSignal(node) },
  });
  Object.assign(node, {
    play: (): void => playGodotVideoStreamPlayer(node),
    stop: (): void => stopGodotVideoStreamPlayer(node),
    is_playing: (): boolean => isGodotVideoStreamPlayerPlaying(node),
    set_stream: (value: unknown | null): void => setGodotVideoStreamPlayerStream(node, value),
    get_stream: (): unknown | null => getGodotVideoStreamPlayerStream(node),
    set_autoplay: (value: boolean): void => setGodotVideoStreamPlayerAutoplay(node, value),
    has_autoplay: (): boolean => getGodotVideoStreamPlayerAutoplay(node),
    set_paused: (value: boolean): void => setGodotVideoStreamPlayerPaused(node, value),
    is_paused: (): boolean => getGodotVideoStreamPlayerPaused(node),
    set_loop: (value: boolean): void => setGodotVideoStreamPlayerLoop(node, value),
    has_loop: (): boolean => getGodotVideoStreamPlayerLoop(node),
    set_stream_position: (value: number): void => setGodotVideoStreamPlayerPosition(node, value),
    get_stream_position: (): number => getGodotVideoStreamPlayerPosition(node),
    set_volume: (value: number): void => setGodotVideoStreamPlayerVolume(node, value, audioGraph()),
    get_volume: (): number => getGodotVideoStreamPlayerVolume(node),
    set_volume_db: (value: number): void => setGodotVideoStreamPlayerVolumeDb(node, value, audioGraph()),
    get_volume_db: (): number => getGodotVideoStreamPlayerVolumeDb(node),
    set_audio_track: (value: number): void => setGodotVideoStreamPlayerAudioTrack(node, value),
    get_audio_track: (): number => getGodotVideoStreamPlayerAudioTrack(node),
    get_stream_length: (): number => getGodotVideoStreamPlayerStreamLength(node),
    get_stream_name: (): string => getGodotVideoStreamPlayerStreamName(node),
    get_video_texture: (): Texture | null => getGodotVideoStreamPlayerTexture(node),
  });
  registerGodotObjectIdentity(node, 'VideoStreamPlayer');
  return node;
}

/** Retain the non-visual player in the real SceneTree hierarchy and release its native media seat. */
export function attachGodotVideoStreamPlayerToTree(
  tree: VideoStreamPlayerTree,
  parent: object,
  node: GodotVideoStreamPlayerNode,
): () => void {
  const releaseChild = tree.registerNonDisplayChild(parent, node, node.siblingIndex);
  return () => {
    releaseChild();
    releaseGodotVideoStreamPlayer(node);
  };
}

export function resizeGodotVideoStreamPlayer(node: Container, width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) {
    throw new RangeError('VideoPlayer Control size requires finite non-negative dimensions.');
  }
  const state = VIDEOS.get(node);
  if (state === undefined) throw new Error('VideoPlayer has no retained Pixi video carrier.');
  if (state.expand) {
    state.sprite.width = width;
    state.sprite.height = height;
  } else if (state.video.videoWidth > 0 && state.video.videoHeight > 0) {
    state.sprite.width = state.video.videoWidth;
    state.sprite.height = state.video.videoHeight;
  }
}

export function setGodotVideoPlayerExpand(node: Container, expand: boolean): void {
  if (typeof expand !== 'boolean') throw new TypeError('VideoPlayer.expand requires bool.');
  const state = VIDEOS.get(node);
  if (state === undefined) throw new Error('VideoPlayer has no retained Pixi video carrier.');
  state.expand = expand;
  if (!expand && state.video.videoWidth > 0 && state.video.videoHeight > 0) {
    state.sprite.width = state.video.videoWidth;
    state.sprite.height = state.video.videoHeight;
  }
}

/** Bind the Three/DOM Control identity directly to the overlay's native video element. */
export interface GodotDomVideoPlayer extends GodotControl {
  stream: unknown | null;
  autoplay: boolean;
  paused: boolean;
  loop: boolean;
  stream_position: number;
  volume: number;
  volume_db: number;
  audio_track: number;
  readonly finished: GodotSignal<readonly []>;
  play(): void;
  stop(): void;
  is_playing(): boolean;
  set_stream(value: unknown | null): void;
  get_stream(): unknown | null;
  set_autoplay(value: boolean): void;
  has_autoplay(): boolean;
  set_paused(value: boolean): void;
  is_paused(): boolean;
  set_loop(value: boolean): void;
  has_loop(): boolean;
  set_stream_position(value: number): void;
  get_stream_position(): number;
  set_volume(value: number): void;
  get_volume(): number;
  set_volume_db(value: number): void;
  get_volume_db(): number;
  set_audio_track(value: number): void;
  get_audio_track(): number;
  get_stream_name(): string;
  get_video_texture(): Texture | null;
}

export function bindGodotDomVideoPlayer<T extends GodotControl>(
  control: T,
  graph: GodotAudioGraph,
): T & GodotDomVideoPlayer {
  const bindPresentation = control.bindPresentationElement;
  Object.defineProperty(control, 'bindPresentationElement', {
    configurable: true,
    value: (element: HTMLElement | null): void => {
      bindPresentation?.(element);
      if (element === null) return;
      if (!(element instanceof HTMLVideoElement)) {
        throw new TypeError('VideoPlayer requires a native HTMLVideoElement presentation.');
      }
      bindGodotVideoStreamPlayer(control, element);
    },
  });
  Object.defineProperties(control, {
      stream: { configurable: true, get: () => getGodotVideoStreamPlayerStream(control), set: (value) => setGodotVideoStreamPlayerStream(control, value) },
      autoplay: { configurable: true, get: () => getGodotVideoStreamPlayerAutoplay(control), set: (value) => setGodotVideoStreamPlayerAutoplay(control, value) },
      paused: { configurable: true, get: () => getGodotVideoStreamPlayerPaused(control), set: (value) => setGodotVideoStreamPlayerPaused(control, value) },
      loop: { configurable: true, get: () => getGodotVideoStreamPlayerLoop(control), set: (value) => setGodotVideoStreamPlayerLoop(control, value) },
      stream_position: { configurable: true, get: () => getGodotVideoStreamPlayerPosition(control), set: (value) => setGodotVideoStreamPlayerPosition(control, value) },
      volume: { configurable: true, get: () => getGodotVideoStreamPlayerVolume(control), set: (value) => setGodotVideoStreamPlayerVolume(control, value, graph) },
      volume_db: { configurable: true, get: () => getGodotVideoStreamPlayerVolumeDb(control), set: (value) => setGodotVideoStreamPlayerVolumeDb(control, value, graph) },
      audio_track: { configurable: true, get: () => getGodotVideoStreamPlayerAudioTrack(control), set: (value) => setGodotVideoStreamPlayerAudioTrack(control, value) },
      finished: { configurable: true, get: () => godotVideoStreamPlayerFinishedSignal(control) },
  });
  const video = control as T & GodotDomVideoPlayer;
  video.play = () => playGodotVideoStreamPlayer(control);
  video.stop = () => stopGodotVideoStreamPlayer(control);
  video.is_playing = () => isGodotVideoStreamPlayerPlaying(control);
  video.set_stream = (value) => { video.stream = value; };
  video.get_stream = () => video.stream;
  video.set_autoplay = (value) => { video.autoplay = value; };
  video.has_autoplay = () => video.autoplay;
  video.set_paused = (value) => { video.paused = value; };
  video.is_paused = () => video.paused;
  video.set_loop = (value) => { video.loop = value; };
  video.has_loop = () => video.loop;
  video.set_stream_position = (value) => { video.stream_position = value; };
  video.get_stream_position = () => video.stream_position;
  video.set_volume = (value) => { video.volume = value; };
  video.get_volume = () => video.volume;
  video.set_volume_db = (value) => { video.volume_db = value; };
  video.get_volume_db = () => video.volume_db;
  video.set_audio_track = (value) => { video.audio_track = value; };
  video.get_audio_track = () => video.audio_track;
  video.get_stream_name = () => getGodotVideoStreamPlayerStreamName(control);
  video.get_video_texture = () => getGodotVideoStreamPlayerTexture(control);
  registerGodotObjectIdentity(control, 'VideoPlayer');
  return control as T & GodotDomVideoPlayer;
}

function retainMediaPromise(state: VideoState, operation: Promise<void>): void {
  state.asyncState = 'pending';
  operation.then(
    () => { state.asyncState = 'ready'; state.lastAsyncError = null; },
    (error: unknown) => { state.asyncState = 'error'; state.lastAsyncError = error; },
  );
}

function playMedia(state: VideoState): void {
  if (state.context?.state === 'suspended') retainMediaPromise(state, state.context.resume());
  retainMediaPromise(state, state.video.play());
}

function streamUrl(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'object' && value !== null) {
    for (const key of ['browser_url', 'url', 'src', 'path', 'resource_path', 'file']) {
      const candidate = Reflect.get(value, key);
      if (typeof candidate === 'string' && candidate.length > 0) return candidate;
    }
  }
  throw new TypeError('VideoPlayer.stream requires a retained VideoStream resource with a browser URL.');
}

interface BrowserAudioTrack {
  enabled: boolean;
}

interface BrowserAudioTrackList {
  readonly length: number;
  readonly [index: number]: BrowserAudioTrack | undefined;
}

function browserAudioTracks(video: HTMLVideoElement): BrowserAudioTrackList | undefined {
  return (video as HTMLVideoElement & { readonly audioTracks?: BrowserAudioTrackList }).audioTracks;
}

function finiteLinearVolume(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError('VideoPlayer.volume requires finite linear gain.');
  }
  return value;
}

function setLinearVolume(state: VideoState, value: number): void {
  const linear = finiteLinearVolume(value);
  if (state.gain === null && (linear < 0 || linear > 1)) {
    throw new Error('VideoPlayer.volume outside [0, 1] requires the native Web Audio gain owner.');
  }
  state.volume = linear;
  if (state.gain !== null) state.gain.gain.value = linear;
  else state.video.volume = linear;
}

function setDbVolume(state: VideoState, value: number): void {
  const db = finiteDb(value);
  setLinearVolume(state, db < -79 ? 0 : Math.exp(db * 0.11512925464970229));
}

function setPaused(state: VideoState, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError('VideoPlayer.paused requires bool.');
  if (state.pausedByUser === value) return;
  state.pausedByUser = value;
  if (value) state.video.pause();
  else if (state.started && state.stream !== null) playMedia(state);
}

function setAudioTrack(state: VideoState, value: number): void {
  if (!Number.isSafeInteger(value)) throw new TypeError('VideoPlayer.audio_track requires int.');
  const tracks = browserAudioTracks(state.video);
  if (tracks === undefined) {
    if (value !== 0) throw new Error('VideoPlayer.audio_track selection is unavailable because this browser exposes no AudioTrackList.');
    state.audioTrack = value;
    return;
  }
  state.audioTrack = value;
  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];
    if (track !== undefined) track.enabled = index === value;
  }
}

function finiteDb(value: number): number {
  if (typeof value !== 'number' || (value !== Number.NEGATIVE_INFINITY && !Number.isFinite(value))) {
    throw new TypeError('VideoPlayer.volume_db requires finite dB or -INF for mute.');
  }
  return value;
}

export function createGodotVideoPlayer(): GodotVideoPlayer {
  if (typeof document === 'undefined') throw new Error('VideoPlayer requires the browser HTML media backend.');
  const node = new Container() as GodotVideoPlayer;
  const video = document.createElement('video');
  video.preload = 'auto';
  video.playsInline = true;
  const texture = Texture.from(video);
  const sprite = markInternalCanvasChild(new Sprite(texture));
  node.addChild(sprite);
  const Context = globalThis.AudioContext;
  const context = Context === undefined ? null : new Context();
  const gain = context?.createGain() ?? null;
  if (context !== null && gain !== null) {
    context.createMediaElementSource(video).connect(gain).connect(context.destination);
  }
  const finished = createSignal<readonly []>();
  const emitFinished = (): void => finished.emit();
  const retainNativePlayback = (): void => { state.started = true; };
  const retainNativeError = (): void => {
    state.asyncState = 'error';
    state.lastAsyncError = video.error ?? new Error('VideoPlayer native media decode failed.');
  };
  const syncIntrinsicSize = (): void => {
    if (!state.expand && video.videoWidth > 0 && video.videoHeight > 0) {
      sprite.width = video.videoWidth;
      sprite.height = video.videoHeight;
    }
  };
  video.addEventListener('ended', emitFinished);
  video.addEventListener('play', retainNativePlayback);
  video.addEventListener('error', retainNativeError);
  video.addEventListener('loadedmetadata', syncIntrinsicSize);
  const state: VideoState = {
    video,
    sprite,
    context,
    gain,
    finished,
    releaseMediaEvents: () => {
      video.removeEventListener('ended', emitFinished);
      video.removeEventListener('play', retainNativePlayback);
      video.removeEventListener('error', retainNativeError);
      video.removeEventListener('loadedmetadata', syncIntrinsicSize);
    },
    stream: null,
    autoplay: false,
    pausedByUser: false,
    started: false,
    audioTrack: 0,
    volume: 1,
    asyncState: 'idle',
    lastAsyncError: null,
    expand: true,
    bufferingMsec: 500,
    bus: 'Master',
    speedScale: 1,
  };
  VIDEOS.set(node, state);
  Object.defineProperties(node, {
    stream: {
      enumerable: true, configurable: true, get: () => state.stream,
      set: (value: unknown | null) => {
        let resolvedUrl: string | null = null;
        if (value !== null) resolvedUrl = streamUrl(value);
        state.stream = value;
        state.started = false;
        video.pause();
        if (value === null) { video.removeAttribute('src'); video.load(); return; }
        assertGodotVideoCodec(video, resolvedUrl!);
        video.src = resolvedUrl!;
        video.load();
      },
    },
    autoplay: {
      enumerable: true, configurable: true, get: () => state.autoplay,
      set: (value: boolean) => {
        if (typeof value !== 'boolean') throw new TypeError('VideoPlayer.autoplay requires bool.');
        state.autoplay = value;
        video.autoplay = value;
      },
    },
    paused: {
      enumerable: true, configurable: true, get: () => state.pausedByUser,
      set: (value: boolean) => setPaused(state, value),
    },
    loop: {
      enumerable: true, configurable: true, get: () => video.loop,
      set: (value: boolean) => {
        if (typeof value !== 'boolean') throw new TypeError('VideoPlayer.loop requires bool.');
        video.loop = value;
      },
    },
    stream_position: {
      enumerable: true, configurable: true, get: () => video.currentTime,
      set: (value: number) => {
        if (!Number.isFinite(value) || value < 0) throw new RangeError('VideoPlayer.stream_position requires finite non-negative seconds.');
        video.currentTime = value;
      },
    },
    volume: {
      enumerable: true, configurable: true, get: () => state.volume,
      set: (value: number) => setLinearVolume(state, value),
    },
    volume_db: {
      enumerable: true, configurable: true, get: () => state.volume === 0 ? -80 : 20 * Math.log10(state.volume),
      set: (value: number) => setDbVolume(state, value),
    },
    audio_track: {
      enumerable: true, configurable: true, get: () => state.audioTrack,
      set: (value: number) => setAudioTrack(state, value),
    },
    expand: { enumerable: true, configurable: true, get: () => state.expand, set: (value: boolean) => { setGodotVideoPlayerExpand(node, value); } },
    buffering_msec: { enumerable: true, configurable: true, get: () => state.bufferingMsec, set: (value: number) => { if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('VideoPlayer.buffering_msec requires non-negative integer milliseconds.'); state.bufferingMsec = value; } },
    bus: { enumerable: true, configurable: true, get: () => state.bus, set: (value: string) => { if (typeof value !== 'string') throw new TypeError('VideoPlayer.bus requires StringName.'); state.bus = value; } },
    speed_scale: { enumerable: true, configurable: true, get: () => state.speedScale, set: (value: number) => { if (!Number.isFinite(value) || value <= 0) throw new RangeError('VideoPlayer.speed_scale requires a positive finite number.'); state.speedScale = value; video.playbackRate = value; } },
    finished: {
      enumerable: true, configurable: true, value: finished.signal,
    },
  });
  node.play = (): void => {
    if (state.stream === null) return;
    state.started = true;
    if (!state.pausedByUser) playMedia(state);
  };
  node.stop = (): void => {
    video.pause();
    state.started = false;
    if (video.readyState === HTMLMediaElement.HAVE_NOTHING || video.seekable.length === 0) return;
    try { video.currentTime = 0; }
    catch (error: unknown) { state.asyncState = 'error'; state.lastAsyncError = error; }
  };
  node.is_playing = (): boolean => !video.paused && !video.ended;
  node.set_stream = (value): void => { node.stream = value; };
  node.get_stream = (): unknown | null => node.stream;
  node.set_autoplay = (value): void => { node.autoplay = value; };
  node.has_autoplay = (): boolean => node.autoplay;
  node.set_paused = (value): void => { node.paused = value; };
  node.is_paused = (): boolean => node.paused;
  node.set_loop = (value): void => { node.loop = value; };
  node.has_loop = (): boolean => node.loop;
  node.set_stream_position = (value): void => { node.stream_position = value; };
  node.get_stream_position = (): number => node.stream_position;
  node.set_volume = (value): void => { node.volume = value; };
  node.get_volume = (): number => node.volume;
  node.set_volume_db = (value): void => { node.volume_db = value; };
  node.get_volume_db = (): number => node.volume_db;
  node.set_audio_track = (value): void => { node.audio_track = value; };
  node.get_audio_track = (): number => node.audio_track;
  node.set_expand = (value): void => { node.expand = value; };
  node.has_expand = (): boolean => state.expand;
  node.set_buffering_msec = (value): void => { node.buffering_msec = value; };
  node.get_buffering_msec = (): number => state.bufferingMsec;
  node.set_bus = (value): void => { node.bus = value; };
  node.get_bus = (): string => state.bus;
  node.set_speed_scale = (value): void => { node.speed_scale = value; };
  node.get_speed_scale = (): number => state.speedScale;
  node.get_stream_length = (): number => Number.isFinite(video.duration) ? video.duration : 0;
  node.get_stream_name = (): string => {
    if (state.stream === null) return '<No Stream>';
    if (typeof state.stream === 'object') {
      const name = Reflect.get(state.stream, 'resource_name');
      if (typeof name === 'string') return name;
    }
    return '';
  };
  node.get_video_texture = (): Texture | null => state.stream === null ? null : texture;
  registerGodotObjectIdentity(node, 'VideoPlayer');
  registerCanvasNodeRelease(node, () => {
    video.pause();
    state.releaseMediaEvents();
    video.removeAttribute('src');
    video.load();
    sprite.removeFromParent();
    sprite.destroy({ texture: true, textureSource: true });
    if (context !== null) retainMediaPromise(state, context.close());
    VIDEOS.delete(node);
  });
  return node;
}
