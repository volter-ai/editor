/**
 * Two plan passes over the composed scenes, each a stamp emit reads instead of a setter's name:
 * which setters an element or resource collects into one prop (`planGodotSceneCollectedSetters`),
 * and what each mesh surface draws (`planGodotSceneSurfaces`).
 *
 * What each mesh surface draws, planned: a mesh resource's own material per surface (an
 * `ArrayMesh`'s surfaces' materials, a primitive mesh's one `material`), and a MeshInstance3D's mesh
 * with, per surface, its override, else the mesh's own (`MeshInstance3D::get_active_material`,
 * mesh_instance_3d.cpp:423). The composition stamps them (`surfaceMaterials` on a mesh resource,
 * `surfaces` on a MeshInstance3D) and emit reads the stamps.
 */

import type { DirectGodotSceneDocumentPlan, DirectGodotSceneNodePlan } from './direct-project-composition-plan';
import { godotSceneSubnodes, type TargetGodotSceneResourcePlan, type TargetGodotSceneSetterPlan } from './scene-document-plan';

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

/**
 * The setters an element or resource collects into one prop, by the prop they join: a mixer's
 * libraries (`libraries/NAME`, `AnimationMixer::_set`), an AnimationTree's parameters
 * (`parameters/<path>`), an Object's metadata (`metadata/NAME`, `Object::_set`), and a
 * ShaderMaterial's shader and its parameters (`shader_parameter/NAME`).
 */
const COLLECTED: ReadonlyMap<string, NonNullable<TargetGodotSceneSetterPlan['collect']>> = new Map([
  ['godot_animation_mixer_set_library', 'libraries'],
  ['godot_animation_tree_set', 'parameters'],
  ['set_meta', 'meta'],
  ['set_shader', 'shader'],
  ['set_shader_parameter', 'shader-parameter'],
]);

/**
 * The setters an element states apart from its own props, by the part they play: a Node3D's
 * `visible` (three's own prop) and a GeometryInstance3D's `transparency` (its `userData`), a
 * GeometryInstance3D's visibility range (`GodotVisibilityRange`'s props), a Camera3D's `current`.
 */
const ROLES: ReadonlyMap<string, TargetGodotSceneSetterPlan['role']> = new Map<string, TargetGodotSceneSetterPlan['role']>([
  ['set_visible', { kind: 'visible' }],
  ['set_transparency', { kind: 'transparency' }],
  ['set_visibility_range_begin', { kind: 'visibility-range', prop: 'begin' }],
  ['set_visibility_range_begin_margin', { kind: 'visibility-range', prop: 'beginMargin' }],
  ['set_visibility_range_end', { kind: 'visibility-range', prop: 'end' }],
  ['set_visibility_range_end_margin', { kind: 'visibility-range', prop: 'endMargin' }],
  ['set_visibility_range_fade_mode', { kind: 'visibility-range', prop: 'fadeMode' }],
  ['set_current', { kind: 'current' }],
]);

const collected = (setters: readonly TargetGodotSceneSetterPlan[]): readonly TargetGodotSceneSetterPlan[] =>
  setters.map((entry) => {
    const collect = COLLECTED.get(entry.setter.exportName);
    const role = ROLES.get(entry.setter.exportName);
    return collect === undefined && role === undefined ? entry : { ...entry, ...(collect === undefined ? {} : { collect }), ...(role === undefined ? {} : { role }) };
  });

/** The first Camera3D the scene holds, in tree order, and the one authored current. */
function sceneCameras(root: DirectGodotSceneNodePlan): { readonly first?: string; readonly authored?: string } {
  let first: string | undefined;
  let authored: string | undefined;
  const walk = (entry: DirectGodotSceneNodePlan) => {
    if (entry.idiom?.form.kind === 'camera') {
      first ??= entry.nodePath;
      const current = entry.setters.find((setter) => setter.role?.kind === 'current')?.value;
      if (current?.kind === 'bool' && current.value) authored ??= entry.nodePath;
    }
    for (const child of godotSceneSubnodes(entry)) walk(child);
  };
  walk(root);
  return { ...(first === undefined ? {} : { first }), ...(authored === undefined ? {} : { authored }) };
}

/** The scenes with each collected setter (`COLLECTED`) stamped with the prop it joins. */
export function planGodotSceneCollectedSetters(scenes: readonly SceneWithoutRefs[]): SceneWithoutRefs[] {
  return scenes.map((scene) => {
    const stamp = (node: DirectGodotSceneNodePlan): DirectGodotSceneNodePlan => ({
      ...node,
      setters: collected(node.setters),
      // An imported model's own nodes' overrides (an AnimationPlayer of the model's libraries).
      ...(node.model === undefined ? {} : { model: { ...node.model, overrides: node.model.overrides.map((override) => ({ ...override, setters: collected(override.setters) })) } }),
      children: node.children.map(stamp),
      ...(node.placements === undefined ? {} : { placements: node.placements.map((placed) => ({ at: placed.at, node: stamp(placed.node) })) }),
    });
    const root = stamp(scene.root);
    return { ...scene, resources: scene.resources.map((resource) => ({ ...resource, setters: collected(resource.setters) })), root, cameras: sceneCameras(root) };
  });
}
