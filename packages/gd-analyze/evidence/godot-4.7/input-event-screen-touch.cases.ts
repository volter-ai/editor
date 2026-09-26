import type { InputEventRecord } from '../../capabilities/catalog/project-source/src/lib/godot-compat/input-event';
import * as S from '../../capabilities/catalog/project-source/src/lib/godot-compat/input-event-screen-touch';
import * as V2 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { eventCase } from './input-event-family';

type Event = Extract<InputEventRecord, { type: 'screen_touch' }>;
const cases = [
  [0, 0, 0],
  [1, 320.5, 240.25],
  [9, -3, 1e6],
].flatMap(([index, x, y]) => {
  const event: Event = { type: 'screen_touch', index: index as number, position: V2.construct(x as number, y as number), pressed: true };
  return [
    eventCase(`get_index-${String(index)}`, 'InputEventScreenTouch', 'get_index', event, (e) => S.get_index(e as Event)),
    eventCase(`get_position-${String(index)}`, 'InputEventScreenTouch', 'get_position', event, (e) => S.get_position(e as Event)),
  ];
});

const EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'InputEventScreenTouch',
  compatModule: 'lib/godot-compat/input-event-screen-touch',
  cases,
};

export default EVIDENCE;
