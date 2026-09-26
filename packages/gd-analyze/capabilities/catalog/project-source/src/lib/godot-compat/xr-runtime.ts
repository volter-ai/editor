/**
 * Godot 4.7 XR runtime protocols over native Three transforms and browser WebXR sessions.
 *
 * The retained values in this file mirror the state-bearing classes in `servers/xr/`. Browser
 * sessions remain browser-owned; interfaces and trackers only expose their source-visible state.
 */
import { Matrix4, Vector3, type Object3D } from 'three';
import { registerGodotObjectIdentity } from './object';
import { createSignal, type GodotSignal } from './signal';
import type { Vector2 } from './vector2';

export const XR_TRACKER_HEAD = 1;
export const XR_TRACKER_CONTROLLER = 2;
export const XR_TRACKER_BASESTATION = 4;
export const XR_TRACKER_ANCHOR = 8;
export const XR_TRACKER_HAND = 16;
export const XR_TRACKER_BODY = 32;
export const XR_TRACKER_FACE = 64;
export const XR_TRACKER_ANY_KNOWN = 127;
export const XR_TRACKER_UNKNOWN = 128;
export const XR_TRACKER_ANY = 255;

export const XR_ROTATION_RESET_FULL = 0;
export const XR_ROTATION_RESET_KEEP_TILT = 1;
export const XR_ROTATION_DONT_RESET = 2;

export const XR_CAPABILITY_NONE = 0;
export const XR_CAPABILITY_MONO = 1;
export const XR_CAPABILITY_STEREO = 2;
export const XR_CAPABILITY_QUAD = 4;
export const XR_CAPABILITY_VR = 8;
export const XR_CAPABILITY_AR = 16;
export const XR_CAPABILITY_EXTERNAL = 32;

export const XR_TRACKING_NORMAL = 0;
export const XR_TRACKING_EXCESSIVE_MOTION = 1;
export const XR_TRACKING_INSUFFICIENT_FEATURES = 2;
export const XR_TRACKING_UNKNOWN = 3;
export const XR_TRACKING_NOT_TRACKING = 4;

export const XR_PLAY_AREA_UNKNOWN = 0;
export const XR_PLAY_AREA_3DOF = 1;
export const XR_PLAY_AREA_SITTING = 2;
export const XR_PLAY_AREA_ROOMSCALE = 3;
export const XR_PLAY_AREA_STAGE = 4;
export const XR_PLAY_AREA_CUSTOM = 0x7fffffff;

export const XR_ENV_BLEND_OPAQUE = 0;
export const XR_ENV_BLEND_ADDITIVE = 1;
export const XR_ENV_BLEND_ALPHA_BLEND = 2;

export const XR_TRACKING_CONFIDENCE_NONE = 0;
export const XR_TRACKING_CONFIDENCE_LOW = 1;
export const XR_TRACKING_CONFIDENCE_HIGH = 2;

export const XR_TRACKER_HAND_UNKNOWN = 0;
export const XR_TRACKER_HAND_LEFT = 1;
export const XR_TRACKER_HAND_RIGHT = 2;
export const XR_TRACKER_HAND_MAX = 3;

export const WEBXR_TARGET_RAY_UNKNOWN = 0;
export const WEBXR_TARGET_RAY_GAZE = 1;
export const WEBXR_TARGET_RAY_TRACKED_POINTER = 2;
export const WEBXR_TARGET_RAY_SCREEN = 3;

export type GodotXRTransform = Matrix4;
export type GodotXRVector3 = Vector3;

function requireFinite(value: number, owner: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${owner} requires a finite number.`);
  return value;
}

function requireEnum(value: number, accepted: readonly number[], owner: string): number {
  if (!Number.isInteger(value) || !accepted.includes(value)) {
    throw new RangeError(`${owner} received an invalid enum value ${String(value)}.`);
  }
  return value;
}

function requireString(value: string, owner: string): string {
  if (typeof value !== 'string') throw new TypeError(`${owner} requires StringName.`);
  return value;
}

function cloneTransform(value: Matrix4, owner: string): Matrix4 {
  if (!(value instanceof Matrix4)) throw new TypeError(`${owner} requires Transform3D.`);
  return value.clone();
}

function cloneVector(value: Vector3, owner: string): Vector3 {
  if (!(value instanceof Vector3)) throw new TypeError(`${owner} requires Vector3.`);
  return value.clone();
}

export class GodotXRPose {
  private trackingData = false;
  private poseName = '';
  private transform = new Matrix4();
  private linearVelocity = new Vector3();
  private angularVelocity = new Vector3();
  private confidence = XR_TRACKING_CONFIDENCE_NONE;

  constructor() { registerGodotObjectIdentity(this, 'XRPose'); }

  set_has_tracking_data(value: boolean): void {
    if (typeof value !== 'boolean') throw new TypeError('XRPose.has_tracking_data requires bool.');
    this.trackingData = value;
  }
  get_has_tracking_data(): boolean { return this.trackingData; }
  set_name(value: string): void { this.poseName = requireString(value, 'XRPose.name'); }
  get_name(): string { return this.poseName; }
  set_transform(value: Matrix4): void { this.transform = cloneTransform(value, 'XRPose.transform'); }
  get_transform(): Matrix4 { return this.transform.clone(); }
  get_adjusted_transform(): Matrix4 { return XRServer.adjust_transform(this.transform); }
  set_linear_velocity(value: Vector3): void {
    this.linearVelocity = cloneVector(value, 'XRPose.linear_velocity');
  }
  get_linear_velocity(): Vector3 { return this.linearVelocity.clone(); }
  set_angular_velocity(value: Vector3): void {
    this.angularVelocity = cloneVector(value, 'XRPose.angular_velocity');
  }
  get_angular_velocity(): Vector3 { return this.angularVelocity.clone(); }
  set_tracking_confidence(value: number): void {
    this.confidence = requireEnum(value, [0, 1, 2], 'XRPose.tracking_confidence');
  }
  get_tracking_confidence(): number { return this.confidence; }

  get has_tracking_data(): boolean { return this.get_has_tracking_data(); }
  set has_tracking_data(value: boolean) { this.set_has_tracking_data(value); }
  get name(): string { return this.get_name(); }
  set name(value: string) { this.set_name(value); }
  get tracking_confidence(): number { return this.get_tracking_confidence(); }
  set tracking_confidence(value: number) { this.set_tracking_confidence(value); }
}

export function createGodotXRPose(): GodotXRPose { return new GodotXRPose(); }

export class GodotXRTracker {
  private trackerType = XR_TRACKER_UNKNOWN;
  private trackerName = 'unknown';
  private trackerDescription = '';

  constructor(className = 'XRTracker') { registerGodotObjectIdentity(this, className); }

  set_tracker_type(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > XR_TRACKER_ANY) {
      throw new RangeError('XRTracker.type requires an 8-bit TrackerType mask.');
    }
    this.trackerType = value;
  }
  get_tracker_type(): number { return this.trackerType; }
  set_tracker_name(value: string): void {
    const name = requireString(value, 'XRTracker.name');
    if (name.length === 0) throw new RangeError('XRTracker.name cannot be empty.');
    this.trackerName = name;
  }
  get_tracker_name(): string { return this.trackerName; }
  set_tracker_desc(value: string): void {
    this.trackerDescription = requireString(value, 'XRTracker.description');
  }
  get_tracker_desc(): string { return this.trackerDescription; }

  get type(): number { return this.get_tracker_type(); }
  set type(value: number) { this.set_tracker_type(value); }
  get name(): string { return this.get_tracker_name(); }
  set name(value: string) { this.set_tracker_name(value); }
  get description(): string { return this.get_tracker_desc(); }
  set description(value: string) { this.set_tracker_desc(value); }
}

export function createGodotXRTracker(): GodotXRTracker { return new GodotXRTracker(); }

type GodotXRInputValue = boolean | number | Vector2;

export class GodotXRPositionalTracker extends GodotXRTracker {
  private readonly poseChangedHandle = createSignal<readonly [GodotXRPose]>();
  private readonly poseLostHandle = createSignal<readonly [GodotXRPose]>();
  private readonly buttonPressedHandle = createSignal<readonly [string]>();
  private readonly buttonReleasedHandle = createSignal<readonly [string]>();
  private readonly inputFloatChangedHandle = createSignal<readonly [string, number]>();
  private readonly inputVectorChangedHandle = createSignal<readonly [string, Vector2]>();
  private readonly profileChangedHandle = createSignal<readonly [string]>();
  readonly pose_changed = this.poseChangedHandle.signal;
  readonly pose_lost_tracking = this.poseLostHandle.signal;
  readonly button_pressed = this.buttonPressedHandle.signal;
  readonly button_released = this.buttonReleasedHandle.signal;
  readonly input_float_changed = this.inputFloatChangedHandle.signal;
  readonly input_vector2_changed = this.inputVectorChangedHandle.signal;
  readonly profile_changed = this.profileChangedHandle.signal;
  private profile = '';
  private hand = XR_TRACKER_HAND_UNKNOWN;
  private readonly poses = new Map<string, GodotXRPose>();
  private readonly inputs = new Map<string, GodotXRInputValue>();

  constructor(className = 'XRPositionalTracker') {
    super(className);
    this.set_tracker_type(XR_TRACKER_CONTROLLER);
  }

  get_tracker_profile(): string { return this.profile; }
  set_tracker_profile(value: string): void {
    const profile = requireString(value, 'XRPositionalTracker.profile');
    if (profile === this.profile) return;
    this.profile = profile;
    this.profileChangedHandle.emit(profile);
  }
  get_tracker_hand(): number { return this.hand; }
  set_tracker_hand(value: number): void {
    this.hand = requireEnum(value, [0, 1, 2], 'XRPositionalTracker.hand');
  }
  has_pose(name: string): boolean { return this.poses.has(requireString(name, 'XRPositionalTracker.has_pose')); }
  get_pose(name: string): GodotXRPose | null {
    return this.poses.get(requireString(name, 'XRPositionalTracker.get_pose')) ?? null;
  }
  invalidate_pose(name: string): void {
    const pose = this.poses.get(requireString(name, 'XRPositionalTracker.invalidate_pose'));
    if (pose === undefined || !pose.get_has_tracking_data()) return;
    pose.set_has_tracking_data(false);
    this.poseLostHandle.emit(pose);
  }
  set_pose(name: string, pose: GodotXRPose): void {
    const key = requireString(name, 'XRPositionalTracker.set_pose');
    if (!(pose instanceof GodotXRPose)) throw new TypeError('XRPositionalTracker.set_pose requires XRPose.');
    pose.set_name(key);
    this.poses.set(key, pose);
    if (pose.get_has_tracking_data()) this.poseChangedHandle.emit(pose);
    else this.poseLostHandle.emit(pose);
  }
  get_input(name: string): GodotXRInputValue | null {
    return this.inputs.get(requireString(name, 'XRPositionalTracker.get_input')) ?? null;
  }
  set_input(name: string, value: GodotXRInputValue): void {
    const key = requireString(name, 'XRPositionalTracker.set_input');
    if (typeof value !== 'boolean' && typeof value !== 'number' &&
        !(typeof value === 'object' && value !== null && 'x' in value && 'y' in value)) {
      throw new TypeError('XRPositionalTracker.set_input requires bool, float, or Vector2.');
    }
    const previous = this.inputs.get(key);
    this.inputs.set(key, value);
    if (typeof value === 'boolean') {
      if (previous !== value) (value ? this.buttonPressedHandle : this.buttonReleasedHandle).emit(key);
    } else if (typeof value === 'number') {
      requireFinite(value, 'XRPositionalTracker input float');
      if (previous !== value) this.inputFloatChangedHandle.emit(key, value);
    } else {
      const vector = { x: value.x, y: value.y };
      if (typeof previous !== 'object' || previous === null ||
          previous.x !== vector.x || previous.y !== vector.y) {
        this.inputVectorChangedHandle.emit(key, vector);
      }
    }
  }
}

export class GodotXRControllerTracker extends GodotXRPositionalTracker {
  constructor() { super('XRControllerTracker'); }
}

export function createGodotXRPositionalTracker(): GodotXRPositionalTracker {
  return new GodotXRPositionalTracker();
}
export function createGodotXRControllerTracker(): GodotXRControllerTracker {
  return new GodotXRControllerTracker();
}

export interface GodotXRSystemInfo {
  readonly XRRuntimeName?: string;
  readonly XRRuntimeVersion?: string;
  readonly [key: string]: unknown;
}

export interface GodotXRSessionLike extends EventTarget {
  readonly inputSources?: readonly GodotXRInputSourceLike[];
  readonly visibilityState?: string;
  readonly environmentBlendMode?: string;
  readonly enabledFeatures?: ReadonlySet<string>;
  readonly supportedFrameRates?: readonly number[];
  readonly frameRate?: number;
  requestReferenceSpace?(type: string): Promise<unknown>;
  updateTargetFrameRate?(rate: number): Promise<void>;
  end(): Promise<void>;
}

export interface GodotXRInputSourceLike {
  readonly handedness: string;
  readonly targetRayMode: string;
  readonly profiles: readonly string[];
  readonly gamepad?: {
    readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
    readonly axes: readonly number[];
  };
}

export interface GodotXRNavigatorLike {
  readonly xr?: {
    isSessionSupported(mode: string): Promise<boolean>;
    requestSession(mode: string, options?: Record<string, unknown>): Promise<GodotXRSessionLike>;
  };
}

export class GodotXRInterface {
  private readonly playAreaChangedHandle = createSignal<readonly [number]>();
  readonly play_area_changed = this.playAreaChangedHandle.signal;
  primary = false;
  protected initialized = false;
  protected playAreaMode = XR_PLAY_AREA_UNKNOWN;
  protected anchorDetection = false;
  protected environmentBlendMode = XR_ENV_BLEND_OPAQUE;
  protected trackingStatus = XR_TRACKING_NOT_TRACKING;
  protected renderTargetSize: Vector2 = { x: 0, y: 0 };
  protected systemInfo: GodotXRSystemInfo = {};

  constructor(private readonly interfaceName = 'XRInterface', className = 'XRInterface') {
    registerGodotObjectIdentity(this, className);
  }

  get_name(): string { return this.interfaceName; }
  get_capabilities(): number { return XR_CAPABILITY_NONE; }
  is_primary(): boolean { return this.primary; }
  set_primary(value: boolean): void {
    if (typeof value !== 'boolean') throw new TypeError('XRInterface.interface_is_primary requires bool.');
    if (value) XRServer.set_primary_interface(this);
    else if (XRServer.get_primary_interface() === this) XRServer.set_primary_interface(null);
    this.primary = value;
  }
  is_initialized(): boolean { return this.initialized; }
  initialize(): boolean | Promise<boolean> { this.initialized = true; return true; }
  uninitialize(): void { this.initialized = false; }
  get_system_info(): GodotXRSystemInfo { return { ...this.systemInfo }; }
  get_tracking_status(): number { return this.trackingStatus; }
  get_render_target_size(): Vector2 { return { ...this.renderTargetSize }; }
  get_view_count(): number { return (this.get_capabilities() & XR_CAPABILITY_STEREO) !== 0 ? 2 : 1; }
  trigger_haptic_pulse(
    _actionName: string,
    _trackerName: string,
    _frequency: number,
    _amplitude: number,
    _durationSec: number,
    _delaySec = 0,
  ): void {
    throw new Error('XRInterface.trigger_haptic_pulse requires a browser XRInputSource gamepad actuator.');
  }
  supports_play_area_mode(mode: number): boolean {
    return mode === XR_PLAY_AREA_UNKNOWN || mode === XR_PLAY_AREA_3DOF;
  }
  get_play_area_mode(): number { return this.playAreaMode; }
  set_play_area_mode(mode: number): boolean {
    requireEnum(mode, [0, 1, 2, 3, 4, 0x7fffffff], 'XRInterface.xr_play_area_mode');
    if (!this.supports_play_area_mode(mode)) return false;
    if (this.playAreaMode === mode) return true;
    this.playAreaMode = mode;
    this.playAreaChangedHandle.emit(mode);
    return true;
  }
  get_play_area(): Vector3[] { return []; }
  get_anchor_detection_is_enabled(): boolean { return this.anchorDetection; }
  set_anchor_detection_is_enabled(value: boolean): void {
    if (typeof value !== 'boolean') throw new TypeError('XRInterface anchor detection requires bool.');
    this.anchorDetection = value;
  }
  get_camera_feed_id(): number { return 0; }
  is_passthrough_supported(): boolean { return false; }
  is_passthrough_enabled(): boolean { return false; }
  start_passthrough(): boolean { return false; }
  stop_passthrough(): void {}
  get_transform_for_view(_view: number, cameraTransform: Matrix4): Matrix4 {
    return cloneTransform(cameraTransform, 'XRInterface.get_transform_for_view');
  }
  get_projection_for_view(_view: number, aspect: number, near: number, far: number): Matrix4 {
    requireFinite(aspect, 'XRInterface projection aspect');
    requireFinite(near, 'XRInterface projection near');
    requireFinite(far, 'XRInterface projection far');
    if (aspect <= 0 || near <= 0 || far <= near) throw new RangeError('XRInterface projection planes are invalid.');
    return new Matrix4().makePerspective(-near * aspect, near * aspect, near, -near, near, far);
  }
  get_supported_environment_blend_modes(): number[] { return [XR_ENV_BLEND_OPAQUE]; }
  set_environment_blend_mode(mode: number): boolean {
    requireEnum(mode, [0, 1, 2], 'XRInterface.environment_blend_mode');
    if (!this.get_supported_environment_blend_modes().includes(mode)) return false;
    this.environmentBlendMode = mode;
    return true;
  }
  get_environment_blend_mode(): number { return this.environmentBlendMode; }
}

export function createGodotXRInterface(): GodotXRInterface { return new GodotXRInterface(); }

function browserTargetRayMode(mode: string | undefined): number {
  switch (mode) {
    case 'gaze': return WEBXR_TARGET_RAY_GAZE;
    case 'tracked-pointer': return WEBXR_TARGET_RAY_TRACKED_POINTER;
    case 'screen': return WEBXR_TARGET_RAY_SCREEN;
    default: return WEBXR_TARGET_RAY_UNKNOWN;
  }
}

function browserEnvironmentBlendMode(mode: string | undefined): number {
  switch (mode) {
    case 'additive': return XR_ENV_BLEND_ADDITIVE;
    case 'alpha-blend': return XR_ENV_BLEND_ALPHA_BLEND;
    default: return XR_ENV_BLEND_OPAQUE;
  }
}

export class GodotWebXRInterface extends GodotXRInterface {
  private readonly sessionSupportedHandle = createSignal<readonly [string, boolean]>();
  private readonly sessionStartedHandle = createSignal<readonly []>();
  private readonly sessionEndedHandle = createSignal<readonly []>();
  private readonly sessionFailedHandle = createSignal<readonly [string]>();
  private readonly selectStartHandle = createSignal<readonly [string]>();
  private readonly selectHandle = createSignal<readonly [string]>();
  private readonly selectEndHandle = createSignal<readonly [string]>();
  private readonly squeezeStartHandle = createSignal<readonly [string]>();
  private readonly squeezeHandle = createSignal<readonly [string]>();
  private readonly squeezeEndHandle = createSignal<readonly [string]>();
  private readonly visibilityChangedHandle = createSignal<readonly []>();
  private readonly referenceSpaceResetHandle = createSignal<readonly []>();
  private readonly refreshRateChangedHandle = createSignal<readonly [number]>();
  readonly session_supported = this.sessionSupportedHandle.signal;
  readonly session_started = this.sessionStartedHandle.signal;
  readonly session_ended = this.sessionEndedHandle.signal;
  readonly session_failed = this.sessionFailedHandle.signal;
  readonly selectstart = this.selectStartHandle.signal;
  readonly select = this.selectHandle.signal;
  readonly selectend = this.selectEndHandle.signal;
  readonly squeezestart = this.squeezeStartHandle.signal;
  readonly squeeze = this.squeezeHandle.signal;
  readonly squeezeend = this.squeezeEndHandle.signal;
  readonly visibility_state_changed = this.visibilityChangedHandle.signal;
  readonly reference_space_reset = this.referenceSpaceResetHandle.signal;
  readonly display_refresh_rate_changed = this.refreshRateChangedHandle.signal;
  private sessionMode = 'immersive-vr';
  private requiredFeatures = '';
  private optionalFeatures = '';
  private requestedReferenceSpaces = 'local-floor,local,viewer';
  private referenceSpaceType = '';
  private enabledFeatures = '';
  private visibilityState = '';
  private session: GodotXRSessionLike | null = null;
  private readonly inputTrackers = new Map<number, GodotXRControllerTracker>();
  private releaseSessionListeners: (() => void) | null = null;

  constructor(
    private readonly navigatorLike: GodotXRNavigatorLike =
      ((globalThis as typeof globalThis & { navigator?: GodotXRNavigatorLike }).navigator ?? {}),
  ) {
    super('WebXR', 'WebXRInterface');
  }

  override get_capabilities(): number {
    return XR_CAPABILITY_STEREO | XR_CAPABILITY_VR | XR_CAPABILITY_AR;
  }
  async is_session_supported(sessionMode: string): Promise<void> {
    const mode = requireString(sessionMode, 'WebXRInterface.is_session_supported');
    try {
      const supported = await this.navigatorLike.xr?.isSessionSupported(mode) ?? false;
      this.sessionSupportedHandle.emit(mode, supported);
    } catch {
      this.sessionSupportedHandle.emit(mode, false);
    }
  }
  set_session_mode(value: string): void { this.sessionMode = requireString(value, 'WebXRInterface.session_mode'); }
  get_session_mode(): string { return this.sessionMode; }
  set_required_features(value: string): void { this.requiredFeatures = requireString(value, 'WebXRInterface.required_features'); }
  get_required_features(): string { return this.requiredFeatures; }
  set_optional_features(value: string): void { this.optionalFeatures = requireString(value, 'WebXRInterface.optional_features'); }
  get_optional_features(): string { return this.optionalFeatures; }
  set_requested_reference_space_types(value: string): void {
    this.requestedReferenceSpaces = requireString(value, 'WebXRInterface.requested_reference_space_types');
  }
  get_requested_reference_space_types(): string { return this.requestedReferenceSpaces; }
  get_reference_space_type(): string { return this.referenceSpaceType; }
  get_enabled_features(): string { return this.enabledFeatures; }
  get_visibility_state(): string { return this.visibilityState; }
  is_input_source_active(index: number): boolean { return this.sourceAt(index) !== undefined; }
  get_input_source_tracker(index: number): GodotXRControllerTracker | null {
    const source = this.sourceAt(index);
    if (source === undefined) return null;
    let tracker = this.inputTrackers.get(index);
    if (tracker === undefined) {
      tracker = new GodotXRControllerTracker();
      tracker.set_tracker_name(`webxr-${index}`);
      tracker.set_tracker_hand(source.handedness === 'left' ? XR_TRACKER_HAND_LEFT :
        source.handedness === 'right' ? XR_TRACKER_HAND_RIGHT : XR_TRACKER_HAND_UNKNOWN);
      tracker.set_tracker_profile(source.profiles[0] ?? '');
      this.inputTrackers.set(index, tracker);
      XRServer.add_tracker(tracker);
    }
    return tracker;
  }
  get_input_source_target_ray_mode(index: number): number {
    return browserTargetRayMode(this.sourceAt(index)?.targetRayMode);
  }
  get_display_refresh_rate(): number { return this.session?.frameRate ?? 0; }
  get_available_display_refresh_rates(): number[] { return [...(this.session?.supportedFrameRates ?? [])]; }
  async set_display_refresh_rate(rate: number): Promise<void> {
    requireFinite(rate, 'WebXRInterface.display_refresh_rate');
    if (rate <= 0) throw new RangeError('WebXRInterface.display_refresh_rate must be positive.');
    if (this.session?.updateTargetFrameRate === undefined) {
      throw new Error('WebXRInterface display refresh-rate updates are unavailable for this session.');
    }
    await this.session.updateTargetFrameRate(rate);
    this.refreshRateChangedHandle.emit(rate);
  }
  override async initialize(): Promise<boolean> {
    if (this.session !== null) return true;
    const xr = this.navigatorLike.xr;
    if (xr === undefined) return false;
    const split = (value: string): string[] => value.split(',').map((item) => item.trim()).filter(Boolean);
    try {
      const session = await xr.requestSession(this.sessionMode, {
        requiredFeatures: split(this.requiredFeatures), optionalFeatures: split(this.optionalFeatures),
      });
      this.session = session;
      this.initialized = true;
      this.trackingStatus = XR_TRACKING_NORMAL;
      this.environmentBlendMode = browserEnvironmentBlendMode(session.environmentBlendMode);
      this.enabledFeatures = [...(session.enabledFeatures ?? [])].join(',');
      this.visibilityState = session.visibilityState ?? '';
      this.referenceSpaceType = await this.selectReferenceSpace(session);
      this.bindSession(session);
      this.sessionStartedHandle.emit();
      return true;
    } catch (error) {
      this.sessionFailedHandle.emit(error instanceof Error ? error.message : String(error));
      return false;
    }
  }
  override uninitialize(): void {
    const session = this.session;
    this.releaseSession();
    if (session !== null) void session.end().catch(() => undefined);
  }
  override get_supported_environment_blend_modes(): number[] {
    return [XR_ENV_BLEND_OPAQUE, XR_ENV_BLEND_ADDITIVE, XR_ENV_BLEND_ALPHA_BLEND];
  }

  private sourceAt(index: number): GodotXRInputSourceLike | undefined {
    if (!Number.isInteger(index) || index < 0) throw new RangeError('WebXR input source index must be non-negative.');
    return this.session?.inputSources?.[index];
  }
  private async selectReferenceSpace(session: GodotXRSessionLike): Promise<string> {
    if (session.requestReferenceSpace === undefined) return '';
    for (const type of this.requestedReferenceSpaces.split(',').map((value) => value.trim()).filter(Boolean)) {
      try { await session.requestReferenceSpace(type); return type; } catch { /* try next authored type */ }
    }
    throw new Error('WebXRInterface could not acquire any requested reference-space type.');
  }
  private bindSession(session: GodotXRSessionLike): void {
    const controller = new AbortController();
    const signal = controller.signal;
    const inputIndex = (event: Event): number => {
      const source = (event as Event & { inputSource?: GodotXRInputSourceLike }).inputSource;
      return Math.max(0, session.inputSources?.indexOf(source as GodotXRInputSourceLike) ?? 0);
    };
    const name = (event: Event): string => this.get_input_source_tracker(inputIndex(event))?.get_tracker_name() ?? '';
    session.addEventListener('end', () => { this.releaseSession(); this.sessionEndedHandle.emit(); }, { signal });
    session.addEventListener('visibilitychange', () => {
      this.visibilityState = session.visibilityState ?? '';
      this.visibilityChangedHandle.emit();
    }, { signal });
    session.addEventListener('inputsourceschange', () => this.syncInputTrackers(), { signal });
    session.addEventListener('selectstart', (event) => this.selectStartHandle.emit(name(event)), { signal });
    session.addEventListener('select', (event) => this.selectHandle.emit(name(event)), { signal });
    session.addEventListener('selectend', (event) => this.selectEndHandle.emit(name(event)), { signal });
    session.addEventListener('squeezestart', (event) => this.squeezeStartHandle.emit(name(event)), { signal });
    session.addEventListener('squeeze', (event) => this.squeezeHandle.emit(name(event)), { signal });
    session.addEventListener('squeezeend', (event) => this.squeezeEndHandle.emit(name(event)), { signal });
    this.releaseSessionListeners = () => controller.abort();
    this.syncInputTrackers();
  }
  private syncInputTrackers(): void {
    const count = this.session?.inputSources?.length ?? 0;
    for (let index = 0; index < count; index += 1) this.get_input_source_tracker(index);
    for (const [index, tracker] of this.inputTrackers) {
      if (index >= count) { XRServer.remove_tracker(tracker); this.inputTrackers.delete(index); }
    }
  }
  private releaseSession(): void {
    this.releaseSessionListeners?.();
    this.releaseSessionListeners = null;
    for (const tracker of this.inputTrackers.values()) XRServer.remove_tracker(tracker);
    this.inputTrackers.clear();
    this.session = null;
    this.initialized = false;
    this.trackingStatus = XR_TRACKING_NOT_TRACKING;
  }
}

export function createGodotWebXRInterface(navigatorLike?: GodotXRNavigatorLike): GodotWebXRInterface {
  return new GodotWebXRInterface(navigatorLike);
}

class GodotXRServer {
  private readonly referenceFrameChangedHandle = createSignal<readonly []>();
  private readonly interfaceAddedHandle = createSignal<readonly [string]>();
  private readonly interfaceRemovedHandle = createSignal<readonly [string]>();
  private readonly trackerAddedHandle = createSignal<readonly [string, number]>();
  private readonly trackerUpdatedHandle = createSignal<readonly [string, number]>();
  private readonly trackerRemovedHandle = createSignal<readonly [string, number]>();
  private readonly worldOriginChangedHandle = createSignal<readonly []>();
  readonly reference_frame_changed = this.referenceFrameChangedHandle.signal;
  readonly interface_added = this.interfaceAddedHandle.signal;
  readonly interface_removed = this.interfaceRemovedHandle.signal;
  readonly tracker_added = this.trackerAddedHandle.signal;
  readonly tracker_updated = this.trackerUpdatedHandle.signal;
  readonly tracker_removed = this.trackerRemovedHandle.signal;
  readonly world_origin_changed = this.worldOriginChangedHandle.signal;
  private scale = 1;
  private origin = new Matrix4();
  private referenceFrame = new Matrix4();
  private cameraLocked = false;
  private readonly interfaces: GodotXRInterface[] = [];
  private readonly trackers = new Map<string, GodotXRTracker>();
  private primary: GodotXRInterface | null = null;

  constructor() { registerGodotObjectIdentity(this, 'XRServer'); }

  get_world_scale(): number { return this.scale; }
  set_world_scale(value: number): void {
    requireFinite(value, 'XRServer.world_scale');
    if (value <= 0) throw new RangeError('XRServer.world_scale must be positive.');
    this.scale = value;
  }
  get_world_origin(): Matrix4 { return this.origin.clone(); }
  set_world_origin(value: Matrix4): void {
    this.origin = cloneTransform(value, 'XRServer.world_origin');
    this.worldOriginChangedHandle.emit();
  }
  get_reference_frame(): Matrix4 { return this.referenceFrame.clone(); }
  clear_reference_frame(): void {
    this.referenceFrame.identity();
    this.referenceFrameChangedHandle.emit();
  }
  center_on_hmd(rotationMode: number, keepHeight: boolean): void {
    requireEnum(rotationMode, [0, 1, 2], 'XRServer.center_on_hmd rotation_mode');
    if (typeof keepHeight !== 'boolean') throw new TypeError('XRServer.center_on_hmd keep_height requires bool.');
    const hmd = this.get_hmd_transform();
    const position = new Vector3().setFromMatrixPosition(hmd);
    if (!keepHeight) position.y = 0;
    const inverse = hmd.clone().setPosition(0, 0, 0).invert();
    if (rotationMode === XR_ROTATION_DONT_RESET) inverse.identity();
    else if (rotationMode === XR_ROTATION_RESET_KEEP_TILT) {
      const forward = new Vector3(0, 0, -1).applyMatrix4(hmd).sub(new Vector3().setFromMatrixPosition(hmd));
      const yaw = Math.atan2(-forward.x, -forward.z);
      inverse.makeRotationY(-yaw);
    }
    inverse.setPosition(position.multiplyScalar(-1));
    this.referenceFrame = inverse;
    this.referenceFrameChangedHandle.emit();
  }
  get_hmd_transform(): Matrix4 {
    const pose = [...this.trackers.values()]
      .find((tracker) => (tracker.get_tracker_type() & XR_TRACKER_HEAD) !== 0);
    return pose instanceof GodotXRPositionalTracker
      ? (pose.get_pose('default')?.get_adjusted_transform() ?? new Matrix4())
      : new Matrix4();
  }
  set_camera_locked_to_origin(value: boolean): void {
    if (typeof value !== 'boolean') throw new TypeError('XRServer.camera_locked_to_origin requires bool.');
    this.cameraLocked = value;
  }
  is_camera_locked_to_origin(): boolean { return this.cameraLocked; }
  add_interface(value: GodotXRInterface): void {
    if (!(value instanceof GodotXRInterface)) throw new TypeError('XRServer.add_interface requires XRInterface.');
    if (this.interfaces.includes(value)) return;
    this.interfaces.push(value);
    this.interfaceAddedHandle.emit(value.get_name());
  }
  get_interface_count(): number { return this.interfaces.length; }
  remove_interface(value: GodotXRInterface): void {
    const index = this.interfaces.indexOf(value);
    if (index < 0) return;
    this.interfaces.splice(index, 1);
    if (this.primary === value) this.set_primary_interface(null);
    this.interfaceRemovedHandle.emit(value.get_name());
  }
  get_interface(index: number): GodotXRInterface | null {
    if (!Number.isInteger(index)) throw new TypeError('XRServer.get_interface index requires int.');
    return this.interfaces[index] ?? null;
  }
  get_interfaces(): Record<string, unknown>[] {
    return this.interfaces.map((entry, id) => ({ id, name: entry.get_name() }));
  }
  find_interface(name: string): GodotXRInterface | null {
    const key = requireString(name, 'XRServer.find_interface').toLowerCase();
    return this.interfaces.find((entry) => entry.get_name().toLowerCase() === key) ?? null;
  }
  add_tracker(value: GodotXRTracker): void {
    if (!(value instanceof GodotXRTracker)) throw new TypeError('XRServer.add_tracker requires XRTracker.');
    const name = value.get_tracker_name();
    const previous = this.trackers.get(name);
    this.trackers.set(name, value);
    (previous === undefined ? this.trackerAddedHandle : this.trackerUpdatedHandle)
      .emit(name, value.get_tracker_type());
  }
  remove_tracker(value: GodotXRTracker): void {
    if (!(value instanceof GodotXRTracker)) throw new TypeError('XRServer.remove_tracker requires XRTracker.');
    const name = value.get_tracker_name();
    if (this.trackers.get(name) !== value) return;
    this.trackers.delete(name);
    this.trackerRemovedHandle.emit(name, value.get_tracker_type());
  }
  get_trackers(typeMask: number): Record<string, GodotXRTracker> {
    if (!Number.isInteger(typeMask) || typeMask < 0 || typeMask > 255) {
      throw new RangeError('XRServer.get_trackers requires an 8-bit TrackerType mask.');
    }
    return Object.fromEntries([...this.trackers].filter(([, tracker]) =>
      (tracker.get_tracker_type() & typeMask) !== 0));
  }
  get_tracker(name: string): GodotXRTracker | null {
    return this.trackers.get(requireString(name, 'XRServer.get_tracker')) ?? null;
  }
  get_primary_interface(): GodotXRInterface | null { return this.primary; }
  set_primary_interface(value: GodotXRInterface | null): void {
    if (value !== null && !(value instanceof GodotXRInterface)) {
      throw new TypeError('XRServer.primary_interface requires XRInterface or null.');
    }
    if (value !== null && !this.interfaces.includes(value)) this.add_interface(value);
    if (this.primary === value) return;
    if (this.primary !== null) this.primary.primary = false;
    this.primary = value;
    if (value !== null) value.primary = true;
  }
  adjust_transform(value: Matrix4): Matrix4 {
    const adjusted = this.origin.clone().multiply(this.referenceFrame).multiply(value);
    const position = new Vector3().setFromMatrixPosition(adjusted).multiplyScalar(this.scale);
    return adjusted.setPosition(position);
  }
}

export const XRServer = new GodotXRServer();

interface GodotXRNodeState {
  tracker: string;
  pose: string;
  showWhenTracked: boolean;
  active: boolean;
  trackerObject: GodotXRPositionalTracker | null;
}
const xrNodes = new WeakMap<Object3D, GodotXRNodeState>();

function nodeState(node: Object3D): GodotXRNodeState {
  let state = xrNodes.get(node);
  if (state === undefined) {
    state = { tracker: '', pose: 'default', showWhenTracked: true, active: false, trackerObject: null };
    xrNodes.set(node, state);
  }
  return state;
}

export function bindGodotXRNode3D(node: Object3D, tracker = '', pose = 'default'): void {
  const state = nodeState(node);
  state.tracker = requireString(tracker, 'XRNode3D.tracker');
  state.pose = requireString(pose, 'XRNode3D.pose');
  updateGodotXRNode3D(node);
}
export function setGodotXRNodeTracker(node: Object3D, value: string): void {
  nodeState(node).tracker = requireString(value, 'XRNode3D.tracker');
  updateGodotXRNode3D(node);
}
export function getGodotXRNodeTracker(node: Object3D): string { return nodeState(node).tracker; }
export function setGodotXRNodePoseName(node: Object3D, value: string): void {
  nodeState(node).pose = requireString(value, 'XRNode3D.pose');
  updateGodotXRNode3D(node);
}
export function getGodotXRNodePoseName(node: Object3D): string { return nodeState(node).pose; }
export function setGodotXRNodeShowWhenTracked(node: Object3D, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError('XRNode3D.show_when_tracked requires bool.');
  nodeState(node).showWhenTracked = value;
  updateGodotXRNode3D(node);
}
export function getGodotXRNodeShowWhenTracked(node: Object3D): boolean {
  return nodeState(node).showWhenTracked;
}
export function getGodotXRNodeIsActive(node: Object3D): boolean { return nodeState(node).active; }
export function getGodotXRNodeHasTrackingData(node: Object3D): boolean {
  const state = nodeState(node);
  return state.trackerObject?.get_pose(state.pose)?.get_has_tracking_data() ?? false;
}
export function getGodotXRNodePose(node: Object3D): GodotXRPose | null {
  const state = nodeState(node);
  return state.trackerObject?.get_pose(state.pose) ?? null;
}
export function updateGodotXRNode3D(node: Object3D): void {
  const state = nodeState(node);
  const tracker = XRServer.get_tracker(state.tracker);
  state.trackerObject = tracker instanceof GodotXRPositionalTracker ? tracker : null;
  const pose = state.trackerObject?.get_pose(state.pose) ?? null;
  state.active = pose?.get_has_tracking_data() ?? false;
  if (state.active && pose !== null) {
    node.matrix.copy(pose.get_adjusted_transform());
    node.matrix.decompose(node.position, node.quaternion, node.scale);
    node.matrixWorldNeedsUpdate = true;
  }
  if (state.showWhenTracked) node.visible = state.active;
}

export function setGodotXROriginWorldScale(origin: Object3D, value: number): void {
  requireFinite(value, 'XROrigin3D.world_scale');
  if (value <= 0) throw new RangeError('XROrigin3D.world_scale must be positive.');
  origin.scale.setScalar(value);
}
export function getGodotXROriginWorldScale(origin: Object3D): number { return origin.scale.x; }
export function makeGodotXROriginCurrent(origin: Object3D, current: boolean): void {
  if (typeof current !== 'boolean') throw new TypeError('XROrigin3D.current requires bool.');
  if (current) XRServer.set_world_origin(origin.matrixWorld);
  else XRServer.set_world_origin(new Matrix4());
}
export function isGodotXROriginCurrent(origin: Object3D): boolean {
  origin.updateWorldMatrix(true, false);
  return XRServer.get_world_origin().equals(origin.matrixWorld);
}

export function godotXRControllerButtonPressed(node: Object3D, name: string): boolean {
  return getGodotXRNodePose(node) !== null &&
    nodeState(node).trackerObject?.get_input(name) === true;
}
export function godotXRControllerGetInput(node: Object3D, name: string): GodotXRInputValue | null {
  return nodeState(node).trackerObject?.get_input(name) ?? null;
}
export function godotXRControllerGetFloat(node: Object3D, name: string): number {
  const value = godotXRControllerGetInput(node, name);
  return typeof value === 'number' ? value : 0;
}
export function godotXRControllerGetVector2(node: Object3D, name: string): Vector2 {
  const value = godotXRControllerGetInput(node, name);
  return typeof value === 'object' && value !== null ? { x: value.x, y: value.y } : { x: 0, y: 0 };
}
export function godotXRControllerGetTrackerHand(node: Object3D): number {
  return nodeState(node).trackerObject?.get_tracker_hand() ?? XR_TRACKER_HAND_UNKNOWN;
}
