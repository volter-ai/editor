import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/color';
import * as P from '../../capabilities/catalog/project-source/src/lib/godot-compat/project-settings';
import * as V2 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import * as V3 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import { projectSettingValue } from '../../src/analyze/project-setting-types';
import type { GodotEvidenceCase, GodotEvidenceCaseFile, GodotEvidenceSymbol } from '../../src/evidence/case';
import type { GodotValue } from '../../src/read/godot-value';
import {
  type DirectGodotSettingValue,
  directGodotSettingValue,
} from '../../src/translate/data/direct-project-composition-plan';

/**
 * `ProjectSettings.get_setting` on the instrument's probe project, against the settings the
 * composition loads for the same keys: the value project facts fix (`projectSettingValue`), as the
 * compat value the world module builds for it (`directGodotSettingValue`).
 */

const SYMBOL: GodotEvidenceSymbol = { kind: 'singleton-member', owner: 'ProjectSettings', member: 'get_setting' };
/** What the probe project's `project.godot` authors (`run-evidence.ts` PROJECT_SOURCE). */
const AUTHORED = new Map<string, GodotValue>([
  ['application/config/name', { kind: 'string', value: 'gd-analyze evidence' }],
]);
const KEYS = [
  'physics/3d/default_gravity',
  'physics/3d/default_gravity_vector',
  'physics/2d/default_gravity',
  'physics/2d/default_gravity_vector',
  'display/window/size/viewport_width',
  'application/run/disable_stdout',
  'rendering/environment/defaults/default_clear_color',
  'application/config/name',
  'physics/common/physics_ticks_per_second',
] as const;

/** The compat value the world module's settings load builds for a planned value. */
function compatValue(value: DirectGodotSettingValue): unknown {
  switch (value.kind) {
    case 'number':
    case 'bool':
    case 'string':
      return value.value;
    case 'Vector2':
      return V2.construct(value.components[0] as number, value.components[1] as number);
    case 'Vector3':
      return V3.construct(value.components[0] as number, value.components[1] as number, value.components[2] as number);
    case 'Color':
      return C.construct(...(value.components as [number, number, number, number]));
  }
}

function loadPlanned(): void {
  P.godot_project_settings_load(
    KEYS.map((key) => {
      const fixed = projectSettingValue(AUTHORED, key);
      const planned = fixed === undefined ? undefined : directGodotSettingValue(fixed);
      if (planned === undefined) throw new Error(`${key} has no planned value`);
      return [key, compatValue(planned)] as const;
    }),
  );
}

const cases: GodotEvidenceCase[] = KEYS.map((key) => ({
  id: `get_setting-${key.replaceAll('/', '-')}`,
  symbol: SYMBOL,
  gdscript: `ProjectSettings.get_setting(${JSON.stringify(key)})`,
  target: () => {
    loadPlanned();
    return P.get_setting(key);
  },
  comparator: 'exact',
}));
cases.push({
  id: 'get_setting-absent-default',
  symbol: SYMBOL,
  gdscript: 'ProjectSettings.get_setting("game/absent", 5.5)',
  target: () => {
    loadPlanned();
    return P.get_setting('game/absent', 5.5);
  },
  comparator: 'exact',
});

const PROJECT_SETTINGS_EVIDENCE: GodotEvidenceCaseFile = {
  godotClass: 'ProjectSettings',
  compatModule: 'lib/godot-compat/project-settings',
  cases,
};

export default PROJECT_SETTINGS_EVIDENCE;
