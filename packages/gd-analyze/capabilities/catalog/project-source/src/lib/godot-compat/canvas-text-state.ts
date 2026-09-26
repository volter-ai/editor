/** Shared retained Pixi Text → Godot ControlState plumbing; widget behavior stays elsewhere. */

import type { Text } from 'pixi.js';
import { createControlState, type ControlRecord, type ControlState } from './control-state';

export function retainedPixiTextControlState(
  node: Text,
  onWrite: (record: ControlRecord) => void = () => {},
): ControlState {
  const base = createControlState();
  base.write('control', { text: node.text });
  return {
    read: (id) => base.read(id),
    write: (id, patch: ControlRecord) => {
      base.write(id, patch);
      if (patch.text !== undefined && node.text !== patch.text) node.text = patch.text;
      onWrite(base.read(id));
    },
    register: (id, authored) => base.register(id, authored),
    authored: (id) => base.authored(id),
    seatControl: (id, control) => base.seatControl(id, control),
    control: (id) => base.control(id),
    childControls: (id) => base.childControls(id),
    focusOwner: () => base.focusOwner(),
    releaseFocus: (control) => base.releaseFocus(control),
    routePointer: (control, event) => base.routePointer(control, event),
    grabClickFocus: (control) => base.grabClickFocus(control),
    removeControl: (id, control) => base.removeControl(id, control),
    retain: (release) => base.retain(release),
    clear: () => base.clear(),
    snapshot: () => base.snapshot(),
  };
}
