/**
 * @godot-class AnimatedSprite3D
 * @role BINDING
 *
 * Godot 4.7's `AnimatedSprite3D` (`scene/3d/sprite_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a SpriteBase3D drawing the current frame of an
 * animation of its SpriteFrames. Playing, its internal processing advances the frame by the
 * animation's speed, the frame's duration and the speed scales (`NOTIFICATION_INTERNAL_PROCESS`),
 * emitting `frame_changed`, and at the end `animation_looped` or `animation_finished`.
 */

import type { ReactElement } from 'react';
import { Mesh } from 'three';
import { godot_node_adopt, godot_node_entity, godot_node_set_internal_process, ready } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import type { GodotSignal } from './signal';
import { godot_sprite_base_3d_mount, godot_sprite_base_3d_props, godot_sprite_base_3d_redraw } from './sprite-base-3d';
import {
  type GodotSpriteFramesPlayer,
  godot_sprite_frames_advance,
  godot_sprite_frames_play,
  godot_sprite_frames_player,
  godot_sprite_frames_playing_speed,
  godot_sprite_frames_set_animation,
  godot_sprite_frames_set_frame_and_progress,
  godot_sprite_frames_set_frames,
  godot_sprite_frames_stop,
  godot_sprite_frames_texture,
  has_animation,
  type SpriteFrames,
} from './sprite-frames';

const ANIMATED = new WeakMap<object, GodotSpriteFramesPlayer>();

function stateOf(self: object, member: string): GodotSpriteFramesPlayer {
  const state = ANIMATED.get(godot_node_entity(self));
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not an AnimatedSprite3D`);
  return state;
}

/**
 * Makes `entity` an AnimatedSprite3D; `autoplay` plays when it is ready (`sprite_3d.cpp:1108`).
 *
 * @godot AnimatedSprite3D (protocol)
 * @source scene/3d/sprite_3d.cpp:1108
 */
export function godot_animated_sprite_3d_mount(entity: Mesh): void {
  const player: GodotSpriteFramesPlayer = godot_sprite_frames_player(
    () => godot_sprite_base_3d_redraw(entity),
    (on) => godot_node_set_internal_process(entity, on ? (delta) => godot_sprite_frames_advance(player, delta) : undefined),
  );
  ANIMATED.set(entity, player);
  godot_sprite_base_3d_mount(entity, () => godot_sprite_frames_texture(player));
  ready(entity).connect(() => {
    if (player.frames !== null && has_animation(player.frames, player.autoplay)) play(entity, player.autoplay);
  });
}

/**
 * A new AnimatedSprite3D (`AnimatedSprite3D.new()`).
 *
 * @godot AnimatedSprite3D.AnimatedSprite3D
 * @source scene/3d/sprite_3d.cpp:1590
 */
export function construct(): Mesh {
  const entity = new Mesh();
  godot_node_adopt(entity, { kind: 'spatial', classes: ['AnimatedSprite3D', 'SpriteBase3D', 'GeometryInstance3D', 'VisualInstance3D', 'Node3D', 'Node', 'Object'] });
  godot_animated_sprite_3d_mount(entity);
  return entity;
}

/**
 * @godot AnimatedSprite3D.set_sprite_frames
 * @source scene/3d/sprite_3d.cpp:1195
 */
export function set_sprite_frames(self: object, frames: SpriteFrames | null): void {
  godot_sprite_frames_set_frames(stateOf(self, 'set_sprite_frames'), frames);
}

/**
 * @godot AnimatedSprite3D.get_sprite_frames
 * @source scene/3d/sprite_3d.cpp:1228
 */
export function get_sprite_frames(self: object): SpriteFrames | null {
  return stateOf(self, 'get_sprite_frames').frames;
}

/**
 * The frame, its progress at the start (or, playing backwards, the end).
 *
 * @godot AnimatedSprite3D.set_frame
 * @source scene/3d/sprite_3d.cpp:1232
 */
export function set_frame(self: object, frame: number): void {
  const state = stateOf(self, 'set_frame');
  godot_sprite_frames_set_frame_and_progress(state, frame, godot_sprite_frames_playing_speed(state) < 0 ? 1 : 0);
}

/**
 * @godot AnimatedSprite3D.get_frame
 * @source scene/3d/sprite_3d.cpp:1236
 */
export function get_frame(self: object): number {
  return stateOf(self, 'get_frame').frame;
}

/**
 * @godot AnimatedSprite3D.set_frame_progress
 * @source scene/3d/sprite_3d.cpp:1240
 */
export function set_frame_progress(self: object, progress: number): void {
  stateOf(self, 'set_frame_progress').frameProgress = progress;
}

/**
 * @godot AnimatedSprite3D.get_frame_progress
 * @source scene/3d/sprite_3d.cpp:1244
 */
export function get_frame_progress(self: object): number {
  return stateOf(self, 'get_frame_progress').frameProgress;
}

/**
 * @godot AnimatedSprite3D.set_frame_and_progress
 * @source scene/3d/sprite_3d.cpp:1248
 */
export function set_frame_and_progress(self: object, frame: number, progress: number): void {
  godot_sprite_frames_set_frame_and_progress(stateOf(self, 'set_frame_and_progress'), frame, progress);
}

/**
 * @godot AnimatedSprite3D.set_speed_scale
 * @source scene/3d/sprite_3d.cpp:1291
 */
export function set_speed_scale(self: object, speed_scale: number): void {
  stateOf(self, 'set_speed_scale').speedScale = speed_scale;
}

/**
 * @godot AnimatedSprite3D.get_speed_scale
 * @source scene/3d/sprite_3d.cpp:1295
 */
export function get_speed_scale(self: object): number {
  return stateOf(self, 'get_speed_scale').speedScale;
}

/**
 * @godot AnimatedSprite3D.get_playing_speed
 * @source scene/3d/sprite_3d.cpp:1299
 */
export function get_playing_speed(self: object): number {
  return godot_sprite_frames_playing_speed(stateOf(self, 'get_playing_speed'));
}

/**
 * @godot AnimatedSprite3D.is_playing
 * @source scene/3d/sprite_3d.cpp:1364
 */
export function is_playing(self: object): boolean {
  return stateOf(self, 'is_playing').playing;
}

/**
 * @godot AnimatedSprite3D.set_autoplay
 * @source scene/3d/sprite_3d.cpp:1368
 */
export function set_autoplay(self: object, name: string): void {
  stateOf(self, 'set_autoplay').autoplay = name;
}

/**
 * @godot AnimatedSprite3D.get_autoplay
 * @source scene/3d/sprite_3d.cpp:1377
 */
export function get_autoplay(self: object): string {
  return stateOf(self, 'get_autoplay').autoplay;
}

/**
 * Plays `name` (the current animation when empty) from its start, or from its end with
 * `from_end`; the one already playing goes on unless it ended.
 *
 * @godot AnimatedSprite3D.play
 * @source scene/3d/sprite_3d.cpp:1381
 */
export function play(self: object, name = '', custom_speed = 1, from_end = false): void {
  godot_sprite_frames_play(stateOf(self, 'play'), name, custom_speed, from_end);
}

/**
 * @godot AnimatedSprite3D.play_backwards
 * @source scene/3d/sprite_3d.cpp:1422
 */
export function play_backwards(self: object, name = ''): void {
  play(self, name, -1, true);
}

/**
 * @godot AnimatedSprite3D.pause
 * @source scene/3d/sprite_3d.cpp:1476
 */
export function pause(self: object): void {
  godot_sprite_frames_stop(stateOf(self, 'pause'), false);
}

/**
 * @godot AnimatedSprite3D.stop
 * @source scene/3d/sprite_3d.cpp:1480
 */
export function stop(self: object): void {
  godot_sprite_frames_stop(stateOf(self, 'stop'), true);
}

/**
 * @godot AnimatedSprite3D.set_animation
 * @source scene/3d/sprite_3d.cpp:1488
 */
export function set_animation(self: object, name: string): void {
  godot_sprite_frames_set_animation(stateOf(self, 'set_animation'), name);
}

/**
 * @godot AnimatedSprite3D.get_animation
 * @source scene/3d/sprite_3d.cpp:1521
 */
export function get_animation(self: object): string {
  return stateOf(self, 'get_animation').animation;
}

function signalOf(name: keyof GodotSpriteFramesPlayer['signals']) {
  return (self: object): GodotSignal<[]> => stateOf(self, name).signals[name].signal;
}

/**
 * @godot AnimatedSprite3D.animation_finished
 * @source scene/3d/sprite_3d.cpp:1573
 */
export function animation_finished(self: object): GodotSignal<[]> {
  return signalOf('animation_finished')(self);
}

/**
 * @godot AnimatedSprite3D.animation_looped
 * @source scene/3d/sprite_3d.cpp:1572
 */
export function animation_looped(self: object): GodotSignal<[]> {
  return signalOf('animation_looped')(self);
}

/**
 * @godot AnimatedSprite3D.animation_changed
 * @source scene/3d/sprite_3d.cpp:1570
 */
export function animation_changed(self: object): GodotSignal<[]> {
  return signalOf('animation_changed')(self);
}

/**
 * @godot AnimatedSprite3D.frame_changed
 * @source scene/3d/sprite_3d.cpp:1571
 */
export function frame_changed(self: object): GodotSignal<[]> {
  return signalOf('frame_changed')(self);
}

/**
 * @godot AnimatedSprite3D.sprite_frames_changed
 * @source scene/3d/sprite_3d.cpp:1569
 */
export function sprite_frames_changed(self: object): GodotSignal<[]> {
  return signalOf('sprite_frames_changed')(self);
}

const ANIMATED_SPRITE_3D = {
  create: () => new Mesh(),
  classes: ['AnimatedSprite3D', 'SpriteBase3D', 'GeometryInstance3D', 'VisualInstance3D', 'Node3D', 'Node', 'Object'],
  spatial: true,
  mount: godot_animated_sprite_3d_mount,
  advances: true,
  props: new Map<string, GodotElementProp<Mesh>>([
    ...godot_sprite_base_3d_props(),
    ['spriteFrames', (entity, value: SpriteFrames | null) => set_sprite_frames(entity, value)],
    ['animation', (entity, value: string) => set_animation(entity, value)],
    ['autoplay', (entity, value: string) => set_autoplay(entity, value)],
    ['frame', (entity, value: number) => set_frame(entity, value)],
    ['frameProgress', (entity, value: number) => set_frame_progress(entity, value)],
    ['speedScale', (entity, value: number) => set_speed_scale(entity, value)],
  ]),
};

/**
 * An AnimatedSprite3D as a scene writes it: `<GodotAnimatedSprite3D spriteFrames={f} animation="shot" />`.
 *
 * @godot AnimatedSprite3D (protocol)
 * @source scene/3d/sprite_3d.cpp:1540
 */
export function GodotAnimatedSprite3D(props: GodotElementProps<Mesh>): ReactElement {
  return useGodotElement(ANIMATED_SPRITE_3D, props);
}
