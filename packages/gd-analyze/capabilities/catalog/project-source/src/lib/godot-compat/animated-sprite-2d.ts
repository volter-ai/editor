/**
 * @godot-class AnimatedSprite2D
 * @role BINDING
 *
 * Godot 4.7's `AnimatedSprite2D` (`scene/2d/animated_sprite_2d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a Node2D drawing the current frame of an animation of
 * its SpriteFrames (its texture, or an AtlasTexture's region of its atlas), centred unless not
 * `centered`, moved by `offset`, flipped by `flip_h`/`flip_v`. Playing, its internal processing
 * advances the frame (the SpriteFrames playback, `sprite-frames.ts`).
 */

import type { ReactElement } from 'react';
import { Group, type Object3D, type Texture } from 'three';
import { godot_atlas_texture_region } from './atlas-texture';
import { godot_canvas_item_self_filter } from './canvas-item';
import { godot_node_2d_mount, godot_node_2d_props } from './node-2d';
import { godot_node_adopt, godot_node_entity, godot_node_set_internal_process, ready } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import type { GodotSignal } from './signal';
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
import { construct as vector2, type Vector2 } from './vector2';

const CLASSES = ['AnimatedSprite2D', 'Node2D', 'CanvasItem', 'Node', 'Object'];

interface Animated2DState {
  readonly player: GodotSpriteFramesPlayer;
  centered: boolean;
  offset: Vector2;
  flipH: boolean;
  flipV: boolean;
}

const ANIMATED = new WeakMap<object, Animated2DState>();

function stateOf(self: object, member: string): Animated2DState {
  const state = ANIMATED.get(godot_node_entity(self));
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not an AnimatedSprite2D`);
  return state;
}

function imageSource(texture: Texture): string {
  const image = texture.image as { readonly src?: string; readonly toDataURL?: () => string } | null | undefined;
  if (image === null || image === undefined) return '';
  if (typeof image.src === 'string') return image.src;
  return typeof image.toDataURL === 'function' ? image.toDataURL() : '';
}

const CONTENTS = new WeakMap<Object3D, HTMLElement>();

/** What `draw` reads: the frame's texture and region, its placement and the tint. */
function drawKey(entity: Object3D, element: HTMLElement): string {
  const state = ANIMATED.get(entity) as Animated2DState;
  const texture = godot_sprite_frames_texture(state.player);
  const region = texture === null ? null : godot_atlas_texture_region(texture);
  return JSON.stringify([
    region === null ? '' : imageSource(region.texture).slice(0, 64),
    region === null ? 0 : [region.x, region.y, region.width, region.height],
    state.player.animation,
    state.player.frame,
    state.centered,
    state.offset,
    state.flipH,
    state.flipV,
    godot_canvas_item_self_filter(entity, element),
  ]);
}

/** `NOTIFICATION_DRAW` (`animated_sprite_2d.cpp:233`): the frame at its rect. */
function draw(entity: Object3D, element: HTMLElement): void {
  const state = ANIMATED.get(entity) as Animated2DState;
  let content = CONTENTS.get(entity);
  if (content === undefined) {
    content = element.ownerDocument.createElement('div');
    content.setAttribute('data-godot-content', '');
    content.style.position = 'absolute';
    CONTENTS.set(entity, content);
  }
  if (content.parentElement !== element) element.insertBefore(content, element.firstChild);
  const texture = godot_sprite_frames_texture(state.player);
  const region = texture === null ? null : godot_atlas_texture_region(texture);
  const source = region === null ? '' : imageSource(region.texture);
  if (region === null || source === '') {
    content.style.display = 'none';
    return;
  }
  const x = state.offset.x - (state.centered ? region.width / 2 : 0);
  const y = state.offset.y - (state.centered ? region.height / 2 : 0);
  content.style.display = '';
  content.style.left = `${String(x)}px`;
  content.style.top = `${String(y)}px`;
  content.style.width = `${String(region.width)}px`;
  content.style.height = `${String(region.height)}px`;
  content.style.transform = state.flipH || state.flipV ? `scale(${state.flipH ? '-1' : '1'}, ${state.flipV ? '-1' : '1'})` : '';
  content.style.backgroundImage = `url("${source}")`;
  content.style.backgroundRepeat = 'no-repeat';
  const image = region.texture.image as { readonly width?: number; readonly height?: number } | null | undefined;
  content.style.backgroundSize = `${String(image?.width ?? region.width)}px ${String(image?.height ?? region.height)}px`;
  content.style.backgroundPosition = `${String(-region.x)}px ${String(-region.y)}px`;
  content.style.filter = godot_canvas_item_self_filter(entity, element);
}

/**
 * Makes `entity` an AnimatedSprite2D (`AnimatedSprite2D::AnimatedSprite2D`, `animated_sprite_2d.cpp:620`);
 * `autoplay` plays when it is ready.
 *
 * @godot AnimatedSprite2D (protocol)
 * @source scene/2d/animated_sprite_2d.cpp:620
 */
export function godot_animated_sprite_2d_mount(entity: Object3D): void {
  const player: GodotSpriteFramesPlayer = godot_sprite_frames_player(
    () => undefined,
    (on) => godot_node_set_internal_process(entity, on ? (delta) => godot_sprite_frames_advance(player, delta) : undefined),
  );
  ANIMATED.set(entity, { player, centered: true, offset: vector2(), flipH: false, flipV: false });
  godot_node_2d_mount(entity, CLASSES, { draw, drawKey });
  ready(entity).connect(() => {
    if (player.frames !== null && has_animation(player.frames, player.autoplay)) play(entity, player.autoplay);
  });
}

/**
 * A new AnimatedSprite2D (`AnimatedSprite2D.new()`).
 *
 * @godot AnimatedSprite2D.AnimatedSprite2D
 * @source scene/2d/animated_sprite_2d.cpp:620
 */
export function construct(): Group {
  const entity = new Group();
  godot_node_adopt(entity, { kind: 'node', classes: CLASSES });
  godot_animated_sprite_2d_mount(entity);
  return entity;
}

/**
 * @godot AnimatedSprite2D.set_sprite_frames
 * @source scene/2d/animated_sprite_2d.cpp:305
 */
export function set_sprite_frames(self: object, frames: SpriteFrames | null): void {
  godot_sprite_frames_set_frames(stateOf(self, 'set_sprite_frames').player, frames);
}

/**
 * @godot AnimatedSprite2D.get_sprite_frames
 * @source scene/2d/animated_sprite_2d.cpp:337
 */
export function get_sprite_frames(self: object): SpriteFrames | null {
  return stateOf(self, 'get_sprite_frames').player.frames;
}

/**
 * @godot AnimatedSprite2D.set_frame
 * @source scene/2d/animated_sprite_2d.cpp:341
 */
export function set_frame(self: object, frame: number): void {
  const player = stateOf(self, 'set_frame').player;
  godot_sprite_frames_set_frame_and_progress(player, frame, godot_sprite_frames_playing_speed(player) < 0 ? 1 : 0);
}

/**
 * @godot AnimatedSprite2D.get_frame
 * @source scene/2d/animated_sprite_2d.cpp:345
 */
export function get_frame(self: object): number {
  return stateOf(self, 'get_frame').player.frame;
}

/**
 * @godot AnimatedSprite2D.set_frame_progress
 * @source scene/2d/animated_sprite_2d.cpp:349
 */
export function set_frame_progress(self: object, progress: number): void {
  stateOf(self, 'set_frame_progress').player.frameProgress = progress;
}

/**
 * @godot AnimatedSprite2D.get_frame_progress
 * @source scene/2d/animated_sprite_2d.cpp:353
 */
export function get_frame_progress(self: object): number {
  return stateOf(self, 'get_frame_progress').player.frameProgress;
}

/**
 * @godot AnimatedSprite2D.set_frame_and_progress
 * @source scene/2d/animated_sprite_2d.cpp:357
 */
export function set_frame_and_progress(self: object, frame: number, progress: number): void {
  godot_sprite_frames_set_frame_and_progress(stateOf(self, 'set_frame_and_progress').player, frame, progress);
}

/**
 * @godot AnimatedSprite2D.set_speed_scale
 * @source scene/2d/animated_sprite_2d.cpp:399
 */
export function set_speed_scale(self: object, speed_scale: number): void {
  stateOf(self, 'set_speed_scale').player.speedScale = speed_scale;
}

/**
 * @godot AnimatedSprite2D.get_speed_scale
 * @source scene/2d/animated_sprite_2d.cpp:403
 */
export function get_speed_scale(self: object): number {
  return stateOf(self, 'get_speed_scale').player.speedScale;
}

/**
 * @godot AnimatedSprite2D.get_playing_speed
 * @source scene/2d/animated_sprite_2d.cpp:407
 */
export function get_playing_speed(self: object): number {
  return godot_sprite_frames_playing_speed(stateOf(self, 'get_playing_speed').player);
}

/**
 * @godot AnimatedSprite2D.set_centered
 * @source scene/2d/animated_sprite_2d.cpp:414
 */
export function set_centered(self: object, center: boolean): void {
  stateOf(self, 'set_centered').centered = center;
}

/**
 * @godot AnimatedSprite2D.is_centered
 * @source scene/2d/animated_sprite_2d.cpp:426
 */
export function is_centered(self: object): boolean {
  return stateOf(self, 'is_centered').centered;
}

/**
 * @godot AnimatedSprite2D.set_offset
 * @source scene/2d/animated_sprite_2d.cpp:430
 */
export function set_offset(self: object, offset: Vector2): void {
  stateOf(self, 'set_offset').offset = offset;
}

/**
 * @godot AnimatedSprite2D.get_offset
 * @source scene/2d/animated_sprite_2d.cpp:442
 */
export function get_offset(self: object): Vector2 {
  return stateOf(self, 'get_offset').offset;
}

/**
 * @godot AnimatedSprite2D.set_flip_h
 * @source scene/2d/animated_sprite_2d.cpp:446
 */
export function set_flip_h(self: object, flip: boolean): void {
  stateOf(self, 'set_flip_h').flipH = flip;
}

/**
 * @godot AnimatedSprite2D.is_flipped_h
 * @source scene/2d/animated_sprite_2d.cpp:455
 */
export function is_flipped_h(self: object): boolean {
  return stateOf(self, 'is_flipped_h').flipH;
}

/**
 * @godot AnimatedSprite2D.set_flip_v
 * @source scene/2d/animated_sprite_2d.cpp:459
 */
export function set_flip_v(self: object, flip: boolean): void {
  stateOf(self, 'set_flip_v').flipV = flip;
}

/**
 * @godot AnimatedSprite2D.is_flipped_v
 * @source scene/2d/animated_sprite_2d.cpp:468
 */
export function is_flipped_v(self: object): boolean {
  return stateOf(self, 'is_flipped_v').flipV;
}

/**
 * @godot AnimatedSprite2D.is_playing
 * @source scene/2d/animated_sprite_2d.cpp:472
 */
export function is_playing(self: object): boolean {
  return stateOf(self, 'is_playing').player.playing;
}

/**
 * @godot AnimatedSprite2D.set_autoplay
 * @source scene/2d/animated_sprite_2d.cpp:476
 */
export function set_autoplay(self: object, name: string): void {
  stateOf(self, 'set_autoplay').player.autoplay = name;
}

/**
 * @godot AnimatedSprite2D.get_autoplay
 * @source scene/2d/animated_sprite_2d.cpp:485
 */
export function get_autoplay(self: object): string {
  return stateOf(self, 'get_autoplay').player.autoplay;
}

/**
 * @godot AnimatedSprite2D.play
 * @source scene/2d/animated_sprite_2d.cpp:489
 */
export function play(self: object, name = '', custom_speed = 1, from_end = false): void {
  godot_sprite_frames_play(stateOf(self, 'play').player, name, custom_speed, from_end);
}

/**
 * @godot AnimatedSprite2D.play_backwards
 * @source scene/2d/animated_sprite_2d.cpp:530
 */
export function play_backwards(self: object, name = ''): void {
  play(self, name, -1, true);
}

/**
 * @godot AnimatedSprite2D.pause
 * @source scene/2d/animated_sprite_2d.cpp:548
 */
export function pause(self: object): void {
  godot_sprite_frames_stop(stateOf(self, 'pause').player, false);
}

/**
 * @godot AnimatedSprite2D.stop
 * @source scene/2d/animated_sprite_2d.cpp:552
 */
export function stop(self: object): void {
  godot_sprite_frames_stop(stateOf(self, 'stop').player, true);
}

/**
 * @godot AnimatedSprite2D.set_animation
 * @source scene/2d/animated_sprite_2d.cpp:563
 */
export function set_animation(self: object, name: string): void {
  godot_sprite_frames_set_animation(stateOf(self, 'set_animation').player, name);
}

/**
 * @godot AnimatedSprite2D.get_animation
 * @source scene/2d/animated_sprite_2d.cpp:596
 */
export function get_animation(self: object): string {
  return stateOf(self, 'get_animation').player.animation;
}

function signalOf(self: object, name: keyof GodotSpriteFramesPlayer['signals']): GodotSignal<[]> {
  return stateOf(self, name).player.signals[name].signal;
}

/**
 * @godot AnimatedSprite2D.animation_finished
 * @source scene/2d/animated_sprite_2d.cpp:612
 */
export function animation_finished(self: object): GodotSignal<[]> {
  return signalOf(self, 'animation_finished');
}

/**
 * @godot AnimatedSprite2D.animation_looped
 * @source scene/2d/animated_sprite_2d.cpp:611
 */
export function animation_looped(self: object): GodotSignal<[]> {
  return signalOf(self, 'animation_looped');
}

/**
 * @godot AnimatedSprite2D.animation_changed
 * @source scene/2d/animated_sprite_2d.cpp:609
 */
export function animation_changed(self: object): GodotSignal<[]> {
  return signalOf(self, 'animation_changed');
}

/**
 * @godot AnimatedSprite2D.frame_changed
 * @source scene/2d/animated_sprite_2d.cpp:610
 */
export function frame_changed(self: object): GodotSignal<[]> {
  return signalOf(self, 'frame_changed');
}

/**
 * @godot AnimatedSprite2D.sprite_frames_changed
 * @source scene/2d/animated_sprite_2d.cpp:608
 */
export function sprite_frames_changed(self: object): GodotSignal<[]> {
  return signalOf(self, 'sprite_frames_changed');
}

const ANIMATED_SPRITE_2D = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: false,
  mount: godot_animated_sprite_2d_mount,
  advances: true,
  props: new Map<string, GodotElementProp<Object3D>>([
    ...godot_node_2d_props(),
    ['spriteFrames', (entity, value: SpriteFrames | null) => set_sprite_frames(entity, value)],
    ['animation', (entity, value: string) => set_animation(entity, value)],
    ['autoplay', (entity, value: string) => set_autoplay(entity, value)],
    ['frame', (entity, value: number) => set_frame(entity, value)],
    ['frameProgress', (entity, value: number) => set_frame_progress(entity, value)],
    ['speedScale', (entity, value: number) => set_speed_scale(entity, value)],
    ['centered', (entity, value: boolean) => set_centered(entity, value)],
    ['offset', (entity, value: readonly [number, number]) => set_offset(entity, vector2(...value))],
    ['flipH', (entity, value: boolean) => set_flip_h(entity, value)],
    ['flipV', (entity, value: boolean) => set_flip_v(entity, value)],
  ]),
};

/**
 * An AnimatedSprite2D as a scene writes it: `<GodotAnimatedSprite2D spriteFrames={f} animation="walk" />`.
 *
 * @godot AnimatedSprite2D (protocol)
 * @source scene/2d/animated_sprite_2d.cpp:620
 */
export function GodotAnimatedSprite2D(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(ANIMATED_SPRITE_2D, props);
}
