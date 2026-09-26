/** Finite native Node presentation dispatch for a statically open/base Node receiver. */

import { Container } from 'pixi.js';
import { Object3D } from 'three';

import { getName, hide, isVisible, setName, setVisible, show } from './node';
import { getName3D, setName3D } from './node-3d';
import {
  godotObjectIsClass,
  godotOpenNodeCollisionAreaCall,
  godotOpenNodeContextCall,
  godotOpenNodeNativeSignal,
  godotOpenNodePhysicsCall,
  godotOpenNodeRigidBodyStateCall,
  godotOpenNodeRigidBodyForceCall,
  godotOpenNodeProcessCall,
  godotOpenNodePresentationCall,
  godotOpenNodeAnimationPlaybackCall,
  godotOpenNodeTimerCall,
  godotOpenNodeTimerGet,
  godotOpenNodeTimerSet,
  godotOpenNodeMediaPlaybackCall,
  godotOpenNodeCameraCall,
  godotOpenNodeCameraGet,
  godotOpenNodeCameraSet,
  godotOpenNodePresentationGet,
  godotOpenNodePresentationSet,
  godotOpenNodeUiCall,
} from './object';
import { getOpenNodeTreeExitedSignal } from './scene-tree';
import type { GodotSignal } from './signal';

function requireNode(receiver: unknown, major: 3 | 4, member: string): void {
  if (!godotObjectIsClass(receiver, 'Node', major)) {
    throw new TypeError(
      `godot-compat: open Node.${member} requires a retained native Node identity.`,
    );
  }
}

type ConcretePresentationProperty =
  | 'environment'
  | 'transform'
  | 'rotation'
  | 'translation'
  | 'color'
  | 'text'
  | 'texture'
  | 'shape'
  | 'disabled'
  | 'editable'
  | 'placeholder_text'
  | 'button_pressed'
  | 'pressed'
  | 'selected'
  | 'current_tab'
  | 'item_count'
  | 'collision_layer'
  | 'collision_mask'
  | 'input_pickable'
  | 'monitoring'
  | 'monitorable'
  | 'value'
  | 'min_value'
  | 'max_value'
  | 'playing'
  | 'stream'
  | 'volume_db'
  | 'pitch_scale'
  | 'animation'
  | 'autoplay'
  | 'speed_scale'
  | 'current_animation'
  | 'linear_velocity'
  | 'angular_velocity'
  | 'gravity_scale'
  | 'velocity'
  | 'mass'
  | 'sleeping'
  | 'lock_rotation'
  | 'freeze'
  | 'linear_damp'
  | 'angular_damp';
type ConcretePresentationMethod = 'play' | 'start';
type AnimationPlaybackMethod =
  | 'stop'
  | 'pause'
  | 'seek'
  | 'is_playing'
  | 'play_backwards'
  | 'queue'
  | 'clear_queue'
  | 'advance'
  | 'set_speed_scale'
  | 'get_speed_scale'
  | 'set_current_animation'
  | 'get_current_animation'
  | 'get_current_animation_length'
  | 'get_current_animation_position'
  | 'get_playing_speed';
type TimerProperty = 'wait_time' | 'one_shot' | 'time_left';
type TimerMethod =
  | 'is_stopped'
  | 'get_time_left'
  | 'set_wait_time'
  | 'get_wait_time'
  | 'set_one_shot'
  | 'is_one_shot';
type MediaPlaybackMethod =
  | 'get_playback_position'
  | 'set_volume_db'
  | 'get_volume_db'
  | 'set_pitch_scale'
  | 'get_pitch_scale'
  | 'set_stream_paused'
  | 'get_stream_paused'
  | 'set_bus'
  | 'get_bus';
type CameraProperty =
  | 'current' | 'enabled' | 'fov' | 'near' | 'far' | 'projection' | 'zoom' | 'offset'
  | 'size' | 'keep_aspect' | 'cull_mask' | 'frustum_offset'
  | 'anchor_mode' | 'ignore_rotation' | 'position_smoothing_enabled' | 'smoothing_enabled'
  | 'position_smoothing_speed' | 'limit_left' | 'limit_right' | 'limit_top' | 'limit_bottom'
  | 'limit_smoothed' | 'drag_horizontal_enabled' | 'drag_vertical_enabled'
  | 'drag_left_margin' | 'drag_right_margin' | 'drag_top_margin' | 'drag_bottom_margin';
type CameraMethod =
  | 'make_current'
  | 'clear_current'
  | 'is_current'
  | 'project_ray_origin'
  | 'project_ray_normal'
  | 'unproject_position'
  | 'project_position'
  | 'align'
  | 'force_update_scroll'
  | 'reset_smoothing'
  | 'get_camera_screen_center'
  | 'get_screen_center_position'
  | 'get_target_position'
  | 'get_anchor_mode' | 'set_anchor_mode' | 'get_drag_margin' | 'set_drag_margin'
  | 'get_limit' | 'set_limit'
  | 'set_ignore_rotation' | 'is_ignoring_rotation'
  | 'set_position_smoothing_enabled' | 'is_position_smoothing_enabled'
  | 'set_position_smoothing_speed' | 'get_position_smoothing_speed'
  | 'is_position_behind' | 'is_position_in_frustum'
  | 'get_cull_mask' | 'set_cull_mask' | 'get_cull_mask_value' | 'set_cull_mask_value'
  | 'get_far' | 'set_far' | 'get_near' | 'set_near' | 'get_size' | 'set_size'
  | 'set_current';
type NodePhysicsMethod =
  | 'move_and_slide'
  | 'move_and_collide'
  | 'is_on_floor'
  | 'is_on_wall'
  | 'is_on_ceiling'
  | 'apply_central_impulse'
  | 'apply_impulse'
  | 'get_slide_count'
  | 'get_slide_collision'
  | 'get_last_slide_collision'
  | 'get_floor_normal'
  | 'get_wall_normal'
  | 'get_last_motion'
  | 'get_position_delta'
  | 'get_real_velocity';
type NodeRigidBodyStateMethod =
  | 'set_mass'
  | 'get_mass'
  | 'set_sleeping'
  | 'is_sleeping'
  | 'set_freeze_enabled'
  | 'is_freeze_enabled'
  | 'set_linear_damp'
  | 'get_linear_damp'
  | 'set_angular_damp'
  | 'get_angular_damp';
type NodeRigidBodyForceMethod =
  | 'add_central_force'
  | 'add_force'
  | 'add_torque'
  | 'apply_central_force'
  | 'apply_force'
  | 'apply_torque'
  | 'add_constant_central_force'
  | 'add_constant_force'
  | 'add_constant_torque'
  | 'set_constant_force'
  | 'get_constant_force'
  | 'set_constant_torque'
  | 'get_constant_torque';
type NodeProcessMethod =
  | 'set_process'
  | 'set_physics_process'
  | 'is_processing'
  | 'is_physics_processing';
type ControlFocusMethod = 'grab_focus' | 'release_focus' | 'has_focus';
type NodeContextMethod = 'get_tree' | 'get_viewport' | 'get_world_2d' | 'get_world_3d';
type NodeUiMethod =
  | 'accept_event'
  | 'get_combined_minimum_size'
  | 'get_minimum_size'
  | 'minimum_size_changed'
  | 'update_minimum_size'
  | 'reset_size'
  | 'update'
  | 'queue_redraw';
type CollisionAreaMethod =
  | 'get_collision_layer'
  | 'set_collision_layer'
  | 'get_collision_mask'
  | 'set_collision_mask'
  | 'is_monitoring'
  | 'set_monitoring'
  | 'is_monitorable'
  | 'set_monitorable'
  | 'get_collision_layer_bit'
  | 'set_collision_layer_bit'
  | 'get_collision_mask_bit'
  | 'set_collision_mask_bit'
  | 'get_collision_layer_value'
  | 'set_collision_layer_value'
  | 'get_collision_mask_value'
  | 'set_collision_mask_value'
  | 'set_pickable'
  | 'is_pickable';
type NativeNodeSignal =
  | 'body_entered'
  | 'body_exited'
  | 'area_entered'
  | 'area_exited'
  | 'input_event'
  | 'mouse_entered'
  | 'mouse_exited'
  | 'pressed'
  | 'toggled'
  | 'value_changed'
  | 'text_changed'
  | 'item_selected'
  | 'animation_finished'
  | 'focus_entered'
  | 'focus_exited'
  | 'gui_input'
  | 'button_down'
  | 'button_up'
  | 'changed'
  | 'scrolling'
  | 'text_entered'
  | 'caret_changed'
  | 'item_clicked'
  | 'text_submitted'
  | 'tab_changed'
  | 'canceled'
  | 'timeout';

/** Generated ClassDB property row on the actual retained runtime subclass. */
export function godotVariantNodePresentationGet(
  receiver: unknown,
  major: 3 | 4,
  property: ConcretePresentationProperty,
): unknown {
  requireNode(receiver, major, property);
  if ((property === 'button_pressed' && major !== 4) || (property === 'pressed' && major !== 3)) {
    throw new Error(`godot-compat: ${property} is not a Godot ${major} BaseButton property.`);
  }
  if ((property === 'current_tab' || property === 'item_count') && major !== 4) {
    throw new Error(`godot-compat: ${property} has no retained Godot ${major} generated property row.`);
  }
  return godotOpenNodePresentationGet(receiver, major, property);
}

/** Generated ClassDB setter row; read-only and absent concrete rows refuse in object.ts. */
export function setGodotVariantNodePresentation(
  receiver: unknown,
  major: 3 | 4,
  property: ConcretePresentationProperty,
  value: unknown,
): void {
  requireNode(receiver, major, property);
  if ((property === 'button_pressed' && major !== 4) || (property === 'pressed' && major !== 3)) {
    throw new Error(`godot-compat: ${property} is not a Godot ${major} BaseButton property.`);
  }
  if ((property === 'current_tab' || property === 'item_count') && major !== 4) {
    throw new Error(`godot-compat: ${property} has no retained Godot ${major} generated property row.`);
  }
  godotOpenNodePresentationSet(receiver, major, property, value);
}

/** Exact generated ClassDB method row for the actual retained runtime subclass. */
export function godotVariantNodePresentationCall(
  receiver: unknown,
  major: 3 | 4,
  method: ConcretePresentationMethod,
  args: readonly unknown[],
): unknown {
  requireNode(receiver, major, method);
  return godotOpenNodePresentationCall(receiver, major, method, args);
}

/** Exact animation playback dispatch for the retained concrete Node subclass. */
export function godotVariantNodeAnimationPlaybackCall(
  receiver: unknown,
  major: 3 | 4,
  method: AnimationPlaybackMethod,
  args: readonly unknown[],
): unknown {
  requireNode(receiver, major, method);
  return godotOpenNodeAnimationPlaybackCall(receiver, major, method, args);
}

export function godotVariantNodeTimerGet(
  receiver: unknown,
  major: 3 | 4,
  property: TimerProperty,
): number | boolean {
  requireNode(receiver, major, property);
  return godotOpenNodeTimerGet(receiver, major, property);
}

export function setGodotVariantNodeTimer(
  receiver: unknown,
  major: 3 | 4,
  property: Exclude<TimerProperty, 'time_left'>,
  value: unknown,
): void {
  requireNode(receiver, major, property);
  godotOpenNodeTimerSet(receiver, major, property, value);
}

export function godotVariantNodeTimerCall(
  receiver: unknown,
  major: 3 | 4,
  method: TimerMethod,
  args: readonly unknown[],
): unknown {
  requireNode(receiver, major, method);
  return godotOpenNodeTimerCall(receiver, major, method, args);
}

export function godotVariantNodeMediaPlaybackCall(
  receiver: unknown,
  major: 3 | 4,
  method: MediaPlaybackMethod,
  args: readonly unknown[],
): unknown {
  requireNode(receiver, major, method);
  return godotOpenNodeMediaPlaybackCall(receiver, major, method, args);
}

export function godotVariantNodeCameraGet(
  receiver: unknown,
  major: 3 | 4,
  property: CameraProperty,
): unknown {
  requireNode(receiver, major, property);
  return godotOpenNodeCameraGet(receiver, major, property);
}

export function setGodotVariantNodeCamera(
  receiver: unknown,
  major: 3 | 4,
  property: CameraProperty,
  value: unknown,
): void {
  requireNode(receiver, major, property);
  godotOpenNodeCameraSet(receiver, major, property, value);
}

export function godotVariantNodeCameraCall(
  receiver: unknown,
  major: 3 | 4,
  method: CameraMethod,
  args: readonly unknown[],
): unknown {
  requireNode(receiver, major, method);
  return godotOpenNodeCameraCall(receiver, major, method, args);
}

/** Exact generated CollisionObject/Area row for an open/base Node receiver. */
export function godotVariantCollisionAreaCall(
  receiver: unknown,
  major: 3 | 4,
  method: CollisionAreaMethod,
  args: readonly unknown[],
): unknown {
  requireNode(receiver, major, method);
  return godotOpenNodeCollisionAreaCall(receiver, major, method, args);
}

/** Exact retained generated Signal row for an open/base Node receiver. */
export function godotVariantNodeNativeSignal(
  receiver: unknown,
  major: 3 | 4,
  signalName: NativeNodeSignal,
): GodotSignal<readonly unknown[]> {
  requireNode(receiver, major, signalName);
  return godotOpenNodeNativeSignal(receiver, major, signalName);
}

/** Generated concrete physics row on a retained native Node identity. */
export function godotVariantNodePhysicsCall(
  receiver: unknown,
  major: 3 | 4,
  method: NodePhysicsMethod,
  args: readonly unknown[],
): unknown {
  requireNode(receiver, major, method);
  return godotOpenNodePhysicsCall(receiver, major, method, args);
}

/** Exact generated rigid-body method row on a retained native Node identity. */
export function godotVariantNodeRigidBodyStateCall(
  receiver: unknown,
  major: 3 | 4,
  method: NodeRigidBodyStateMethod,
  args: readonly unknown[],
): unknown {
  requireNode(receiver, major, method);
  return godotOpenNodeRigidBodyStateCall(receiver, major, method, args);
}

/** Exact generated force/torque row on a retained native rigid-body identity. */
export function godotVariantNodeRigidBodyForceCall(
  receiver: unknown,
  major: 3 | 4,
  method: NodeRigidBodyForceMethod,
  args: readonly unknown[],
): unknown {
  requireNode(receiver, major, method);
  return godotOpenNodeRigidBodyForceCall(receiver, major, method, args);
}

/** Existing native SceneTree scheduler ownership through the concrete generated Node row. */
export function godotVariantNodeProcessCall(
  receiver: unknown,
  major: 3 | 4,
  method: NodeProcessMethod,
  args: readonly unknown[],
): unknown {
  requireNode(receiver, major, method);
  return godotOpenNodeProcessCall(receiver, major, method, args);
}

/** Exact Control focus dispatch for an open/base Node receiver with retained ClassDB identity. */
export function godotVariantControlFocusCall(
  receiver: unknown,
  major: 3 | 4,
  method: ControlFocusMethod,
  args: readonly unknown[],
): unknown {
  if (args.length !== 0) {
    throw new TypeError(`godot-compat: Control.${method} takes no arguments.`);
  }
  if (!godotObjectIsClass(receiver, 'Control', major)) {
    throw new TypeError(
      `godot-compat: open Control.${method} requires a retained native Control identity.`,
    );
  }
  const result = godotOpenNodePresentationCall(receiver, major, method, args);
  if (method === 'has_focus' && typeof result !== 'boolean') {
    throw new TypeError('godot-compat: Control.has_focus must return bool.');
  }
  return result;
}

/** Existing retained SceneTree/viewport/world identity through the concrete generated row. */
export function godotVariantNodeContextCall(
  receiver: unknown,
  major: 3 | 4,
  method: NodeContextMethod,
  args: readonly unknown[],
): unknown {
  requireNode(receiver, major, method);
  return godotOpenNodeContextCall(receiver, major, method, args);
}

/** Existing retained Control/CanvasItem ownership through the concrete generated runtime row. */
export function godotVariantNodeUiCall(
  receiver: unknown,
  major: 3 | 4,
  method: NodeUiMethod,
  args: readonly unknown[],
): unknown {
  requireNode(receiver, major, method);
  return godotOpenNodeUiCall(receiver, major, method, args);
}

export function godotVariantNodeName(receiver: unknown, major: 3 | 4): string {
  requireNode(receiver, major, 'name');
  if (receiver instanceof Object3D) return getName3D(receiver);
  if (receiver instanceof Container) return getName(receiver);
  const value = godotOpenNodePresentationGet(receiver, major, 'name');
  if (typeof value !== 'string') {
    throw new TypeError('godot-compat: native Node.name getter did not return String/StringName.');
  }
  return value;
}

export function setGodotVariantNodeName(
  receiver: unknown,
  major: 3 | 4,
  value: unknown,
): void {
  requireNode(receiver, major, 'name');
  if (typeof value !== 'string') throw new TypeError('godot-compat: Node.name requires String/StringName.');
  if (receiver instanceof Object3D) setName3D(receiver, value);
  else if (receiver instanceof Container) setName(receiver, value);
  else godotOpenNodePresentationSet(receiver, major, 'name', value);
}

export function godotVariantNodeVisible(receiver: unknown, major: 3 | 4): boolean {
  requireNode(receiver, major, 'visible');
  if (receiver instanceof Object3D || receiver instanceof Container) return isVisible(receiver);
  const value = godotOpenNodePresentationGet(receiver, major, 'visible');
  if (typeof value !== 'boolean') {
    throw new TypeError('godot-compat: open Node.visible requires a visual retained native carrier.');
  }
  return value;
}

export function setGodotVariantNodeVisible(
  receiver: unknown,
  major: 3 | 4,
  value: unknown,
): void {
  requireNode(receiver, major, 'visible');
  if (typeof value !== 'boolean') throw new TypeError('godot-compat: Node.visible requires bool.');
  if (receiver instanceof Object3D || receiver instanceof Container) setVisible(receiver, value);
  else godotOpenNodePresentationSet(receiver, major, 'visible', value);
}

export function godotVariantNodeHide(receiver: unknown, major: 3 | 4): void {
  requireNode(receiver, major, 'hide');
  if (receiver instanceof Object3D || receiver instanceof Container) hide(receiver);
  else void godotOpenNodePresentationCall(receiver, major, 'hide');
}

export function godotVariantNodeShow(receiver: unknown, major: 3 | 4): void {
  requireNode(receiver, major, 'show');
  if (receiver instanceof Object3D || receiver instanceof Container) show(receiver);
  else void godotOpenNodePresentationCall(receiver, major, 'show');
}

export function godotVariantNodeTreeExited(
  receiver: unknown,
  major: 3 | 4,
): GodotSignal<[]> {
  return getOpenNodeTreeExitedSignal(receiver, major);
}
