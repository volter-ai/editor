import { LinearFilter, SRGBColorSpace, VideoTexture } from 'three';
import { registerGodotObjectIdentity } from './object';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';

export const GODOT_CAMERA_FEED_POSITION = Object.freeze({ UNSPECIFIED: 0, FRONT: 1, BACK: 2 });
export const GODOT_CAMERA_FEED_IMAGE = Object.freeze({ RGB: 0, YCBCR: 1, Y: 2, CBCR: 3 });
export const GODOT_CAMERA_FEED_DATA_TYPE = Object.freeze({ NONE: 0, IMAGE: 1 });

export interface GodotCameraFeedFormat {
  readonly width: number;
  readonly height: number;
  readonly format: string;
  readonly frame_denominator: number;
  readonly frame_numerator: number;
}

export interface GodotCameraFeedOptions {
  readonly id?: number;
  readonly name?: string;
  readonly position?: number;
  readonly transform?: unknown;
  readonly formats?: readonly Partial<GodotCameraFeedFormat>[];
  readonly stream?: MediaStream | null;
}

export interface GodotCameraFeedSnapshot {
  readonly id: number;
  readonly name: string;
  readonly position: number;
  readonly transform: unknown;
  readonly active: boolean;
  readonly datatype: number;
  readonly formats: readonly GodotCameraFeedFormat[];
  readonly stream: MediaStream | null;
  readonly revision: number;
}

type FeedWatcher = (snapshot: GodotCameraFeedSnapshot) => void;

let nextFeedId = 1;
const FEEDS = new Map<number, GodotCameraFeed>();
const SERVER_WATCHERS = new Set<(feeds: readonly GodotCameraFeed[]) => void>();

function integer(value: unknown, member: string, minimum = 0, maximum = 0x7fff_ffff): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new RangeError(`godot-compat: ${member} requires integer in [${minimum}, ${maximum}].`);
  return value as number;
}

function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`godot-compat: ${member} requires bool.`);
  return value;
}

function format(value: Partial<GodotCameraFeedFormat>): GodotCameraFeedFormat {
  return Object.freeze({
    width: integer(value.width ?? 0, 'CameraFeedFormat.width'),
    height: integer(value.height ?? 0, 'CameraFeedFormat.height'),
    format: String(value.format ?? ''),
    frame_denominator: integer(value.frame_denominator ?? 1, 'CameraFeedFormat.frame_denominator', 1),
    frame_numerator: integer(value.frame_numerator ?? 0, 'CameraFeedFormat.frame_numerator'),
  });
}

function serverPublish(): void {
  const feeds = Object.freeze([...FEEDS.values()]);
  for (const watcher of SERVER_WATCHERS) watcher(feeds);
}

export class GodotCameraFeed {
  public readonly __godotClass = 'CameraFeed';
  private readonly idValue: number;
  private nameValue: string;
  private positionValue: number;
  private transformValue: unknown;
  private activeValue = false;
  private datatypeValue: number;
  private formatsValue: GodotCameraFeedFormat[];
  private streamValue: MediaStream | null;
  private revisionValue = 0;
  private readonly watchers = new Set<FeedWatcher>();

  public constructor(options: GodotCameraFeedOptions = {}) {
    this.idValue = integer(options.id ?? nextFeedId++, 'CameraFeed.id', 1);
    if (FEEDS.has(this.idValue)) throw new Error(`godot-compat: CameraFeed id ${this.idValue} already exists.`);
    nextFeedId = Math.max(nextFeedId, this.idValue + 1);
    this.nameValue = String(options.name ?? `Camera ${this.idValue}`);
    this.positionValue = integer(options.position ?? 0, 'CameraFeed.position', 0, 2);
    this.transformValue = options.transform ?? null;
    this.formatsValue = (options.formats ?? []).map(format);
    this.streamValue = options.stream ?? null;
    this.datatypeValue = this.streamValue === null ? 0 : 1;
    registerGodotObjectIdentity(this, 'CameraFeed');
    bindGodotResourceProtocol<GodotCameraFeed>(this, {
      createDuplicate: (source) => new GodotCameraFeed({
        name: source.nameValue, position: source.positionValue, transform: source.transformValue,
        formats: source.formatsValue, stream: source.streamValue,
      }),
    });
  }

  private publish(): void {
    this.revisionValue += 1;
    const value = this.snapshot();
    for (const watcher of this.watchers) watcher(value);
    godotResourceEmitChanged(this);
  }

  public getId(): number { return this.idValue; }
  public getName(): string { return this.nameValue; }
  public setName(value: unknown): void { this.nameValue = String(value); this.publish(); serverPublish(); }
  public getPosition(): number { return this.positionValue; }
  public setPosition(value: unknown): void { this.positionValue = integer(value, 'CameraFeed.position', 0, 2); this.publish(); }
  public getTransform(): unknown { return this.transformValue; }
  public setTransform(value: unknown): void { this.transformValue = value; this.publish(); }
  public isActive(): boolean { return this.activeValue; }
  public setActive(value: unknown): void {
    const active = bool(value, 'CameraFeed.active');
    if (active === this.activeValue) return;
    this.activeValue = active;
    for (const track of this.streamValue?.getTracks() ?? []) track.enabled = active;
    this.publish();
  }
  public getDatatype(): number { return this.datatypeValue; }
  public getFormats(): GodotCameraFeedFormat[] { return this.formatsValue.map((one) => ({ ...one })); }
  public setFormats(value: readonly Partial<GodotCameraFeedFormat>[]): void {
    if (!Array.isArray(value)) throw new TypeError('godot-compat: CameraFeed.formats requires Array.');
    this.formatsValue = value.map(format); this.publish();
  }
  public setStream(stream: MediaStream | null): void {
    if (stream !== null && (typeof MediaStream === 'undefined' || !(stream instanceof MediaStream))) throw new TypeError('godot-compat: CameraFeed stream requires MediaStream or null.');
    for (const track of this.streamValue?.getTracks() ?? []) track.enabled = false;
    this.streamValue = stream;
    this.datatypeValue = stream === null ? 0 : 1;
    for (const track of stream?.getTracks() ?? []) track.enabled = this.activeValue;
    this.publish();
  }
  public getStream(): MediaStream | null { return this.streamValue; }
  public snapshot(): GodotCameraFeedSnapshot {
    return Object.freeze({ id: this.idValue, name: this.nameValue, position: this.positionValue, transform: this.transformValue, active: this.activeValue, datatype: this.datatypeValue, formats: Object.freeze(this.getFormats()), stream: this.streamValue, revision: this.revisionValue });
  }
  public watch(watcher: FeedWatcher): () => void { this.watchers.add(watcher); watcher(this.snapshot()); return () => this.watchers.delete(watcher); }
}

export function createGodotCameraFeed(options: GodotCameraFeedOptions = {}): GodotCameraFeed { return new GodotCameraFeed(options); }
export function godotCameraServerAddFeed(feed: GodotCameraFeed): void {
  if (!(feed instanceof GodotCameraFeed)) throw new TypeError('godot-compat: CameraServer.add_feed requires CameraFeed.');
  FEEDS.set(feed.getId(), feed); serverPublish();
}
export function godotCameraServerRemoveFeed(feed: GodotCameraFeed): void {
  if (!(feed instanceof GodotCameraFeed)) throw new TypeError('godot-compat: CameraServer.remove_feed requires CameraFeed.');
  if (FEEDS.delete(feed.getId())) serverPublish();
}
export function godotCameraServerGetFeed(id: unknown): GodotCameraFeed | null { return FEEDS.get(integer(id, 'CameraServer.get_feed.id', 1)) ?? null; }
export function godotCameraServerGetFeeds(): GodotCameraFeed[] { return [...FEEDS.values()]; }
export function watchGodotCameraServer(watcher: (feeds: readonly GodotCameraFeed[]) => void): () => void { SERVER_WATCHERS.add(watcher); watcher(Object.freeze([...FEEDS.values()])); return () => SERVER_WATCHERS.delete(watcher); }

interface CameraTextureState {
  feedId: number;
  whichFeed: number;
  cameraActive: boolean;
  video: HTMLVideoElement | null;
  texture: VideoTexture | null;
  unwatch: (() => void) | null;
}

export interface GodotCameraTexture {
  readonly __godotClass: 'CameraTexture';
  camera_feed_id: number;
  which_feed: number;
  camera_is_active: boolean;
  setCameraFeedId(value: unknown): void;
  getCameraFeedId(): number;
  setWhichFeed(value: unknown): void;
  getWhichFeed(): number;
  setCameraActive(value: unknown): void;
  getCameraActive(): boolean;
  getNativeTexture(): VideoTexture | null;
  dispose(): void;
}

function replaceTexture(state: CameraTextureState): void {
  state.unwatch?.(); state.unwatch = null;
  state.texture?.dispose(); state.texture = null;
  if (state.video !== null) { state.video.pause(); state.video.srcObject = null; state.video.remove(); state.video = null; }
  const feed = FEEDS.get(state.feedId);
  if (feed === undefined) return;
  feed.setActive(state.cameraActive);
  state.unwatch = feed.watch((snapshot) => {
    if (!state.cameraActive || snapshot.stream === null || typeof document === 'undefined') return;
    if (state.video === null) {
      const video = document.createElement('video');
      video.autoplay = true; video.muted = true; video.playsInline = true; video.srcObject = snapshot.stream;
      const texture = new VideoTexture(video); texture.minFilter = LinearFilter; texture.magFilter = LinearFilter; texture.colorSpace = SRGBColorSpace;
      state.video = video; state.texture = texture;
      void video.play().catch(() => undefined);
    } else if (state.video.srcObject !== snapshot.stream) {
      state.video.srcObject = snapshot.stream; void state.video.play().catch(() => undefined);
    }
  });
}

export function createGodotCameraTexture(): GodotCameraTexture {
  const state: CameraTextureState = { feedId: 1, whichFeed: 0, cameraActive: false, video: null, texture: null, unwatch: null };
  const value: GodotCameraTexture = {
    __godotClass: 'CameraTexture',
    get camera_feed_id() { return state.feedId; }, set camera_feed_id(next) { value.setCameraFeedId(next); },
    get which_feed() { return state.whichFeed; }, set which_feed(next) { value.setWhichFeed(next); },
    get camera_is_active() { return state.cameraActive; }, set camera_is_active(next) { value.setCameraActive(next); },
    setCameraFeedId(next) { state.feedId = integer(next, 'CameraTexture.camera_feed_id', 1); replaceTexture(state); godotResourceEmitChanged(value); },
    getCameraFeedId() { return state.feedId; },
    setWhichFeed(next) { state.whichFeed = integer(next, 'CameraTexture.which_feed', 0, 3); godotResourceEmitChanged(value); },
    getWhichFeed() { return state.whichFeed; },
    setCameraActive(next) { state.cameraActive = bool(next, 'CameraTexture.camera_is_active'); replaceTexture(state); godotResourceEmitChanged(value); },
    getCameraActive() { return state.cameraActive; },
    getNativeTexture() { return state.texture; },
    dispose() { state.cameraActive = false; replaceTexture(state); },
  };
  registerGodotObjectIdentity(value, 'CameraTexture');
  bindGodotResourceProtocol<GodotCameraTexture>(value, { createDuplicate: (source) => { const duplicate = createGodotCameraTexture(); duplicate.camera_feed_id = source.camera_feed_id; duplicate.which_feed = source.which_feed; duplicate.camera_is_active = source.camera_is_active; return duplicate; } });
  return value;
}
