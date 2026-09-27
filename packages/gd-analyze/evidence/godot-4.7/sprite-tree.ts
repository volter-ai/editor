/**
 * Sprite cases as frames: a GDScript body whose chunks are separated by `await process_frame`, and
 * the same chunks run in compat, the first inside a `process_frame` emission of compat's tree (as
 * the native probe's case runs inside the first frame's), each later one in the next frame's, the
 * tree stepped as `Main::iteration` steps it at a fixed 60 fps.
 */
import { Group, Mesh, Scene } from 'three';
import * as AS from '../../capabilities/catalog/project-source/src/lib/godot-compat/animated-sprite-3d';
import * as N from '../../capabilities/catalog/project-source/src/lib/godot-compat/node';
import * as PT from '../../capabilities/catalog/project-source/src/lib/godot-compat/placeholder-texture-2d';
import * as ST from '../../capabilities/catalog/project-source/src/lib/godot-compat/scene-tree';
import * as S3 from '../../capabilities/catalog/project-source/src/lib/godot-compat/sprite-3d';
import * as V2 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import type { GodotEvidenceCase, GodotEvidenceSymbol } from '../../src/evidence/case';

const DT = 1 / 60;

/** The target's frame context: the holder under the tree's root, and values the chunks share. */
export interface SpriteFrameContext {
  readonly holder: Group;
  readonly values: Map<string, unknown>;
  readonly out: unknown[];
}

/** One frame: its GDScript lines (appending to `out`) and the same through compat. */
export interface SpriteFrame {
  readonly gd: readonly string[];
  readonly ts: (context: SpriteFrameContext) => void;
}

export function spriteFramesCase(id: string, symbol: GodotEvidenceSymbol, frames: readonly SpriteFrame[]): GodotEvidenceCase {
  const lines = ['var out := []'];
  frames.forEach((frame, index) => {
    if (index > 0) lines.push('await process_frame');
    lines.push(...frame.gd.flatMap((line) => line.split('\n')));
  });
  lines.push('return out');
  return {
    id,
    symbol,
    gdscript: lines.join('\n'),
    target: () => {
      const root = new Scene();
      ST.godot_tree_set_root(root);
      const tree = ST.godot_tree();
      const holder = new Group();
      N.godot_node_adopt(holder, { kind: 'node' });
      N.add_child(root, holder);
      const context: SpriteFrameContext = { holder, values: new Map(), out: [] };
      let next = 0;
      const run = (): void => {
        (frames[next] as SpriteFrame).ts(context);
        next += 1;
        if (next < frames.length) tree.process_frame.connect(run, { oneShot: true });
      };
      tree.process_frame.connect(run, { oneShot: true });
      ST.godot_tree_frame(DT);
      for (let guard = 0; next < frames.length && guard < 1000; guard += 1) {
        ST.godot_tree_physics_step(DT);
        ST.godot_tree_frame(DT);
      }
      return context.out;
    },
    comparator: 'exact',
  };
}

const SPRITE_3D = ['Sprite3D', 'SpriteBase3D', 'GeometryInstance3D', 'VisualInstance3D', 'Node3D', 'Node', 'Object'];
const ANIMATED_SPRITE_3D = ['AnimatedSprite3D', 'SpriteBase3D', 'GeometryInstance3D', 'VisualInstance3D', 'Node3D', 'Node', 'Object'];

/** A Sprite3D node made as `Sprite3D.new()` makes it. */
export function newSprite3D(): Mesh {
  const sprite = new Mesh();
  N.godot_node_adopt(sprite, { kind: 'spatial', classes: SPRITE_3D });
  S3.godot_sprite_3d_mount(sprite);
  return sprite;
}

/** An AnimatedSprite3D node made as `AnimatedSprite3D.new()` makes it. */
export function newAnimatedSprite3D(): Mesh {
  const sprite = new Mesh();
  N.godot_node_adopt(sprite, { kind: 'spatial', classes: ANIMATED_SPRITE_3D });
  AS.godot_animated_sprite_3d_mount(sprite);
  return sprite;
}

/** A PlaceholderTexture2D of `size`, as `PlaceholderTexture2D.new()` with its size set. */
export function placeholder(width: number, height: number) {
  const texture = PT.godot_placeholder_texture_2d_new();
  PT.set_size(texture, V2.construct(width, height));
  return texture;
}

/** The GDScript that makes the same texture as `placeholder`, as variable `name`. */
export function gdPlaceholder(name: string, width: number, height: number): string {
  return `var ${name} := PlaceholderTexture2D.new()\n${name}.size = Vector2(${String(width)}, ${String(height)})`;
}
