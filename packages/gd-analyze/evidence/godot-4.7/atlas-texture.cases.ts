/**
 * AtlasTexture: atlases of placeholder textures made in official Godot and in compat, each read
 * back: the atlas, the region as set, and the texture's size (`get_width`/`get_height`, which the
 * floored region, or the atlas where a side is empty, decides).
 */
import * as AT from '../../capabilities/catalog/project-source/src/lib/godot-compat/atlas-texture';
import * as R from '../../capabilities/catalog/project-source/src/lib/godot-compat/rect2';
import * as T2D from '../../capabilities/catalog/project-source/src/lib/godot-compat/texture-2d';
import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd } from './literals';
import * as PT from '../../capabilities/catalog/project-source/src/lib/godot-compat/placeholder-texture-2d';
import * as V2 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';

/** A PlaceholderTexture2D of a size, as `PlaceholderTexture2D.new()` with its size set. */
function placeholder(width: number, height: number) {
  const texture = PT.godot_placeholder_texture_2d_new();
  PT.set_size(texture, V2.construct(width, height));
  return texture;
}
const gdPlaceholder = (name: string, width: number, height: number): string => `var ${name} := PlaceholderTexture2D.new()\n${name}.size = Vector2(${String(width)}, ${String(height)})`;

type Rect = readonly [number, number, number, number];
const gdRect = (r: Rect): string => `Rect2(${r.map(gd).join(', ')})`;

const cases: GodotEvidenceCase[] = [];
const add = (id: string, member: string, gdscript: readonly string[], target: () => unknown): void => {
  cases.push({ id, symbol: { kind: 'native-member', owner: 'AtlasTexture', member }, gdscript: gdscript.join('\n'), target, comparator: 'exact' });
};

// Regions over a 256 by 128 atlas: whole cells, fractional sizes (floored), empty sides (the
// atlas's), and a region with no atlas.
const REGIONS: readonly Rect[] = [
  [0, 0, 128, 128],
  [128, 0, 128, 128],
  [10.5, 3.25, 60.75, 20.9],
  [0, 0, 0, 64],
  [32, 16, 0, 0],
  [-8, -4, 300, 200],
];
REGIONS.forEach((region, index) => {
  for (const withAtlas of [true, false]) {
    add(
      `set_region-${String(index)}${withAtlas ? '' : '-no-atlas'}`,
      'set_region',
      [
        gdPlaceholder('a', 256, 128),
        'var t := AtlasTexture.new()',
        ...(withAtlas ? ['t.atlas = a'] : []),
        `t.region = ${gdRect(region)}`,
        'return [t.region, t.get_size(), t.get_width(), t.get_height()]',
      ],
      () => {
        const a = placeholder(256, 128);
        const t = AT.godot_atlas_texture_new();
        if (withAtlas) AT.set_atlas(t, a);
        AT.set_region(t, R.construct(...region));
        return [AT.get_region(t), T2D.get_size(t), T2D.get_width(t), T2D.get_height(t)];
      },
    );
  }
});
add('get_region-default', 'get_region', ['var t := AtlasTexture.new()', 'return [t.region, t.get_size()]'], () => {
  const t = AT.godot_atlas_texture_new();
  return [AT.get_region(t), T2D.get_size(t)];
});
add('set_atlas', 'set_atlas', [gdPlaceholder('a', 96, 40), 'var t := AtlasTexture.new()', 't.atlas = a', 'return [t.atlas == a, t.get_size()]'], () => {
  const a = placeholder(96, 40);
  const t = AT.godot_atlas_texture_new();
  AT.set_atlas(t, a);
  return [AT.get_atlas(t) === a, T2D.get_size(t)];
});
add('set_atlas-self', 'set_atlas', ['var t := AtlasTexture.new()', 't.atlas = t', 'return [t.atlas == null, t.get_size()]'], () => {
  const t = AT.godot_atlas_texture_new();
  AT.set_atlas(t, t);
  return [AT.get_atlas(t) === null, T2D.get_size(t)];
});
add('get_atlas-default', 'get_atlas', ['var t := AtlasTexture.new()', 'return t.atlas == null'], () => AT.get_atlas(AT.godot_atlas_texture_new()) === null);
// A nested atlas: the outer's size follows the inner's region.
add('set_atlas-nested', 'set_atlas', [
  gdPlaceholder('a', 256, 128),
  'var inner := AtlasTexture.new()',
  'inner.atlas = a',
  `inner.region = ${gdRect([0, 0, 64, 32])}`,
  'var t := AtlasTexture.new()',
  't.atlas = inner',
  'var before := t.get_size()',
  `inner.region = ${gdRect([0, 0, 50, 20])}`,
  'return [before, t.get_size(), t.atlas == inner]',
], () => {
  const a = placeholder(256, 128);
  const inner = AT.godot_atlas_texture_new();
  AT.set_atlas(inner, a);
  AT.set_region(inner, R.construct(0, 0, 64, 32));
  const t = AT.godot_atlas_texture_new();
  AT.set_atlas(t, inner);
  const before = T2D.get_size(t);
  AT.set_region(inner, R.construct(0, 0, 50, 20));
  return [before, T2D.get_size(t), AT.get_atlas(t) === inner];
});

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'AtlasTexture', compatModule: 'lib/godot-compat/atlas-texture', cases };
export default EVIDENCE;
