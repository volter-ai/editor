import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { inputCase, type Op } from './input-tree';

const touch = (index: number, at: readonly [number, number], pressed: boolean): Op => ({ event: { touch: index, at, pressed } });

// The corpus's jump button: a 1x1 CanvasTexture scaled by 124 inside a moved parent; its action,
// signals, the InputEventAction it pushes (seen by a node's `_input`), a second finger, passby.
const OPS: Op[] = [
  { action: 'jump' },
  { texture: 'unit' },
  { texture: 'big', size: [20, 10] },
  { node: 'watcher', kind: 'Node', script: { input: false } },
  { node: 'holder2d', kind: 'Node2D' },
  { call: 'set_position', on: 'holder2d', args: [[10, 5]] },
  { node: 'b', kind: 'TouchScreenButton', parent: 'holder2d' },
  ...['get_action', 'get_visibility_mode', 'is_passby_press_enabled', 'is_pressed'].map((read): Op => ({ read, on: 'b' })),
  { call: 'set_texture_normal', on: 'b', args: [{ ref: 'unit' }] },
  { call: 'set_scale', on: 'b', args: [[24, 24]] },
  { call: 'set_action', on: 'b', args: ['jump'] },
  { watch: 'b', signal: 'pressed' },
  { watch: 'b', signal: 'released' },
  { read: 'get_texture_normal', on: 'b', then: 'get_size' },
  touch(0, [5, 5], true),
  { read: 'is_pressed', on: 'b' },
  touch(0, [5, 5], false),
  touch(0, [20, 20], true),
  { read: 'is_pressed', on: 'b' },
  { pressedAction: 'jump' },
  touch(1, [30, 25], true),
  touch(0, [20, 20], false),
  { pressedAction: 'jump' },
  touch(1, [30, 25], false),
  { call: 'set_texture_pressed', on: 'b', args: [{ ref: 'big' }] },
  { read: 'get_texture_pressed', on: 'b', then: 'get_size' },
  { call: 'set_passby_press', on: 'b', args: [true] },
  touch(2, [5, 5], true),
  { event: { drag: 2, at: [12, 12] } },
  { event: { drag: 2, at: [50, 50] } },
  touch(2, [50, 50], false),
  { call: 'set_visibility_mode', on: 'b', args: [1] },
  { read: 'get_visibility_mode', on: 'b' },
  { call: 'hide', on: 'b' },
  touch(0, [20, 20], true),
  touch(0, [20, 20], false),
  ...['get_action', 'is_passby_press_enabled', 'is_pressed'].map((read): Op => ({ read, on: 'b' })),
];
const cases: GodotEvidenceCase[] = [
  'set_texture_normal',
  'get_texture_normal',
  'set_texture_pressed',
  'get_texture_pressed',
  'is_pressed',
  'set_action',
  'get_action',
  'set_visibility_mode',
  'get_visibility_mode',
  'set_passby_press',
  'is_passby_press_enabled',
].map((member) => {
  const built = inputCase(OPS);
  return { id: `${member}-jump`, symbol: { kind: 'native-member', owner: 'TouchScreenButton', member }, gdscript: built.gdscript, target: built.target, comparator: 'exact' };
});

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'TouchScreenButton', compatModule: 'lib/godot-compat/touch-screen-button', cases };
export default EVIDENCE;
