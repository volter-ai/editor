/** A Godot Skeleton3D patch reaches every matching glTF skin without double-posing shared bones. */
import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { applyGodotModelBonePoses } from '../../editor/catalog/project-source/src/lib/godot-compat/gltf-model';

function skin(root: Object3D, bones: Object3D[]): void {
  const wrapper = new Object3D() as Object3D & {
    isSkinnedMesh: boolean;
    skeleton: { bones: Object3D[] };
  };
  wrapper.isSkinnedMesh = true;
  wrapper.skeleton = { bones };
  root.add(wrapper);
}

describe('Godot model bone poses over glTF skin wrappers', () => {
  it('poses every matching live skeleton and writes shared Bone identities once', () => {
    const root = new Object3D();
    const shared = new Object3D();
    const distinct = new Object3D();
    shared.name = 'MASTER';
    distinct.name = 'MASTER';
    skin(root, [shared]);
    skin(root, [shared]);
    skin(root, [distinct]);

    applyGodotModelBonePoses(root, ['MASTER'], [{ index: 0, position: [1, 0, 0] }]);

    expect(shared.position.x).toBe(1);
    expect(distinct.position.x).toBe(1);
  });

  it('refuses when no skin has the authored ordered bone names', () => {
    const root = new Object3D();
    const wrong = new Object3D();
    wrong.name = 'body';
    skin(root, [wrong]);

    expect(() => applyGodotModelBonePoses(root, ['MASTER'], [])).toThrow(
      /expected at least one model skeleton \[MASTER\], found 0 among 1 skin wrapper/,
    );
  });
});
