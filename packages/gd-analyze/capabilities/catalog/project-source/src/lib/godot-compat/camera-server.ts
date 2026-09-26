/** Retained CameraServer and CameraFeed lifecycle over project-provided frame producers. */
import { registerGodotObjectIdentity } from './object';
import { createSignal, type GodotSignal } from './signal';
import { godotTransform2DNew, type GodotTransform2D } from './transform-2d';

export const CAMERA_FEED_NOIMAGE = 0;
export const CAMERA_FEED_RGB = 1;
export const CAMERA_FEED_YCBCR = 2;
export const CAMERA_FEED_YCBCR_SEP = 3;
export const CAMERA_FEED_EXTERNAL = 4;
export const CAMERA_FEED_UNSPECIFIED = 0;
export const CAMERA_FEED_FRONT = 1;
export const CAMERA_FEED_BACK = 2;

export interface GodotCameraFeedHooks {
  readonly activate?: () => boolean;
  readonly deactivate?: () => void;
  readonly setFormat?: (index: number, parameters: ReadonlyMap<unknown, unknown> | Readonly<Record<string, unknown>>) => boolean;
  readonly getFormats?: () => readonly unknown[];
}

function integer(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`CameraFeed.${member} requires integer.`);
  return value;
}

function stringValue(value: unknown, member: string): string {
  if (typeof value !== 'string') throw new TypeError(`CameraFeed.${member} requires String.`);
  return value;
}

let nextFeedId = 1;

export class GodotCameraFeed {
  private readonly frameChanged = createSignal<[]>();
  private readonly formatChanged = createSignal<[]>();
  private activeValue = false;
  private nameValue = '';
  private positionValue = CAMERA_FEED_UNSPECIFIED;
  private transformValue: GodotTransform2D = godotTransform2DNew();
  private dataTypeValue = CAMERA_FEED_NOIMAGE;
  private readonly images = new Map<number, unknown>();
  private readonly textureIds = new Map<number, number>();
  private externalSize = { width: 0, height: 0 };
  private selectedFormat = -1;
  private selectedParameters: ReadonlyMap<unknown, unknown> | Readonly<Record<string, unknown>> = {};

  readonly id = nextFeedId++;
  readonly frame_changed: GodotSignal<[]> = this.frameChanged.signal;
  readonly format_changed: GodotSignal<[]> = this.formatChanged.signal;

  constructor(private readonly hooks: GodotCameraFeedHooks = {}) {
    registerGodotObjectIdentity(this, 'CameraFeed');
  }

  get feed_is_active(): boolean { return this.is_active(); }
  set feed_is_active(value: boolean) { this.set_active(value); }
  get feed_transform(): GodotTransform2D { return this.get_transform(); }
  set feed_transform(value: GodotTransform2D) { this.set_transform(value); }
  get formats(): readonly unknown[] { return this.get_formats(); }

  _activate_feed(): boolean { return this.hooks.activate?.() ?? true; }
  _deactivate_feed(): void { this.hooks.deactivate?.(); }
  _set_format(index: number, parameters: ReadonlyMap<unknown, unknown> | Readonly<Record<string, unknown>>): boolean {
    return this.hooks.setFormat?.(index, parameters) ?? this.get_formats()[index] !== undefined;
  }
  _get_formats(): readonly unknown[] { return this.hooks.getFormats?.() ?? []; }
  get_id(): number { return this.id; }
  is_active(): boolean { return this.activeValue; }

  set_active(active: unknown): void {
    const next = Boolean(active);
    if (next === this.activeValue) return;
    if (next) {
      if (!this._activate_feed()) return;
      this.activeValue = true;
    } else {
      this._deactivate_feed();
      this.activeValue = false;
    }
  }

  get_name(): string { return this.nameValue; }
  set_name(name: unknown): void { this.nameValue = stringValue(name, 'set_name'); }
  get_position(): number { return this.positionValue; }
  set_position(position: unknown): void {
    const next = integer(position, 'set_position');
    if (next < 0 || next > 2) throw new RangeError('CameraFeed.position is outside FeedPosition.');
    this.positionValue = next;
  }
  get_transform(): GodotTransform2D { return godotTransform2DNew(this.transformValue); }
  set_transform(transform: GodotTransform2D): void { this.transformValue = godotTransform2DNew(transform); }

  set_rgb_image(image: unknown): void {
    this.images.clear(); this.images.set(0, image); this.dataTypeValue = CAMERA_FEED_RGB; this.frameChanged.emit();
  }
  set_ycbcr_image(image: unknown): void {
    this.images.clear(); this.images.set(0, image); this.dataTypeValue = CAMERA_FEED_YCBCR; this.frameChanged.emit();
  }
  set_ycbcr_images(yImage: unknown, cbcrImage: unknown): void {
    this.images.clear(); this.images.set(0, yImage); this.images.set(1, cbcrImage);
    this.dataTypeValue = CAMERA_FEED_YCBCR_SEP; this.frameChanged.emit();
  }
  set_external(widthValue: unknown, heightValue: unknown): void {
    const width = integer(widthValue, 'set_external width');
    const height = integer(heightValue, 'set_external height');
    if (width < 0 || height < 0) throw new RangeError('CameraFeed external size cannot be negative.');
    this.externalSize = { width, height }; this.images.clear(); this.dataTypeValue = CAMERA_FEED_EXTERNAL;
    this.frameChanged.emit();
  }

  set_texture_tex_id(feedImageType: unknown, textureId: unknown): void {
    this.textureIds.set(integer(feedImageType, 'set_texture_tex_id image'), integer(textureId, 'set_texture_tex_id texture'));
    this.frameChanged.emit();
  }
  get_texture_tex_id(feedImageType: unknown): number { return this.textureIds.get(integer(feedImageType, 'get_texture_tex_id')) ?? 0; }
  get_datatype(): number { return this.dataTypeValue; }
  get_formats(): readonly unknown[] { return [...this._get_formats()]; }

  set_format(indexValue: unknown, parameters: ReadonlyMap<unknown, unknown> | Readonly<Record<string, unknown>> = {}): boolean {
    const index = integer(indexValue, 'set_format');
    if (index < 0 || !this._set_format(index, parameters)) return false;
    this.selectedFormat = index; this.selectedParameters = parameters; this.formatChanged.emit();
    return true;
  }

  get_selected_format(): number { return this.selectedFormat; }
  get_selected_parameters(): ReadonlyMap<unknown, unknown> | Readonly<Record<string, unknown>> { return this.selectedParameters; }
  get_image(type: number): unknown { return this.images.get(type) ?? null; }
  get_external_size(): { readonly width: number; readonly height: number } { return { ...this.externalSize }; }
}

class GodotCameraServerRuntime {
  private readonly feedAdded = createSignal<[id: number]>();
  private readonly feedRemoved = createSignal<[id: number]>();
  private readonly feedsUpdated = createSignal<[]>();
  private readonly feedList: GodotCameraFeed[] = [];
  private monitoring = false;
  readonly camera_feed_added: GodotSignal<[id: number]> = this.feedAdded.signal;
  readonly camera_feed_removed: GodotSignal<[id: number]> = this.feedRemoved.signal;
  readonly camera_feeds_updated: GodotSignal<[]> = this.feedsUpdated.signal;
  get monitoring_feeds(): boolean { return this.monitoring; }
  set monitoring_feeds(value: boolean) { this.set_monitoring_feeds(value); }
  get feeds(): readonly GodotCameraFeed[] { return [...this.feedList]; }
  set_monitoring_feeds(value: unknown): void { this.monitoring = Boolean(value); }
  is_monitoring_feeds(): boolean { return this.monitoring; }
  get_feed(indexValue: unknown): GodotCameraFeed | null { return this.feedList[integer(indexValue, 'get_feed')] ?? null; }
  get_feed_count(): number { return this.feedList.length; }
  add_feed(feed: GodotCameraFeed): void {
    if (!(feed instanceof GodotCameraFeed)) throw new TypeError('CameraServer.add_feed requires CameraFeed.');
    if (this.feedList.includes(feed)) return;
    this.feedList.push(feed); this.feedAdded.emit(feed.get_id()); this.feedsUpdated.emit();
  }
  remove_feed(feed: GodotCameraFeed): void {
    const index = this.feedList.indexOf(feed);
    if (index < 0) return;
    this.feedList.splice(index, 1); feed.set_active(false);
    this.feedRemoved.emit(feed.get_id()); this.feedsUpdated.emit();
  }
}

export const GodotCameraServer = new GodotCameraServerRuntime();
export const createGodotCameraFeed = (hooks: GodotCameraFeedHooks = {}): GodotCameraFeed => new GodotCameraFeed(hooks);
