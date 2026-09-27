/**
 * Sprite3D: sprites given textures (placeholders, atlas regions, none) in official Godot and in
 * compat, entered into the tree and stepped frame by frame, read after each: the texture, the
 * drawn AABB, whether the quad draws (`get_base().is_valid()`), and how many `texture_changed`
 * signals fired; a texture's own change (a placeholder resized, a region moved) redraws.
 */
import type { Mesh } from 'three';
import * as AT from '../../capabilities/catalog/project-source/src/lib/godot-compat/atlas-texture';
import * as N from '../../capabilities/catalog/project-source/src/lib/godot-compat/node';
import * as PT from '../../capabilities/catalog/project-source/src/lib/godot-compat/placeholder-texture-2d';
import * as R from '../../capabilities/catalog/project-source/src/lib/godot-compat/rect2';
import * as SB from '../../capabilities/catalog/project-source/src/lib/godot-compat/sprite-base-3d';
import * as S3 from '../../capabilities/catalog/project-source/src/lib/godot-compat/sprite-3d';
import { godot_object_signal } from '../../capabilities/catalog/project-source/src/lib/godot-compat/signal';
import * as V2 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import * as VI from '../../capabilities/catalog/project-source/src/lib/godot-compat/visual-instance-3d';
import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gdPlaceholder, newSprite3D, placeholder, type SpriteFrame, type SpriteFrameContext, spriteFramesCase } from './sprite-tree';

type Texture = ReturnType<typeof placeholder>;

const GD_READ = 'out.append([s.texture == null, s.texture == a, s.get_aabb().position, s.get_aabb().size, s.get_base().is_valid(), changed[0]])';
function tsRead(context: SpriteFrameContext): void {
  const s = context.values.get('s') as Mesh;
  const texture = S3.get_texture(s);
  const box = VI.get_aabb(s);
  context.out.push([texture === null, texture === context.values.get('a'), box.position, box.size, SB.godot_sprite_base_3d_surface(s).based, context.values.get('changed')]);
}

/** The sprite and its texture `a`, counting `texture_changed`, before it enters the tree. */
const SETUP: SpriteFrame = {
  gd: [gdPlaceholder('a', 64, 32), 'var s := Sprite3D.new()', 'var changed := [0]', 's.texture_changed.connect(func(): changed[0] += 1)'],
  ts: (context) => {
    const a = placeholder(64, 32);
    const s = newSprite3D();
    context.values.set('a', a);
    context.values.set('s', s);
    context.values.set('changed', 0);
    godot_object_signal(s, 'texture_changed').signal.connect(() => context.values.set('changed', (context.values.get('changed') as number) + 1));
  },
};
const step = (gd: readonly string[], ts: (s: Mesh, context: SpriteFrameContext) => void): SpriteFrame => ({
  gd: [...gd, GD_READ],
  ts: (context) => {
    ts(context.values.get('s') as Mesh, context);
    tsRead(context);
  },
});
const read: SpriteFrame = step([], () => undefined);
const enter = step(['holder.add_child(s)'], (s, context) => N.add_child(context.holder, s));

const cases: GodotEvidenceCase[] = [
  spriteFramesCase('set_texture-before-tree', { kind: 'native-member', owner: 'Sprite3D', member: 'set_texture' }, [
    { ...SETUP, gd: [...SETUP.gd, 's.texture = a'], ts: (context) => { SETUP.ts(context); S3.set_texture(context.values.get('s') as Mesh, context.values.get('a') as Texture); } },
    enter,
    read,
  ]),
  spriteFramesCase('set_texture-in-tree', { kind: 'native-member', owner: 'Sprite3D', member: 'set_texture' }, [
    SETUP,
    enter,
    step(['s.texture = a', 's.texture = a'], (s, context) => { S3.set_texture(s, context.values.get('a') as Texture); S3.set_texture(s, context.values.get('a') as Texture); }),
    read,
    step(['a.size = Vector2(10, 90)'], (_, context) => PT.set_size(context.values.get('a') as Texture, V2.construct(10, 90))),
    read,
    step(['s.texture = null'], (s) => S3.set_texture(s, null)),
    read,
  ]),
  spriteFramesCase('set_texture-atlas', { kind: 'native-member', owner: 'Sprite3D', member: 'set_texture' }, [
    {
      gd: [...SETUP.gd, 'var t := AtlasTexture.new()', 't.atlas = a', 't.region = Rect2(8, 4, 20, 12)', 's.texture = t', 'holder.add_child(s)'],
      ts: (context) => {
        SETUP.ts(context);
        const t = AT.godot_atlas_texture_new();
        AT.set_atlas(t, context.values.get('a') as Texture);
        AT.set_region(t, R.construct(8, 4, 20, 12));
        context.values.set('t', t);
        S3.set_texture(context.values.get('s') as Mesh, t);
        N.add_child(context.holder, context.values.get('s') as Mesh);
      },
    },
    read,
    step(['t.region = Rect2(0, 0, 40.5, 30)'], (_, context) => AT.set_region(context.values.get('t') as Texture, R.construct(0, 0, 40.5, 30))),
    read,
  ]),
  spriteFramesCase('get_texture-default', { kind: 'native-member', owner: 'Sprite3D', member: 'get_texture' }, [SETUP, enter, read]),
];

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'Sprite3D', compatModule: 'lib/godot-compat/sprite-3d', cases };
export default EVIDENCE;
