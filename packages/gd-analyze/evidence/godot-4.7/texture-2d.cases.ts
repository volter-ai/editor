import * as PT from '../../capabilities/catalog/project-source/src/lib/godot-compat/placeholder-texture-2d';
import * as T2D from '../../capabilities/catalog/project-source/src/lib/godot-compat/texture-2d';
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

// A texture without an image (`PlaceholderTexture2D` keeps none, `placeholder_textures.cpp`).
cases.push({
  id: 'get_image-placeholder',
  symbol: { kind: 'native-member', owner: 'Texture2D', member: 'get_image' },
  gdscript: 'return PlaceholderTexture2D.new().get_image() == null',
  target: () => T2D.get_image(PT.godot_placeholder_texture_2d_new()) === null,
  comparator: 'exact',
});

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'Texture2D', compatModule: 'lib/godot-compat/texture-2d', cases };
export default EVIDENCE;
