/**
 * @godot-class AnimationPlayer
 * @role PROTOCOL
 *
 * An AnimationPlayer among Controls (docs/GODOT.md "UI is React DOM"): a hidden element whose
 * animations are Web Animations of the Controls it animates, each value track keyframes of a CSS
 * property of the element at its path from the player's root node, which the plan computed
 * (`scene-control-idioms.ts`). Playing an animation runs them with `element.animate`, for the
 * animation's length, looping as it loops; the page's animation clock times them.
 */

import { get_node_or_null, godot_node_entity } from './node';

/** The animations a player among Controls plays, as the plan wrote them. */
export interface GodotAnimationElements {
  readonly root: string;
  readonly autoplay?: string;
  readonly animations: readonly {
    readonly name: string;
    readonly length: number;
    readonly loop: number;
    readonly tracks: readonly { readonly path: string; readonly keyframes: readonly Keyframe[] }[];
  }[];
}

interface Playing {
  readonly data: GodotAnimationElements;
  current: string;
  speed: number;
  running: Animation[];
}

const PLAYERS = new WeakMap<object, Playing>();

/** The element at a node path from `from`, as the Node protocol finds it (`get_node_or_null`). */
function elementAt(from: HTMLElement, path: string): HTMLElement | null {
  const found = get_node_or_null(from, path);
  const entity = found === null ? null : (godot_node_entity(found) as unknown);
  return entity instanceof HTMLElement ? entity : null;
}

/** Stops what the player runs, leaving the animated properties as they were before. */
function cancel(playing: Playing): void {
  for (const running of playing.running) running.cancel();
  playing.running = [];
  playing.current = '';
}

/**
 * Plays an animation on the Controls it animates.
 *
 * @godot AnimationPlayer (protocol)
 * @source scene/animation/animation_player.cpp:423
 */
export function godot_animation_elements_play(entity: object, name: string, speed = 1, fromEnd = false): void {
  const playing = PLAYERS.get(entity);
  if (playing === undefined) return;
  const animation = playing.data.animations.find((entry) => entry.name === name);
  if (animation === undefined) throw new Error(`godot-compat: AnimationPlayer has no animation ${name}.`);
  cancel(playing);
  const root = elementAt(entity as HTMLElement, playing.data.root);
  const rate = speed * playing.speed;
  for (const track of animation.tracks) {
    const target = root === null ? null : elementAt(root, track.path);
    if (target === null) continue;
    const running = target.animate([...track.keyframes], {
      duration: Math.max(1, animation.length * 1000),
      iterations: animation.loop === 0 ? 1 : Infinity,
      direction: animation.loop === 2 ? 'alternate' : 'normal',
      fill: 'forwards',
    });
    running.playbackRate = fromEnd ? -Math.abs(rate) : rate;
    playing.running.push(running);
  }
  playing.current = name;
}

/**
 * @godot AnimationPlayer (protocol)
 * @source scene/animation/animation_player.cpp:656
 */
export function godot_animation_elements_stop(entity: object): void {
  const playing = PLAYERS.get(entity);
  if (playing !== undefined) cancel(playing);
}

/**
 * The animation playing now, "" when none is (a finished one that does not loop plays no more).
 *
 * @godot AnimationPlayer (protocol)
 * @source scene/animation/animation_player.cpp:627
 */
export function godot_animation_elements_current(entity: object): string {
  const playing = PLAYERS.get(entity);
  if (playing === undefined) return '';
  return playing.running.some((running) => running.playState === 'running') ? playing.current : '';
}

/**
 * @godot AnimationPlayer (protocol)
 * @source scene/animation/animation_player.cpp:660
 */
export function godot_animation_elements_set_speed(entity: object, speed: number): void {
  const playing = PLAYERS.get(entity);
  if (playing === undefined) return;
  playing.speed = speed;
  for (const running of playing.running) running.playbackRate = speed;
}

/**
 * @godot AnimationPlayer (protocol)
 * @source scene/animation/animation_player.cpp:664
 */
export function godot_animation_elements_speed(entity: object): number {
  return PLAYERS.get(entity)?.speed ?? 1;
}

/**
 * Whether the node is an AnimationPlayer among Controls.
 *
 * @godot AnimationPlayer (protocol)
 * @source scene/animation/animation_player.cpp:423
 */
export function godot_animation_elements_of(entity: object): boolean {
  return PLAYERS.has(entity);
}

/**
 * Mounts a player's animations on its element and plays its autoplay animation
 * (`AnimationPlayer::_notification`, `NOTIFICATION_READY`); the returned call stops it.
 *
 * @godot AnimationPlayer (protocol)
 * @source scene/animation/animation_player.cpp:147
 */
export function godot_animation_player_elements(element: HTMLElement | null, data: GodotAnimationElements): () => void {
  if (element === null) return () => undefined;
  const playing: Playing = { data, current: '', speed: 1, running: [] };
  PLAYERS.set(element, playing);
  if (data.autoplay !== undefined) godot_animation_elements_play(element, data.autoplay);
  return () => {
    cancel(playing);
    PLAYERS.delete(element);
  };
}
