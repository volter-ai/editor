import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { inputCase, type Op } from './input-tree';

// Read through a Sprite2D: a canvas texture is 1x1 until its diffuse texture gives it its size.
const OPS: Op[] = [
  { texture: 'c' },
  { texture: 'd', size: [12, 7] },
  { node: 's', kind: 'Sprite2D' },
  { call: 'set_texture', on: 's', args: [{ ref: 'c' }] },
  { read: 'get_rect', on: 's' },
  { read: 'get_texture', on: 's', then: 'get_size' },
  { call: 'set_diffuse_texture', on: 'c', args: [{ ref: 'd' }] },
  { read: 'get_rect', on: 's' },
  { read: 'get_texture', on: 's', then: 'get_size' },
  { read: 'get_diffuse_texture', on: 'c', then: 'get_size' },
];
const built = inputCase(OPS);
const cases: GodotEvidenceCase[] = ['set_diffuse_texture', 'get_diffuse_texture'].map((member) => ({
  id: `${member}-sizes`,
  symbol: { kind: 'native-member', owner: 'CanvasTexture', member },
  gdscript: built.gdscript,
  target: built.target,
  comparator: 'exact',
}));

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'CanvasTexture', compatModule: 'lib/godot-compat/canvas-texture', cases };
export default EVIDENCE;
