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

const numberValue = (setters: readonly TargetGodotSceneSetterPlan[], exportName: string): number | undefined => {
  const value = setters.find((entry) => entry.setter.exportName === exportName)?.value;
  return value?.kind === 'number' ? value.value : undefined;
};

/**
 * A primitive mesh's three geometry args (Godot's defaults where unauthored): a plane's size and,
 * when subdivided, its segments; a sphere's radius, radial segments and rows (`rings + 1`); a
 * cylinder's radii, height, radial segments and rows, and whether its top is open.
 */
function primitiveArgs(resource: TargetGodotSceneResourcePlan): TargetGodotSceneResourcePlan['primitive'] {
  const idiom = resource.idiom;
  const set = resource.setters;
  const num = (name: string, initial: number) => numberValue(set, name) ?? initial;
  switch (idiom?.kind) {
    case 'plane': {
      const value = set.find((entry) => entry.setter.exportName === 'set_size')?.value;
      const size = value !== undefined && 'components' in value ? value.components : idiom.size;
      const segments = [num('set_subdivide_width', 0) + 1, num('set_subdivide_depth', 0) + 1];
      return { args: segments.some((entry) => entry !== 1) ? [size[0] as number, size[1] as number, ...segments] : [size[0] as number, size[1] as number] };
    }
    case 'sphere':
      return { args: [num('set_radius', 0.5), num('set_radial_segments', 64), num('set_rings', 32) + 1] };
    case 'box': {
      const value = set.find((entry) => entry.setter.exportName === 'set_size')?.value;
      const size = value !== undefined && 'components' in value ? value.components : [1, 1, 1];
      return { args: [size[0] as number, size[1] as number, size[2] as number, num('set_subdivide_width', 0) + 1, num('set_subdivide_height', 0) + 1, num('set_subdivide_depth', 0) + 1] };
    }
    case 'cylinder': {
      const cap = set.find((entry) => entry.setter.exportName === 'set_cap_top')?.value;
      return {
        args: [num('set_top_radius', 0.5), num('set_bottom_radius', 0.5), num('set_height', 2), num('set_radial_segments', 64), num('set_rings', 4) + 1],
        ...(cap?.kind === 'bool' && !cap.value ? { open: true as const } : {}),
      };
    }
    default:
      return undefined;
  }
}

/**
 * A Camera3D's lens (`camera_3d.h:68`, three's defaults differ, so every value is stated): its
 * vertical angle, near and far, its cull mask (Godot's default all 20 layers, `camera_3d.h:83`), and
 * its own environment.
 */
function cameraLens(node: DirectGodotSceneNodePlan): NonNullable<DirectGodotSceneNodePlan['lens']> {
  const property = (name: string, initial: number) => node.properties.find((entry) => entry.propertyName === name)?.value[0] ?? initial;
  const environment = node.setters.find((entry) => entry.setter.exportName === 'set_environment')?.value;
  return {
    fov: Number(property('fov', 75)),
    near: Number(property('near', 0.05)),
    far: Number(property('far', 4000)),
    cullMask: numberValue(node.setters, 'set_cull_mask') ?? 0xfffff,
    ...(environment === undefined ? {} : { environment }),
    // An orthogonal or frustum projection and its size (`camera_3d.h:71`, perspective and 1 by default).
    ...(numberValue(node.setters, 'set_projection') === undefined ? {} : { projection: numberValue(node.setters, 'set_projection') as number }),
    ...(numberValue(node.setters, 'set_size') === undefined ? {} : { size: numberValue(node.setters, 'set_size') as number }),
  };
}

/** The setters a scene may state on a model's AnimationPlayer that plays the glTF's clips (`animation-clips.ts`). */
const CLIP_PLAYER_SETTERS: ReadonlySet<string> = new Set(['set_default_blend_time', 'set_deterministic']);

/** The scenes with each mesh resource's `surfaceMaterials` and each MeshInstance3D's `surfaces`. */
export function planGodotSceneSurfaces(scenes: readonly SceneWithoutRefs[]): SceneWithoutRefs[] {
  return scenes.map((scene) => {
    // A model's AnimationPlayer plays the glTF's own clips when the scene adds no library or
    // animation to it (an AnimationTree over it drives the clips, `animation-tree.ts`).
    const resources = scene.resources.map((resource) => {
      const primitive = primitiveArgs(resource);
      return { ...resource, surfaceMaterials: surfaceMaterials(resource), ...(primitive === undefined ? {} : { primitive }) };
    });
    const byKey = new Map(resources.map((resource) => [resource.key, resource] as const));
    const stamp = (node: DirectGodotSceneNodePlan): DirectGodotSceneNodePlan => {
      const children = node.children.map(stamp);
      const placements = node.placements?.map((placed) => ({ at: placed.at, node: stamp(placed.node) }));
      let surfaces: DirectGodotSceneNodePlan['surfaces'];
      if (node.idiom?.form.kind === 'mesh') {
        const mesh = resourceKey(node.setters, 'set_mesh');
        const own = mesh === undefined ? [] : (byKey.get(mesh)?.surfaceMaterials ?? []);
        // `material_override` draws every surface, before a surface's own override
        // (`GeometryInstance3D`, `visual_instance_3d.cpp:218`; `mesh_instance_3d.cpp:423`).
        const override = resourceKey(node.setters, 'set_material_override');
        surfaces = {
          ...(mesh === undefined ? {} : { mesh }),
          materials: own.map((material, surface) => override ?? resourceKey(node.setters, 'set_surface_override_material', surface) ?? material),
          layers: numberValue(node.setters, 'set_layer_mask') ?? 1,
          // Any setting but `SHADOW_CASTING_SETTING_OFF` casts (`geometry-instance-3d.ts`).
          castShadow: (numberValue(node.setters, 'set_cast_shadows_setting') ?? 1) !== 0,
        };
      }
      const lens = node.idiom?.form.kind === 'camera' ? cameraLens(node) : undefined;
      const model = node.model;
      const clipPlayers =
        model === undefined || model.animations === undefined
          ? []
          : model.nodes
              .filter((entry) => entry.animationPlayer === true)
              .map((entry) => entry.path)
              // (An override's `animation` is its own tracks' bindings, which the clips do not need; a
              // library the scene adds is a setter.)
              .filter((path) => !model.overrides.some((override) => override.at === path && override.setters.some((entry) => !CLIP_PLAYER_SETTERS.has(entry.setter.exportName))));
      // A camera, light or reflection probe draws with its scale removed (`disable_scale`,
      // node_3d.cpp:655): with no children and no script to read it back, its authored scale (the
      // rounding a `.tscn` rotation carries) changes nothing, and its element states none.
      const scaleless = node.idiom?.scaleless === true && node.children.length === 0 && node.scriptInstance === undefined;
      return {
        ...node,
        ...(surfaces === undefined ? {} : { surfaces }),
        ...(lens === undefined ? {} : { lens }),
        ...(scaleless ? { scaleless: true as const } : {}),
        ...(model !== undefined && clipPlayers.length > 0 ? { model: { ...model, clipPlayers } } : {}),
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
  ['add_theme_font_size_override', 'theme'],
  ['add_theme_font_override', 'theme'],
  ['add_theme_color_override', 'theme'],
  ['add_theme_constant_override', 'theme'],
  ['add_theme_stylebox_override', 'theme'],
  ['add_theme_icon_override', 'theme'],
]);

/**
 * The setters an element states apart from its own props, by the part they play: a Node3D's
 * `visible` (three's own prop), a GeometryInstance3D's `transparency` and GI mode (its `userData`), a
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
  // A GeometryInstance3D's GI mode, which lights nothing on the page (`geometry-instance-3d.ts`).
  ['set_gi_mode', { kind: 'data', key: 'gi_mode' }],
  // A light's shadow drawn with back faces, which three's shadow map chooses by material side.
  ['set_shadow_reverse_cull_face', { kind: 'data', key: 'shadow_reverse_cull_face' }],
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
