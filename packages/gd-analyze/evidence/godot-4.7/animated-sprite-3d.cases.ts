/**
 * AnimatedSprite3D: sprites over SpriteFrames of placeholder textures (the fps kit's burst with its
 * empty last frame, its impact, looping and ping-pong animations with uneven durations) made in
 * official Godot and in compat, played and stepped frame by frame at a fixed 60 fps, each frame read
 * back: the animation, frame, frame progress and playing state, the signals emitted since the last
 * read in order, the drawn AABB and whether the quad draws.
 */
import type { Mesh } from 'three';
import * as AS from '../../capabilities/catalog/project-source/src/lib/godot-compat/animated-sprite-3d';
import * as N from '../../capabilities/catalog/project-source/src/lib/godot-compat/node';
import * as SB from '../../capabilities/catalog/project-source/src/lib/godot-compat/sprite-base-3d';
import * as SF from '../../capabilities/catalog/project-source/src/lib/godot-compat/sprite-frames';
import * as VI from '../../capabilities/catalog/project-source/src/lib/godot-compat/visual-instance-3d';
import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd, gs } from './literals';
import { gdPlaceholder, newAnimatedSprite3D, placeholder, type SpriteFrame, type SpriteFrameContext, spriteFramesCase } from './sprite-tree';

interface Anim {
  readonly name: string;
  readonly speed: number;
  readonly loop: boolean | number;
  /** Each frame's texture width (a placeholder 16 high), null for none, and its duration. */
  readonly frames: readonly (readonly [number | null, number])[];
}

const SIGNALS = ['sprite_frames_changed', 'animation_changed', 'frame_changed', 'animation_looped', 'animation_finished'] as const;

const SETS = {
  burst: [{ name: 'default', speed: 30, loop: false, frames: [[256, 1], [255, 1], [null, 1]] }],
  impact: [{ name: 'shot', speed: 30, loop: false, frames: [[128, 1], [127, 1], [126, 1], [125, 1]] }],
  uneven: [
    { name: 'walk', speed: 12.5, loop: true, frames: [[10, 0.5], [11, 2.5], [12, 0.3]] },
    { name: 'bounce', speed: 20, loop: 2, frames: [[20, 1], [21, 0.25], [22, 1.75]] },
    { name: 'empty', speed: 5, loop: true, frames: [] },
    { name: 'still', speed: 0, loop: true, frames: [[30, 1], [31, 1]] },
  ],
} satisfies Readonly<Record<string, readonly Anim[]>>;

function gdSetup(set: readonly Anim[]): string[] {
  const widths = [...new Set(set.flatMap((anim) => anim.frames.map(([width]) => width)).filter((width): width is number => width !== null))];
  const dicts = set.map(
    (anim) =>
      `{"name": &${gs(anim.name)}, "speed": ${gd(anim.speed)}, "loop": ${String(anim.loop)}, "frames": [${anim.frames
        .map(([width, duration]) => `{"duration": ${gd(duration)}, "texture": ${width === null ? 'null' : `t${String(width)}`}}`)
        .join(', ')}]}`,
  );
  return [
    ...widths.map((width) => gdPlaceholder(`t${String(width)}`, width, 16)),
    'var sf := SpriteFrames.new()',
    `sf.set("animations", [${dicts.join(', ')}])`,
    'var s := AnimatedSprite3D.new()',
    'var log := []',
    ...SIGNALS.map((name) => `s.${name}.connect(func(): log.append(${gs(name)}))`),
  ];
}

function tsSetup(set: readonly Anim[], context: SpriteFrameContext): void {
  const textures = new Map<number, ReturnType<typeof placeholder>>();
  for (const anim of set) for (const [width] of anim.frames) if (width !== null && !textures.has(width)) textures.set(width, placeholder(width, 16));
  const sf = SF.godot_sprite_frames_new(
    set.map((anim) => ({ name: anim.name, speed: anim.speed, loop: anim.loop, frames: anim.frames.map(([width, duration]) => ({ texture: width === null ? null : (textures.get(width) ?? null), duration })) })),
  );
  const s = newAnimatedSprite3D();
  const log: string[] = [];
  for (const name of SIGNALS) AS.godot_animated_sprite_3d_signal(s, name).connect(() => log.push(name));
  context.values.set('sf', sf);
  context.values.set('s', s);
  context.values.set('log', log);
}

const GD_READ = 'out.append([String(s.animation), s.frame, s.frame_progress, s.is_playing(), log.duplicate(), s.get_aabb().position, s.get_aabb().size, s.get_base().is_valid()])\nlog.clear()';
function tsRead(context: SpriteFrameContext): void {
  const s = context.values.get('s') as Mesh;
  const log = context.values.get('log') as string[];
  const box = VI.get_aabb(s);
  context.out.push([AS.get_animation(s), AS.get_frame(s), AS.get_frame_progress(s), AS.is_playing(s), [...log], box.position, box.size, SB.godot_sprite_base_3d_surface(s).based]);
  log.length = 0;
}

/** A statement both sides run on the sprite `s`, the frames `sf` and the holder. */
interface Act {
  readonly gd: string;
  readonly ts: (s: Mesh, context: SpriteFrameContext) => void;
}
const act = (gdLine: string, ts: (s: Mesh, context: SpriteFrameContext) => void): Act => ({ gd: gdLine, ts });
const setFrames: Act = act('s.sprite_frames = sf', (s, context) => AS.set_sprite_frames(s, context.values.get('sf') as SF.SpriteFrames));
const enter: Act = act('holder.add_child(s)', (s, context) => N.add_child(context.holder, s));
const play = (name?: string, speed?: number, fromEnd?: boolean): Act =>
  act(
    `s.play(${[name === undefined ? undefined : `&${gs(name)}`, speed === undefined ? undefined : gd(speed), fromEnd === undefined ? undefined : String(fromEnd)].filter((x) => x !== undefined).join(', ')})`,
    (s) => (name === undefined ? AS.play(s) : speed === undefined ? AS.play(s, name) : fromEnd === undefined ? AS.play(s, name, speed) : AS.play(s, name, speed, fromEnd)),
  );
const frame = (value: number): Act => act(`s.frame = ${String(value)}`, (s) => AS.set_frame(s, value));
const animation = (name: string): Act => act(`s.animation = &${gs(name)}`, (s) => AS.set_animation(s, name));

/** Frames: the setup and the first acts, then per later frame its acts; every frame is read. */
function build(set: readonly Anim[], acts: readonly (readonly Act[])[]): SpriteFrame[] {
  return acts.map((frameActs, index) => ({
    gd: [...(index === 0 ? gdSetup(set) : []), ...frameActs.map((entry) => entry.gd), GD_READ],
    ts: (context) => {
      if (index === 0) tsSetup(set, context);
      const s = context.values.get('s') as Mesh;
      for (const entry of frameActs) entry.ts(s, context);
      tsRead(context);
    },
  }));
}
const idle = (count: number): Act[][] => Array.from({ length: count }, () => []);

const cases: GodotEvidenceCase[] = [];
const add = (id: string, member: string, set: readonly Anim[], acts: readonly (readonly Act[])[]): void => {
  cases.push(spriteFramesCase(id, { kind: 'native-member', owner: 'AnimatedSprite3D', member }, build(set, acts)));
};

// The enemy's muzzle: authored at its empty frame, then played from frame 0 to its end.
add('play-burst', 'play', SETS.burst, [[setFrames, frame(2), enter], [frame(0), play('default')], ...idle(8), [frame(0), play('default')], ...idle(4)]);
// The player's muzzle: played again while still playing.
add('play-burst-replay', 'play', SETS.burst, [[setFrames, frame(2), enter], [play('default')], ...idle(2), [play('default')], ...idle(6), [play('default')], ...idle(3)]);
// The impact: its animation named, played before it enters the tree.
add('play-impact', 'play', SETS.impact, [[setFrames, animation('shot'), play('shot'), enter], ...idle(10)]);
add('play-loop-uneven', 'play', SETS.uneven, [[setFrames, enter, play('walk')], ...idle(24)]);
add('play-pingpong', 'play', SETS.uneven, [[setFrames, enter, play('bounce')], ...idle(24)]);
add('play-backwards', 'play', SETS.uneven, [[setFrames, enter, play('bounce', -1, true)], ...idle(12), [play('walk', 2)], ...idle(8)]);
add('play-current', 'play', SETS.uneven, [[setFrames, enter, play()], ...idle(6), [play('missing')], [play('empty')], [play('still')], ...idle(3)]);
add('is_playing', 'is_playing', SETS.impact, [[enter, play('shot')], [setFrames], [play('shot')], ...idle(2)]);
add('set_sprite_frames', 'set_sprite_frames', SETS.uneven, [[enter], [animation('bounce')], [setFrames], [act('s.sprite_frames = null', (s) => AS.set_sprite_frames(s, null))], [setFrames]]);
add('get_sprite_frames', 'get_sprite_frames', SETS.impact, [[act('out.append(s.sprite_frames == null)', (_, c) => c.out.push(AS.get_sprite_frames(c.values.get('s') as Mesh) === null)), setFrames, act('out.append(s.sprite_frames == sf)', (_, c) => c.out.push(AS.get_sprite_frames(c.values.get('s') as Mesh) === c.values.get('sf')))]]);
add('set_animation', 'set_animation', SETS.uneven, [[setFrames, enter], [animation('bounce')], [animation('missing')], [animation('')], [animation('empty')], [animation('walk'), play()], ...idle(2), [animation('bounce')], ...idle(2)]);
add('get_animation', 'get_animation', SETS.burst, [[enter], [setFrames]]);
add('set_frame', 'set_frame', SETS.uneven, [[setFrames, enter], [frame(1)], [frame(7)], [frame(-3)], [play('bounce', -1)], [frame(1)], ...idle(3), [frame(2)]]);
add('get_frame', 'get_frame', SETS.burst, [[frame(5), setFrames, frame(5)]]);
add('get_frame_progress', 'get_frame_progress', SETS.uneven, [[setFrames, enter, play('walk', 0.37)], ...idle(9)]);

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'AnimatedSprite3D', compatModule: 'lib/godot-compat/animated-sprite-3d', cases };
export default EVIDENCE;
