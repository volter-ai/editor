import type { InputEventRecord } from '../../capabilities/catalog/project-source/src/lib/godot-compat/input-event';
import * as M from '../../capabilities/catalog/project-source/src/lib/godot-compat/input-event-mouse';
import * as V2 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { eventCase } from './input-event-family';

type Mouse = Extract<InputEventRecord, { type: 'mouse_button' | 'mouse_motion' }>;
const cases = [
  [0, 0],
  [640.5, 360.25],
  [-12, 1e6],
  [0.1, 16777217],
].flatMap(([x, y]) => {
  const position = V2.construct(x as number, y as number);
  const events: Mouse[] = [
    { type: 'mouse_button', button_index: 1, pressed: true, position },
    { type: 'mouse_motion', position },
  ];
  return events.map((event) =>
    eventCase(`get_position-${event.type}-${String(x)}-${String(y)}`, 'InputEventMouse', 'get_position', event, (e) => M.get_position(e as Mouse)),
  );
});

const INPUT_EVENT_MOUSE_EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'InputEventMouse',
  compatModule: 'lib/godot-compat/input-event-mouse',
  cases,
};

export default INPUT_EVENT_MOUSE_EVIDENCE;
