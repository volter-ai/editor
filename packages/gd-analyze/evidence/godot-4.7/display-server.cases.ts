import * as DS from '../../capabilities/catalog/project-source/src/lib/godot-compat/display-server';
import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';

// The web display server's answer, measured against page windows with and without touch events.
const withWindow = (window: object | undefined): boolean => {
  const scope = globalThis as { window?: object };
  const previous = scope.window;
  if (window === undefined) delete scope.window;
  else scope.window = window;
  try {
    return DS.is_touchscreen_available();
  } finally {
    if (previous === undefined) delete scope.window;
    else scope.window = previous;
  }
};
const cases: GodotEvidenceCase[] = [
  {
    id: 'is_touchscreen_available-web',
    symbol: { kind: 'singleton-member', owner: 'DisplayServer', member: 'is_touchscreen_available' },
    gdscript: '',
    comparator: 'web-platform-fact',
    fact: {
      // No window, a page without touch events, a page with `ontouchstart`.
      value: 'false,false,true',
      source: { file: 'platform/web/js/libs/library_godot_display.js', symbol: 'godot_js_display_touchscreen_is_available', line: 556 },
    },
    target: () => [withWindow(undefined), withWindow({}), withWindow({ ontouchstart: null })].join(','),
  },
];

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'DisplayServer', compatModule: 'lib/godot-compat/display-server', cases };
export default EVIDENCE;
