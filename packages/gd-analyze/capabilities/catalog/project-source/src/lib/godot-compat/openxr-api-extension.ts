/** Godot OpenXRAPIExtension over an exact project-owned OpenXR runtime carrier. */

import { Matrix4 } from 'three';
import { registerGodotObjectIdentity } from './object';
import { packedInt64Array, type PackedInt64Array } from './packed-array';

export interface GodotOpenXRVector2i { readonly x: number; readonly y: number }
export interface GodotOpenXRRect2i {
  readonly position: GodotOpenXRVector2i;
  readonly size: GodotOpenXRVector2i;
}

export type GodotOpenXRRID = unknown;
export type GodotOpenXRExtensionWrapperLike = object;

export interface GodotOpenXRAPIExtensionCarrier {
  getOpenXRVersion(): number;
  getInstance(): number;
  getSystemId(): number;
  getSession(): number;
  transformFromPose(pose: unknown): Matrix4;
  formatResult(result: number, format: string, args: readonly unknown[]): boolean;
  isEnabled(checkRunInEditor: boolean): boolean;
  getInstanceProcAddr(name: string): number;
  getErrorString(result: number): string;
  getSwapchainFormatName(format: number): string;
  setObjectName(objectType: number, objectHandle: number, objectName: string): void;
  beginDebugLabelRegion(labelName: string): void;
  endDebugLabelRegion(): void;
  insertDebugLabel(labelName: string): void;
  getViewCount(): number;
  getViewConfiguration(): number;
  isInitialized(): boolean;
  isRunning(): boolean;
  setCustomPlaySpace(space: unknown): void;
  getPlaySpace(): number;
  getPredictedDisplayTime(): number;
  getNextFrameTime(): number;
  canRender(): boolean;
  findAction(name: string, actionSet: GodotOpenXRRID): GodotOpenXRRID;
  actionGetHandle(action: GodotOpenXRRID): number;
  getHandTracker(handIndex: number): number;
  registerCompositionLayerProvider(extension: GodotOpenXRExtensionWrapperLike): void;
  unregisterCompositionLayerProvider(extension: GodotOpenXRExtensionWrapperLike): void;
  registerProjectionViewsExtension(extension: GodotOpenXRExtensionWrapperLike): void;
  unregisterProjectionViewsExtension(extension: GodotOpenXRExtensionWrapperLike): void;
  registerFrameInfoExtension(extension: GodotOpenXRExtensionWrapperLike): void;
  unregisterFrameInfoExtension(extension: GodotOpenXRExtensionWrapperLike): void;
  registerProjectionLayerExtension(extension: GodotOpenXRExtensionWrapperLike): void;
  unregisterProjectionLayerExtension(extension: GodotOpenXRExtensionWrapperLike): void;
  getRenderStateZNear(): number;
  getRenderStateZFar(): number;
  setVelocityTexture(renderTarget: GodotOpenXRRID): void;
  setVelocityDepthTexture(renderTarget: GodotOpenXRRID): void;
  setVelocityTargetSize(targetSize: GodotOpenXRVector2i): void;
  getSupportedSwapchainFormats(): Iterable<number>;
  createSwapchain(
    createFlags: number,
    usageFlags: number,
    swapchainFormat: number,
    width: number,
    height: number,
    sampleCount: number,
    arraySize: number,
  ): number;
  freeSwapchain(swapchain: number): void;
  getSwapchain(swapchain: number): number;
  acquireSwapchain(swapchain: number): void;
  getSwapchainImage(swapchain: number): GodotOpenXRRID;
  releaseSwapchain(swapchain: number): void;
  getProjectionLayer(): number;
  setRenderRegion(renderRegion: GodotOpenXRRect2i): void;
  setEmulateEnvironmentBlendModeAlphaBlend(enabled: boolean): void;
  getEnvironmentBlendModeAlphaSupport(): number;
  updateMainSwapchainSize(): void;
}

function integer(value: number, member: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`OpenXRAPIExtension.${member} requires an integer >= ${minimum}.`);
  }
  return value;
}

function finite(value: number, member: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`OpenXRAPIExtension.${member} requires finite float.`);
  return value;
}

function text(value: string, member: string, empty = true): string {
  if (typeof value !== 'string' || (!empty && value.length === 0)) {
    throw new TypeError(`OpenXRAPIExtension.${member} requires ${empty ? '' : 'non-empty '}String.`);
  }
  return value;
}

function vector2i(value: GodotOpenXRVector2i, member: string, positive = false): GodotOpenXRVector2i {
  const minimum = positive ? 1 : 0;
  return Object.freeze({
    x: integer(value.x, `${member}.x`, minimum),
    y: integer(value.y, `${member}.y`, minimum),
  });
}

function rect2i(value: GodotOpenXRRect2i): GodotOpenXRRect2i {
  return Object.freeze({
    position: Object.freeze({
      x: Math.trunc(value.position.x),
      y: Math.trunc(value.position.y),
    }),
    size: vector2i(value.size, 'render_region.size'),
  });
}

export class GodotOpenXRAPIExtension {
  private readonly activeSwapchains = new Set<number>();
  private readonly acquiredSwapchains = new Set<number>();
  private readonly debugLabelRegions: string[] = [];
  private readonly compositionLayerProviders = new Set<object>();
  private readonly projectionViewsExtensions = new Set<object>();
  private readonly frameInfoExtensions = new Set<object>();
  private readonly projectionLayerExtensions = new Set<object>();

  constructor(private readonly carrier: GodotOpenXRAPIExtensionCarrier) {
    registerGodotObjectIdentity(this, 'OpenXRAPIExtension');
  }

  get_openxr_version(): number { return integer(this.carrier.getOpenXRVersion(), 'openxr_version'); }
  get_instance(): number { return integer(this.carrier.getInstance(), 'instance'); }
  get_system_id(): number { return integer(this.carrier.getSystemId(), 'system_id'); }
  get_session(): number { return integer(this.carrier.getSession(), 'session'); }

  transform_from_pose(pose: unknown): Matrix4 {
    const transform = this.carrier.transformFromPose(pose);
    if (!(transform instanceof Matrix4)) throw new TypeError('OpenXR pose carrier must return Transform3D.');
    return transform.clone();
  }

  xr_result(result: number, format: string, args: readonly unknown[] = []): boolean {
    if (!Array.isArray(args)) throw new TypeError('OpenXRAPIExtension.xr_result args require Array.');
    return Boolean(this.carrier.formatResult(Math.trunc(result), text(format, 'xr_result format'), args.slice()));
  }

  openxr_is_enabled(checkRunInEditor = true): boolean {
    return Boolean(this.carrier.isEnabled(Boolean(checkRunInEditor)));
  }
  get_instance_proc_addr(name: string): number {
    return integer(this.carrier.getInstanceProcAddr(text(name, 'instance_proc_addr', false)), 'instance_proc_addr');
  }
  get_error_string(result: number): string { return String(this.carrier.getErrorString(Math.trunc(result))); }
  get_swapchain_format_name(format: number): string {
    return String(this.carrier.getSwapchainFormatName(Math.trunc(format)));
  }
  set_object_name(objectType: number, objectHandle: number, objectName: string): void {
    this.carrier.setObjectName(
      integer(objectType, 'object_type'),
      integer(objectHandle, 'object_handle'),
      text(objectName, 'object_name'),
    );
  }

  begin_debug_label_region(labelName: string): void {
    const label = text(labelName, 'debug_label', false);
    this.debugLabelRegions.push(label);
    this.carrier.beginDebugLabelRegion(label);
  }
  end_debug_label_region(): void {
    if (this.debugLabelRegions.length === 0) throw new Error('OpenXR debug label region stack is empty.');
    this.debugLabelRegions.pop();
    this.carrier.endDebugLabelRegion();
  }
  insert_debug_label(labelName: string): void {
    this.carrier.insertDebugLabel(text(labelName, 'debug_label', false));
  }
  get_debug_label_regions(): readonly string[] { return this.debugLabelRegions.slice(); }

  get_view_count(): number { return integer(this.carrier.getViewCount(), 'view_count'); }
  get_view_configuration(): number { return integer(this.carrier.getViewConfiguration(), 'view_configuration'); }
  is_initialized(): boolean { return Boolean(this.carrier.isInitialized()); }
  is_running(): boolean { return Boolean(this.carrier.isRunning()); }
  set_custom_play_space(space: unknown): void { this.carrier.setCustomPlaySpace(space); }
  get_play_space(): number { return integer(this.carrier.getPlaySpace(), 'play_space'); }
  get_predicted_display_time(): number { return integer(this.carrier.getPredictedDisplayTime(), 'predicted_display_time'); }
  get_next_frame_time(): number { return integer(this.carrier.getNextFrameTime(), 'next_frame_time'); }
  can_render(): boolean { return Boolean(this.carrier.canRender()); }

  find_action(name: string, actionSet: GodotOpenXRRID): GodotOpenXRRID {
    return this.carrier.findAction(text(name, 'find_action name', false), actionSet);
  }
  action_get_handle(action: GodotOpenXRRID): number {
    return integer(this.carrier.actionGetHandle(action), 'action_handle');
  }
  get_hand_tracker(handIndex: number): number {
    return integer(this.carrier.getHandTracker(integer(handIndex, 'hand_index')), 'hand_tracker');
  }

  register_composition_layer_provider(extension: object): void {
    this.registerExtension(this.compositionLayerProviders, extension, 'composition_layer_provider');
    this.carrier.registerCompositionLayerProvider(extension);
  }
  unregister_composition_layer_provider(extension: object): void {
    this.unregisterExtension(this.compositionLayerProviders, extension, 'composition_layer_provider');
    this.carrier.unregisterCompositionLayerProvider(extension);
  }
  register_projection_views_extension(extension: object): void {
    this.registerExtension(this.projectionViewsExtensions, extension, 'projection_views_extension');
    this.carrier.registerProjectionViewsExtension(extension);
  }
  unregister_projection_views_extension(extension: object): void {
    this.unregisterExtension(this.projectionViewsExtensions, extension, 'projection_views_extension');
    this.carrier.unregisterProjectionViewsExtension(extension);
  }
  register_frame_info_extension(extension: object): void {
    this.registerExtension(this.frameInfoExtensions, extension, 'frame_info_extension');
    this.carrier.registerFrameInfoExtension(extension);
  }
  unregister_frame_info_extension(extension: object): void {
    this.unregisterExtension(this.frameInfoExtensions, extension, 'frame_info_extension');
    this.carrier.unregisterFrameInfoExtension(extension);
  }
  register_projection_layer_extension(extension: object): void {
    this.registerExtension(this.projectionLayerExtensions, extension, 'projection_layer_extension');
    this.carrier.registerProjectionLayerExtension(extension);
  }
  unregister_projection_layer_extension(extension: object): void {
    this.unregisterExtension(this.projectionLayerExtensions, extension, 'projection_layer_extension');
    this.carrier.unregisterProjectionLayerExtension(extension);
  }

  get_render_state_z_near(): number { return finite(this.carrier.getRenderStateZNear(), 'render_state_z_near'); }
  get_render_state_z_far(): number { return finite(this.carrier.getRenderStateZFar(), 'render_state_z_far'); }
  set_velocity_texture(renderTarget: GodotOpenXRRID): void { this.carrier.setVelocityTexture(renderTarget); }
  set_velocity_depth_texture(renderTarget: GodotOpenXRRID): void { this.carrier.setVelocityDepthTexture(renderTarget); }
  set_velocity_target_size(targetSize: GodotOpenXRVector2i): void {
    this.carrier.setVelocityTargetSize(vector2i(targetSize, 'velocity_target_size', true));
  }
  get_supported_swapchain_formats(): PackedInt64Array {
    return packedInt64Array(this.carrier.getSupportedSwapchainFormats());
  }

  openxr_swapchain_create(
    createFlags: number,
    usageFlags: number,
    swapchainFormat: number,
    width: number,
    height: number,
    sampleCount: number,
    arraySize: number,
  ): number {
    const handle = integer(this.carrier.createSwapchain(
      integer(createFlags, 'swapchain create_flags'),
      integer(usageFlags, 'swapchain usage_flags'),
      Math.trunc(swapchainFormat),
      integer(width, 'swapchain width', 1),
      integer(height, 'swapchain height', 1),
      integer(sampleCount, 'swapchain sample_count', 1),
      integer(arraySize, 'swapchain array_size', 1),
    ), 'swapchain handle', 1);
    this.activeSwapchains.add(handle);
    return handle;
  }

  openxr_swapchain_free(swapchain: number): void {
    const handle = this.requireSwapchain(swapchain);
    if (this.acquiredSwapchains.has(handle)) this.openxr_swapchain_release(handle);
    this.carrier.freeSwapchain(handle);
    this.activeSwapchains.delete(handle);
  }
  openxr_swapchain_get_swapchain(swapchain: number): number {
    return integer(this.carrier.getSwapchain(this.requireSwapchain(swapchain)), 'native_swapchain');
  }
  openxr_swapchain_acquire(swapchain: number): void {
    const handle = this.requireSwapchain(swapchain);
    if (this.acquiredSwapchains.has(handle)) throw new Error('OpenXR swapchain is already acquired.');
    this.carrier.acquireSwapchain(handle);
    this.acquiredSwapchains.add(handle);
  }
  openxr_swapchain_get_image(swapchain: number): GodotOpenXRRID {
    const handle = this.requireSwapchain(swapchain);
    if (!this.acquiredSwapchains.has(handle)) throw new Error('OpenXR swapchain image requires acquire first.');
    return this.carrier.getSwapchainImage(handle);
  }
  openxr_swapchain_release(swapchain: number): void {
    const handle = this.requireSwapchain(swapchain);
    if (!this.acquiredSwapchains.has(handle)) return;
    this.carrier.releaseSwapchain(handle);
    this.acquiredSwapchains.delete(handle);
  }

  get_projection_layer(): number { return integer(this.carrier.getProjectionLayer(), 'projection_layer'); }
  set_render_region(renderRegion: GodotOpenXRRect2i): void { this.carrier.setRenderRegion(rect2i(renderRegion)); }
  set_emulate_environment_blend_mode_alpha_blend(enabled: boolean): void {
    this.carrier.setEmulateEnvironmentBlendModeAlphaBlend(Boolean(enabled));
  }
  is_environment_blend_mode_alpha_supported(): number {
    const support = Math.trunc(this.carrier.getEnvironmentBlendModeAlphaSupport());
    return support >= 0 && support <= 2 ? support : 0;
  }
  update_main_swapchain_size(): void { this.carrier.updateMainSwapchainSize(); }

  private registerExtension(collection: Set<object>, extension: object, member: string): void {
    if ((typeof extension !== 'object' && typeof extension !== 'function') || extension === null) {
      throw new TypeError(`OpenXRAPIExtension.${member} requires OpenXRExtensionWrapper.`);
    }
    collection.add(extension);
  }
  private unregisterExtension(collection: Set<object>, extension: object, member: string): void {
    if (!collection.delete(extension)) throw new Error(`OpenXRAPIExtension ${member} is not registered.`);
  }
  private requireSwapchain(swapchain: number): number {
    const handle = integer(swapchain, 'swapchain', 1);
    if (!this.activeSwapchains.has(handle)) throw new Error(`OpenXR swapchain ${handle} is not active.`);
    return handle;
  }
}

export function createGodotOpenXRAPIExtension(
  carrier: GodotOpenXRAPIExtensionCarrier,
): GodotOpenXRAPIExtension {
  return new GodotOpenXRAPIExtension(carrier);
}
