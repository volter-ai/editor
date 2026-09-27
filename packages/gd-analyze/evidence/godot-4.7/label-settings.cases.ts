import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { color, int, type Op, type Pair, type Value, uiCase, v2 } from './ui-tree';

const FIELDS: readonly (readonly [string, Value])[] = [
  ['line_spacing', 7.3],
  ['paragraph_spacing', -2.5],
  ['font_size', int(31)],
  ['font_color', color(0.2, 0.4, 0.6, 0.8)],
  ['outline_size', int(4)],
  ['outline_color', color(0, 0, 0, 1)],
  ['shadow_size', int(3)],
  ['shadow_color', color(1, 0, 0, 0.5)],
  ['shadow_offset', v2(2.5, -1)],
];
const built = uiCase([64, 64] as Pair, [
  {
    ops: [
      { settings: 's' },
      ...FIELDS.map(([field]): Op => ({ read: `get_${field}`, on: 's' })),
      ...FIELDS.map(([field, value]): Op => ({ call: `set_${field}`, on: 's', args: [value] })),
      ...FIELDS.map(([field]): Op => ({ read: `get_${field}`, on: 's' })),
    ],
  },
]);
const cases: GodotEvidenceCase[] = FIELDS.flatMap(([field]) =>
  ['set', 'get'].map((verb): GodotEvidenceCase => ({
    id: `${verb}_${field}`,
    symbol: { kind: 'native-member', owner: 'LabelSettings', member: `${verb}_${field}` },
    gdscript: built.gdscript,
    target: built.target,
    comparator: 'exact',
  })),
);

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'LabelSettings', compatModule: 'lib/godot-compat/label-settings', cases };
export default EVIDENCE;
