/**
 * The children of a node that places them itself (a SpringArm3D, `GodotSceneNodeIdiom.placesChildren`):
 * stated at its origin, their rotation and scale kept, as Godot places them there on its first
 * physics step (`SpringArm3D::process_spring`, `spring_arm_3d.cpp:133`); the node's component then
 * moves the group they hang in (`spring-arm-3d.ts`).
 */
import type { DirectGodotSceneDocumentPlan, DirectGodotSceneNodePlan } from './direct-project-composition-plan';

type SceneWithoutRefs = Omit<DirectGodotSceneDocumentPlan, 'refs'>;

/** A node's authored transform with no translation. */
function atOrigin(node: DirectGodotSceneNodePlan): DirectGodotSceneNodePlan {
  return {
    ...node,
    properties: node.properties.map((entry) => {
      if (entry.propertyName === 'position') return { ...entry, value: [0, 0, 0] };
      if (entry.propertyName === 'transform' && Array.isArray(entry.value) && entry.value.length === 16) {
        const matrix = [...(entry.value as readonly number[])];
        matrix[12] = 0;
        matrix[13] = 0;
        matrix[14] = 0;
        return { ...entry, value: matrix };
      }
      return entry;
    }),
  };
}

/** The scenes with the children of each node that places them itself stated at its origin. */
export function planGodotScenePlacedChildren(scenes: readonly SceneWithoutRefs[]): SceneWithoutRefs[] {
  return scenes.map((scene) => {
    const stamp = (node: DirectGodotSceneNodePlan): DirectGodotSceneNodePlan => {
      const placed = node.idiom?.placesChildren === true;
      return {
        ...node,
        children: node.children.map((child) => stamp(placed ? atOrigin(child) : child)),
        ...(node.placements === undefined ? {} : { placements: node.placements.map((entry) => ({ at: entry.at, node: stamp(entry.node) })) }),
      };
    };
    return { ...scene, root: stamp(scene.root) };
  });
}
