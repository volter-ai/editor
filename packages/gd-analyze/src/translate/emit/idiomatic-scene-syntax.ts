/**
 * A scene written as idiomatic React Three Fiber (GODOT.md, "The output is idiomatic three.js"):
 * ordinary JSX with Godot's values converted at import into three's units and written as literals,
 * transforms as `position`/`rotation`/`scale`, geometry and materials as child elements with
 * literal args, lights and cameras with three's own props, bodies and colliders as
 * `@react-three/rapier` components, and each script attached by compat's `useGodotScript`. Node
 * names are Godot's, so `$Path` resolves over the mounted tree.
 *
 * The carried node families (meshes, materials, lights, cameras) are written by their elements
 * (`scene-family-elements.ts`), with the conversions each names; a Transform3D is decomposed into
 * position, XYZ Euler rotation and scale (a basis with shear has no such form and is refused by
 * name); a BoxShape3D is a cuboid collider of half its size.
 */
import * as path from 'node:path';
import type {
  TargetTsExpression,
  TargetTsJsxAttribute,
  TargetTsJsxChild,
  TargetTsJsxElementShape,
  TargetTsSourceFile,
  TargetTsStatement,
  TargetTsType,
} from '../code/target-ts-syntax';
import { TARGET_TS_SYNTAX_VERSION } from '../code/target-ts-syntax';
import type {
  DirectGodotProjectCompositionPlan,
  DirectGodotSceneDocumentPlan,
  DirectGodotSceneNodePlan,
} from '../data/direct-project-composition-plan';
import type { TargetGodotSceneResourcePlan, TargetGodotSceneSetterPlan, TargetGodotSceneValue } from '../data/scene-document-plan';
import { directGodotSceneAutoloadContextName, directGodotSceneAutoloadReferences } from './direct-autoload-syntax';
import {
  attribute,
  camelName,
  componentsValue,
  element,
  type FamilyEmission,
  familyElement,
  familyCountUses,
  familyEmission,
  familyImports,
  familyInstanceProps,
  familyThreeType,
  flag,
  float32Literal,
  literal,
  moduleSpecifier,
  numberValue,
  numbers,
  setterValue,
  useCompat as familyUseCompat,
} from './scene-family-elements';


/**
 * A Transform3D (the plan's column-major matrix) as `position`, XYZ `rotation` and `scale` props,
 * each only when it differs from three's default. A basis whose columns are not orthogonal
 * (shear) has no such form.
 */
export function idiomaticTransformAttributes(at: string, matrix: unknown): TargetTsJsxAttribute[] {
  return transformAttributes(at, matrix as readonly number[] | undefined);
}

function transformAttributes(at: string, matrix: readonly number[] | undefined): TargetTsJsxAttribute[] {
  if (matrix === undefined) return [];
  const e = matrix;
  const columns = [0, 1, 2].map((c) => [e[c * 4] as number, e[c * 4 + 1] as number, e[c * 4 + 2] as number]);
  const length = (v: readonly number[]) => Math.hypot(v[0] as number, v[1] as number, v[2] as number);
  const dot = (a: readonly number[], b: readonly number[]) => a.reduce((sum, x, i) => sum + x * (b[i] as number), 0);
  const [cx, cy, cz] = columns as [number[], number[], number[]];
  for (const [a, b] of [[cx, cy], [cx, cz], [cy, cz]] as const) {
    if (Math.abs(dot(a, b)) > 1e-5 * length(a) * length(b)) {
      throw new Error(`${at}: a transform with shear has no position, rotation and scale`);
    }
  }
  const det =
    (cx[0] as number) * ((cy[1] as number) * (cz[2] as number) - (cz[1] as number) * (cy[2] as number)) -
    (cy[0] as number) * ((cx[1] as number) * (cz[2] as number) - (cz[1] as number) * (cx[2] as number)) +
    (cz[0] as number) * ((cx[1] as number) * (cy[2] as number) - (cy[1] as number) * (cx[2] as number));
  const scale = [length(cx) * (det < 0 ? -1 : 1), length(cy), length(cz)];
  // Row r, column c of the rotation (three's `Euler.setFromRotationMatrix`, order XYZ).
  const m = (r: number, c: number) => ((columns[c] as number[])[r] as number) / (scale[c] as number);
  const clamp = (x: number) => Math.min(Math.max(x, -1), 1);
  const y = Math.asin(clamp(m(0, 2)));
  let x: number;
  let z: number;
  if (Math.abs(m(0, 2)) < 0.9999999) {
    x = Math.atan2(-m(1, 2), m(2, 2));
    z = Math.atan2(-m(0, 1), m(0, 0));
  } else {
    x = Math.atan2(m(2, 1), m(1, 1));
    z = 0;
  }
  const position = [e[12] as number, e[13] as number, e[14] as number];
  const result: TargetTsJsxAttribute[] = [];
  if (position.some((value) => value !== 0)) result.push(attribute('position', numbers(position)));
  if ([x, y, z].some((value) => float32Literal(value) !== 0)) result.push(attribute('rotation', numbers([x, y, z])));
  if (scale.some((value) => float32Literal(value) !== 1)) result.push(attribute('scale', numbers(scale)));
  return result;
}

interface Emission {
  readonly scene: DirectGodotSceneDocumentPlan;
  /** The carried families' elements, their loaders and imports (`scene-family-elements.ts`). */
  readonly family: FamilyEmission;
  readonly resources: ReadonlyMap<string, TargetGodotSceneResourcePlan>;
  readonly three: Set<string>;
  readonly rapier: Set<string>;
  readonly scripts: Map<string, { readonly local: string; readonly module: string; readonly exportName: string }>;
  readonly hooks: TargetTsStatement[];
  readonly refNames: Set<string>;
  /** The nodes another statement refers to (a script's, a connection's): their refs, once made. */
  readonly needsRef: ReadonlySet<string>;
  readonly nodeRefs: Map<string, string>;
  /** Types `@react-three/rapier` exports that the refs name. */
  readonly rapierTypes: Set<string>;
  /** The composition's scenes, for an instance's prefab. */
  readonly scenes: ReadonlyMap<string, DirectGodotSceneDocumentPlan>;
  /** The prefab components the scene instances, by name, with their modules. */
  readonly instances: Map<string, string>;
  /** The scene's autoload context (`<Scene>Autoloads`), when its scripts read autoloads. */
  readonly autoloads: string | undefined;
}

function useCompat(emission: Emission, module: string, name: string): string {
  return familyUseCompat(emission.family, module, name);
}

function resourceOf(emission: Emission, value: TargetGodotSceneValue | undefined): TargetGodotSceneResourcePlan | undefined {
  return value?.kind === 'resource' ? emission.resources.get(value.key) : undefined;
}

function pascalName(file: string): string {
  const base = path.posix.basename(file).replace(/\.[^.]+$/u, '');
  const camel = camelName(base);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/**
 * A node's ref, when another statement refers to it (its script, a connection): `useRef<Type>(null)`
 * on its element, `type` the element's ref type (three's, or the Rapier body a `<RigidBody>`'s ref
 * holds). Its script is attached through it: `useGodotScript(ref, Class, { exports }, { autoloads })`.
 */
function nodeRef(emission: Emission, node: DirectGodotSceneNodePlan, type: string, from: 'three' | 'rapier' = 'three'): TargetTsJsxAttribute[] {
  if (!emission.needsRef.has(node.nodePath)) return [];
  let refName = camelName(node.name);
  for (let n = 2; emission.family.taken.has(refName); n += 1) refName = `${camelName(node.name)}${String(n)}`;
  emission.family.taken.add(refName);
  emission.refNames.add(refName);
  emission.nodeRefs.set(node.nodePath, refName);
  (from === 'three' ? emission.three : emission.rapierTypes).add(type);
  emission.hooks.push({
    kind: 'variable-statement',
    declaration: 'const',
    name: refName,
    initializer: {
      kind: 'call-expression',
      callee: { kind: 'identifier-expression', name: 'useRef' },
      typeArguments: [{ kind: 'type-reference', name: from === 'three' ? threeLocal(type) : type, arguments: [] }],
      arguments: [{ kind: 'literal-expression', value: null }],
    },
  });
  const script = node.scriptInstance;
  if (script !== undefined) {
    const cls = script.generatedClass;
    let local = emission.scripts.get(cls.modulePath + cls.exportName)?.local;
    if (local === undefined) {
      local = pascalName(script.scriptResPath);
      const taken = new Set([...emission.scripts.values()].map((entry) => entry.local));
      for (let n = 2; taken.has(local); n += 1) local = `${pascalName(script.scriptResPath)}${String(n)}`;
      emission.scripts.set(cls.modulePath + cls.exportName, {
        local,
        module: moduleSpecifier(emission.scene.targetPath, cls.modulePath),
        exportName: cls.exportName,
      });
    }
    emission.hooks.push({
      kind: 'expression-statement',
      expression: {
        kind: 'call-expression',
        callee: { kind: 'identifier-expression', name: useCompat(emission, 'react-lifecycle', 'useGodotScript') },
        arguments: [
          { kind: 'identifier-expression', name: refName },
          { kind: 'identifier-expression', name: local },
          ...(script.fields.length === 0 && script.autoloadReferences.length === 0
            ? []
            : [
                {
                  kind: 'object-expression' as const,
                  properties: script.fields.map((field) => ({
                    key: field.fieldName,
                    value: { kind: 'literal-expression' as const, value: field.value.value },
                  })),
                },
              ]),
          // The autoloads the script reads, each its field and the ref the world mounts it into.
          ...(script.autoloadReferences.length === 0 || emission.autoloads === undefined
            ? []
            : [
                {
                  kind: 'object-expression' as const,
                  properties: script.autoloadReferences.map((reference) => ({
                    key: reference.fieldName,
                    value: {
                      kind: 'property-expression' as const,
                      object: { kind: 'identifier-expression' as const, name: 'autoloads' },
                      property: reference.name,
                    },
                  })),
                },
              ]),
        ],
      },
    });
  }
  return [attribute('ref', { kind: 'identifier-expression', name: refName })];
}

/** A three type's local name: drei's components share some names (`PerspectiveCamera`). */
function threeLocal(type: string): string {
  return type === 'PerspectiveCamera' ? 'ThreePerspectiveCamera' : type;
}

/** A JSON-like value as a literal expression (a `userData` object). */
function dataExpression(value: unknown): TargetTsExpression {
  if (Array.isArray(value)) return { kind: 'array-expression', elements: value.map(dataExpression) };
  if (value !== null && typeof value === 'object') {
    return {
      kind: 'object-expression',
      properties: Object.entries(value as Record<string, unknown>).map(([key, entry]) => ({ key, value: dataExpression(entry) })),
    };
  }
  return literal(value as number | string | boolean | null);
}

/** A setter's value as plain data: a number, a boolean, a vector's components, a resource's key. */
function plainValue(value: TargetGodotSceneValue): unknown {
  if (value.kind === 'number' || value.kind === 'bool') return value.value;
  if ('components' in value) return [...value.components];
  if (value.kind === 'resource') return value.key;
  throw new Error(`a ${value.kind} value has no idiomatic form`);
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

/**
 * A body's `<RigidBody>` props from its class and setters (with `resources` for its material):
 * Rapier's own props for what Rapier consumes (type, sensor, friction and bounce with Godot's
 * combine rules, gravity scale, damping, axis locks) and `userData` for the rest by Godot name.
 * `shapes` is its collision shapes' Godot-only settings by collider name.
 */
function bodyProps(
  emission: Emission,
  className: string,
  setters: readonly TargetGodotSceneSetterPlan[],
  resources: ReadonlyMap<string, TargetGodotSceneResourcePlan>,
  shapes: Readonly<Record<string, Record<string, unknown>>>,
  node: Readonly<Record<string, unknown>> = {},
): Map<string, TargetTsExpression> {
  const props = new Map<string, TargetTsExpression>();
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
    else if (name === 'set_physics_material_override') {
      material = entry.value.kind === 'resource' ? resources.get(entry.value.key) : undefined;
      if (material !== undefined) data['physics_material_override'] = materialData(material);
    } else {
      const key = BODY_DATA[name];
      if (key === undefined) throw new Error(`${className}.${entry.propertyName} has no idiomatic form`);
      data[key] = plainValue(entry.value);
    }
  }
  if (locks.linear.includes(false)) props.set('enabledTranslations', dataExpression(locks.linear));
  if (locks.angular.includes(false)) props.set('enabledRotations', dataExpression(locks.angular));
  if (className !== 'Area3D') {
    // Godot's friction is the smaller of the pair's, its bounce the larger (`combine_friction`,
    // `combine_bounce`, godot_body_pair_3d.cpp:255); a body without a material has friction 1 and
    // no bounce. A rough or absorbent material's sign (`physics_material.h:55`) is not carried.
    const computed = material === undefined ? { friction: 1, bounce: 0, absorbent: false } : materialData(material);
    const friction = Math.abs(Number(computed['friction'] ?? 1));
    const bounce = computed['absorbent'] === true ? 0 : Math.min(Math.max(Number(computed['bounce'] ?? 0), 0), 1);
    emission.rapier.add('CoefficientCombineRule');
    const rule = (value: string): TargetTsExpression => ({
      kind: 'property-expression',
      object: { kind: 'identifier-expression', name: 'CoefficientCombineRule' },
      property: value,
    });
    props.set('friction', literal(friction));
    props.set('frictionCombineRule', rule('Min'));
    props.set('restitution', literal(bounce));
    props.set('restitutionCombineRule', rule('Max'));
  }
  if (Object.keys(shapes).length > 0) data['shapes'] = shapes;
  if (Object.keys(data).length > 0) props.set('userData', dataExpression(data));
  return props;
}

/** The Godot-only settings of a body's collision shapes, by collider name. */
function shapeData(emission: Emission, node: DirectGodotSceneNodePlan): Record<string, Record<string, unknown>> {
  const shapes: Record<string, Record<string, unknown>> = {};
  for (const child of node.children) {
    if (child.classes[0] !== 'CollisionShape3D') continue;
    const entry: Record<string, unknown> = {};
    if (setterValue(child.setters, 'set_disabled')?.kind === 'bool' && (setterValue(child.setters, 'set_disabled') as { value: boolean }).value) entry['disabled'] = true;
    const shape = resourceOf(emission, setterValue(child.setters, 'set_shape'));
    const backface = shape === undefined ? undefined : setterValue(shape.setters, 'set_backface_collision_enabled');
    if (backface?.kind === 'bool') entry['backface_collision'] = backface.value;
    if (Object.keys(entry).length > 0) shapes[child.name] = entry;
  }
  return shapes;
}

const BODY_TYPES: Readonly<Record<string, string>> = {
  StaticBody3D: 'fixed',
  Area3D: 'fixed',
  RigidBody3D: 'dynamic',
  CharacterBody3D: 'kinematicPosition',
};

/** A collision shape's collider element: three's shape of the Godot shape's data. */
function collider(emission: Emission, node: DirectGodotSceneNodePlan, name: TargetTsJsxAttribute, transform: TargetTsJsxAttribute[], at: string): TargetTsJsxChild {
  if (node.scriptInstance !== undefined) throw new Error(`${at}: a script on a collision shape has no idiomatic form`);
  if (Object.keys(nodeData(node)).length > 0) throw new Error(`${at}: groups or a unique name on a collision shape have no idiomatic form`);
  if (node.children.length > 0) throw new Error(`${at}: children of a collision shape have no idiomatic form`);
  const shape = resourceOf(emission, setterValue(node.setters, 'set_shape'));
  if (shape === undefined) throw new Error(`${at}: a collision shape without a shape has no idiomatic form`);
  const set = shape.setters;
  const tag = (component: string, args: TargetTsExpression): TargetTsJsxChild => {
    emission.rapier.add(component);
    return element(component, [name, attribute('args', args), ...transform]);
  };
  switch (shape.className) {
    case 'BoxShape3D':
      return tag('CuboidCollider', numbers((componentsValue(setterValue(set, 'set_size')) ?? [1, 1, 1]).map((value) => value / 2)));
    case 'SphereShape3D':
      return tag('BallCollider', numbers([numberValue(setterValue(set, 'set_radius')) ?? 0.5]));
    case 'CapsuleShape3D': {
      // Godot's height spans the caps (`capsule_shape_3d.cpp:100`); Rapier's half height does not.
      const radius = numberValue(setterValue(set, 'set_radius')) ?? 0.5;
      const height = numberValue(setterValue(set, 'set_height')) ?? 2;
      return tag('CapsuleCollider', numbers([height / 2 - radius, radius]));
    }
    case 'ConvexPolygonShape3D':
      return tag('ConvexHullCollider', { kind: 'array-expression', elements: [numbers(componentsValue(setterValue(set, 'set_points')) ?? [])] });
    case 'ConcavePolygonShape3D': {
      const faces = componentsValue(setterValue(set, 'set_faces')) ?? [];
      const indices = Array.from({ length: faces.length / 3 }, (_, index) => index);
      return tag('TrimeshCollider', { kind: 'array-expression', elements: [numbers(faces), { kind: 'array-expression', elements: indices.map((index) => ({ kind: 'literal-expression' as const, value: index })) }] });
    }
    default:
      throw new Error(`${at}: ${shape.className} has no idiomatic collider`);
  }
}

/** A node's Godot-only state the Node protocol seeds from its `userData`: groups and `%Name`. */
function nodeData(node: DirectGodotSceneNodePlan): Record<string, unknown> {
  return {
    ...(node.groups.length === 0 ? {} : { groups: [...node.groups] }),
    ...(node.unique === true ? { unique_name_in_owner: true } : {}),
  };
}

/** `userData` stating a node's Godot-only state, when it has any. */
function nodeDataAttribute(node: DirectGodotSceneNodePlan): TargetTsJsxAttribute[] {
  const data = nodeData(node);
  return Object.keys(data).length === 0 ? [] : [attribute('userData', dataExpression(data))];
}

/** A setter's Godot-named value as a compat component's camelCase prop. */
function componentProp(entry: TargetGodotSceneSetterPlan): TargetTsJsxAttribute {
  const camel = entry.propertyName.replace(/_([a-z])/gu, (_, letter: string) => letter.toUpperCase());
  const value = plainValue(entry.value);
  return attribute(camel, dataExpression(value));
}

/** An instanced scene's root as its prefab element, with the instance's overrides as props. */
function instanceElement(emission: Emission, node: DirectGodotSceneNodePlan, name: TargetTsJsxAttribute, transform: TargetTsJsxAttribute[], at: string): TargetTsJsxChild {
  const instanced = emission.scenes.get(node.instance?.sourceResPath ?? '');
  if (instanced === undefined || instanced.idiomatic !== true) throw new Error(`${at}: the instanced scene is not idiomatic`);
  const local = instanced.exportName;
  emission.instances.set(local, moduleSpecifier(emission.scene.targetPath, instanced.targetPath));
  const rootClass = instanced.root.classes[0] as string;
  const overrides: TargetTsJsxAttribute[] = [];
  // The instance's groups join its scene root's (`SceneState::instantiate`, packed_scene.cpp:511).
  const rootData = nodeData(instanced.root);
  const ownData = nodeData(node);
  const data: Record<string, unknown> = {
    ...rootData,
    ...ownData,
    ...(ownData['groups'] === undefined ? {} : { groups: [...new Set([...((rootData['groups'] ?? []) as string[]), ...(ownData['groups'] as string[])])] }),
  };
  const familyProps = node.setters.length > 0 ? familyInstanceProps(emission.family, rootClass, node, instanced.root.setters) : undefined;
  if (familyProps !== undefined) {
    overrides.push(...familyProps);
    if (Object.keys(ownData).length > 0) overrides.push(attribute('userData', dataExpression(data)));
  } else if (BODY_TYPES[rootClass] !== undefined) {
    // The overridden values merged over the prefab's own: the props that differ from its root's
    // (a `userData` always whole, since the element's replaces the prefab's).
    const merged = [...instanced.root.setters.filter((own) => !node.setters.some((entry) => sameSetter(entry, own))), ...node.setters];
    const resources = new Map([...instanced.resources, ...emission.scene.resources].map((resource) => [resource.key, resource] as const));
    const shapes = shapeData({ ...emission, resources: new Map(instanced.resources.map((resource) => [resource.key, resource] as const)) }, instanced.root);
    const own = bodyProps(emission, rootClass, instanced.root.setters, new Map(instanced.resources.map((resource) => [resource.key, resource] as const)), shapes, rootData);
    for (const [prop, value] of bodyProps(emission, rootClass, merged, resources, shapes, data)) {
      if (JSON.stringify(own.get(prop)) !== JSON.stringify(value)) overrides.push(attribute(prop, value));
    }
  } else {
    if (node.setters.length > 0) throw new Error(`${at}: overrides on an instanced ${rootClass} have no idiomatic form`);
    if (Object.keys(ownData).length > 0) overrides.push(attribute('userData', dataExpression(data)));
  }
  const children = node.children.map((child) => nodeElement(emission, child));
  const ref = BODY_TYPES[rootClass] !== undefined ? nodeRef(emission, node, 'RapierRigidBody', 'rapier') : nodeRef(emission, node, familyThreeType(rootClass) ?? 'Group');
  return element(local, [name, ...ref, ...transform, ...overrides], children);
}

function sameSetter(left: TargetGodotSceneSetterPlan, right: TargetGodotSceneSetterPlan): boolean {
  return left.setter.exportName === right.setter.exportName && left.index === right.index;
}

function nodeElement(emission: Emission, node: DirectGodotSceneNodePlan): TargetTsJsxChild {
  const className = node.classes[0] as string;
  const at = `${emission.scene.sourceResPath}#${node.nodePath}`;
  const matrix = node.properties.find((entry) => entry.propertyName === 'transform')?.value;
  const name: TargetTsJsxAttribute = { kind: 'jsx-string-attribute', name: 'name', value: node.name };
  // A camera or light draws with its scale removed (`disable_scale`, node_3d.cpp:655; set by
  // Camera3D and Light3D): with no children and no script to read it back, its authored scale (the
  // rounding a `.tscn` rotation carries) changes nothing, and the element states none.
  const scaleless =
    (className === 'Camera3D' || className === 'DirectionalLight3D' || className === 'OmniLight3D') &&
    node.children.length === 0 &&
    node.scriptInstance === undefined;
  const transform = transformAttributes(at, matrix).filter(
    (entry) => !scaleless || entry.kind === 'jsx-spread-attribute' || entry.name !== 'scale',
  );
  const children = () => node.children.map((child) => nodeElement(emission, child));
  if (node.instance !== undefined) return instanceElement(emission, node, name, transform, at);
  const bodyType = BODY_TYPES[className];
  if (bodyType !== undefined) {
    emission.rapier.add('RigidBody');
    const props = bodyProps(emission, className, node.setters, emission.resources, shapeData(emission, node), nodeData(node));
    return element('RigidBody', [
      name,
      ...nodeRef(emission, node, 'RapierRigidBody', 'rapier'),
      { kind: 'jsx-string-attribute', name: 'type', value: bodyType },
      attribute('colliders', { kind: 'literal-expression', value: false }),
      ...(className === 'Area3D' ? [flag('sensor')] : []),
      ...transform,
      ...[...props].map(([prop, value]) => attribute(prop, value)),
    ], children());
  }
  // A carried family's element (`scene-family-elements.ts`).
  const family = familyElement(emission.family, node);
  if (family !== undefined) {
    return element(family.tag, [name, ...nodeRef(emission, node, familyThreeType(className) as string), ...transform, ...family.attributes, ...nodeDataAttribute(node)], [
      ...family.children,
      ...children(),
    ]);
  }
  switch (className) {
    case 'Node':
      useCompat(emission, 'react-lifecycle', 'GodotNode');
      return element('GodotNode', [name, ...nodeRef(emission, node, 'Group'), ...nodeDataAttribute(node)], children());
    case 'Node3D':
      return element('group', [name, ...nodeRef(emission, node, 'Group'), ...transform, ...nodeDataAttribute(node)], children());
    case 'CollisionShape3D':
      return collider(emission, node, name, transform, at);
    case 'RayCast3D':
      useCompat(emission, 'ray-cast-3d', 'GodotRayCast3D');
      return element('GodotRayCast3D', [name, ...nodeRef(emission, node, 'Group'), ...transform, ...node.setters.map(componentProp), ...nodeDataAttribute(node)], children());
    case 'Marker3D':
      useCompat(emission, 'marker-3d', 'GodotMarker3D');
      return element('GodotMarker3D', [name, ...nodeRef(emission, node, 'Group'), ...transform, ...node.setters.map(componentProp), ...nodeDataAttribute(node)], children());
    default:
      throw new Error(`${at}: ${className} has no idiomatic element`);
  }
}

/** The first Camera3D the scene holds, in tree order, or the one authored current. */
function currentCamera(node: DirectGodotSceneNodePlan): { readonly first?: string; readonly authored?: string } {
  let first: string | undefined;
  let authored: string | undefined;
  const walk = (entry: DirectGodotSceneNodePlan) => {
    if (entry.classes[0] === 'Camera3D') {
      first ??= entry.nodePath;
      const current = setterValue(entry.setters, 'set_current');
      if (current?.kind === 'bool' && current.value) authored ??= entry.nodePath;
    }
    for (const child of entry.children) walk(child);
  };
  walk(node);
  return { ...(first === undefined ? {} : { first }), ...(authored === undefined ? {} : { authored }) };
}

/** The nodes a statement refers to: each with a script, and each end of a connection. */
function refTargets(scene: DirectGodotSceneDocumentPlan): ReadonlySet<string> {
  const targets = new Set<string>();
  let unique = false;
  const walk = (node: DirectGodotSceneNodePlan): void => {
    if (node.scriptInstance !== undefined) targets.add(node.nodePath);
    if (node.unique === true) unique = true;
    for (const child of node.children) walk(child);
  };
  walk(scene.root);
  // A scene whose nodes its owner finds as `%Name` marks its root (`useGodotScene`).
  if (unique) targets.add(scene.root.nodePath);
  for (const connection of scene.connections) targets.add(connection.fromNodePath).add(connection.toNodePath);
  return targets;
}

/** The props an instancing scene hands the root, by the root element. */
function rootPropsType(
  tag: string,
  targetPath: string,
  three: string | undefined,
): { readonly type: TargetTsType; readonly children: boolean; readonly from?: { readonly module: string; readonly name: string } } {
  const omitRef = (type: TargetTsType): TargetTsType => ({ kind: 'type-reference', name: 'Omit', arguments: [type, { kind: 'literal-type', value: 'ref' }] });
  // A compat element's own props (`useGodotElement`).
  if (tag.startsWith('Godot') && three !== undefined) {
    return {
      type: omitRef({ kind: 'type-reference', name: 'GodotElementProps', arguments: [{ kind: 'type-reference', name: three, arguments: [] }] }),
      children: true,
      from: { module: moduleSpecifier(targetPath, 'src/lib/godot-compat/react-lifecycle.tsx'), name: 'GodotElementProps' },
    };
  }
  if (tag === 'PerspectiveCamera') {
    return { type: { kind: 'type-reference', name: 'PerspectiveCameraProps', arguments: [] }, children: false, from: { module: '@react-three/drei', name: 'PerspectiveCameraProps' } };
  }
  if (tag === 'RigidBody') {
    return { type: omitRef({ kind: 'type-reference', name: 'RigidBodyProps', arguments: [] }), children: true, from: { module: '@react-three/rapier', name: 'RigidBodyProps' } };
  }
  return {
    type: omitRef({ kind: 'indexed-access-type', object: { kind: 'type-reference', name: 'ThreeElements', arguments: [] }, index: { kind: 'literal-type', value: tag } }),
    children: true,
    from: { module: '@react-three/fiber', name: 'ThreeElements' },
  };
}

export function idiomaticSceneSourceFile(
  project: DirectGodotProjectCompositionPlan,
  scene: DirectGodotSceneDocumentPlan,
): TargetTsSourceFile {
  const cameras = currentCamera(scene.root);
  const autoloadReferences = directGodotSceneAutoloadReferences(scene.root);
  const referencedAutoloads = autoloadReferences.map((reference) => {
    const autoload = project.scriptAutoloads.find((candidate) => candidate.name === reference.name && candidate.scriptResPath === reference.resPath);
    if (autoload === undefined) throw new Error(`${reference.name}: singleton ${reference.resPath} is absent from composition`);
    return autoload;
  });
  // Godot makes the first camera to enter the viewport current when none is authored so: the
  // main scene's first.
  const current = cameras.authored ?? (scene.sourceResPath === project.mainScene ? cameras.first : undefined);
  const family = familyEmission(scene.targetPath, scene.resources, current);
  familyCountUses(family, scene.root);
  const emission: Emission = {
    scene,
    family,
    resources: family.resources,
    three: new Set(),
    rapier: new Set(),
    scripts: new Map(),
    hooks: [],
    refNames: new Set(),
    needsRef: refTargets(scene),
    nodeRefs: new Map(),
    rapierTypes: new Set(),
    scenes: new Map(project.scenes.map((entry) => [entry.sourceResPath, entry] as const)),
    instances: new Map(),
    autoloads: autoloadReferences.length === 0 ? undefined : directGodotSceneAutoloadContextName(scene.exportName),
  };
  const node = nodeElement(emission, scene.root) as TargetTsJsxElementShape & { readonly kind: 'jsx-element-child' };
  if ((function hasUnique(entry: DirectGodotSceneNodePlan): boolean {
    return entry.unique === true || entry.children.some(hasUnique);
  })(scene.root)) {
    // Marked before any script attaches (a script mounted outside a startup enters at once).
    const rootRef = emission.nodeRefs.get(scene.root.nodePath) as string;
    const at = emission.hooks.findIndex((hook) => hook.kind === 'variable-statement' && hook.name === rootRef);
    emission.hooks.splice(at + 1, 0, {
      kind: 'expression-statement',
      expression: {
        kind: 'call-expression',
        callee: { kind: 'identifier-expression', name: useCompat(emission, 'react-lifecycle', 'useGodotScene') },
        arguments: [{ kind: 'identifier-expression', name: rootRef }],
      },
    });
  }
  // The scene's connections, made once its scripts are attached (`packed_scene.cpp:682`).
  for (const connection of scene.connections) {
    const accessor = useCompat(emission, connection.accessor.module.replace(/^lib\/godot-compat\//u, ''), connection.accessor.exportName);
    emission.hooks.push({
      kind: 'expression-statement',
      expression: {
        kind: 'call-expression',
        callee: { kind: 'identifier-expression', name: useCompat(emission, 'react-lifecycle', 'useGodotConnection') },
        arguments: [
          { kind: 'identifier-expression', name: emission.nodeRefs.get(connection.fromNodePath) as string },
          { kind: 'identifier-expression', name: accessor },
          { kind: 'literal-expression', value: connection.signal },
          { kind: 'identifier-expression', name: emission.nodeRefs.get(connection.toNodePath) as string },
          { kind: 'literal-expression', value: connection.method },
        ],
      },
    });
  }
  // An instancing scene's props (its name, transform, …) reach the root, and its children follow
  // the scene's own: the prefab form.
  const rootThree = familyThreeType(scene.root.classes[0] ?? '');
  if (node.tag.startsWith('Godot') && rootThree !== undefined) emission.three.add(rootThree);
  const props = rootPropsType(node.tag, scene.targetPath, rootThree);
  const root: TargetTsJsxElementShape & { readonly kind: 'jsx-element-child' } = {
    ...node,
    attributes: [...node.attributes, { kind: 'jsx-spread-attribute', value: { kind: 'identifier-expression', name: 'props' } }],
    children: props.children
      ? [...node.children, { kind: 'jsx-expression-child', value: { kind: 'property-expression', object: { kind: 'identifier-expression', name: 'props' }, property: 'children' } }]
      : node.children,
  };
  if (emission.autoloads !== undefined) {
    emission.hooks.unshift(
      {
        kind: 'variable-statement',
        declaration: 'const',
        name: 'autoloads',
        initializer: {
          kind: 'call-expression',
          callee: { kind: 'identifier-expression', name: 'useContext' },
          arguments: [{ kind: 'identifier-expression', name: emission.autoloads }],
        },
      },
      {
        kind: 'if-statement',
        condition: {
          kind: 'binary-expression',
          operator: '===',
          left: { kind: 'identifier-expression', name: 'autoloads' },
          right: { kind: 'literal-expression', value: null },
        },
        // biome-ignore lint/suspicious/noThenProperty: TargetTsSyntax names the source branch.
        then: [
          {
            kind: 'throw-statement',
            expression: {
              kind: 'new-expression',
              callee: { kind: 'identifier-expression', name: 'Error' },
              arguments: [{ kind: 'literal-expression', value: 'The world provides no autoloads to this scene.' }],
            },
          },
        ],
      },
    );
  }
  const reactNames = [
    ...(emission.autoloads === undefined ? [] : ['createContext', 'useContext']),
    ...(emission.refNames.size === 0 ? [] : ['useRef']),
  ];
  const imports: TargetTsStatement[] = [
    ...(reactNames.length === 0
      ? []
      : [{ kind: 'import-statement' as const, module: 'react', namedBindings: reactNames.map((name) => ({ imported: name, local: name })) }]),
    ...(emission.autoloads === undefined
      ? []
      : [{ kind: 'import-statement' as const, module: 'react', namedBindings: [{ imported: 'RefObject', local: 'RefObject' }], typeOnly: true as const }]),
    ...(props.from === undefined
      ? []
      : [{ kind: 'import-statement' as const, module: props.from.module, namedBindings: [{ imported: props.from.name, local: props.from.name }], typeOnly: true as const }]),
    ...(emission.three.size === 0
      ? []
      : [
          {
            kind: 'import-statement' as const,
            module: 'three',
            namedBindings: [...emission.three].sort().map((name) => ({ imported: name, local: threeLocal(name) })),
            typeOnly: true as const,
          },
        ]),
    ...(emission.rapierTypes.size === 0
      ? []
      : [{ kind: 'import-statement' as const, module: '@react-three/rapier', namedBindings: [...emission.rapierTypes].sort().map((name) => ({ imported: name, local: name })), typeOnly: true as const }]),
    ...[...emission.instances].map(([local, module]) => ({
      kind: 'import-statement' as const,
      module,
      namedBindings: [{ imported: local, local }],
    })),
    ...(emission.rapier.size === 0
      ? []
      : [{ kind: 'import-statement' as const, module: '@react-three/rapier', namedBindings: [...emission.rapier].sort().map((name) => ({ imported: name, local: name })) }]),
    ...familyImports(family),
    ...[...emission.scripts.values()].map((script) => ({
      kind: 'import-statement' as const,
      module: script.module,
      namedBindings: [{ imported: script.exportName, local: script.local }],
    })),
    ...referencedAutoloads.map((autoload) => ({
      kind: 'import-statement' as const,
      module: moduleSpecifier(scene.targetPath, autoload.generatedClass.modulePath),
      namedBindings: [{ imported: autoload.generatedClass.exportName, local: `${autoload.name}Autoload` }],
      typeOnly: true as const,
    })),
  ];
  // The autoloads the world mounts, as the refs its context hands this scene's scripts.
  const autoloadContext: TargetTsStatement[] =
    emission.autoloads === undefined
      ? []
      : [
          {
            kind: 'variable-statement',
            declaration: 'const',
            name: emission.autoloads,
            modifiers: ['export'],
            initializer: {
              kind: 'call-expression',
              callee: { kind: 'identifier-expression', name: 'createContext' },
              typeArguments: [
                {
                  kind: 'union-type',
                  members: [
                    {
                      kind: 'object-type',
                      properties: referencedAutoloads.map((autoload) => ({
                        name: autoload.name,
                        readonly: true as const,
                        type: {
                          kind: 'type-reference' as const,
                          name: 'RefObject',
                          arguments: [
                            {
                              kind: 'union-type' as const,
                              members: [
                                { kind: 'type-reference' as const, name: `${autoload.name}Autoload`, arguments: [] },
                                { kind: 'literal-type' as const, value: null },
                              ],
                            },
                          ],
                        },
                      })),
                    },
                    { kind: 'literal-type', value: null },
                  ],
                },
              ],
              arguments: [{ kind: 'literal-expression', value: null }],
            },
          },
        ];
  return {
    syntaxVersion: TARGET_TS_SYNTAX_VERSION,
    sourcePath: scene.targetPath,
    statements: [
      ...imports,
      ...family.statics,
      ...autoloadContext,
      {
        kind: 'function-statement',
        name: scene.exportName,
        modifiers: ['export'],
        parameters: [{ name: 'props', type: props.type }],
        body: [...family.hooks, ...emission.hooks, { kind: 'return-statement', expression: { ...root, kind: 'jsx-element-expression' } }],
      },
    ],
  };
}
