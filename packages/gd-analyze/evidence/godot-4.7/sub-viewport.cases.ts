import { Scene } from 'three';
import * as SV from '../../capabilities/catalog/project-source/src/lib/godot-compat/sub-viewport';
import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';

const cases: GodotEvidenceCase[] = [];
const symbol = (member: string) => ({ kind: 'native-member' as const, owner: 'SubViewport', member });

cases.push({
  id: 'get_size-default',
  symbol: symbol('get_size'),
  gdscript: 'var vp := SubViewport.new()\nholder.add_child(vp)\nreturn vp.get_size()',
  target: () => SV.get_size(new Scene()),
  comparator: 'exact',
});
for (const [x, y] of [
  [640, 480],
  [1, 1],
  [1920, 1080],
  [333, 777],
  [0, 5],
  [-3, 2],
  [2, -100],
] as const) {
  cases.push({
    id: `set_size-${String(x)}x${String(y)}`,
    symbol: symbol('set_size'),
    gdscript: `var vp := SubViewport.new()\nholder.add_child(vp)\nvp.set_size(Vector2i(${String(x)}, ${String(y)}))\nreturn vp.get_size()`,
    target: () => {
      const viewport = new Scene();
      SV.set_size(viewport, { x, y });
      return SV.get_size(viewport);
    },
    comparator: 'exact',
  });
}

const SUB_VIEWPORT_EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'SubViewport',
  compatModule: 'lib/godot-compat/sub-viewport',
  cases,
};

export default SUB_VIEWPORT_EVIDENCE;
