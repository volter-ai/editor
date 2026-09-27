import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { inputCase, type Op } from './input-tree';

const OPS: Op[] = [
  { texture: 'sheet', size: [96, 50] },
  { node: 's', kind: 'Sprite2D' },
  { read: 'get_rect', on: 's' },
  ...['is_centered', 'get_offset', 'is_flipped_h', 'is_flipped_v', 'get_hframes', 'get_vframes', 'get_frame'].map((read): Op => ({ read, on: 's' })),
  { call: 'set_texture', on: 's', args: [{ ref: 'sheet' }] },
  { read: 'get_rect', on: 's' },
  { call: 'set_offset', on: 's', args: [[3.5, -2]] },
  { call: 'set_hframes', on: 's', args: [5] },
  { call: 'set_vframes', on: 's', args: [2] },
  { call: 'set_frame', on: 's', args: [7] },
  { read: 'get_rect', on: 's' },
  { read: 'get_frame', on: 's' },
  { call: 'set_hframes', on: 's', args: [3] },
  { read: 'get_frame', on: 's' },
  { call: 'set_frame', on: 's', args: [2] },
  { call: 'set_hframes', on: 's', args: [2] },
  { read: 'get_frame', on: 's' },
  { call: 'set_frame', on: 's', args: [9] },
  { read: 'get_frame', on: 's' },
  { call: 'set_vframes', on: 's', args: [0] },
  { read: 'get_vframes', on: 's' },
  { call: 'set_centered', on: 's', args: [false] },
  { call: 'set_flip_h', on: 's', args: [true] },
  { call: 'set_flip_v', on: 's', args: [true] },
  { read: 'get_rect', on: 's' },
  ...['is_centered', 'get_offset', 'is_flipped_h', 'is_flipped_v', 'get_hframes', 'get_vframes'].map((read): Op => ({ read, on: 's' })),
  { read: 'get_texture', on: 's', then: 'get_size' },
];
const cases: GodotEvidenceCase[] = [
  'set_texture',
  'get_texture',
  'set_centered',
  'is_centered',
  'set_offset',
  'get_offset',
  'set_flip_h',
  'is_flipped_h',
  'set_flip_v',
  'is_flipped_v',
  'set_hframes',
  'get_hframes',
  'set_vframes',
  'get_vframes',
  'set_frame',
  'get_frame',
  'get_rect',
].map((member) => {
  const built = inputCase(OPS);
  return { id: `${member}-sheet`, symbol: { kind: 'native-member', owner: 'Sprite2D', member }, gdscript: built.gdscript, target: built.target, comparator: 'exact' };
});

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'Sprite2D', compatModule: 'lib/godot-compat/sprite-2d', cases };
export default EVIDENCE;
