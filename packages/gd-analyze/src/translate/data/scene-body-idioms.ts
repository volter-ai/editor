/**
 * A node's Godot-only state and a physics body's `<RigidBody>` props, planned: the plan decides
 * them from the node's setters and the scene's resources, and emit prints them. The composition
 * stamps every node with its `data` (`userData`), each body with its props (`body`), and each
 * instance of a scene rooted in a body with the props its overrides change (`bodyOverrides`).
 *
 * A body's props are Rapier's for what Rapier consumes (friction and bounce with Godot's combine
 * rules, gravity scale, damping, axis locks, `lock_rotation`) and `userData` for the rest by Godot
 * name, which compat reads back.
 */

import type { DirectGodotCompositionDiagnostic, DirectGodotSceneDocumentPlan, DirectGodotSceneNodePlan } from './direct-project-composition-plan';
import { godotSceneRootClass, godotSceneRootIdiom } from './scene-document-plan';
import type { TargetGodotSceneResourcePlan, TargetGodotSceneSetterPlan, TargetGodotSceneValue } from './scene-document-plan';

/** A planned `<RigidBody>` prop's value: a literal, a plain value, or Rapier's combine rule. */
export type GodotSceneBodyPropValue =
  | { readonly kind: 'literal'; readonly value: number | boolean }
  | { readonly kind: 'data'; readonly value: unknown }
  | { readonly kind: 'combine-rule'; readonly rule: 'Min' | 'Max' };

export interface GodotSceneBodyProp {
  readonly name: string;
  readonly value: GodotSceneBodyPropValue;
}

type SceneWithoutRefs = Omit<DirectGodotSceneDocumentPlan, 'refs'>;

const setterValue = (setters: readonly TargetGodotSceneSetterPlan[], exportName: string): TargetGodotSceneValue | undefined =>
  setters.find((entry) => entry.setter.exportName === exportName)?.value;

function plainValue(value: TargetGodotSceneValue): unknown {
  if (value.kind === 'number' || value.kind === 'bool') return value.value;
  if ('components' in value) return [...value.components];
  if (value.kind === 'resource') return value.key;
  throw new Error(`a ${value.kind} value has no idiomatic form`);
}

/**
 * A node's Godot-only state the Node protocol seeds from its `userData`: groups and `%Name`; a
 * MeshInstance3D's `skeleton` path, which draws nothing on the unskinned meshes a scene carries
 * (`MeshInstance3D::_resolve_skeleton_path`, mesh_instance_3d.cpp:184; skinned surfaces refuse); a
 * GeometryInstance3D's `transparency`, which the web's renderer never draws, and its shadow
 * casting setting, which three's `castShadow` holds only as on or off.
 */
function nodeData(node: DirectGodotSceneNodePlan): Record<string, unknown> {
  const skeleton = setterValue(node.setters, 'set_skeleton_path');
  const transparency = setterValue(node.setters, 'set_transparency');
  const castShadow = setterValue(node.setters, 'set_cast_shadows_setting');
  return {
    ...(node.groups.length === 0 ? {} : { groups: [...node.groups] }),
    ...(node.unique === true ? { unique_name_in_owner: true } : {}),
    ...(skeleton?.kind === 'string' ? { skeleton_path: skeleton.value } : {}),
    ...(transparency?.kind === 'number' ? { transparency: transparency.value } : {}),
    ...(node.siblingIndex === undefined ? {} : { index: node.siblingIndex }),
    ...(castShadow?.kind === 'number' ? { cast_shadow: castShadow.value } : {}),
  };
}

/** A PhysicsMaterial resource's properties by their Godot names. */
function materialData(resource: TargetGodotSceneResourcePlan): Record<string, unknown> {
  const names: Readonly<Record<string, string>> = { set_friction: 'friction', set_bounce: 'bounce', set_rough: 'rough', set_absorbent: 'absorbent' };
  return Object.fromEntries(resource.setters.map((entry) => [names[entry.setter.exportName] ?? entry.propertyName, plainValue(entry.value)]));
}

/** The Godot-only properties a body holds, by their Godot names (its `userData`). */
const BODY_DATA: Readonly<Record<string, string>> = {
  set_collision_layer: 'collision_layer',
  set_collision_mask: 'collision_mask',
  set_ray_pickable: 'input_ray_pickable',
  set_mass: 'mass',
  set_linear_damp_mode: 'linear_damp_mode',
  set_angular_damp_mode: 'angular_damp_mode',
  set_lock_rotation_enabled: 'lock_rotation',
  set_use_custom_integrator: 'custom_integrator',
  set_contact_monitor: 'contact_monitor',
  set_max_contacts_reported: 'max_contacts_reported',
  set_velocity: 'velocity',
  set_safe_margin: 'safe_margin',
  set_floor_stop_on_slope_enabled: 'floor_stop_on_slope',
  set_floor_constant_speed_enabled: 'floor_constant_speed',
  set_floor_block_on_wall_enabled: 'floor_block_on_wall',
  set_slide_on_ceiling_enabled: 'slide_on_ceiling',
  set_motion_mode: 'motion_mode',
  set_max_slides: 'max_slides',
  set_floor_max_angle: 'floor_max_angle',
  set_floor_snap_length: 'floor_snap_length',
  set_wall_min_slide_angle: 'wall_min_slide_angle',
  set_up_direction: 'up_direction',
  set_monitoring: 'monitoring',
};

/** Rapier's own value of each `<RigidBody>` prop a body states only when Godot's differs. */
const RAPIER_BODY_DEFAULTS: Readonly<Record<string, GodotSceneBodyPropValue>> = {
  gravityScale: { kind: 'literal', value: 1 },
  linearDamping: { kind: 'literal', value: 0 },
  angularDamping: { kind: 'literal', value: 0 },
  ccd: { kind: 'literal', value: false },
  enabledTranslations: { kind: 'data', value: [true, true, true] },
  enabledRotations: { kind: 'data', value: [true, true, true] },
  lockRotations: { kind: 'literal', value: false },
  userData: { kind: 'data', value: {} },
};

const literal = (value: number | boolean): GodotSceneBodyPropValue => ({ kind: 'literal', value });

/** The Godot-only settings of a body's collision shapes, by collider name. */
function shapeData(node: DirectGodotSceneNodePlan, resources: ReadonlyMap<string, TargetGodotSceneResourcePlan>): Record<string, Record<string, unknown>> {
  const shapes: Record<string, Record<string, unknown>> = {};
  for (const child of node.children) {
    if (child.idiom?.form.kind !== 'collider') continue;
    const entry: Record<string, unknown> = {};
    const disabled = setterValue(child.setters, 'set_disabled');
    if (disabled?.kind === 'bool' && disabled.value) entry['disabled'] = true;
    const shapeValue = setterValue(child.setters, 'set_shape');
    const shape = shapeValue?.kind === 'resource' ? resources.get(shapeValue.key) : undefined;
    const backface = shape === undefined ? undefined : setterValue(shape.setters, 'set_backface_collision_enabled');
    if (backface?.kind === 'bool') entry['backface_collision'] = backface.value;
    if (Object.keys(entry).length > 0) shapes[child.name] = entry;
  }
  return shapes;
}

/**
 * A body's `<RigidBody>` props from its class and setters (with `resources` for its material),
 * `shapes` its collision shapes' Godot-only settings and `node` its node data.
 */
function bodyProps(
  refuse: (message: string) => void,
  className: string,
  sensor: boolean,
  setters: readonly TargetGodotSceneSetterPlan[],
  resources: ReadonlyMap<string, TargetGodotSceneResourcePlan>,
  shapes: Readonly<Record<string, Record<string, unknown>>>,
  node: Readonly<Record<string, unknown>>,
): Map<string, GodotSceneBodyPropValue> {
  const props = new Map<string, GodotSceneBodyPropValue>();
  const data: Record<string, unknown> = { ...node };
  const locks = { linear: [true, true, true], angular: [true, true, true] };
  let material: TargetGodotSceneResourcePlan | undefined;
  for (const entry of setters) {
    const name = entry.setter.exportName;
    if (name === 'set_axis_lock') {
      const axis = [1, 2, 4, 8, 16, 32].indexOf(entry.index as number);
      if (entry.value.kind === 'bool' && entry.value.value) (axis < 3 ? locks.linear : locks.angular)[axis % 3] = false;
    } else if (name === 'set_gravity_scale') props.set('gravityScale', literal(plainValue(entry.value) as number));
    else if (name === 'set_linear_damp') props.set('linearDamping', literal(plainValue(entry.value) as number));
    else if (name === 'set_angular_damp') props.set('angularDamping', literal(plainValue(entry.value) as number));
    else if (name === 'set_use_continuous_collision_detection') props.set('ccd', literal(plainValue(entry.value) as boolean));
    else if (name === 'set_physics_material_override') {
      material = entry.value.kind === 'resource' ? resources.get(entry.value.key) : undefined;
      if (material !== undefined) data['physics_material_override'] = materialData(material);
    } else {
      const key = BODY_DATA[name];
      if (key === undefined) refuse(`${className}.${entry.propertyName} has no idiomatic form`);
      else data[key] = plainValue(entry.value);
    }
  }
  if (locks.linear.includes(false)) props.set('enabledTranslations', { kind: 'data', value: locks.linear });
  if (locks.angular.includes(false)) props.set('enabledRotations', { kind: 'data', value: locks.angular });
  // Rapier merges its locks, so compat reads Godot's own (`locked_axis`, `BodyAxis` bits) from userData.
  const axes = [...locks.linear, ...locks.angular].reduce((bits, enabled, index) => (enabled ? bits : bits | (1 << index)), 0);
  if (axes !== 0) data['axis_lock'] = axes;
  // lock_rotation is Rapier's own `lockRotations`, beside its flag in `userData` for compat: Rapier
  // merges it with the axis locks, which it then cannot report back, so the pair has no form.
  if (data['lock_rotation'] === true) {
    if (locks.angular.includes(false)) refuse(`${className}.lock_rotation with an angular axis lock has no idiomatic form`);
    else props.set('lockRotations', literal(true));
  }
  if (!sensor) {
    // Godot's friction is the smaller of the pair's, its bounce the larger (`combine_friction`,
    // `combine_bounce`, godot_body_pair_3d.cpp:255); a body without a material has friction 1 and
    // no bounce. A rough or absorbent material's sign (`physics_material.h:55`) is not carried.
    const computed = material === undefined ? { friction: 1, bounce: 0, absorbent: false } : materialData(material);
    const friction = Math.abs(Number(computed['friction'] ?? 1));
    const bounce = computed['absorbent'] === true ? 0 : Math.min(Math.max(Number(computed['bounce'] ?? 0), 0), 1);
    props.set('friction', literal(friction));
    props.set('frictionCombineRule', { kind: 'combine-rule', rule: 'Min' });
    props.set('restitution', literal(bounce));
    props.set('restitutionCombineRule', { kind: 'combine-rule', rule: 'Max' });
  }
  if (Object.keys(shapes).length > 0) data['shapes'] = shapes;
  if (Object.keys(data).length > 0) props.set('userData', { kind: 'data', value: data });
  return props;
}

/**
 * An instance's `userData`: the instanced root's with the instance's own over it, its groups
 * joining the root's (`SceneState::instantiate`, packed_scene.cpp:511).
 */
function instanceData(root: Readonly<Record<string, unknown>>, own: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return {
    ...root,
    ...own,
    ...(own['groups'] === undefined ? {} : { groups: [...new Set([...((root['groups'] ?? []) as string[]), ...(own['groups'] as string[])])] }),
  };
}

const sameSetter = (left: TargetGodotSceneSetterPlan, right: TargetGodotSceneSetterPlan): boolean =>
  left.setter.exportName === right.setter.exportName && left.index === right.index;

/**
 * The props an instance of a scene rooted in a body changes: the props of the prefab's values with
 * the instance's over them, where they differ from the prefab's, and Rapier's default for a prop
 * the prefab states that the instance's values leave out (an override back to Godot's default).
 */
function bodyOverrides(
  scene: SceneWithoutRefs,
  node: DirectGodotSceneNodePlan,
  instanced: SceneWithoutRefs,
  scenes: ReadonlyMap<string, SceneWithoutRefs>,
  refuse: (message: string) => void,
): readonly GodotSceneBodyProp[] {
  // The instanced scene's root may itself instance a scene (an inherited scene): its class and
  // form are the chain's end's.
  const form = godotSceneRootIdiom(scenes, instanced.sourceResPath)?.form;
  if (form?.kind !== 'body' || node.instance === undefined) return [];
  const className = godotSceneRootClass(scenes, instanced.sourceResPath) as string;
  // The prefab is the chain folded from its base: the base scene's root, then each inheriting
  // scene's root overrides over it, each setter's resources its own document's (keyed by document).
  const chain: SceneWithoutRefs[] = [];
  for (let at: SceneWithoutRefs | undefined = instanced; at !== undefined; at = at.root.instance === undefined ? undefined : scenes.get(at.root.instance.sourceResPath)) {
    chain.unshift(at);
  }
  const resources = new Map<string, TargetGodotSceneResourcePlan>();
  const keyed = (document: SceneWithoutRefs, setters: readonly TargetGodotSceneSetterPlan[]): TargetGodotSceneSetterPlan[] => {
    for (const resource of document.resources) resources.set(`${document.sourceResPath}|${resource.key}`, { ...resource, key: `${document.sourceResPath}|${resource.key}` });
    return setters.map((entry) => (entry.value.kind === 'resource' ? { ...entry, value: { ...entry.value, key: `${document.sourceResPath}|${entry.value.key}` } } : entry));
  };
  const over = (base: readonly TargetGodotSceneSetterPlan[], top: readonly TargetGodotSceneSetterPlan[]): TargetGodotSceneSetterPlan[] => [
    ...base.filter((own) => !top.some((entry) => sameSetter(entry, own))),
    ...top,
  ];
  let prefab: TargetGodotSceneSetterPlan[] = [];
  let prefabData: Record<string, unknown> = {};
  const shapes: Record<string, Record<string, unknown>> = {};
  for (const document of chain) {
    prefab = over(prefab, keyed(document, document.root.setters));
    prefabData = instanceData(prefabData, nodeData(document.root));
    Object.assign(shapes, shapeData(document.root, new Map(document.resources.map((resource) => [resource.key, resource] as const))));
  }
  const merged = over(prefab, keyed(scene, node.setters));
  const own = bodyProps(refuse, className, form.sensor, prefab, resources, shapes, prefabData);
  const instance = bodyProps(refuse, className, form.sensor, merged, resources, shapes, instanceData(prefabData, nodeData(node)));
  const changed: GodotSceneBodyProp[] = [];
  for (const [name, value] of instance) {
    if (JSON.stringify(own.get(name)) !== JSON.stringify(value)) changed.push({ name, value });
  }
  // Rapier applies lockRotations after enabledRotations, and clearing it clears every rotation lock.
  if (own.has('lockRotations') && !instance.has('lockRotations') && instance.has('enabledRotations')) {
    refuse(`clearing the instanced ${className}'s lock_rotation beside an angular axis lock has no idiomatic form`);
    return [];
  }
  for (const name of own.keys()) {
    if (instance.has(name)) continue;
    const reset = RAPIER_BODY_DEFAULTS[name];
    if (reset === undefined) refuse(`clearing the instanced ${className}'s ${name} has no idiomatic form`);
    else changed.push({ name, value: reset });
  }
  return changed;
}

/**
 * The scenes with every node's Godot-only `data`, each body's props (`body`), and each instance of
 * a scene rooted in a body the props its overrides change (`bodyOverrides`); what has no form is a
 * composition diagnostic.
 */
export function planGodotSceneBodies(scenes: readonly SceneWithoutRefs[], diagnostics: DirectGodotCompositionDiagnostic[]): SceneWithoutRefs[] {
  const bySource = new Map(scenes.map((scene) => [scene.sourceResPath, scene] as const));
  return scenes.map((scene) => {
    const resources = new Map(scene.resources.map((resource) => [resource.key, resource] as const));
    const stamp = (node: DirectGodotSceneNodePlan): DirectGodotSceneNodePlan => {
      const at = `${scene.sourceResPath}#${node.nodePath}`;
      const refuse = (message: string): void => {
        diagnostics.push({ at, message });
      };
      const children = node.children.map(stamp);
      const placements = node.placements?.map((placed) => ({ at: placed.at, node: stamp(placed.node) }));
      const data = nodeData(node);
      const form = node.idiom?.form;
      const instanced = node.instance === undefined ? undefined : bySource.get(node.instance.sourceResPath);
      // A value with no plain form (`plainValue`) is refused as the rest are.
      const planned = <T>(plan: () => T, fallback: T): T => {
        try {
          return plan();
        } catch (error) {
          refuse(error instanceof Error ? error.message : String(error));
          return fallback;
        }
      };
      const body =
        node.instance === undefined && node.model === undefined && form?.kind === 'body'
          ? planned(() => [...bodyProps(refuse, node.classes[0] as string, form.sensor, node.setters, resources, shapeData(node, resources), data)].map(([name, value]) => ({ name, value })), [])
          : undefined;
      const overrides = instanced === undefined ? [] : planned(() => bodyOverrides(scene, node, instanced, bySource, refuse), []);
      return {
        ...node,
        data,
        ...(body === undefined ? {} : { body }),
        ...(overrides.length === 0 ? {} : { bodyOverrides: overrides }),
        children,
        ...(placements === undefined ? {} : { placements }),
      };
    };
    return { ...scene, root: stamp(scene.root) };
  });
}

/** The `userData` of an instance of a scene: the instanced root's with the instance's own over it. */
export function godotSceneInstanceData(instanced: DirectGodotSceneNodePlan, node: DirectGodotSceneNodePlan): Record<string, unknown> {
  return instanceData(instanced.data ?? {}, node.data ?? {});
}
