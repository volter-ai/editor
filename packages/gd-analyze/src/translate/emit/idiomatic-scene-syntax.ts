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
import { Euler, Quaternion } from 'three';
import type {
  TargetTsExpression,
  TargetTsJsxAttribute,
  TargetTsJsxChild,
  TargetTsJsxElementShape,
  TargetTsObjectProperty,
  TargetTsSourceFile,
  TargetTsStatement,
  TargetTsType,
} from '../code/target-ts-syntax';
import { TARGET_TS_SYNTAX_VERSION } from '../code/target-ts-syntax';
import type {
  DirectGodotProjectCompositionPlan,
  DirectGodotSceneDocumentPlan,
  DirectGodotSceneNodePlan,
  DirectGodotScriptInstancePlan,
} from '../data/direct-project-composition-plan';
import { type ScriptLifecycleImports, scriptLifecycleHooks } from './script-lifecycle-hooks';
import type { TargetGodotSceneResourcePlan, TargetGodotSceneSetterPlan, TargetGodotSceneValue } from '../data/scene-document-plan';
import { directGodotSceneAutoloadContextName, directGodotSceneAutoloadReferences } from './direct-autoload-syntax';
import { godotImportedModelDataPath, godotSceneRootClass, godotSceneRootIdiom, godotSceneSubnodes } from '../data/scene-document-plan';
import type { GodotSceneNodeIdiom } from '../data/scene-node-idioms';
import { godotResolveNodePath } from '../data/scene-animation';
import {
  attribute,
  camelName,
  componentsValue,
  element,
  type FamilyEmission,
  familyAnimationOverride,
  familyElement,
  familyCountUses,
  familyEmission,
  familyImports,
  familyInstanceProps,
  familyMaterialOverride,
  flag,
  float32Literal,
  importedTextureHook,
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

const f32 = Math.fround;

/** The literal numbers an array prop states, or undefined for another expression. */
function propNumbers(attributes: readonly TargetTsJsxAttribute[], name: string): readonly number[] | undefined {
  const found = attributes.find((entry) => entry.kind === 'jsx-expression-attribute' && entry.name === name);
  if (found?.kind !== 'jsx-expression-attribute' || found.value.kind !== 'array-expression') return undefined;
  const values = found.value.elements.map((element) => (element.kind === 'literal-expression' && typeof element.value === 'number' ? element.value : undefined));
  return values.every((value) => value !== undefined) ? (values as number[]) : undefined;
}

/**
 * `userData-godotLocal` (the authored Transform3D's basis rows and origin) for a node whose
 * `position`, `rotation` and `scale` props do not reproduce it bit for bit through three's
 * Object3D (`Quaternion.setFromEuler`) and compat's float32 read of it (`fromThree`, node-3d.ts:
 * `Basis::set_quaternion_scale`); compat's Node3D then holds the authored one (`node-3d.ts`). A
 * node whose props reproduce it carries none.
 */
export function authoredLocalAttributes(matrix: readonly number[] | undefined, attributes: readonly TargetTsJsxAttribute[]): TargetTsJsxAttribute[] {
  if (matrix === undefined) return [];
  const e = matrix;
  const authoredRows = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => f32(e[c * 4 + r] as number)));
  const authoredOrigin = [f32(e[12] as number), f32(e[13] as number), f32(e[14] as number)];
  const position = propNumbers(attributes, 'position') ?? [0, 0, 0];
  const rotation = propNumbers(attributes, 'rotation') ?? [0, 0, 0];
  const scale = propNumbers(attributes, 'scale') ?? [1, 1, 1];
  const q = new Quaternion().setFromEuler(new Euler(rotation[0], rotation[1], rotation[2], 'XYZ'));
  // compat's `fromThree` (node-3d.ts), which this must equal.
  const [x, y, z, w] = [f32(q.x), f32(q.y), f32(q.z), f32(q.w)];
  const d = f32(f32(f32(f32(x * x) + f32(y * y)) + f32(z * z)) + f32(w * w));
  const s2 = f32(2 / d);
  const [xs, ys, zs] = [f32(x * s2), f32(y * s2), f32(z * s2)];
  const [wx, wy, wz] = [f32(w * xs), f32(w * ys), f32(w * zs)];
  const [xx, xy, xz, yy, yz, zz] = [f32(x * xs), f32(x * ys), f32(x * zs), f32(y * ys), f32(y * zs), f32(z * zs)];
  const rows = [
    f32(1 - f32(yy + zz)), f32(xy - wz), f32(xz + wy),
    f32(xy + wz), f32(1 - f32(xx + zz)), f32(yz - wx),
    f32(xz - wy), f32(yz + wx), f32(1 - f32(xx + yy)),
  ].map((value, index) => f32(value * f32(scale[index % 3] as number)));
  const origin = position.map((value) => f32(value));
  const reproduced = rows.every((value, index) => Object.is(value, authoredRows[index])) && origin.every((value, index) => Object.is(value, authoredOrigin[index]));
  if (reproduced) return [];
  return [attribute('userData-godotLocal', numbers([...[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => e[c * 4 + r] as number)), e[12] as number, e[13] as number, e[14] as number]))];
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
  /** The scripts' attachments, after every ref (a field may reference another node's). */
  readonly scriptHooks: (() => TargetTsStatement[])[];
  /** What the scripts' lifecycle hooks import (`script-lifecycle-hooks.ts`). */
  readonly lifecycle: ScriptLifecycleImports;
  /** Whether the colliders being emitted are an area's sensors. */
  readonly sensor: { current: boolean };
  /** What the scene imports from Rapier itself (`@dimforge/rapier3d-compat`). */
  readonly rapierCore: Set<string>;
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
  /** The imported models' data files the scene reads, by local name. */
  readonly models: Map<string, string>;
  /** The scene's autoload context (`<Scene>Autoloads`), when its scripts read autoloads. */
  readonly autoloads: string | undefined;
  /** Whether a scene instancing this one overrides its root script's fields (its `exports` prop). */
  readonly rootExports: boolean;
  /** Whether a scene instancing this one refers to its root (its `ref` prop, the root's handle). */
  readonly rootRef: boolean;
  /** Each ref's type as its `useRef` names it. */
  readonly refTypes: Map<string, string>;
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

/** The ref's local name of the node at `nodePath`, named once (a field may name it before its element). */
function refLocal(emission: Emission, nodePath: string, nodeName: string): string {
  const named = emission.nodeRefs.get(nodePath);
  if (named !== undefined) return named;
  const name = camelName(nodeName);
  let refName = name;
  for (let n = 2; emission.family.taken.has(refName); n += 1) refName = `${name}${String(n)}`;
  emission.family.taken.add(refName);
  emission.refNames.add(refName);
  emission.nodeRefs.set(nodePath, refName);
  return refName;
}

/**
 * A node's ref, when another statement refers to it (its script, a connection): `useRef<Type>(null)`
 * on its element, `type` the element's ref type (three's, or the Rapier body a `<RigidBody>`'s ref
 * holds). Its script is attached through it: `useGodotScript(ref, Class, { exports }, { autoloads })`.
 */
function nodeRef(emission: Emission, node: DirectGodotSceneNodePlan, type: string, from: 'three' | 'rapier' = 'three'): TargetTsJsxAttribute[] {
  if (!emission.needsRef.has(node.nodePath)) return [];
  const refName = refLocal(emission, node.nodePath, node.name);
  (from === 'three' ? emission.three : emission.rapierTypes).add(type);
  emission.refTypes.set(node.nodePath, from === 'three' ? threeLocal(type) : type);
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
    const scriptName = `${refName}Script`;
    emission.scriptHooks.push(() => [{
      kind: 'variable-statement',
      declaration: 'const',
      name: scriptName,
      initializer: {
        kind: 'call-expression',
        callee: { kind: 'identifier-expression', name: useCompat(emission, 'react-lifecycle', 'useGodotScript') },
        arguments: [
          { kind: 'identifier-expression', name: refName },
          { kind: 'identifier-expression', name: local },
          ...((): TargetTsExpression[] => {
            const own: TargetTsExpression = {
              kind: 'object-expression',
              properties: script.fields.map((field) => ({ key: field.fieldName, value: fieldValue(emission, node, field.value) })),
            };
            // A scene root whose instancers override its script's fields: theirs over its own.
            if (node.nodePath === emission.scene.root.nodePath && emission.rootExports) {
              return [{ kind: 'call-expression', callee: { kind: 'property-expression', object: { kind: 'identifier-expression', name: 'Object' }, property: 'assign' }, arguments: [own, { kind: 'identifier-expression', name: 'exports' }] }];
            }
            return script.fields.length === 0 && script.autoloadReferences.length === 0 ? [] : [own];
          })(),
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
    }, ...scriptLifecycleHooks(scriptName, refName, script.lifecycle, emission.lifecycle)]);
  }
  return [attribute('ref', { kind: 'identifier-expression', name: refName })];
}

/**
 * A script field's authored value: a literal, or a node reference as the referenced node's ref
 * (`godot_node_reference`), null for a path leaving the scene (`validateNodeReferences`).
 */
function fieldValue(emission: Emission, node: DirectGodotSceneNodePlan, value: DirectGodotScriptInstancePlan['fields'][number]['value']): TargetTsExpression {
  if (value.kind !== 'node-reference') return { kind: 'literal-expression', value: value.value };
  const target = godotResolveNodePath(node.nodePath, value.value);
  if (target === undefined) return { kind: 'literal-expression', value: null };
  // A node its element mounts later in the scene is named now; its element declares the ref.
  const ref = emission.nodeRefs.get(target) ?? (emission.needsRef.has(target) && target !== '.' ? refLocal(emission, target, target.slice(target.lastIndexOf('/') + 1)) : undefined);
  if (ref === undefined) throw new Error(`${emission.scene.sourceResPath}#${node.nodePath}: the referenced node ${target} mounts no ref`);
  return {
    kind: 'call-expression',
    callee: { kind: 'identifier-expression', name: useCompat(emission, 'react-lifecycle', 'godot_node_reference') },
    arguments: [{ kind: 'identifier-expression', name: ref }],
  };
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

/**
 * A body's `<RigidBody>` props from its class and setters (with `resources` for its material):
 * Rapier's own props for what Rapier consumes (type, sensor, friction and bounce with Godot's
 * combine rules, gravity scale, damping, axis locks) and `userData` for the rest by Godot name.
 * `shapes` is its collision shapes' Godot-only settings by collider name.
 */
function bodyProps(
  emission: Emission,
  className: string,
  sensor: boolean,
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
    else if (name === 'set_use_continuous_collision_detection') props.set('ccd', literal(plainValue(entry.value) as boolean));
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
  if (!sensor) {
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
    if (child.idiom?.form.kind !== 'collider') continue;
    const entry: Record<string, unknown> = {};
    if (setterValue(child.setters, 'set_disabled')?.kind === 'bool' && (setterValue(child.setters, 'set_disabled') as { value: boolean }).value) entry['disabled'] = true;
    const shape = resourceOf(emission, setterValue(child.setters, 'set_shape'));
    const backface = shape === undefined ? undefined : setterValue(shape.setters, 'set_backface_collision_enabled');
    if (backface?.kind === 'bool') entry['backface_collision'] = backface.value;
    if (Object.keys(entry).length > 0) shapes[child.name] = entry;
  }
  return shapes;
}


/**
 * A body's children, its colliders told whether they are an area's sensors: a sensor also reports
 * kinematic and fixed bodies (Rapier leaves those pairs out by default; a CharacterBody3D is
 * kinematic, an area fixed).
 */
function sensorChildren(emission: Emission, sensor: boolean, children: () => TargetTsJsxChild[]): TargetTsJsxChild[] {
  const outer = emission.sensor.current;
  emission.sensor.current = sensor;
  try {
    return children();
  } finally {
    emission.sensor.current = outer;
  }
}

/**
 * An area's sensor events: each collider pair Rapier reports starting or stopping to intersect the
 * sensor enters or leaves the area (`godot_area_3d_intersection`).
 */
function sensorEvents(emission: Emission): TargetTsJsxAttribute[] {
  const handler = useCompat(emission, 'area-3d', 'godot_area_3d_intersection');
  return (['onIntersectionEnter', 'onIntersectionExit'] as const).map((prop) =>
    attribute(prop, {
      kind: 'arrow-expression',
      parameters: [{ name: 'event' }],
      body: {
        kind: 'call-expression',
        callee: { kind: 'identifier-expression', name: handler },
        arguments: [{ kind: 'identifier-expression', name: 'event' }, { kind: 'literal-expression', value: prop === 'onIntersectionEnter' }],
      },
    }),
  );
}

/** A dynamic body's contacts, which compat reports as its `body_entered` and `body_exited` while monitoring. */
function contactEvents(emission: Emission): TargetTsJsxAttribute[] {
  const handler = useCompat(emission, 'rigid-body-3d', 'godot_rigid_body_3d_contact');
  return (['onCollisionEnter', 'onCollisionExit'] as const).map((prop) =>
    attribute(prop, {
      kind: 'arrow-expression',
      parameters: [{ name: 'event' }],
      body: {
        kind: 'call-expression',
        callee: { kind: 'identifier-expression', name: handler },
        arguments: [{ kind: 'identifier-expression', name: 'event' }, { kind: 'literal-expression', value: prop === 'onCollisionEnter' }],
      },
    }),
  );
}

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
    const sensorTypes: TargetTsJsxAttribute[] = [];
    if (emission.sensor.current) {
      emission.rapierCore.add('ActiveCollisionTypes');
      const types = (member: string): TargetTsExpression => ({ kind: 'property-expression', object: { kind: 'identifier-expression', name: 'ActiveCollisionTypes' }, property: member });
      sensorTypes.push(attribute('activeCollisionTypes', { kind: 'binary-expression', operator: '|', left: { kind: 'binary-expression', operator: '|', left: types('DEFAULT'), right: types('KINEMATIC_FIXED') }, right: types('FIXED_FIXED') }));
    }
    return element(component, [name, attribute('args', args), ...sensorTypes, ...transform]);
  };
  const idiom = shape.idiom;
  if (idiom?.kind !== 'collider') throw new Error(`${at}: ${shape.className} has no idiomatic collider`);
  switch (idiom.collider) {
    case 'CuboidCollider':
      return tag('CuboidCollider', numbers((componentsValue(setterValue(set, 'set_size')) ?? [1, 1, 1]).map((value) => value / 2)));
    case 'BallCollider':
      return tag('BallCollider', numbers([numberValue(setterValue(set, 'set_radius')) ?? 0.5]));
    case 'CapsuleCollider': {
      // Godot's height spans the caps (`capsule_shape_3d.cpp:100`); Rapier's half height does not.
      const radius = numberValue(setterValue(set, 'set_radius')) ?? 0.5;
      const height = numberValue(setterValue(set, 'set_height')) ?? 2;
      return tag('CapsuleCollider', numbers([height / 2 - radius, radius]));
    }
    case 'ConvexHullCollider':
      return tag('ConvexHullCollider', { kind: 'array-expression', elements: [numbers(componentsValue(setterValue(set, 'set_points')) ?? [])] });
    case 'TrimeshCollider': {
      const faces = componentsValue(setterValue(set, 'set_faces')) ?? [];
      const indices = Array.from({ length: faces.length / 3 }, (_, index) => index);
      return tag('TrimeshCollider', { kind: 'array-expression', elements: [numbers(faces), { kind: 'array-expression', elements: indices.map((index) => ({ kind: 'literal-expression' as const, value: index })) }] });
    }
  }
}

/**
 * A node's Godot-only state the Node protocol seeds from its `userData`: groups and `%Name`; a
 * MeshInstance3D's `skeleton` path, which draws nothing on the unskinned meshes a scene carries
 * (`MeshInstance3D::_resolve_skeleton_path`, mesh_instance_3d.cpp:184; skinned surfaces refuse); a
 * GeometryInstance3D's `transparency` and shadow casting setting.
 */
function nodeData(node: DirectGodotSceneNodePlan): Record<string, unknown> {
  const skeleton = setterValue(node.setters, 'set_skeleton_path');
  // A GeometryInstance3D's `transparency`, which the web's renderer never draws (`geometry-instance-3d.ts`).
  const transparency = setterValue(node.setters, 'set_transparency');
  // Its shadow casting setting, which three's `castShadow` holds only as on or off.
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

/** The setters every Node3D element states the same way: `visible` (three's), `transparency` (`userData`'s). */
const SPATIAL_SETTERS = new Set(['set_visible', 'set_transparency']);

/** A Node3D's authored `visible`, as three's own prop, which hides the subtree as Godot does (`node_3d.cpp:1120`). */
function visibleProp(setters: readonly TargetGodotSceneSetterPlan[]): TargetTsJsxAttribute[] {
  const visible = setterValue(setters, 'set_visible');
  return visible?.kind === 'bool' ? [attribute('visible', { kind: 'literal-expression', value: visible.value })] : [];
}

/** A node with the setters `SPATIAL_SETTERS` states taken out, for the element's own props. */
function withoutSpatial(node: DirectGodotSceneNodePlan): DirectGodotSceneNodePlan {
  return node.setters.some((entry) => SPATIAL_SETTERS.has(entry.setter.exportName))
    ? { ...node, setters: node.setters.filter((entry) => !SPATIAL_SETTERS.has(entry.setter.exportName)) }
    : node;
}

/** An instanced scene's root as its prefab element, with the instance's overrides as props. */
function instanceElement(emission: Emission, node: DirectGodotSceneNodePlan, name: TargetTsJsxAttribute, transform: TargetTsJsxAttribute[], at: string): TargetTsJsxChild {
  const instanced = emission.scenes.get(node.instance?.sourceResPath ?? '');
  if (instanced === undefined) throw new Error(`${at}: the instanced scene is absent from composition`);
  const local = instanced.exportName;
  emission.instances.set(local, moduleSpecifier(emission.scene.targetPath, instanced.targetPath));
  const rootClass = godotSceneRootClass(emission.scenes, instanced.sourceResPath) as string;
  const rootIdiom = godotSceneRootIdiom(emission.scenes, instanced.sourceResPath);
  const overrides: TargetTsJsxAttribute[] = [];
  // The instance's groups join its scene root's (`SceneState::instantiate`, packed_scene.cpp:511).
  const rootData = nodeData(instanced.root);
  const ownData = nodeData(node);
  const data: Record<string, unknown> = {
    ...rootData,
    ...ownData,
    ...(ownData['groups'] === undefined ? {} : { groups: [...new Set([...((rootData['groups'] ?? []) as string[]), ...(ownData['groups'] as string[])])] }),
  };
  // `visible` is the root element's three prop; `transparency` its `userData`'s.
  const stated = withoutSpatial(node);
  overrides.push(...visibleProp(node.setters));
  const rootBody = rootIdiom?.form.kind === 'body' ? rootIdiom.form : undefined;
  const familyProps = stated.setters.length > 0 && rootIdiom?.form.kind === 'element' ? familyInstanceProps(emission.family, stated, instanced.root.setters) : undefined;
  if (familyProps !== undefined) {
    overrides.push(...familyProps);
    if (Object.keys(ownData).length > 0) overrides.push(attribute('userData', dataExpression(data)));
  } else if (rootBody !== undefined) {
    // The overridden values merged over the prefab's own: the props that differ from its root's
    // (a `userData` always whole, since the element's replaces the prefab's).
    const merged = [...instanced.root.setters.filter((own) => !node.setters.some((entry) => sameSetter(entry, own))), ...node.setters];
    const resources = new Map([...instanced.resources, ...emission.scene.resources].map((resource) => [resource.key, resource] as const));
    const shapes = shapeData({ ...emission, resources: new Map(instanced.resources.map((resource) => [resource.key, resource] as const)) }, instanced.root);
    const own = bodyProps(emission, rootClass, rootBody.sensor, instanced.root.setters, new Map(instanced.resources.map((resource) => [resource.key, resource] as const)), shapes, rootData);
    for (const [prop, value] of bodyProps(emission, rootClass, rootBody.sensor, merged, resources, shapes, data)) {
      if (JSON.stringify(own.get(prop)) !== JSON.stringify(value)) overrides.push(attribute(prop, value));
    }
  } else {
    if (stated.setters.length > 0) throw new Error(`${at}: overrides on an instanced ${rootClass} have no idiomatic form`);
    if (Object.keys(ownData).length > 0) overrides.push(attribute('userData', dataExpression(data)));
  }
  // Its overrides of the instanced scene root script's fields, which that component's script takes.
  if (node.instanceExports !== undefined) {
    overrides.push(
      attribute('exports', {
        kind: 'object-expression',
        properties: node.instanceExports.map((field) => ({ key: field.fieldName, value: fieldValue(emission, node, field.value) })),
      }),
    );
  }
  const children = node.children.map((child) => nodeElement(emission, child));
  const ref = rootBody !== undefined ? nodeRef(emission, node, 'RapierRigidBody', 'rapier') : nodeRef(emission, node, rootIdiom?.three ?? 'Group');
  return element(local, [name, ...ref, ...transform, ...overrides], children);
}

/** The URL the project serves an imported model's file at (its copied asset). */
function importedModelUrl(resPath: string): string {
  return `/godot/${resPath.slice('res://'.length)}`;
}

/**
 * An instanced imported model: compat's `<GodotImportedScene>` over drei's `useGLTF`, with the
 * importer's tree from its data file, the bone poses the scene sets on its nodes as `overrides`,
 * the instance's own children as JSX children, and the nodes placed under a model node inside
 * `<GodotPlaced at>`.
 */
function modelElement(emission: Emission, node: DirectGodotSceneNodePlan, name: TargetTsJsxAttribute, transform: TargetTsJsxAttribute[]): TargetTsJsxChild {
  const model = node.model as NonNullable<DirectGodotSceneNodePlan['model']>;
  const file = godotImportedModelDataPath(model.sourceResPath);
  let local = [...emission.models].find(([, path]) => path === file)?.[0];
  if (local === undefined) {
    local = `${camelName(path.posix.basename(model.sourceResPath).replace(/\.[^.]+$/u, ''))}Model`;
    for (let n = 2; emission.family.taken.has(local); n += 1) local = `${camelName(path.posix.basename(model.sourceResPath).replace(/\.[^.]+$/u, ''))}Model${String(n)}`;
    emission.family.taken.add(local);
    emission.models.set(local, file);
  }
  const overrides: TargetTsObjectProperty[] = [];
  for (const override of model.overrides) {
    const slot = (setter: (typeof override.setters)[number]) => setter.modelSlot?.kind;
    const bones = override.setters.filter((setter) => slot(setter) === 'bone-pose');
    const layers = override.setters.find((setter) => slot(setter) === 'layers');
    const moved = override.setters.find((setter) => slot(setter) === 'transform');
    const surfaces = override.setters.filter((setter) => slot(setter) === 'surface-material');
    const others = override.setters.filter((setter) => slot(setter) === 'player');
    overrides.push({
      key: override.at,
      value: {
        kind: 'object-expression',
        properties: [
          ...bones.map((setter) => ({ key: `bones/${String(setter.index)}/${setter.modelSlot?.kind === 'bone-pose' ? setter.modelSlot.component : ''}`, value: dataExpression(plainValue(setter.value)) })),
          // A mesh of the model's render layers (compat's `set_layer_mask`).
          ...(layers === undefined ? [] : [{ key: 'layers', value: dataExpression(plainValue(layers.value)) }]),
          // A node of the model placed anew (compat's `set_transform`), its matrix column-major.
          ...(moved === undefined ? [] : [{ key: 'transform', value: dataExpression(plainValue(moved.value)) }]),
          // A mesh of the model's surface materials, the scene's own (three's materials).
          ...familyMaterialOverride(emission.family, surfaces),
          // An AnimationPlayer of the model: compat's player props (`familyAnimationOverride`).
          ...(others.length === 0 && override.animation === undefined ? [] : familyAnimationOverride(emission.family, override.at, others, override.animation)),
        ],
      },
    });
  }
  useCompat(emission, 'packed-scene', 'GodotImportedScene');
  const placed = new Map<string, TargetTsJsxChild[]>();
  for (const placement of node.placements ?? []) {
    placed.set(placement.at, [...(placed.get(placement.at) ?? []), nodeElement(emission, placement.node)]);
  }
  const placements = [...placed].map(([at, children]) => {
    useCompat(emission, 'packed-scene', 'GodotPlaced');
    return element('GodotPlaced', [{ kind: 'jsx-string-attribute', name: 'at', value: at }], children);
  });
  return element(
    'GodotImportedScene',
    [
      name,
      ...nodeRef(emission, node, 'Group'),
      { kind: 'jsx-string-attribute', name: 'src', value: importedModelUrl(model.sourceResPath) },
      attribute('tree', { kind: 'identifier-expression', name: local }),
      ...transform,
      ...(overrides.length === 0 ? [] : [attribute('overrides', { kind: 'object-expression', properties: overrides })]),
      // The file's external images: the project's imported textures, shared with every other use.
      ...(model.images === undefined
        ? []
        : [
            attribute('images', {
              kind: 'object-expression',
              properties: model.images.map((image) => ({
                key: String(image.index),
                value: { kind: 'identifier-expression' as const, name: importedTextureHook(emission.family, `ext:${image.load.sourceResPath}`, image.load) },
              })),
            }),
          ]),
    ],
    [...node.children.map((child) => nodeElement(emission, child)), ...placements],
  );
}

function sameSetter(left: TargetGodotSceneSetterPlan, right: TargetGodotSceneSetterPlan): boolean {
  return left.setter.exportName === right.setter.exportName && left.index === right.index;
}

/** A GeometryInstance3D's visibility range setters, by the `<GodotVisibilityRange>` prop each states. */
const VISIBILITY_RANGE_PROPS: Readonly<Record<string, string>> = {
  set_visibility_range_begin: 'begin',
  set_visibility_range_begin_margin: 'beginMargin',
  set_visibility_range_end: 'end',
  set_visibility_range_end_margin: 'endMargin',
  set_visibility_range_fade_mode: 'fadeMode',
};

/** The transform components a node authored as properties, which three's own props state. */
const SPATIAL_COMPONENTS = new Set(['position', 'rotation', 'scale']);

/** The three object a family element (a compat element, mesh, light, camera or probe) mounts. */
function familyThree(idiom: GodotSceneNodeIdiom | undefined): string | undefined {
  const kind = idiom?.form.kind;
  return kind === 'element' || kind === 'mesh' || kind === 'light' || kind === 'camera' || kind === 'reflection-probe' ? idiom?.three : undefined;
}

function nodeElement(emission: Emission, node: DirectGodotSceneNodePlan): TargetTsJsxChild {
  const className = node.classes[0] as string;
  const idiom = node.idiom;
  const at = `${emission.scene.sourceResPath}#${node.nodePath}`;
  const matrix = node.properties.find((entry) => entry.propertyName === 'transform')?.value;
  const name: TargetTsJsxAttribute = { kind: 'jsx-string-attribute', name: 'name', value: node.name };
  // A camera, light or reflection probe draws with its scale removed (`disable_scale`,
  // node_3d.cpp:655; set by Camera3D, Light3D and ReflectionProbe): with no children and no script
  // to read it back, its authored scale (the rounding a `.tscn` rotation carries) changes nothing,
  // and the element states none.
  const scaleless = idiom?.scaleless === true && node.children.length === 0 && node.scriptInstance === undefined;
  // A node authored with position, rotation and scale (Godot's YXZ Euler) states them as they are.
  // (A class's own properties, a camera's lens, are its element's.)
  const components = node.properties.filter((entry) => SPATIAL_COMPONENTS.has(entry.propertyName)).flatMap((entry): TargetTsJsxAttribute[] => {
    const value = entry.value as readonly number[];
    if (entry.propertyName === 'rotation') return [attribute('rotation', { kind: 'array-expression', elements: [...value.map((component) => literal(component)), literal('YXZ')] })];
    return [attribute(entry.propertyName, numbers(value))];
  });
  const transform = [...transformAttributes(at, matrix), ...components].filter(
    (entry) => !scaleless || entry.kind === 'jsx-spread-attribute' || entry.name !== 'scale',
  );
  // three's `DirectionalLight` starts at (0, 1, 0) (`Object3D.DEFAULT_UP`); Godot's at the origin.
  if (idiom?.origin === true && !transform.some((entry) => entry.kind !== 'jsx-spread-attribute' && entry.name === 'position')) {
    transform.push(attribute('position', numbers([0, 0, 0])));
  }
  transform.push(...authoredLocalAttributes(matrix as readonly number[] | undefined, transform));
  const children = () => node.children.map((child) => nodeElement(emission, child));
  if (node.model !== undefined) return modelElement(emission, node, name, transform);
  if (node.instance !== undefined) return instanceElement(emission, node, name, transform, at);
  if (idiom === undefined) throw new Error(`${at}: ${className} has no idiomatic element`);
  const form = idiom.form;
  if (form.kind === 'body') {
    const body = form;
    emission.rapier.add('RigidBody');
    const props = bodyProps(emission, className, body.sensor, node.setters, emission.resources, shapeData(emission, node), nodeData(node));
    return element('RigidBody', [
      name,
      ...nodeRef(emission, node, 'RapierRigidBody', 'rapier'),
      { kind: 'jsx-string-attribute', name: 'type', value: body.type },
      attribute('colliders', { kind: 'literal-expression', value: false }),
      ...(body.sensor ? [flag('sensor'), ...sensorEvents(emission)] : []),
      ...(body.type === 'dynamic' ? contactEvents(emission) : []),
      ...transform,
      ...[...props].map(([prop, value]) => attribute(prop, value)),
    ], sensorChildren(emission, body.sensor, children));
  }
  const visible = visibleProp(node.setters);
  const own = withoutSpatial(node);
  // A carried family's element (`scene-family-elements.ts`), inside its visibility range when it has one.
  const range = own.setters.filter((entry) => VISIBILITY_RANGE_PROPS[entry.setter.exportName] !== undefined);
  const family = familyElement(emission.family, form, range.length === 0 ? own : { ...own, setters: own.setters.filter((entry) => !range.includes(entry)) });
  if (family !== undefined) {
    const drawn = element(family.tag, [name, ...nodeRef(emission, node, idiom.three), ...transform, ...visible, ...family.attributes, ...nodeDataAttribute(node)], [
      ...family.children,
      ...children(),
    ]);
    if (range.length === 0) return drawn;
    return element(
      useCompat(emission, 'geometry-instance-3d', 'GodotVisibilityRange'),
      range.map((entry) => attribute(VISIBILITY_RANGE_PROPS[entry.setter.exportName] as string, dataExpression(plainValue(entry.value)))),
      [drawn],
    );
  }
  switch (form.kind) {
    case 'plain-node': {
      const tag = useCompat(emission, form.module, form.exportName);
      return element(tag, [name, ...nodeRef(emission, node, idiom.three), ...nodeDataAttribute(node)], children());
    }
    case 'group':
      return element('group', [name, ...nodeRef(emission, node, idiom.three), ...transform, ...visible, ...nodeDataAttribute(node)], children());
    case 'collider':
      return collider(emission, node, name, transform, at);
    case 'component': {
      const tag = useCompat(emission, form.module, form.exportName);
      return element(tag, [name, ...nodeRef(emission, node, idiom.three), ...transform, ...visible, ...own.setters.map(componentProp), ...nodeDataAttribute(node)], children());
    }
    default:
      throw new Error(`${at}: ${className} has no idiomatic element`);
  }
}

/** The first Camera3D the scene holds, in tree order, or the one authored current. */
function currentCamera(node: DirectGodotSceneNodePlan): { readonly first?: string; readonly authored?: string } {
  let first: string | undefined;
  let authored: string | undefined;
  const walk = (entry: DirectGodotSceneNodePlan) => {
    if (entry.idiom?.form.kind === 'camera') {
      first ??= entry.nodePath;
      const current = setterValue(entry.setters, 'set_current');
      if (current?.kind === 'bool' && current.value) authored ??= entry.nodePath;
    }
    for (const child of godotSceneSubnodes(entry)) walk(child);
  };
  walk(node);
  return { ...(first === undefined ? {} : { first }), ...(authored === undefined ? {} : { authored }) };
}

/** The props an instancing scene hands the root, by the root element. */
function rootPropsType(
  tag: string,
  targetPath: string,
  three: string | undefined,
  rootNode: DirectGodotSceneNodePlan,
): { readonly type: TargetTsType; readonly children: boolean; readonly from?: { readonly module: string; readonly name: string } } {
  const omitRef = (type: TargetTsType): TargetTsType => ({ kind: 'type-reference', name: 'Omit', arguments: [type, { kind: 'literal-type', value: 'ref' }] });
  // An inherited scene (its root an instance of its base): the base component's own props.
  if (rootNode.instance !== undefined) {
    return { type: { kind: 'indexed-access-type', object: { kind: 'type-reference', name: 'Parameters', arguments: [{ kind: 'type-query', name: tag }] }, index: { kind: 'literal-type', value: 0 } }, children: true };
  }
  // A scene inheriting an imported model: the model element's group props.
  if (rootNode.model !== undefined) {
    return {
      type: omitRef({ kind: 'indexed-access-type', object: { kind: 'type-reference', name: 'ThreeElements', arguments: [] }, index: { kind: 'literal-type', value: 'group' } }),
      children: true,
      from: { module: '@react-three/fiber', name: 'ThreeElements' },
    };
  }
  // A compat element's own props (`useGodotElement`).
  if (tag.startsWith('Godot') && three !== undefined) {
    return {
      type: { kind: 'type-reference', name: 'GodotSceneRootProps', arguments: [] },
      children: true,
      from: { module: moduleSpecifier(targetPath, 'src/lib/godot-compat/react-lifecycle.tsx'), name: 'GodotSceneRootProps' },
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
    scriptHooks: [],
    lifecycle: { react: new Set(), fiber: new Set(), rapier: new Set(), compat: new Map() },
    sensor: { current: false },
    rapierCore: new Set(),
    refNames: new Set(),
    needsRef: new Set(scene.refs.targets),
    nodeRefs: new Map(),
    rapierTypes: new Set(),
    scenes: new Map(project.scenes.map((entry) => [entry.sourceResPath, entry] as const)),
    instances: new Map(),
    models: new Map(),
    autoloads: autoloadReferences.length === 0 ? undefined : directGodotSceneAutoloadContextName(scene.exportName),
    rootExports: scene.refs.rootExports,
    rootRef: scene.refs.rootRef,
    refTypes: new Map(),
  };
  const node = nodeElement(emission, scene.root) as TargetTsJsxElementShape & { readonly kind: 'jsx-element-child' };
  emission.hooks.push(...emission.scriptHooks.flatMap((hook) => hook()));
  for (const [name, module] of emission.lifecycle.compat) useCompat(emission, module, name);
  for (const name of emission.lifecycle.rapier) emission.rapier.add(name);
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
  // The scene enters the tree last, once its scripts are attached and its signals connected: its
  // component's last effect, so every script of the scene exists before any `_ready` runs
  // (`SceneState::instantiate` makes the whole scene before `add_child` enters it). It returns the
  // scenes scripts add under its nodes, which the component renders.
  let added = 'addedScenes';
  for (let n = 2; emission.refNames.has(added); n += 1) added = `addedScenes${String(n)}`;
  emission.hooks.push({
    kind: 'variable-statement',
    declaration: 'const',
    name: added,
    initializer: {
      kind: 'call-expression',
      callee: { kind: 'identifier-expression', name: useCompat(emission, 'react-lifecycle', 'useGodotScene') },
      arguments: [{ kind: 'identifier-expression', name: emission.nodeRefs.get(scene.root.nodePath) as string }],
    },
  });
  // An instancing scene's props (its name, transform, …) reach the root, and its children follow
  // the scene's own: the prefab form.
  const rootThree = scene.root.instance === undefined && scene.root.model === undefined ? familyThree(scene.root.idiom) : undefined;
  if (node.tag.startsWith('Godot') && rootThree !== undefined) emission.three.add(rootThree);
  const props = rootPropsType(node.tag, scene.targetPath, rootThree, scene.root);
  const root: TargetTsJsxElementShape & { readonly kind: 'jsx-element-child' } = {
    ...node,
    // Its instancers' overrides of its script's fields are the `exports` prop, not the root's.
    attributes: [...node.attributes, { kind: 'jsx-spread-attribute', value: { kind: 'identifier-expression', name: emission.rootExports || emission.rootRef ? 'rest' : 'props' } }],
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
  // The root's handle for an instancing scene that refers to it (React's `ref` prop).
  const rootRefType = emission.refTypes.get(scene.root.nodePath) ?? 'Object3D';
  if (emission.rootRef) {
    emission.hooks.push({
      kind: 'expression-statement',
      expression: {
        kind: 'call-expression',
        callee: { kind: 'identifier-expression', name: 'useImperativeHandle' },
        arguments: [
          { kind: 'identifier-expression', name: 'ref' },
          {
            kind: 'arrow-expression',
            parameters: [],
            body: {
              kind: 'as-expression',
              expression: { kind: 'property-expression', object: { kind: 'identifier-expression', name: emission.nodeRefs.get(scene.root.nodePath) as string }, property: 'current' },
              type: { kind: 'type-reference', name: rootRefType, arguments: [] },
            },
          },
          { kind: 'array-expression', elements: [] },
        ],
      },
    });
  }
  const reactNames = [
    ...(emission.autoloads === undefined ? [] : ['createContext', 'useContext']),
    ...(emission.rootRef ? ['useImperativeHandle'] : []),
    ...(emission.refNames.size === 0 ? [] : ['useRef']),
    ...[...emission.lifecycle.react].sort(),
  ];
  const imports: TargetTsStatement[] = [
    ...(emission.rapierCore.size === 0
      ? []
      : [{ kind: 'import-statement' as const, module: '@dimforge/rapier3d-compat', namedBindings: [...emission.rapierCore].sort().map((name) => ({ imported: name, local: name })) }]),
    ...(emission.lifecycle.fiber.size === 0
      ? []
      : [{ kind: 'import-statement' as const, module: '@react-three/fiber', namedBindings: [...emission.lifecycle.fiber].sort().map((name) => ({ imported: name, local: name })) }]),
    ...(reactNames.length === 0
      ? []
      : [{ kind: 'import-statement' as const, module: 'react', namedBindings: reactNames.map((name) => ({ imported: name, local: name })) }]),
    ...(emission.autoloads === undefined && !emission.rootRef
      ? []
      : [
          {
            kind: 'import-statement' as const,
            module: 'react',
            namedBindings: [...(emission.rootRef ? ['Ref'] : []), ...(emission.autoloads === undefined ? [] : ['RefObject'])].map((name) => ({ imported: name, local: name })),
            typeOnly: true as const,
          },
        ]),
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
    ...[...emission.models].map(([local, file]) => ({
      kind: 'import-statement' as const,
      module: moduleSpecifier(scene.targetPath, file),
      defaultBinding: local,
      namedBindings: [],
    })),
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
        parameters: [
          {
            name: 'props',
            type:
              emission.rootExports || emission.rootRef
                ? {
                    kind: 'intersection-type',
                    members: [
                      props.type,
                      {
                        kind: 'object-type',
                        properties: [
                          ...(emission.rootExports ? [{ name: 'exports', type: { kind: 'type-reference' as const, name: 'Record', arguments: [{ kind: 'keyword-type' as const, keyword: 'string' as const }, { kind: 'keyword-type' as const, keyword: 'unknown' as const }] }, readonly: true as const, optional: true as const }] : []),
                          ...(emission.rootRef ? [{ name: 'ref', type: { kind: 'type-reference' as const, name: 'Ref', arguments: [{ kind: 'type-reference' as const, name: rootRefType, arguments: [] }] }, readonly: true as const, optional: true as const }] : []),
                        ],
                      },
                    ],
                  }
                : props.type,
          },
        ],
        body: [
          ...(emission.rootExports || emission.rootRef
            ? [{ kind: 'destructure-statement' as const, names: [...(emission.rootExports ? ['exports'] : []), ...(emission.rootRef ? ['ref'] : [])], rest: 'rest', initializer: { kind: 'identifier-expression' as const, name: 'props' } }]
            : []),
          ...family.hooks,
          ...emission.hooks,
          {
            kind: 'return-statement',
            expression: { kind: 'jsx-fragment-expression', children: [root, { kind: 'jsx-expression-child', value: { kind: 'identifier-expression', name: added } }] },
          },
        ],
      },
    ],
  };
}
