/** Godot XRInterfaceExtension virtual bridge for translated custom XR providers. */
import { Matrix4, Vector3 } from 'three';
import { GodotXRInterface, XR_CAPABILITY_NONE, XR_TRACKING_NOT_TRACKING } from './xr-runtime';
import type { GodotRect2i } from './rect2';
import type { Vector2 } from './vector2';

export interface GodotXRBlit {
  readonly renderTarget: unknown;
  readonly sourceRect: GodotRect2i;
  readonly destinationRect: GodotRect2i;
  readonly useLayer: boolean;
  readonly layer: number;
  readonly applyLensDistortion: boolean;
  readonly eyeCenter: Vector2;
  readonly k1: number;
  readonly k2: number;
  readonly upscale: number;
  readonly aspectRatio: number;
}

export interface GodotXRInterfaceExtensionCallbacks {
  readonly getName?: () => string;
  readonly getCapabilities?: () => number;
  readonly isInitialized?: () => boolean;
  readonly initialize?: () => boolean;
  readonly uninitialize?: () => void;
  readonly getSystemInfo?: () => Record<string, unknown>;
  readonly supportsPlayAreaMode?: (mode: number) => boolean;
  readonly getPlayAreaMode?: () => number;
  readonly setPlayAreaMode?: (mode: number) => boolean;
  readonly getPlayArea?: () => readonly { readonly x: number; readonly y: number; readonly z: number }[];
  readonly getRenderTargetSize?: () => Vector2;
  readonly getViewCount?: () => number;
  readonly getCameraTransform?: () => Matrix4;
  readonly getTransformForView?: (view: number, cameraTransform: Matrix4) => Matrix4;
  readonly getProjectionForView?: (view: number, aspect: number, near: number, far: number) => Matrix4;
  readonly getVrsTexture?: () => unknown;
  readonly getVrsTextureFormat?: () => number;
  readonly process?: () => void;
  readonly preRender?: () => void;
  readonly preDrawViewport?: (renderTarget: unknown) => boolean;
  readonly postDrawViewport?: (renderTarget: unknown, screenRect: GodotRect2i) => void;
  readonly endFrame?: () => void;
  readonly getSuggestedTrackerNames?: () => readonly string[];
  readonly getSuggestedPoseNames?: (trackerName: string) => readonly string[];
  readonly getTrackingStatus?: () => number;
  readonly triggerHapticPulse?: (
    actionName: string,
    trackerName: string,
    frequency: number,
    amplitude: number,
    durationSec: number,
    delaySec: number,
  ) => void;
  readonly getAnchorDetectionIsEnabled?: () => boolean;
  readonly setAnchorDetectionIsEnabled?: (enabled: boolean) => void;
  readonly getCameraFeedId?: () => number;
  readonly getColorTexture?: () => unknown;
  readonly getDepthTexture?: () => unknown;
  readonly getVelocityTexture?: () => unknown;
  readonly getRenderTargetTexture?: (renderTarget: unknown) => unknown;
}

export class GodotXRInterfaceExtension extends GodotXRInterface {
  private callbacks: GodotXRInterfaceExtensionCallbacks;
  private readonly blits: GodotXRBlit[] = [];

  constructor(callbacks: GodotXRInterfaceExtensionCallbacks = {}) {
    super(callbacks.getName?.() ?? 'XRInterfaceExtension', 'XRInterfaceExtension');
    this.callbacks = callbacks;
  }

  set_callbacks(callbacks: GodotXRInterfaceExtensionCallbacks): void {
    if (typeof callbacks !== 'object' || callbacks === null) {
      throw new TypeError('XRInterfaceExtension callbacks require an object.');
    }
    this.callbacks = callbacks;
  }

  _get_name(): string { return this.callbacks.getName?.() ?? 'XRInterfaceExtension'; }
  _get_capabilities(): number { return this.callbacks.getCapabilities?.() ?? XR_CAPABILITY_NONE; }
  _is_initialized(): boolean { return this.callbacks.isInitialized?.() ?? this.initialized; }
  _initialize(): boolean {
    const initialized = this.callbacks.initialize?.() ?? true;
    this.initialized = initialized;
    return initialized;
  }
  _uninitialize(): void {
    this.callbacks.uninitialize?.();
    this.initialized = false;
  }
  _get_system_info(): Record<string, unknown> { return { ...(this.callbacks.getSystemInfo?.() ?? {}) }; }
  _supports_play_area_mode(mode: number): boolean { return this.callbacks.supportsPlayAreaMode?.(mode) ?? false; }
  _get_play_area_mode(): number { return this.callbacks.getPlayAreaMode?.() ?? this.playAreaMode; }
  _set_play_area_mode(mode: number): boolean {
    const accepted = this.callbacks.setPlayAreaMode?.(mode) ?? false;
    if (accepted) this.playAreaMode = mode;
    return accepted;
  }
  _get_play_area(): Vector3[] {
    return [...(this.callbacks.getPlayArea?.() ?? [])].map(
      (point) => new Vector3(point.x, point.y, point.z),
    );
  }
  _get_render_target_size(): Vector2 { return { ...(this.callbacks.getRenderTargetSize?.() ?? { x: 0, y: 0 }) }; }
  _get_view_count(): number { return this.callbacks.getViewCount?.() ?? 1; }
  _get_camera_transform(): Matrix4 { return this.callbacks.getCameraTransform?.()?.clone() ?? new Matrix4(); }
  _get_transform_for_view(view: number, cameraTransform: Matrix4): Matrix4 {
    return this.callbacks.getTransformForView?.(view, cameraTransform.clone())?.clone() ?? cameraTransform.clone();
  }
  _get_projection_for_view(view: number, aspect: number, near: number, far: number): Matrix4 {
    return this.callbacks.getProjectionForView?.(view, aspect, near, far)?.clone() ??
      super.get_projection_for_view(view, aspect, near, far);
  }
  _get_vrs_texture(): unknown { return this.callbacks.getVrsTexture?.() ?? null; }
  _get_vrs_texture_format(): number { return this.callbacks.getVrsTextureFormat?.() ?? 0; }
  _process(): void { this.callbacks.process?.(); }
  _pre_render(): void { this.callbacks.preRender?.(); }
  _pre_draw_viewport(renderTarget: unknown): boolean {
    return this.callbacks.preDrawViewport?.(renderTarget) ?? true;
  }
  _post_draw_viewport(renderTarget: unknown, screenRect: GodotRect2i): void {
    this.callbacks.postDrawViewport?.(renderTarget, screenRect);
  }
  _end_frame(): void { this.callbacks.endFrame?.(); this.blits.length = 0; }
  _get_suggested_tracker_names(): string[] { return [...(this.callbacks.getSuggestedTrackerNames?.() ?? [])]; }
  _get_suggested_pose_names(trackerName: string): string[] {
    return [...(this.callbacks.getSuggestedPoseNames?.(trackerName) ?? [])];
  }
  _get_tracking_status(): number { return this.callbacks.getTrackingStatus?.() ?? XR_TRACKING_NOT_TRACKING; }
  _trigger_haptic_pulse(
    actionName: string,
    trackerName: string,
    frequency: number,
    amplitude: number,
    durationSec: number,
    delaySec: number,
  ): void {
    const callback = this.callbacks.triggerHapticPulse;
    if (callback === undefined) {
      throw new Error('XRInterfaceExtension._trigger_haptic_pulse is not implemented by this provider.');
    }
    callback(actionName, trackerName, frequency, amplitude, durationSec, delaySec);
  }
  _get_anchor_detection_is_enabled(): boolean {
    return this.callbacks.getAnchorDetectionIsEnabled?.() ?? this.anchorDetection;
  }
  _set_anchor_detection_is_enabled(enabled: boolean): void {
    this.callbacks.setAnchorDetectionIsEnabled?.(enabled);
    this.anchorDetection = enabled;
  }
  _get_camera_feed_id(): number { return this.callbacks.getCameraFeedId?.() ?? 0; }
  _get_color_texture(): unknown { return this.callbacks.getColorTexture?.() ?? null; }
  _get_depth_texture(): unknown { return this.callbacks.getDepthTexture?.() ?? null; }
  _get_velocity_texture(): unknown { return this.callbacks.getVelocityTexture?.() ?? null; }
  get_color_texture(): unknown { return this._get_color_texture(); }
  get_depth_texture(): unknown { return this._get_depth_texture(); }
  get_velocity_texture(): unknown { return this._get_velocity_texture(); }

  add_blit(
    renderTarget: unknown,
    sourceRect: GodotRect2i,
    destinationRect: GodotRect2i,
    useLayer = false,
    layer = 0,
    applyLensDistortion = false,
    eyeCenter: Vector2 = { x: 0.5, y: 0.5 },
    k1 = 0,
    k2 = 0,
    upscale = 1,
    aspectRatio = 1,
  ): void {
    if (!Number.isInteger(layer) || layer < 0) throw new RangeError('XRInterfaceExtension.add_blit layer must be non-negative.');
    for (const [name, value] of Object.entries({ k1, k2, upscale, aspectRatio, eyeCenterX: eyeCenter.x, eyeCenterY: eyeCenter.y })) {
      if (!Number.isFinite(value)) throw new TypeError(`XRInterfaceExtension.add_blit ${name} must be finite.`);
    }
    this.blits.push({
      renderTarget,
      sourceRect: copyRect(sourceRect),
      destinationRect: copyRect(destinationRect),
      useLayer: Boolean(useLayer),
      layer,
      applyLensDistortion: Boolean(applyLensDistortion),
      eyeCenter: { ...eyeCenter },
      k1,
      k2,
      upscale,
      aspectRatio,
    });
  }
  get_render_target_texture(renderTarget: unknown): unknown {
    return this.callbacks.getRenderTargetTexture?.(renderTarget) ?? renderTarget;
  }
  consume_blits(): GodotXRBlit[] {
    const result = this.blits.splice(0, this.blits.length);
    return result.map((blit) => ({
      ...blit,
      sourceRect: copyRect(blit.sourceRect),
      destinationRect: copyRect(blit.destinationRect),
      eyeCenter: { ...blit.eyeCenter },
    }));
  }

  override get_name(): string { return this._get_name(); }
  override get_capabilities(): number { return this._get_capabilities(); }
  override is_initialized(): boolean { return this._is_initialized(); }
  override initialize(): boolean { return this._initialize(); }
  override uninitialize(): void { this._uninitialize(); }
  override get_system_info(): Record<string, unknown> { return this._get_system_info(); }
  override supports_play_area_mode(mode: number): boolean { return this._supports_play_area_mode(mode); }
  override get_play_area_mode(): number { return this._get_play_area_mode(); }
  override set_play_area_mode(mode: number): boolean { return this._set_play_area_mode(mode); }
  override get_play_area(): Vector3[] { return this._get_play_area(); }
  override get_render_target_size(): Vector2 { return this._get_render_target_size(); }
  override get_view_count(): number { return this._get_view_count(); }
  override get_transform_for_view(view: number, cameraTransform: Matrix4): Matrix4 {
    return this._get_transform_for_view(view, cameraTransform);
  }
  override get_projection_for_view(view: number, aspect: number, near: number, far: number): Matrix4 {
    return this._get_projection_for_view(view, aspect, near, far);
  }
  override get_tracking_status(): number { return this._get_tracking_status(); }
  override trigger_haptic_pulse(
    actionName: string,
    trackerName: string,
    frequency: number,
    amplitude: number,
    durationSec: number,
    delaySec = 0,
  ): void {
    this._trigger_haptic_pulse(actionName, trackerName, frequency, amplitude, durationSec, delaySec);
  }
  override get_anchor_detection_is_enabled(): boolean { return this._get_anchor_detection_is_enabled(); }
  override set_anchor_detection_is_enabled(value: boolean): void { this._set_anchor_detection_is_enabled(value); }
  override get_camera_feed_id(): number { return this._get_camera_feed_id(); }
}

function copyRect(value: GodotRect2i): GodotRect2i {
  const position = { x: value.position.x, y: value.position.y };
  const size = { x: value.size.x, y: value.size.y };
  return {
    position,
    size,
    get end() { return { x: this.position.x + this.size.x, y: this.position.y + this.size.y }; },
    set end(end: Vector2) { this.size = { x: end.x - this.position.x, y: end.y - this.position.y }; },
  };
}

export function createGodotXRInterfaceExtension(
  callbacks: GodotXRInterfaceExtensionCallbacks = {},
): GodotXRInterfaceExtension {
  return new GodotXRInterfaceExtension(callbacks);
}
