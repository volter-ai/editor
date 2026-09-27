/**
 * SpriteFrames: a new one (its `default` animation) and ones whose `animations` a scene states
 * (`_set_animations`: named animations with speeds, loop flags or modes, frames of placeholder
 * textures or none, durations under the minimum), made in official Godot and in compat, each read
 * back through the getters an AnimatedSprite3D uses, including missing animations and indices.
 */
import * as SF from '../../capabilities/catalog/project-source/src/lib/godot-compat/sprite-frames';
import * as T2D from '../../capabilities/catalog/project-source/src/lib/godot-compat/texture-2d';
import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd, gs } from './literals';
import * as PT from '../../capabilities/catalog/project-source/src/lib/godot-compat/placeholder-texture-2d';
import * as V2 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';

/** A PlaceholderTexture2D of a size, as `PlaceholderTexture2D.new()` with its size set. */
function placeholder(width: number, height: number) {
  const texture = PT.godot_placeholder_texture_2d_new();
  PT.set_size(texture, V2.construct(width, height));
  return texture;
}
const gdPlaceholder = (name: string, width: number, height: number): string => `var ${name} := PlaceholderTexture2D.new()\n${name}.size = Vector2(${String(width)}, ${String(height)})`;

interface Anim {
  readonly name: string;
  readonly speed: number;
  readonly loop: boolean | number;
  /** Each frame's texture (by its width, a placeholder 16 high; null for none) and duration. */
  readonly frames: readonly (readonly [number | null, number])[];
}

const SETS: Readonly<Record<string, readonly Anim[]>> = {
  burst: [{ name: 'default', speed: 30, loop: false, frames: [[256, 1], [128, 1], [null, 1]] }],
  impact: [{ name: 'shot', speed: 30, loop: false, frames: [[64, 1], [65, 1], [66, 1], [67, 1]] }],
  mixed: [
    { name: 'walk', speed: 12.5, loop: true, frames: [[10, 0.001], [11, 2.5], [12, 0.3]] },
    { name: 'idle', speed: 0, loop: 2, frames: [] },
    { name: 'Attack', speed: 7, loop: 0, frames: [[20, 0.01], [21, -3]] },
  ],
};

const gdSet = (anims: readonly Anim[]): string[] => {
  const widths = [...new Set(anims.flatMap((anim) => anim.frames.map(([width]) => width)).filter((width): width is number => width !== null))];
  const texture = (width: number | null) => (width === null ? 'null' : `t${String(width)}`);
  const dicts = anims.map(
    (anim) =>
      `{"name": &${gs(anim.name)}, "speed": ${gd(anim.speed)}, "loop": ${String(anim.loop)}, "frames": [${anim.frames
        .map(([width, duration]) => `{"duration": ${gd(duration)}, "texture": ${texture(width)}}`)
        .join(', ')}]}`,
  );
  return [...widths.map((width) => gdPlaceholder(`t${String(width)}`, width, 16)), 'var sf := SpriteFrames.new()', `sf.set("animations", [${dicts.join(', ')}])`];
};

const tsSet = (anims: readonly Anim[]): { readonly sf: SF.SpriteFrames } => {
  const textures = new Map<number, ReturnType<typeof placeholder>>();
  const texture = (width: number | null) => {
    if (width === null) return null;
    if (!textures.has(width)) textures.set(width, placeholder(width, 16));
    return textures.get(width) ?? null;
  };
  // The GDScript makes the textures first, in order of first use.
  for (const anim of anims) for (const [width] of anim.frames) texture(width);
  return { sf: SF.godot_sprite_frames_new(anims.map((anim) => ({ name: anim.name, speed: anim.speed, loop: anim.loop, frames: anim.frames.map(([width, duration]) => ({ texture: texture(width), duration })) }))) };
};

const cases: GodotEvidenceCase[] = [];
const add = (id: string, member: string, set: readonly Anim[] | null, gdRead: string, read: (sf: SF.SpriteFrames) => unknown): void => {
  cases.push({
    id,
    symbol: { kind: 'native-member', owner: 'SpriteFrames', member },
    gdscript: [...(set === null ? ['var sf := SpriteFrames.new()'] : gdSet(set)), `return ${gdRead}`].join('\n'),
    target: () => read(set === null ? SF.godot_sprite_frames_new() : tsSet(set).sf),
    comparator: 'exact',
  });
};

const NAMES = ['default', 'shot', 'walk', 'idle', 'Attack', 'missing', ''];
for (const [key, set] of [['new', null], ...Object.entries(SETS)] as const) {
  add(`get_animation_names-${key}`, 'get_animation_names', set, 'Array(sf.get_animation_names())', (sf) => SF.get_animation_names(sf));
  for (const name of NAMES) {
    add(`has_animation-${key}-${name}`, 'has_animation', set, `sf.has_animation(&${gs(name)})`, (sf) => SF.has_animation(sf, name));
    add(`get_animation_speed-${key}-${name}`, 'get_animation_speed', set, `sf.get_animation_speed(&${gs(name)})`, (sf) => SF.get_animation_speed(sf, name));
    add(`get_animation_loop_mode-${key}-${name}`, 'get_animation_loop_mode', set, `sf.get_animation_loop_mode(&${gs(name)})`, (sf) => SF.get_animation_loop_mode(sf, name));
    add(`get_frame_count-${key}-${name}`, 'get_frame_count', set, `sf.get_frame_count(&${gs(name)})`, (sf) => SF.get_frame_count(sf, name));
    for (const index of [-1, 0, 1, 2, 3, 4]) {
      add(`get_frame_duration-${key}-${name}-${String(index)}`, 'get_frame_duration', set, `sf.get_frame_duration(&${gs(name)}, ${String(index)})`, (sf) => SF.get_frame_duration(sf, name, index));
      add(
        `get_frame_texture-${key}-${name}-${String(index)}`,
        'get_frame_texture',
        set,
        `null if sf.get_frame_texture(&${gs(name)}, ${String(index)}) == null else sf.get_frame_texture(&${gs(name)}, ${String(index)}).get_size()`,
        (sf) => {
          const texture = SF.get_frame_texture(sf, name, index);
          return texture === null ? null : T2D.get_size(texture);
        },
      );
    }
  }
}

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'SpriteFrames', compatModule: 'lib/godot-compat/sprite-frames', cases };
export default EVIDENCE;
