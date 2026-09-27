import type { InputEventRecord } from '../../capabilities/catalog/project-source/src/lib/godot-compat/input-event';
import * as S from '../../capabilities/catalog/project-source/src/lib/godot-compat/input-event-screen-drag';
import * as V2 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { eventCase } from './input-event-family';

type Event = Extract<InputEventRecord, { type: 'screen_drag' }>;
const cases = [
  [0, 0, 0],
  [1, 320.5, 240.25],
  [9, -3, 1e6],
].flatMap(([index, x, y]) => {
  const event: Event = { type: 'screen_drag', index: index as number, position: V2.construct(x as number, y as number) };
  return [
    eventCase(`get_index-${String(index)}`, 'InputEventScreenDrag', 'get_index', event, (e) => S.get_index(e as Event)),
    eventCase(`get_position-${String(index)}`, 'InputEventScreenDrag', 'get_position', event, (e) => S.get_position(e as Event)),
  ];
});

const EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'InputEventScreenDrag',
  compatModule: 'lib/godot-compat/input-event-screen-drag',
  cases,
};

export default EVIDENCE;
