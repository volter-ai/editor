import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { type Pair, uiCase, v2 } from './ui-tree';

const cases: GodotEvidenceCase[] = [];
for (const member of ['get_width', 'get_height', 'get_size']) {
  const built = uiCase(
    [64, 64] as Pair,
    [0.4, 1, 120.9, 2048.5].map((size) => ({
      ops: [
        { placeholder: `t${String(size).replace('.', '_')}` },
        { call: 'set_size', on: `t${String(size).replace('.', '_')}`, args: [v2(size, size / 2)] },
        { read: member, on: `t${String(size).replace('.', '_')}` },
      ],
    })),
  );
  cases.push({ id: `${member}-placeholder`, symbol: { kind: 'native-member', owner: 'Texture2D', member }, gdscript: built.gdscript, target: built.target, comparator: 'exact' });
}

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'Texture2D', compatModule: 'lib/godot-compat/texture-2d', cases };
export default EVIDENCE;
