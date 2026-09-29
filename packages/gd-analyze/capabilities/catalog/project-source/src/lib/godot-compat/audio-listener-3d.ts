/**
 * @godot-class AudioListener3D
 * @role BINDING
 *
 * Godot 4.7's `AudioListener3D` (`scene/3d/audio_listener_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): the place 3D sound is heard from in place of the
 * camera, while it is the viewport's current listener (`AudioStreamPlayer3D::_update_panning`,
 * `audio_stream_player_3d.cpp:400`). A listener entering the tree is made current when it was set
 * current, or when it is the first; one leaving stops being current and remembers it was. The
 * page's one viewport holds the one current listener. Doppler tracking is not bound.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D } from 'three';
import { godot_node_adopt, godot_node_entity, godot_node_tree_signal, is_inside_tree } from './node';
import { get_global_transform } from './node-3d';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import type { Transform3D } from './transform-3d';

const CLASSES = ['AudioListener3D', 'Node3D', 'Node', 'Object'];

/** Whether each listener was made current (`current`), in or out of the tree. */
const CURRENT = new WeakMap<object, boolean>();
/** The listeners in the tree, in the order they entered (`Viewport::_audio_listener_3d_add`). */
const LISTENERS = new Set<object>();
let active: object | null = null;

/**
 * The viewport's current listener, which 3D sound is heard from, or null for its camera.
 *
 * @godot AudioListener3D (protocol)
 * @source scene/3d/audio_stream_player_3d.cpp:400
 */
export function godot_audio_listener_3d_current(): Object3D | null {
  return active as Object3D | null;
}

/**
 * @godot AudioListener3D (protocol)
 * @source scene/3d/audio_listener_3d.cpp:80
 */
export function godot_audio_listener_3d_mount(entity: Object3D): void {
  godot_node_tree_signal(entity, 'tree_entered').connect(() => {
    const first = LISTENERS.size === 0;
    LISTENERS.add(entity);
    if (CURRENT.get(entity) === true || first) make_current(entity);
  });
  godot_node_tree_signal(entity, 'tree_exiting').connect(() => {
    if (active === entity) {
      clear_current(entity);
      CURRENT.set(entity, true);
    } else {
      CURRENT.set(entity, false);
    }
    LISTENERS.delete(entity);
  });
}

/**
 * @godot AudioListener3D.AudioListener3D
 * @source scene/3d/audio_listener_3d.cpp:187
 */
export function construct(): Group {
  const entity = new Group();
  godot_node_adopt(entity, { kind: 'spatial', classes: CLASSES });
  godot_audio_listener_3d_mount(entity);
  return entity;
}

/**
 * @godot AudioListener3D.make_current
 * @source scene/3d/audio_listener_3d.cpp:116
 */
export function make_current(self: object): void {
  const entity = godot_node_entity(self);
  CURRENT.set(entity, true);
  if (is_inside_tree(entity)) active = entity;
}

/**
 * @godot AudioListener3D.clear_current
 * @source scene/3d/audio_listener_3d.cpp:126
 */
export function clear_current(self: object): void {
  const entity = godot_node_entity(self);
  CURRENT.set(entity, false);
  if (active === entity) active = null;
}

/**
 * @godot AudioListener3D.is_current
 * @source scene/3d/audio_listener_3d.cpp:138
 */
export function is_current(self: object): boolean {
  return active === godot_node_entity(self);
}

/**
 * `current` as a scene sets it (`AudioListener3D::_set`): made current, or not.
 *
 * @godot AudioListener3D._set_current
 * @source scene/3d/audio_listener_3d.cpp:42
 */
export function _set_current(self: object, current: boolean): void {
  if (current) make_current(self);
  else clear_current(self);
}

/**
 * @godot AudioListener3D.get_listener_transform
 * @source scene/3d/audio_listener_3d.cpp:112
 */
export function get_listener_transform(self: object): Transform3D {
  return get_global_transform(godot_node_entity(self));
}

const AUDIO_LISTENER_3D = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: true,
  mount: godot_audio_listener_3d_mount,
  props: new Map<string, GodotElementProp<Object3D>>([['current', (entity, value: boolean) => _set_current(entity, value)]]),
};

/**
 * A listener as a scene writes it: `<GodotAudioListener3D current />`.
 *
 * @godot AudioListener3D (protocol)
 * @source scene/3d/audio_listener_3d.cpp:80
 */
export function GodotAudioListener3D(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(AUDIO_LISTENER_3D, props);
}
