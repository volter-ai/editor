import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { type Pair, uiCase, v2 } from './ui-tree';

const built = uiCase([64, 64] as Pair, [
  {
    ops: [
      { placeholder: 't' },
      { read: 'get_size', on: 't' },
      { call: 'set_size', on: 't', args: [v2(-3.5, 7.99)] },
      { read: 'get_size', on: 't' },
      { call: 'set_size', on: 't', args: [v2(1e6, 0.5)] },
      { read: 'get_size', on: 't' },
    ],
  },
]);
const cases: GodotEvidenceCase[] = [
  { id: 'set_size', symbol: { kind: 'native-member', owner: 'PlaceholderTexture2D', member: 'set_size' }, gdscript: built.gdscript, target: built.target, comparator: 'exact' },
];

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'PlaceholderTexture2D', compatModule: 'lib/godot-compat/placeholder-texture-2d', cases };
export default EVIDENCE;
