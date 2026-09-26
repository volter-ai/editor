import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { SIZES, TEXTS } from './text-samples';
import { int, type Op, type Pair, uiCase } from './ui-tree';

const cases: GodotEvidenceCase[] = [];
const add = (id: string, member: string, ops: readonly Op[]): void => {
  const built = uiCase([64, 64] as Pair, [{ ops: [{ font: 'f' }, ...ops] }]);
  cases.push({ id, symbol: { kind: 'native-member', owner: 'Font', member }, gdscript: built.gdscript, target: built.target, comparator: 'exact' });
};
for (const member of ['get_ascent', 'get_descent', 'get_height']) {
  add(`${member}-sizes`, member, SIZES.map((size): Op => ({ read: member, on: 'f', args: [int(size)] })));
}
add(
  'get_string_size-texts',
  'get_string_size',
  SIZES.flatMap((size) => TEXTS.map((text): Op => ({ read: 'get_string_size', on: 'f', args: [text, int(0), -1, int(size)] }))),
);

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'Font', compatModule: 'lib/godot-compat/font', cases };
export default EVIDENCE;
