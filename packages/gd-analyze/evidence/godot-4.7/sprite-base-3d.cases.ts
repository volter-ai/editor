/**
 * SpriteBase3D: Sprite3Ds and AnimatedSprite3Ds made in official Godot and in compat, entered into
 * the tree and drawn by their deferred redraw, then read after the next frame: the AABB
 * `draw_texture_rect` set from the drawn vertices, `get_item_rect`, `pixel_size` and the draw flags; for textures,
 * AtlasTextures (regions of a placeholder atlas) and none. What headless Godot cannot show (the
 * Compatibility renderer's material state and the UVs it samples) is compared by `render-mapping`
 * against the cited source.
 */
import type { Mesh } from 'three';
import { DoubleSide, FrontSide, type MeshBasicMaterial, type Texture } from 'three';
import * as AS from '../../capabilities/catalog/project-source/src/lib/godot-compat/animated-sprite-3d';
import * as AT from '../../capabilities/catalog/project-source/src/lib/godot-compat/atlas-texture';
import * as N from '../../capabilities/catalog/project-source/src/lib/godot-compat/node';
import * as R from '../../capabilities/catalog/project-source/src/lib/godot-compat/rect2';
import * as SB from '../../capabilities/catalog/project-source/src/lib/godot-compat/sprite-base-3d';
import * as SF from '../../capabilities/catalog/project-source/src/lib/godot-compat/sprite-frames';
import * as S3 from '../../capabilities/catalog/project-source/src/lib/godot-compat/sprite-3d';
import * as VI from '../../capabilities/catalog/project-source/src/lib/godot-compat/visual-instance-3d';
import type { GodotEvidenceCase, GodotEvidenceCaseFile, GodotEvidenceSymbol } from '../../src/evidence/case';
import { gd } from './literals';
import { gdPlaceholder, newAnimatedSprite3D, newSprite3D, placeholder, type SpriteFrameContext, spriteFramesCase } from './sprite-tree';

const member = (name: string): GodotEvidenceSymbol => ({ kind: 'native-member', owner: 'SpriteBase3D', member: name });

/** How the sprite's texture is made: a placeholder of a size, an atlas region of one, or none. */
type Source =
  | { readonly kind: 'plain'; readonly size: readonly [number, number] }
  | { readonly kind: 'atlas'; readonly size: readonly [number, number]; readonly region: readonly [number, number, number, number] }
  | { readonly kind: 'none' };

interface Build {
  readonly animated: boolean;
  readonly source: Source;
  readonly pixelSize?: number;
  readonly flags?: readonly (readonly [number, boolean])[];
}

function gdBuild(b: Build): string[] {
  const lines: string[] = [];
  if (b.source.kind !== 'none') lines.push(gdPlaceholder('a', ...b.source.size));
  if (b.source.kind === 'atlas') lines.push('var tex := AtlasTexture.new()', 'tex.atlas = a', `tex.region = Rect2(${b.source.region.map(gd).join(', ')})`);
  const texture = b.source.kind === 'none' ? 'null' : b.source.kind === 'atlas' ? 'tex' : 'a';
  if (b.animated) {
    lines.push('var sf := SpriteFrames.new()', `sf.set("animations", [{"name": &"default", "speed": 5.0, "loop": true, "frames": [{"duration": 1.0, "texture": ${texture}}]}])`);
    lines.push('var s := AnimatedSprite3D.new()', 's.sprite_frames = sf');
  } else {
    lines.push('var s := Sprite3D.new()', `s.texture = ${texture}`);
  }
  if (b.pixelSize !== undefined) lines.push(`s.pixel_size = ${gd(b.pixelSize)}`);
  for (const [flag, on] of b.flags ?? []) lines.push(`s.set_draw_flag(${String(flag)}, ${String(on)})`);
  lines.push('holder.add_child(s)');
  return lines;
}

function tsBuild(b: Build, context: SpriteFrameContext): Mesh {
  const a = b.source.kind === 'none' ? null : placeholder(...b.source.size);
  let texture = a;
  if (b.source.kind === 'atlas') {
    texture = AT.godot_atlas_texture_new();
    AT.set_atlas(texture, a);
    AT.set_region(texture, R.construct(...b.source.region));
  }
  const s = b.animated ? newAnimatedSprite3D() : newSprite3D();
  if (b.animated) AS.set_sprite_frames(s, SF.godot_sprite_frames_new([{ name: 'default', speed: 5, loop: true, frames: [{ texture, duration: 1 }] }]));
  else S3.set_texture(s, texture);
  if (b.pixelSize !== undefined) SB.set_pixel_size(s, b.pixelSize);
  for (const [flag, on] of b.flags ?? []) SB.set_draw_flag(s, flag, on);
  N.add_child(context.holder, s);
  context.values.set('s', s);
  return s;
}

/** The reads after the redraw: AABB, item rect, pixel size, the flags. */
const GD_READ = [
  'var box := s.get_aabb()',
  'out.append([box.position, box.size, s.get_item_rect(), s.pixel_size, [s.get_draw_flag(0), s.get_draw_flag(1), s.get_draw_flag(2), s.get_draw_flag(3), s.get_draw_flag(4), s.get_draw_flag(5), s.get_draw_flag(-1)]])',
];

function tsRead(s: Mesh): unknown {
  const box = VI.get_aabb(s);
  return [box.position, box.size, SB.get_item_rect(s), SB.get_pixel_size(s), [0, 1, 2, 3, 4, 5, -1].map((flag) => SB.get_draw_flag(s, flag))];
}

const cases: GodotEvidenceCase[] = [];
function add(id: string, symbol: string, b: Build): void {
  cases.push(
    spriteFramesCase(`${id}${b.animated ? '-animated' : ''}`, member(symbol), [
      { gd: gdBuild(b), ts: (context) => void tsBuild(b, context) },
      {
        gd: GD_READ,
        ts: (context) => context.out.push(tsRead(context.values.get('s') as Mesh)),
      },
    ]),
  );
}

for (const animated of [false, true]) {
  add('defaults', 'get_pixel_size', { animated, source: { kind: 'plain', size: [256, 128] } });
  add('pixel_size', 'set_pixel_size', { animated, source: { kind: 'plain', size: [64, 64] }, pixelSize: 0.0025 });
  add('pixel_size-odd', 'set_pixel_size', { animated, source: { kind: 'plain', size: [33, 17] }, pixelSize: 0.013 });
  add('atlas-cell', 'get_item_rect', { animated, source: { kind: 'atlas', size: [256, 256], region: [128, 0, 128, 128] } });
  add('atlas-burst', 'get_item_rect', { animated, source: { kind: 'atlas', size: [512, 256], region: [256, 0, 256, 256] }, pixelSize: 0.01 });
  add('atlas-fractional', 'get_item_rect', { animated, source: { kind: 'atlas', size: [100, 60], region: [10.5, 3.25, 40.75, 20.9] }, pixelSize: 0.02 });
  add('atlas-clipped', 'get_item_rect', { animated, source: { kind: 'atlas', size: [100, 60], region: [80, 40, 50, 50] } });
  add('none', 'get_item_rect', { animated, source: { kind: 'none' } });
  add('flags', 'set_draw_flag', { animated, source: { kind: 'plain', size: [16, 16] }, flags: [[2, false], [3, true], [0, false], [1, true], [4, true], [4, false], [7, true], [-1, true]] });
  add('get_draw_flag-default', 'get_draw_flag', { animated, source: { kind: 'plain', size: [8, 8] } });
}

/**
 * The drawn quad's material and UVs as three holds them (side, transparent, depth write, depth test,
 * cast shadow, unshaded, samples the texture's atlas, UVs, indices), against Godot's 2D material for the flags
 * (`get_material_for_2d`, material.cpp:2992) as the Compatibility renderer draws it, and the UVs
 * `draw_texture_rect` writes (sprite_3d.cpp:150), `v` flipped for the flipped upload.
 */
function fact(id: string, symbol: string, b: Build, value: unknown, source: { readonly file: string; readonly symbol: string; readonly line: number }): void {
  const built = spriteFramesCase(`${id}${b.animated ? '-animated' : ''}`, member(symbol), [
    { gd: gdBuild(b), ts: (context) => void tsBuild(b, context) },
    {
      gd: ['out.append(0)'],
      ts: (context) => {
        const s = context.values.get('s') as Mesh;
        const material = s.material as MeshBasicMaterial;
        const uv = s.geometry.getAttribute('uv');
        context.out.push([
          material.side === DoubleSide ? 'double' : material.side === FrontSide ? 'front' : 'back',
          material.transparent,
          material.depthWrite,
          material.depthTest,
          s.castShadow,
          material.type === 'MeshBasicMaterial',
          material.map !== null && material.map.source === AT.godot_atlas_texture_source(drawnTexture(s, b.animated))?.source,
          Array.from(uv.array as Float32Array),
          Array.from(s.geometry.getIndex()?.array ?? []),
        ]);
      },
    },
  ]);
  cases.push({ ...built, target: () => JSON.stringify(built.target()), comparator: 'render-mapping', fact: { value: JSON.stringify([value]), source } });
}

/** The texture the sprite draws: its own, or its animation's first frame. */
function drawnTexture(s: Mesh, animated: boolean): Texture {
  return (animated ? SF.get_frame_texture(AS.get_sprite_frames(s) as SF.SpriteFrames, 'default', 0) : S3.get_texture(s)) as Texture;
}

const MATERIAL_2D = { file: 'scene/resources/material.cpp', symbol: 'BaseMaterial3D::get_material_for_2d', line: 3016 };
const ALPHA_PASS = { file: 'drivers/gles3/rasterizer_scene_gles3.cpp', symbol: 'GeometryInstanceSurface flags (alpha pass only)', line: 257 };
const UVS = { file: 'scene/3d/sprite_3d.cpp', symbol: 'SpriteBase3D::draw_texture_rect (UVs)', line: 150 };
const QUAD = [0, 2, 1, 0, 3, 2];
for (const animated of [false, true]) {
  // Transparent and double-sided (the defaults): alpha-blended, no depth writes, no culling, no shadow.
  fact('material-default', 'set_draw_flag', { animated, source: { kind: 'plain', size: [16, 16] } }, ['double', true, false, true, false, true, true, [0, 1, 1, 1, 1, 0, 0, 0], QUAD], MATERIAL_2D);
  // The impact's flags: one-sided, no depth test.
  fact('material-no-depth', 'set_draw_flag', { animated, source: { kind: 'plain', size: [16, 16] }, flags: [[2, false], [3, true]] }, ['front', true, false, false, false, true, true, [0, 1, 1, 1, 1, 0, 0, 0], QUAD], MATERIAL_2D);
  // Opaque: in the opaque pass, casting its shadow.
  fact('material-opaque', 'set_draw_flag', { animated, source: { kind: 'plain', size: [16, 16] }, flags: [[0, false]] }, ['double', false, true, true, true, true, true, [0, 1, 1, 1, 1, 0, 0, 0], QUAD], ALPHA_PASS);
  // An atlas cell samples its atlas: region (128, 0, 128, 128) of 256 by 256 is u 0.5..1, v 0..0.5.
  fact('uv-atlas-cell', 'get_item_rect', { animated, source: { kind: 'atlas', size: [256, 256], region: [128, 0, 128, 128] } }, ['double', true, false, true, false, true, true, [0.5, 1, 1, 1, 1, 0.5, 0.5, 0.5], QUAD], UVS);
}

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'SpriteBase3D', compatModule: 'lib/godot-compat/sprite-base-3d', cases };
export default EVIDENCE;
