import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { type Event, inputCase, type Op } from './input-tree';

const cases: GodotEvidenceCase[] = [];
function add(id: string, member: string, ops: readonly Op[]): void {
  const built = inputCase(ops);
  cases.push({ id, symbol: { kind: 'native-member', owner: 'Viewport', member }, gdscript: built.gdscript, target: built.target, comparator: 'exact' });
}
const touch = (index: number, at: readonly [number, number], pressed: boolean): Op => ({ event: { touch: index, at, pressed } });
const ev = (event: Event): Op => ({ event });

// The stages in order, reverse tree order within a stage, and handling stopping later stages.
const ORDER: Op[] = [
  { node: 'first', kind: 'Node', script: { input: false, unhandled_input: false, unhandled_key_input: false, shortcut_input: false } },
  { node: 'parent', kind: 'Node', script: { input: false, unhandled_input: false } },
  { node: 'child', kind: 'Node', parent: 'parent', script: { input: false, unhandled_input: false, shortcut_input: false } },
  { node: 'last', kind: 'Node', script: { unhandled_input: false } },
  ev({ key: 65, pressed: true }),
  ev({ key: 65, pressed: false }),
  touch(0, [5, 6], true),
  ev({ drag: 0, at: [7, 8] }),
  touch(0, [7, 8], false),
  ev({ button: 2, at: [3, 4], pressed: true }),
  ev({ button: 2, at: [3, 4], pressed: false }),
  ev({ motion: [9, 9] }),
];
add('push_input-order', 'push_input', ORDER);

// A node that handles in `_input` stops the others; one that handles unhandled input stops the rest.
const HANDLED: Op[] = [
  { node: 'a', kind: 'Node', script: { input: false, unhandled_input: false } },
  { node: 'b', kind: 'Node', script: { input: true, unhandled_input: false } },
  { node: 'c', kind: 'Node', script: { unhandled_input: true } },
  { node: 'd', kind: 'Node', script: { input: false } },
  ev({ key: 66, pressed: true }),
  ev({ key: 66, pressed: false }),
  { call: 'set_process_input', on: 'b', args: [false] },
  ev({ key: 67, pressed: true }),
  ev({ key: 67, pressed: false }),
];
for (const member of ['set_input_as_handled', 'is_input_handled']) add(`${member}-handled`, member, HANDLED);

// The GUI: the Control under the pointer and its parents by their mouse filters, in their own
// coordinates; a Control that stops the mouse keeps the event from unhandled input.
const GUI: Op[] = [
  { node: 'watcher', kind: 'Node', script: { unhandled_input: false } },
  { node: 'panel', kind: 'Control', script: { gui_input: false } },
  { call: 'set_position', on: 'panel', args: [[10, 10]] },
  { call: 'set_size', on: 'panel', args: [[40, 40]] },
  { node: 'button', kind: 'Control', parent: 'panel', script: { gui_input: false } },
  { call: 'set_position', on: 'button', args: [[5, 5]] },
  { call: 'set_size', on: 'button', args: [[10, 10]] },
  { call: 'set_mouse_filter', on: 'button', args: [1] },
  { node: 'layer', kind: 'CanvasLayer' },
  { call: 'set_offset', on: 'layer', args: [[30, 0]] },
  { node: 'overlay', kind: 'Control', parent: 'layer', script: { gui_input: false } },
  { call: 'set_size', on: 'overlay', args: [[10, 64]] },
  { call: 'set_mouse_filter', on: 'overlay', args: [0] },
  touch(0, [17, 18], true),
  touch(0, [17, 18], false),
  touch(1, [35, 20], true),
  ev({ drag: 1, at: [12, 22] }),
  touch(1, [12, 22], false),
  ev({ button: 1, at: [20, 45], pressed: true }),
  ev({ motion: [60, 60] }),
  ev({ button: 1, at: [60, 60], pressed: false }),
  { call: 'set_mouse_filter', on: 'panel', args: [2] },
  touch(0, [45, 45], true),
  touch(0, [45, 45], false),
  { call: 'set_mouse_filter', on: 'overlay', args: [2] },
  touch(0, [35, 5], true),
  touch(0, [35, 5], false),
  { read: 'get_mouse_filter', on: 'panel' },
];
add('push_input-gui', 'push_input', GUI);

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'Viewport', compatModule: 'lib/godot-compat/viewport', cases };
export default EVIDENCE;
