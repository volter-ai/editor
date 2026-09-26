/** Godot OpenXRExtensionWrapper hook surface and retained runtime lifecycle. */

import { registerGodotObjectIdentity } from './object';
import type { GodotOpenXRAPIExtension } from './openxr-api-extension';
import { packedStringArray, type PackedStringArray } from './packed-array';

export type GodotOpenXRDictionary = Readonly<Record<string, unknown>> | ReadonlyMap<unknown, unknown>;
export type GodotOpenXRRIDLike = unknown;

export interface GodotOpenXRExtensionWrapperHooks {
  _get_requested_extensions?(xrVersion: number): GodotOpenXRDictionary;
  _set_system_properties_and_get_next_pointer?(nextPointer: number): number;
  _set_instance_create_info_and_get_next_pointer?(xrVersion: number, nextPointer: number): number;
  _set_session_create_and_get_next_pointer?(nextPointer: number): number;
  _set_swapchain_create_info_and_get_next_pointer?(nextPointer: number): number;
  _set_hand_joint_locations_and_get_next_pointer?(handIndex: number, nextPointer: number): number;
  _set_projection_views_and_get_next_pointer?(viewIndex: number, nextPointer: number): number;
  _set_frame_wait_info_and_get_next_pointer?(nextPointer: number): number;
  _set_frame_end_info_and_get_next_pointer?(nextPointer: number): number;
  _set_projection_layer_and_get_next_pointer?(nextPointer: number): number;
  _set_view_locate_info_and_get_next_pointer?(nextPointer: number): number;
  _set_reference_space_create_info_and_get_next_pointer?(referenceSpaceType: number, nextPointer: number): number;
  _prepare_view_configuration?(viewCount: number): void;
  _set_view_configuration_and_get_next_pointer?(view: number, nextPointer: number): number;
  _print_view_configuration_info?(view: number): void;
  _get_composition_layer_count?(): number;
  _get_composition_layer?(index: number): number;
  _get_composition_layer_order?(index: number): number;
  _get_suggested_tracker_names?(): Iterable<string>;
  _on_register_metadata?(interactionProfileMetadata: object): void;
  _on_before_instance_created?(): void;
  _on_instance_created?(instance: number): void;
  _on_instance_destroyed?(): void;
  _on_session_created?(session: number): void;
  _on_process?(): void;
  _on_sync_actions?(): void;
  _on_pre_render?(): void;
  _on_main_swapchains_created?(): void;
  _on_pre_draw_viewport?(viewport: GodotOpenXRRIDLike): void;
  _on_post_draw_viewport?(viewport: GodotOpenXRRIDLike): void;
  _on_session_destroyed?(): void;
  _on_state_idle?(): void;
  _on_state_ready?(): void;
  _on_state_synchronized?(): void;
  _on_state_visible?(): void;
  _on_state_focused?(): void;
  _on_state_stopping?(): void;
  _on_state_loss_pending?(): void;
  _on_state_exiting?(): void;
  _on_event_polled?(event: unknown): boolean;
  _set_viewport_composition_layer_and_get_next_pointer?(
    layer: unknown,
    propertyValues: GodotOpenXRDictionary,
    nextPointer: number,
  ): number;
  _get_viewport_composition_layer_extension_properties?(): readonly GodotOpenXRDictionary[];
  _get_viewport_composition_layer_extension_property_defaults?(): GodotOpenXRDictionary;
  _on_viewport_composition_layer_destroyed?(layer: unknown): void;
  _set_android_surface_swapchain_create_info_and_get_next_pointer?(
    propertyValues: GodotOpenXRDictionary,
    nextPointer: number,
  ): number;
}

const registeredOpenXRExtensionWrappers = new Set<GodotOpenXRExtensionWrapper>();

function pointer(value: number, member: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`OpenXRExtensionWrapper.${member} requires a non-negative native pointer.`);
  }
  return value;
}

function index(value: number, member: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`OpenXRExtensionWrapper.${member} requires non-negative index.`);
  return value;
}

function dictionary(value: GodotOpenXRDictionary, member: string): GodotOpenXRDictionary {
  if (!(value instanceof Map) && (typeof value !== 'object' || value === null || Array.isArray(value))) {
    throw new TypeError(`OpenXRExtensionWrapper.${member} requires Dictionary.`);
  }
  return value;
}

export class GodotOpenXRExtensionWrapper {
  private registered = false;
  private instanceHandle = 0;
  private sessionHandle = 0;
  private sessionState = 'idle';

  constructor(
    private readonly hooks: GodotOpenXRExtensionWrapperHooks = {},
    private readonly openxrApi: GodotOpenXRAPIExtension | null = null,
    className = 'OpenXRExtensionWrapper',
  ) {
    registerGodotObjectIdentity(this, className);
  }

  _get_requested_extensions(xrVersion: number): GodotOpenXRDictionary {
    return this.hooks._get_requested_extensions?.(pointer(xrVersion, 'xr_version')) ?? {};
  }
  _set_system_properties_and_get_next_pointer(nextPointer: number): number {
    return this.next(this.hooks._set_system_properties_and_get_next_pointer, nextPointer);
  }
  _set_instance_create_info_and_get_next_pointer(xrVersion: number, nextPointer: number): number {
    return pointer(this.hooks._set_instance_create_info_and_get_next_pointer?.(
      pointer(xrVersion, 'xr_version'), pointer(nextPointer, 'next_pointer'),
    ) ?? nextPointer, 'instance_create_info pointer');
  }
  _set_session_create_and_get_next_pointer(nextPointer: number): number {
    return this.next(this.hooks._set_session_create_and_get_next_pointer, nextPointer);
  }
  _set_swapchain_create_info_and_get_next_pointer(nextPointer: number): number {
    return this.next(this.hooks._set_swapchain_create_info_and_get_next_pointer, nextPointer);
  }
  _set_hand_joint_locations_and_get_next_pointer(handIndex: number, nextPointer: number): number {
    return pointer(this.hooks._set_hand_joint_locations_and_get_next_pointer?.(
      index(handIndex, 'hand_index'), pointer(nextPointer, 'next_pointer'),
    ) ?? nextPointer, 'hand_joint_locations pointer');
  }
  _set_projection_views_and_get_next_pointer(viewIndex: number, nextPointer: number): number {
    return pointer(this.hooks._set_projection_views_and_get_next_pointer?.(
      index(viewIndex, 'view_index'), pointer(nextPointer, 'next_pointer'),
    ) ?? nextPointer, 'projection_views pointer');
  }
  _set_frame_wait_info_and_get_next_pointer(nextPointer: number): number {
    return this.next(this.hooks._set_frame_wait_info_and_get_next_pointer, nextPointer);
  }
  _set_frame_end_info_and_get_next_pointer(nextPointer: number): number {
    return this.next(this.hooks._set_frame_end_info_and_get_next_pointer, nextPointer);
  }
  _set_projection_layer_and_get_next_pointer(nextPointer: number): number {
    return this.next(this.hooks._set_projection_layer_and_get_next_pointer, nextPointer);
  }
  _set_view_locate_info_and_get_next_pointer(nextPointer: number): number {
    return this.next(this.hooks._set_view_locate_info_and_get_next_pointer, nextPointer);
  }
  _set_reference_space_create_info_and_get_next_pointer(referenceSpaceType: number, nextPointer: number): number {
    return pointer(this.hooks._set_reference_space_create_info_and_get_next_pointer?.(
      index(referenceSpaceType, 'reference_space_type'), pointer(nextPointer, 'next_pointer'),
    ) ?? nextPointer, 'reference_space_create pointer');
  }
  _prepare_view_configuration(viewCount: number): void {
    this.hooks._prepare_view_configuration?.(index(viewCount, 'view_count'));
  }
  _set_view_configuration_and_get_next_pointer(view: number, nextPointer: number): number {
    return pointer(this.hooks._set_view_configuration_and_get_next_pointer?.(
      index(view, 'view'), pointer(nextPointer, 'next_pointer'),
    ) ?? nextPointer, 'view_configuration pointer');
  }
  _print_view_configuration_info(view: number): void { this.hooks._print_view_configuration_info?.(index(view, 'view')); }

  _get_composition_layer_count(): number {
    return Math.max(0, Math.trunc(this.hooks._get_composition_layer_count?.() ?? 0));
  }
  _get_composition_layer(layerIndex: number): number {
    this.requireCompositionIndex(layerIndex);
    return pointer(this.hooks._get_composition_layer?.(layerIndex) ?? 0, 'composition_layer');
  }
  _get_composition_layer_order(layerIndex: number): number {
    this.requireCompositionIndex(layerIndex);
    return Math.trunc(this.hooks._get_composition_layer_order?.(layerIndex) ?? 0);
  }
  _get_suggested_tracker_names(): PackedStringArray {
    return packedStringArray(this.hooks._get_suggested_tracker_names?.() ?? []);
  }

  _on_register_metadata(metadata: object): void {
    if (typeof metadata !== 'object' || metadata === null) throw new TypeError('OpenXR metadata requires Object.');
    this.hooks._on_register_metadata?.(metadata);
  }
  _on_before_instance_created(): void { this.hooks._on_before_instance_created?.(); }
  _on_instance_created(instance: number): void {
    this.instanceHandle = pointer(instance, 'instance');
    this.hooks._on_instance_created?.(this.instanceHandle);
  }
  _on_instance_destroyed(): void {
    if (this.sessionHandle !== 0) this._on_session_destroyed();
    this.hooks._on_instance_destroyed?.();
    this.instanceHandle = 0;
  }
  _on_session_created(session: number): void {
    if (this.instanceHandle === 0) throw new Error('OpenXR session requires an active instance.');
    this.sessionHandle = pointer(session, 'session');
    this.hooks._on_session_created?.(this.sessionHandle);
  }
  _on_process(): void { this.hooks._on_process?.(); }
  _on_sync_actions(): void { this.hooks._on_sync_actions?.(); }
  _on_pre_render(): void { this.hooks._on_pre_render?.(); }
  _on_main_swapchains_created(): void { this.hooks._on_main_swapchains_created?.(); }
  _on_pre_draw_viewport(viewport: GodotOpenXRRIDLike): void { this.hooks._on_pre_draw_viewport?.(viewport); }
  _on_post_draw_viewport(viewport: GodotOpenXRRIDLike): void { this.hooks._on_post_draw_viewport?.(viewport); }
  _on_session_destroyed(): void {
    this.hooks._on_session_destroyed?.();
    this.sessionHandle = 0;
    this.sessionState = 'idle';
  }

  _on_state_idle(): void { this.transition('idle', this.hooks._on_state_idle); }
  _on_state_ready(): void { this.transition('ready', this.hooks._on_state_ready); }
  _on_state_synchronized(): void { this.transition('synchronized', this.hooks._on_state_synchronized); }
  _on_state_visible(): void { this.transition('visible', this.hooks._on_state_visible); }
  _on_state_focused(): void { this.transition('focused', this.hooks._on_state_focused); }
  _on_state_stopping(): void { this.transition('stopping', this.hooks._on_state_stopping); }
  _on_state_loss_pending(): void { this.transition('loss_pending', this.hooks._on_state_loss_pending); }
  _on_state_exiting(): void { this.transition('exiting', this.hooks._on_state_exiting); }
  _on_event_polled(event: unknown): boolean { return Boolean(this.hooks._on_event_polled?.(event) ?? false); }

  _set_viewport_composition_layer_and_get_next_pointer(
    layer: unknown,
    propertyValues: GodotOpenXRDictionary,
    nextPointer: number,
  ): number {
    return pointer(this.hooks._set_viewport_composition_layer_and_get_next_pointer?.(
      layer, dictionary(propertyValues, 'composition layer properties'), pointer(nextPointer, 'next_pointer'),
    ) ?? nextPointer, 'viewport composition layer pointer');
  }
  _get_viewport_composition_layer_extension_properties(): readonly GodotOpenXRDictionary[] {
    return (this.hooks._get_viewport_composition_layer_extension_properties?.() ?? []).map(
      (value) => dictionary(value, 'extension property'),
    );
  }
  _get_viewport_composition_layer_extension_property_defaults(): GodotOpenXRDictionary {
    return dictionary(this.hooks._get_viewport_composition_layer_extension_property_defaults?.() ?? {}, 'property defaults');
  }
  _on_viewport_composition_layer_destroyed(layer: unknown): void {
    this.hooks._on_viewport_composition_layer_destroyed?.(layer);
  }
  _set_android_surface_swapchain_create_info_and_get_next_pointer(
    propertyValues: GodotOpenXRDictionary,
    nextPointer: number,
  ): number {
    return pointer(this.hooks._set_android_surface_swapchain_create_info_and_get_next_pointer?.(
      dictionary(propertyValues, 'Android surface properties'), pointer(nextPointer, 'next_pointer'),
    ) ?? nextPointer, 'Android surface pointer');
  }

  get_openxr_api(): GodotOpenXRAPIExtension | null { return this.openxrApi; }
  register_extension_wrapper(): void {
    if (this.registered) return;
    registeredOpenXRExtensionWrappers.add(this);
    this.registered = true;
  }
  unregister_extension_wrapper(): void {
    registeredOpenXRExtensionWrappers.delete(this);
    this.registered = false;
  }
  is_extension_wrapper_registered(): boolean { return this.registered; }
  get_instance_handle(): number { return this.instanceHandle; }
  get_session_handle(): number { return this.sessionHandle; }
  get_session_state(): string { return this.sessionState; }

  private next(hook: ((nextPointer: number) => number) | undefined, nextPointer: number): number {
    const next = pointer(nextPointer, 'next_pointer');
    return pointer(hook?.(next) ?? next, 'next_pointer result');
  }
  private requireCompositionIndex(layerIndex: number): void {
    if (!Number.isSafeInteger(layerIndex) || layerIndex < 0 || layerIndex >= this._get_composition_layer_count()) {
      throw new RangeError('OpenXR composition layer index is invalid.');
    }
  }
  private transition(state: string, hook: (() => void) | undefined): void {
    if (this.sessionHandle === 0 && state !== 'idle') throw new Error(`OpenXR state ${state} requires an active session.`);
    this.sessionState = state;
    hook?.();
  }
}

export class GodotOpenXRExtensionWrapperExtension extends GodotOpenXRExtensionWrapper {
  constructor(hooks: GodotOpenXRExtensionWrapperHooks = {}, openxrApi: GodotOpenXRAPIExtension | null = null) {
    super(hooks, openxrApi, 'OpenXRExtensionWrapperExtension');
  }
}

export function createGodotOpenXRExtensionWrapper(
  hooks: GodotOpenXRExtensionWrapperHooks = {},
  openxrApi: GodotOpenXRAPIExtension | null = null,
): GodotOpenXRExtensionWrapper {
  return new GodotOpenXRExtensionWrapper(hooks, openxrApi);
}
export function createGodotOpenXRExtensionWrapperExtension(
  hooks: GodotOpenXRExtensionWrapperHooks = {},
  openxrApi: GodotOpenXRAPIExtension | null = null,
): GodotOpenXRExtensionWrapperExtension {
  return new GodotOpenXRExtensionWrapperExtension(hooks, openxrApi);
}
export function getGodotOpenXRExtensionWrappers(): readonly GodotOpenXRExtensionWrapper[] {
  return [...registeredOpenXRExtensionWrappers];
}
