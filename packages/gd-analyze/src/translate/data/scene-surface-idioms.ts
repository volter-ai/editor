/**
 * What each mesh surface draws, planned: a mesh resource's own material per surface (an
 * `ArrayMesh`'s surfaces' materials, a primitive mesh's one `material`), and a MeshInstance3D's mesh
 * with, per surface, its override, else the mesh's own (`MeshInstance3D::get_active_material`,
 * mesh_instance_3d.cpp:423). The composition stamps them (`surfaceMaterials` on a mesh resource,
 * `surfaces` on a MeshInstance3D) and emit reads the stamps.
 */

import type { DirectGodotSceneDocumentPlan, DirectGodotSceneNodePlan } from './direct-project-composition-plan';
import type { TargetGodotSceneResourcePlan, TargetGodotSceneSetterPlan } from './scene-document-plan';

type SceneWithoutRefs = Omit<DirectGodotSceneDocumentPlan, 'refs'>;

/** The resource a setter passes, by its key. */
const resourceKey = (setters: readonly TargetGodotSceneSetterPlan[], exportName: string, index?: number): string | undefined => {
  const value = setters.find((entry) => entry.setter.exportName === exportName && (index === undefined || Number(entry.index) === index))?.value;
  return value?.kind === 'resource' ? value.key : undefined;
};

/**
 * A resource's own material per surface as a mesh draws it: an `ArrayMesh`'s surfaces' materials,
 * any other resource's one `material` (a primitive or loaded mesh's; nothing for a resource that is
 * not a mesh, which no mesh setter passes).
 */
function surfaceMaterials(resource: TargetGodotSceneResourcePlan): readonly (string | undefined)[] {
  if (resource.mesh !== undefined) return resource.mesh.surfaces.map((surface) => surface.material);
  return [resourceKey(resource.setters, 'set_material')];
}

/** The scenes with each mesh resource's `surfaceMaterials` and each MeshInstance3D's `surfaces`. */
export function planGodotSceneSurfaces(scenes: readonly SceneWithoutRefs[]): SceneWithoutRefs[] {
  return scenes.map((scene) => {
    const resources = scene.resources.map((resource) => ({ ...resource, surfaceMaterials: surfaceMaterials(resource) }));
    const byKey = new Map(resources.map((resource) => [resource.key, resource] as const));
    const stamp = (node: DirectGodotSceneNodePlan): DirectGodotSceneNodePlan => {
      const children = node.children.map(stamp);
      const placements = node.placements?.map((placed) => ({ at: placed.at, node: stamp(placed.node) }));
      let surfaces: DirectGodotSceneNodePlan['surfaces'];
      if (node.idiom?.form.kind === 'mesh') {
        const mesh = resourceKey(node.setters, 'set_mesh');
        const own = mesh === undefined ? [] : (byKey.get(mesh)?.surfaceMaterials ?? []);
        surfaces = {
          ...(mesh === undefined ? {} : { mesh }),
          materials: own.map((material, surface) => resourceKey(node.setters, 'set_surface_override_material', surface) ?? material),
        };
      }
      return {
        ...node,
        ...(surfaces === undefined ? {} : { surfaces }),
        children,
        ...(placements === undefined ? {} : { placements }),
      };
    };
    return { ...scene, resources, root: stamp(scene.root) };
  });
}
