import type { InputEventRecord } from '../../capabilities/catalog/project-source/src/lib/godot-compat/input-event';
import * as M from '../../capabilities/catalog/project-source/src/lib/godot-compat/input-event-mouse-motion';
import * as V2 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { eventCase } from './input-event-family';

type Motion = Extract<InputEventRecord, { type: 'mouse_motion' }>;
const position = V2.construct(10, 20);
const events: readonly (readonly [string, Motion])[] = [
  ['unset', { type: 'mouse_motion', position }],
  ['zero', { type: 'mouse_motion', position, relative: V2.construct(0, 0) }],
  ['fractional', { type: 'mouse_motion', position, relative: V2.construct(-3.5, 0.25) }],
  ['float32', { type: 'mouse_motion', position, relative: V2.construct(0.1, 16777217) }],
];
const cases = events.map(([name, event]) => eventCase(`get_relative-${name}`, 'InputEventMouseMotion', 'get_relative', event, (e) => M.get_relative(e as Motion)));

const EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'InputEventMouseMotion',
  compatModule: 'lib/godot-compat/input-event-mouse-motion',
  cases,
};

export default EVIDENCE;
