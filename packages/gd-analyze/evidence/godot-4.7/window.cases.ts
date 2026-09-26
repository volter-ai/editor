import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { inputCase } from './input-tree';

// The root window's size as the environment gives it (the headless binary's 64x64; the target's
// host sets it the same way).
const built = inputCase([{ rootSize: null }]);
const cases: GodotEvidenceCase[] = ['get_size'].map((member) => ({
  id: `${member}-root`,
  symbol: { kind: 'native-member', owner: 'Window', member },
  gdscript: built.gdscript,
  target: built.target,
  comparator: 'exact',
}));

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'Window', compatModule: 'lib/godot-compat/window', cases };
export default EVIDENCE;
