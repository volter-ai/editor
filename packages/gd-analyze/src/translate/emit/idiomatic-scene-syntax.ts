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
  DirectGodotProcessDeltaPlan,
  DirectGodotProjectCompositionPlan,
  DirectGodotSceneDocumentPlan,
  DirectGodotSceneNodePlan,
  DirectGodotScriptInstancePlan,
} from '../data/direct-project-composition-plan';
import { type ScriptLifecycleImports, scriptLifecycleHooks } from './script-lifecycle-hooks';
import type { TargetGodotSceneConnectionPlan, TargetGodotSceneResourcePlan, TargetGodotSceneSetterPlan, TargetGodotSceneValue } from '../data/scene-document-plan';
import { directGodotSceneAutoloadContextName } from './direct-autoload-syntax';
import { godotImportedModelDataPath, godotSceneSubnodes } from '../data/scene-document-plan';
import type { GodotSceneBodyProp } from '../data/scene-body-idioms';
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
  familyModelMaterialOverride,
  familyModelMaterials,
  flag,
  float32Literal,
  importedTextureHook,
  literal,
  moduleSpecifier,
  numberValue,
  numbers,
  setterValue,
  useCompat as familyUseCompat,
  variantValue,
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
  // (The plan refuses a transform with shear, `scene-body-idioms.ts`.)
  const [cx, cy, cz] = columns as [number[], number[], number[]];
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
  /** The scripts' node fields, handed after every script is attached (`useGodotNodeReferences`). */
  readonly referenceHooks: (() => TargetTsStatement[])[];
  /** What the scripts' lifecycle hooks import (`script-lifecycle-hooks.ts`). */
  readonly lifecycle: ScriptLifecycleImports;
  /** The plan's bound on the delta a frame hands `_process`. */
  readonly processDelta: DirectGodotProcessDeltaPlan;
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
  /** The prefab components the scene instances, by name, with their modules. */
  readonly instances: Map<string, string>;
  /** The imported models' data files the scene reads, by local name. */
  readonly models: Map<string, string>;
  /** The scene's autoload context (`<Scene>Autoloads`), when its scripts read autoloads. */
  readonly autoloads: string | undefined;
  /** Whether a scene instancing this one overrides its root script's fields (its `exports` prop). */
  readonly rootExports: boolean;
  /** Whether an instancer connects methods to the root script's signals (`connections`). */
  readonly rootConnections: boolean;
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
  const own: TargetTsExpression = {
    kind: 'call-expression',
    callee: { kind: 'identifier-expression', name: 'useRef' },
    typeArguments: [{ kind: 'type-reference', name: from === 'three' ? threeLocal(type) : type, arguments: [] }],
    arguments: [{ kind: 'literal-expression', value: null }],
  };
  if (emission.rootRef && node.nodePath === emission.scene.root.nodePath) {
    // The root's ref is the instancer's when it passes one, so the instancer holds the root as soon
    // as the root's element sets it: a `<RigidBody>` sets its body in its own effect, after any
    // layout-time handle would have read it.
    let ownName = `own${refName.charAt(0).toUpperCase()}${refName.slice(1)}`;
    for (let n = 2; emission.family.taken.has(ownName); n += 1) ownName = `own${refName.charAt(0).toUpperCase()}${refName.slice(1)}${String(n)}`;
    emission.family.taken.add(ownName);
    emission.hooks.push(
      { kind: 'variable-statement', declaration: 'const', name: ownName, initializer: own },
      {
        kind: 'variable-statement',
        declaration: 'const',
        name: refName,
        initializer: { kind: 'binary-expression', operator: '??', left: { kind: 'identifier-expression', name: 'ref' }, right: { kind: 'identifier-expression', name: ownName } },
      },
    );
  } else {
    emission.hooks.push({ kind: 'variable-statement', declaration: 'const', name: refName, initializer: own });
  }
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
    // The scene's methods on the script's own signals: its own connections', then an instancer's.
    const connections: TargetTsExpression[] = [
      ...handedConnections(emission, node, 'script-connections'),
      ...(node.nodePath === emission.scene.root.nodePath && emission.rootConnections ? [{ kind: 'identifier-expression' as const, name: 'connections' }] : []),
    ];
    const scriptArguments = (): TargetTsExpression[] => {
      const own: TargetTsExpression = {
        kind: 'object-expression',
        properties: [
          ...values.map((field) => ({ key: field.fieldName, value: fieldValue(emission, node, field.value) })),
          ...(node.fieldValues ?? []).map((field) => ({ key: field.field, value: variantValue(emission.family, field.value) })),
        ],
      };
      // A scene root whose instancers override its script's fields: theirs over its own.
      const exported: TargetTsExpression =
        node.nodePath === emission.scene.root.nodePath && emission.rootExports
          ? { kind: 'call-expression', callee: { kind: 'property-expression', object: { kind: 'identifier-expression', name: 'Object' }, property: 'assign' }, arguments: [own, { kind: 'identifier-expression', name: 'exports' }] }
          : own;
      // The autoloads the script reads, each its field and the ref the world mounts it into.
      const autoloads: TargetTsExpression = {
        kind: 'object-expression',
        properties:
          emission.autoloads === undefined
            ? []
            : script.autoloadReferences.map((reference) => ({
                key: reference.fieldName,
                value: { kind: 'property-expression' as const, object: { kind: 'identifier-expression' as const, name: 'autoloads' }, property: reference.name },
              })),
      };
      const hasAutoloads = script.autoloadReferences.length > 0 && emission.autoloads !== undefined;
      if (connections.length > 0) return [exported, autoloads, { kind: 'array-expression', elements: connections }];
      if (hasAutoloads) return [exported, autoloads];
      return exported === own && values.length === 0 && (node.fieldValues ?? []).length === 0 ? [] : [exported];
    };
    // A field holding a node is handed once every script of the scene is attached, so a scripted
    // node is its script instance wherever it is in the scene.
    const values = script.fields.filter((field) => field.value.kind !== 'node-reference');
    const nodes = script.fields.filter((field) => field.value.kind === 'node-reference');
    if (nodes.length > 0) referenceHook(emission, node, node.nodePath, nodes);
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
          ...scriptArguments(),
        ],
      },
    }, ...scriptLifecycleHooks(scriptName, refName, script.lifecycle, emission.lifecycle, emission.processDelta, script.ownsTimed)]);
  }
  return [attribute('ref', { kind: 'identifier-expression', name: refName })];
}

/**
 * The hook handing a script's node fields (`useGodotNodeReferences`), on the ref of the node running
 * it, printed after every script of the scene attaches (`referenceHooks`).
 */
function referenceHook(emission: Emission, node: DirectGodotSceneNodePlan, holder: string, fields: DirectGodotScriptInstancePlan['fields']): void {
  emission.referenceHooks.push(() => [{
    kind: 'expression-statement',
    expression: {
      kind: 'call-expression',
      callee: { kind: 'identifier-expression', name: useCompat(emission, 'react-lifecycle', 'useGodotNodeReferences') },
      arguments: [
        { kind: 'identifier-expression', name: emission.nodeRefs.get(holder) as string },
        { kind: 'object-expression', properties: fields.map((field) => ({ key: field.fieldName, value: nodeReference(emission, node, field.value.value as string) })) },
      ],
    },
  }]);
}

/** A node a script's field holds, as its ref from the node running the script; null where it leaves the scene. */
function nodeReference(emission: Emission, node: DirectGodotSceneNodePlan, path: string): TargetTsExpression {
  // An empty NodePath names no node (`Node::get_node_or_null` of an empty path is null).
  const target = path === '' ? undefined : godotResolveNodePath(node.nodePath, path);
  if (target === undefined) return { kind: 'literal-expression', value: null };
  // A node its element mounts later in the scene is named now; its element declares the ref.
  const ref = emission.nodeRefs.get(target) ?? (emission.needsRef.has(target) && target !== '.' ? refLocal(emission, target, target.slice(target.lastIndexOf('/') + 1)) : undefined);
  if (ref === undefined) throw new Error(`${emission.scene.sourceResPath}#${node.nodePath}: the referenced node ${target} mounts no ref`);
  return { kind: 'identifier-expression', name: ref };
}

/** A script field's authored value; a node reference is handed by `useGodotNodeReferences` instead. */
function fieldValue(emission: Emission, node: DirectGodotSceneNodePlan, value: DirectGodotScriptInstancePlan['fields'][number]['value']): TargetTsExpression {
  if (value.kind === 'node-reference') throw new Error(`${emission.scene.sourceResPath}#${node.nodePath}: a node reference is handed by its hook, not as a value`);
  return { kind: 'literal-expression', value: value.value };
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

/** A planned `<RigidBody>` prop (`scene-body-idioms.ts`) as the expression that states it. */
function bodyProp(emission: Emission, prop: GodotSceneBodyProp): TargetTsJsxAttribute {
  const value = prop.value;
  if (value.kind === 'literal') return attribute(prop.name, literal(value.value));
  if (value.kind === 'data') return attribute(prop.name, dataExpression(value.value));
  emission.rapier.add('CoefficientCombineRule');
  return attribute(prop.name, { kind: 'property-expression', object: { kind: 'identifier-expression', name: 'CoefficientCombineRule' }, property: value.rule });
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

/**
 * The scene's connections a script's own signal takes (`scene-signal-delivery.ts`), as the
 * callbacks it takes: one const (before the scripts for the script's own `useGodotScript`, after
 * them for an instance's prop), with each signal's methods called on their scripts in the scene's
 * order. A callback passes what the signal hands it on as it
 * is (`any`), as a connection does: the method's own parameter type is its own.
 */
function handedConnections(emission: Emission, node: DirectGodotSceneNodePlan, delivery: NonNullable<TargetGodotSceneConnectionPlan['delivery']>): TargetTsExpression[] {
  // A script's own signal takes them as its `useGodotScript` runs, so they are declared before it
  // (its callbacks reach the other scripts only when called); an instance's prop after every
  // script.
  const connections = emission.scene.connections.filter((connection) => connection.delivery === delivery && connection.fromNodePath === node.nodePath);
  if (connections.length === 0) return [];
  const base = `${camelName(node.name)}Connections`;
  let local = base;
  for (let n = 2; emission.family.taken.has(local); n += 1) local = `${base}${String(n)}`;
  emission.family.taken.add(local);
  // The targets' refs are planned (`scene-refs.ts`); a target later in the tree is named now.
  const scriptOf = (target: string) => `${emission.nodeRefs.get(target) ?? refLocal(emission, target, target === '.' ? emission.scene.root.name : target.slice(target.lastIndexOf('/') + 1))}Script`;
  const scripts = new Map(connections.map((connection) => [connection.toNodePath, scriptOf(connection.toNodePath)] as const));
  const declare = (): TargetTsStatement[] => {
    const signals = [...new Set(connections.map((connection) => connection.signal))];
    return [
      {
        kind: 'variable-statement',
        declaration: 'const',
        name: local,
        initializer: {
          kind: 'object-expression',
          properties: signals.map((signal) => {
            const called = connections.filter((connection) => connection.signal === signal);
            // The method's parameters, each of the signal's arguments passed on as it comes, as a
            // connection calls the method with that many of them.
            const count = Math.max(...called.map((connection) => connection.methodParameters ?? 0));
            const parameters = Array.from({ length: count }, (_, index) => ({ name: count === 1 ? 'value' : `value${String(index + 1)}`, type: { kind: 'keyword-type' as const, keyword: 'any' as const } }));
            const calls: TargetTsExpression[] = called.map((connection) => ({
              kind: 'call-expression',
              callee: {
                kind: 'property-expression',
                object: { kind: 'property-expression', object: { kind: 'identifier-expression', name: scripts.get(connection.toNodePath) as string }, property: 'current' },
                property: connection.method,
                optional: true,
              },
              arguments: parameters.slice(0, connection.methodParameters ?? 0).map((parameter) => ({ kind: 'identifier-expression' as const, name: parameter.name })),
            }));
            return {
              key: signal,
              value: {
                kind: 'arrow-expression' as const,
                parameters,
                body: calls.length === 1 ? (calls[0] as TargetTsExpression) : calls.map((call): TargetTsStatement => ({ kind: 'expression-statement', expression: call })),
              },
            };
          }),
        },
      },
    ];
  };
  if (delivery === 'script-connections') emission.hooks.push(...declare());
  else emission.referenceHooks.push(declare);
  return [{ kind: 'identifier-expression', name: local }];
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
  // The plan's collider (`scene-body-idioms.ts`), which refuses what has no form.
  const planned = node.collider;
  if (planned === undefined) throw new Error(`${at}: a collision shape the plan did not form`);
  emission.rapier.add(planned.component);
  const sensorTypes: TargetTsJsxAttribute[] = [];
  if (emission.sensor.current) {
    emission.rapierCore.add('ActiveCollisionTypes');
    const types = (member: string): TargetTsExpression => ({ kind: 'property-expression', object: { kind: 'identifier-expression', name: 'ActiveCollisionTypes' }, property: member });
    sensorTypes.push(attribute('activeCollisionTypes', { kind: 'binary-expression', operator: '|', left: { kind: 'binary-expression', operator: '|', left: types('DEFAULT'), right: types('KINEMATIC_FIXED') }, right: types('FIXED_FIXED') }));
  }
  const args: TargetTsExpression = planned.args.kind === 'flat' ? numbers(planned.args.values) : { kind: 'array-expression', elements: planned.args.values.map((values) => numbers(values)) };
  return element(planned.component, [name, attribute('args', args), ...(planned.mass === undefined ? [] : [attribute('mass', { kind: 'literal-expression', value: planned.mass })]), ...sensorTypes, ...transform]);
}

/** A node's Godot-only state, as the plan stamps it (`scene-body-idioms.ts`). */
function nodeData(node: DirectGodotSceneNodePlan): Readonly<Record<string, unknown>> {
  return node.data ?? {};
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

/** A Node3D's authored `visible`, as three's own prop, which hides the subtree as Godot does (`node_3d.cpp:1120`). */
function visibleProp(setters: readonly TargetGodotSceneSetterPlan[]): TargetTsJsxAttribute[] {
  const visible = setters.find((entry) => entry.role?.kind === 'visible')?.value;
  return visible?.kind === 'bool' ? [attribute('visible', { kind: 'literal-expression', value: visible.value })] : [];
}

/** A node with its visible and transparency setters (their planned roles) taken out, for the element's own props. */
function withoutSpatial(node: DirectGodotSceneNodePlan): DirectGodotSceneNodePlan {
  const spatial = (entry: TargetGodotSceneSetterPlan) => entry.role?.kind === 'visible' || entry.role?.kind === 'transparency';
  return node.setters.some(spatial) ? { ...node, setters: node.setters.filter((entry) => !spatial(entry)) } : node;
}

/** An instanced scene's root as its prefab element, with the instance's overrides as props. */
function instanceElement(emission: Emission, node: DirectGodotSceneNodePlan, name: TargetTsJsxAttribute, transform: TargetTsJsxAttribute[], at: string): TargetTsJsxChild {
  // What the plan found of the instanced scene (`scene-body-idioms.ts`): emit reads no other scene.
  const instanced = node.instanceOf;
  if (instanced === undefined) throw new Error(`${at}: the instanced scene is absent from composition`);
  const local = instanced.exportName;
  emission.instances.set(local, moduleSpecifier(emission.scene.targetPath, instanced.targetPath));
  const rootClass = instanced.rootClass as string;
  const rootIdiom = instanced.rootIdiom;
  const overrides: TargetTsJsxAttribute[] = [];
  // The instance's groups join its scene root's (`SceneState::instantiate`, packed_scene.cpp:511).
  const ownData = nodeData(node);
  const data = instanced.data;
  // `visible` is the root element's three prop; `transparency` its `userData`'s.
  overrides.push(...visibleProp(node.setters));
  const rootBody = rootIdiom?.form.kind === 'body' ? rootIdiom.form : undefined;
  const familyProps = instanced.stated > 0 && rootIdiom?.form.kind === 'element' ? familyInstanceProps(emission.family, node.nodePath, instanced.changed) : undefined;
  if (familyProps !== undefined) {
    overrides.push(...familyProps);
    if (Object.keys(ownData).length > 0) overrides.push(attribute('userData', dataExpression(data)));
  } else if (rootBody !== undefined) {
    // The props the plan found the instance's overrides change (`scene-body-idioms.ts`).
    overrides.push(...(node.bodyOverrides ?? []).map((prop) => bodyProp(emission, prop)));
  } else if (Object.keys(ownData).length > 0) {
    overrides.push(attribute('userData', dataExpression(data)));
  }
  // Its overrides of the instanced scene root script's fields, which that component's script takes.
  // Its node references are handed here, after this scene's scripts attach and after the instance's
  // own (its component is a child), so they are script instances and override the instance's own.
  const exportedValues = (node.instanceExports ?? []).filter((field) => field.value.kind !== 'node-reference');
  const exportedNodes = (node.instanceExports ?? []).filter((field) => field.value.kind === 'node-reference');
  if (exportedValues.length > 0 || (node.fieldValues ?? []).length > 0) {
    overrides.push(
      attribute('exports', {
        kind: 'object-expression',
        properties: [
          ...exportedValues.map((field) => ({ key: field.fieldName, value: fieldValue(emission, node, field.value) })),
          ...(node.fieldValues ?? []).map((field) => ({ key: field.field, value: variantValue(emission.family, field.value) })),
        ],
      }),
    );
  }
  if (exportedNodes.length > 0) referenceHook(emission, node, node.nodePath, exportedNodes);
  // The methods this scene connects to the instance's root script's signals.
  const connected = handedConnections(emission, node, 'instance-prop');
  if (connected.length > 0) overrides.push(attribute('connections', connected[0] as TargetTsExpression));
  const children = node.children.map((child) => nodeElement(emission, child));
  const ref = rootBody !== undefined ? nodeRef(emission, node, 'RapierRigidBody', 'rapier') : nodeRef(emission, node, rootIdiom?.three ?? 'Group');
  return element(local, [name, ...ref, ...transform, ...overrides], children);
}

/** The URL the project serves an imported model's file at (its copied asset). */
function importedModelUrl(resPath: string): string {
  return `/godot/${resPath.slice('res://'.length)}`;
}

/**
 * An instanced imported model: compat's `<GodotImportedScene>` over three's `GLTFLoader` through R3F's `useLoader`, with the
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
    const materialOverride = override.setters.find((setter) => slot(setter) === 'material-override');
    const castShadow = override.setters.find((setter) => slot(setter) === 'cast-shadow');
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
          // A geometry of the model drawn with one material, and its shadow casting (compat's own).
          ...familyModelMaterialOverride(emission.family, materialOverride),
          ...(castShadow === undefined ? [] : [{ key: 'cast_shadow', value: dataExpression(plainValue(castShadow.value)) }]),
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
      // The importer's external materials: the project's own, by the file's material names.
      ...(model.materials === undefined ? [] : [attribute('materials', { kind: 'object-expression', properties: familyModelMaterials(emission.family, model.materials) })]),
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
      ...modelRefs(emission, node),
      // The model's AnimationPlayers that play its glTF's own clips (`animation-clips.ts`).
      ...(model.clipPlayers === undefined ? [] : [attribute('clipPlayers', { kind: 'array-expression', elements: model.clipPlayers.map((path) => ({ kind: 'literal-expression' as const, value: path })) })]),
      // The importer's physics bodies, each a `<RigidBody>` the model mounts in its node.
      ...(model.bodies === undefined ? [] : [attribute('bodies', dataExpression(model.bodies))]),
    ],
    [...node.children.map((child) => nodeElement(emission, child)), ...placements],
  );
}

/**
 * The refs the scene holds to a model's own nodes (`refs.modelNodes`), which the model's element
 * sets from the tree it builds: `refs={{ "Skeleton/RayFloor": rayFloor }}`.
 */
function modelRefs(emission: Emission, node: DirectGodotSceneNodePlan): TargetTsJsxAttribute[] {
  const held = emission.scene.refs.modelNodes.filter((entry) => entry.holder === node.nodePath);
  if (held.length === 0) return [];
  emission.three.add('Object3D');
  const properties = held.map((entry) => {
    const refName = refLocal(emission, entry.nodePath, entry.at.slice(entry.at.lastIndexOf('/') + 1));
    emission.refTypes.set(entry.nodePath, 'Object3D');
    emission.hooks.push({
      kind: 'variable-statement',
      declaration: 'const',
      name: refName,
      initializer: {
        kind: 'call-expression',
        callee: { kind: 'identifier-expression', name: 'useRef' },
        typeArguments: [{ kind: 'type-reference', name: 'Object3D', arguments: [] }],
        arguments: [{ kind: 'literal-expression', value: null }],
      },
    });
    return { key: entry.at, value: { kind: 'identifier-expression' as const, name: refName } };
  });
  return [attribute('refs', { kind: 'object-expression', properties })];
}

function sameSetter(left: TargetGodotSceneSetterPlan, right: TargetGodotSceneSetterPlan): boolean {
  return left.setter.exportName === right.setter.exportName && left.index === right.index;
}

/** The transform components a node authored as properties, which three's own props state. */
const SPATIAL_COMPONENTS = new Set(['position', 'rotation', 'scale']);

/** The three object a family element (a compat element, mesh, light, camera or probe) mounts. */
function familyThree(idiom: GodotSceneNodeIdiom | undefined): string | undefined {
  const kind = idiom?.form.kind;
  return kind === 'element' || kind === 'mesh' || kind === 'light' || kind === 'camera' || kind === 'reflection-probe' ? idiom?.three : undefined;
}

/** The planned sky lights' refs, handed to the environment that reads them (`skyLights={[sun]}`). */
function skyLightsAttribute(emission: Emission, node: DirectGodotSceneNodePlan): TargetTsJsxAttribute[] {
  if (node.skyLights === undefined) return [];
  return [
    attribute('skyLights', {
      kind: 'array-expression',
      elements: node.skyLights.map((light) => ({ kind: 'identifier-expression' as const, name: refLocal(emission, light.nodePath, light.name) })),
    }),
  ];
}

function nodeElement(emission: Emission, node: DirectGodotSceneNodePlan): TargetTsJsxChild {
  const className = node.classes[0] as string;
  const idiom = node.idiom;
  const at = `${emission.scene.sourceResPath}#${node.nodePath}`;
  const matrix = node.properties.find((entry) => entry.propertyName === 'transform')?.value;
  const name: TargetTsJsxAttribute = { kind: 'jsx-string-attribute', name: 'name', value: node.name };
  // A camera, light or probe the plan found states no scale (`scene-surface-idioms.ts`).
  const scaleless = node.scaleless === true;
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
  // The plan refuses a node with no idiom (`scene-body-idioms.ts`).
  if (idiom === undefined) throw new Error(`${at}: ${className} reached emit without its planned idiom`);
  const form = idiom.form;
  if (form.kind === 'body') {
    const body = form;
    emission.rapier.add('RigidBody');
    const props = node.body ?? [];
    return element('RigidBody', [
      name,
      ...nodeRef(emission, node, 'RapierRigidBody', 'rapier'),
      { kind: 'jsx-string-attribute', name: 'type', value: body.type },
      attribute('colliders', { kind: 'literal-expression', value: false }),
      ...(body.sensor ? [flag('sensor'), ...sensorEvents(emission)] : []),
      ...(body.type === 'dynamic' ? contactEvents(emission) : []),
      ...transform,
      ...props.map((prop) => bodyProp(emission, prop)),
    ], sensorChildren(emission, body.sensor, () => [
      // The body's driver (a vehicle's controller) first, inside the body it drives.
      ...(body.driver === undefined ? [] : [element(useCompat(emission, body.driver.module, body.driver.exportName), [])]),
      ...children(),
    ]));
  }
  const visible = visibleProp(node.setters);
  const own = withoutSpatial(node);
  // A carried family's element (`scene-family-elements.ts`), inside its visibility range when it has one.
  const range = own.setters.filter((entry) => entry.role?.kind === 'visibility-range');
  const family = familyElement(emission.family, form, range.length === 0 ? own : { ...own, setters: own.setters.filter((entry) => !range.includes(entry)) });
  if (family !== undefined) {
    const drawn = element(family.tag, [name, ...nodeRef(emission, node, idiom.three), ...transform, ...visible, ...family.attributes, ...skyLightsAttribute(emission, node), ...nodeDataAttribute(node)], [
      ...family.children,
      ...children(),
    ]);
    if (range.length === 0) return drawn;
    return element(
      useCompat(emission, 'geometry-instance-3d', 'GodotVisibilityRange'),
      range.map((entry) => attribute(entry.role?.kind === 'visibility-range' ? entry.role.prop : '', dataExpression(plainValue(entry.value)))),
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

/** The props an instancing scene hands the root: the plan's root props for its idiom, printed. */
function rootPropsType(
  tag: string,
  targetPath: string,
  rootNode: DirectGodotSceneNodePlan,
): { readonly type: TargetTsType; readonly children: boolean; readonly from?: { readonly module: string; readonly name: string } } {
  const omitRef = (type: TargetTsType): TargetTsType => ({ kind: 'type-reference', name: 'Omit', arguments: [type, { kind: 'literal-type', value: 'ref' }] });
  const ownParameters: TargetTsType = { kind: 'indexed-access-type', object: { kind: 'type-reference', name: 'Parameters', arguments: [{ kind: 'type-query', name: tag }] }, index: { kind: 'literal-type', value: 0 } };
  const threeElement = (element: string) => ({
    type: omitRef({ kind: 'indexed-access-type', object: { kind: 'type-reference', name: 'ThreeElements', arguments: [] }, index: { kind: 'literal-type', value: element } }),
    children: true,
    from: { module: '@react-three/fiber', name: 'ThreeElements' },
  });
  // An inherited scene (its root an instance of its base): the base component's own props.
  if (rootNode.instance !== undefined) return { type: ownParameters, children: true };
  // A scene inheriting an imported model: the model element's group props.
  if (rootNode.model !== undefined) return threeElement('group');
  const props = rootNode.idiom?.rootProps;
  if (props === undefined) throw new Error(`${rootNode.nodePath}: a scene root without its planned idiom`);
  switch (props.kind) {
    case 'compat':
      return {
        type: { kind: 'type-reference', name: props.name, arguments: [] },
        children: true,
        from: { module: moduleSpecifier(targetPath, `src/lib/godot-compat/${props.module}.tsx`), name: props.name },
      };
    case 'component':
      return { type: ownParameters, children: true };
    case 'library': {
      const named: TargetTsType = { kind: 'type-reference', name: props.name, arguments: [] };
      return { type: props.omitRef ? omitRef(named) : named, children: props.children, from: { module: props.module, name: props.name } };
    }
    case 'three-element':
      return threeElement(tag);
  }
}

export function idiomaticSceneSourceFile(
  project: DirectGodotProjectCompositionPlan,
  scene: DirectGodotSceneDocumentPlan,
): TargetTsSourceFile {
  // The camera current as the scene mounts, as the plan found it.
  const cameras = scene.cameras ?? {};
  const autoloadReferences = scene.autoloadReferences ?? [];
  const referencedAutoloads = autoloadReferences.map((reference) => {
    const autoload = project.scriptAutoloads.find((candidate) => candidate.name === reference.name && candidate.scriptResPath === reference.resPath);
    if (autoload === undefined) throw new Error(`${reference.name}: singleton ${reference.resPath} is absent from composition`);
    return autoload;
  });
  const current = cameras.current;
  const scriptClasses = new Map(project.scriptClasses.map((entry) => [entry.scriptResPath, entry.generatedClass] as const));
  const family = familyEmission(scene.targetPath, scene.resources, current, (resPath) => scriptClasses.get(resPath));
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
    referenceHooks: [],
    lifecycle: { react: new Set(), fiber: family.fiber, rapier: new Set(), compat: new Map() },
    processDelta: project.processDelta,
    sensor: { current: false },
    rapierCore: new Set(),
    refNames: new Set(),
    needsRef: new Set(scene.refs.targets),
    nodeRefs: new Map(),
    rapierTypes: new Set(),
    instances: new Map(),
    models: new Map(),
    autoloads: autoloadReferences.length === 0 ? undefined : directGodotSceneAutoloadContextName(scene.exportName),
    rootExports: scene.refs.rootExports,
    rootConnections: scene.refs.rootConnections,
    rootRef: scene.refs.rootRef,
    refTypes: new Map(),
  };
  const node = nodeElement(emission, scene.root) as TargetTsJsxElementShape & { readonly kind: 'jsx-element-child' };
  emission.hooks.push(...emission.scriptHooks.flatMap((hook) => hook()));
  emission.hooks.push(...emission.referenceHooks.flatMap((hook) => hook()));
  for (const [name, module] of emission.lifecycle.compat) useCompat(emission, module, name);
  for (const name of emission.lifecycle.rapier) emission.rapier.add(name);
  // The scene's connections, made once its scripts are attached (`packed_scene.cpp:682`).
  for (const connection of scene.connections.filter((entry) => entry.delivery === undefined)) {
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
  if (scene.root.idiom?.rootProps.kind === 'compat' && rootThree !== undefined) emission.three.add(rootThree);
  const props = rootPropsType(node.tag, scene.targetPath, scene.root);
  const root: TargetTsJsxElementShape & { readonly kind: 'jsx-element-child' } = {
    ...node,
    // Its instancers' overrides of its script's fields are the `exports` prop, not the root's.
    attributes: [...node.attributes, { kind: 'jsx-spread-attribute', value: { kind: 'identifier-expression', name: emission.rootExports || emission.rootRef || emission.rootConnections ? 'rest' : 'props' } }],
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
  const rootRefType = emission.refTypes.get(scene.root.nodePath) ?? 'Object3D';
  const reactNames = [
    ...(emission.autoloads === undefined ? [] : ['createContext', 'useContext']),
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
            namedBindings: ['RefObject'].map((name) => ({ imported: name, local: name })),
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
              emission.rootExports || emission.rootRef || emission.rootConnections
                ? {
                    kind: 'intersection-type',
                    members: [
                      props.type,
                      {
                        kind: 'object-type',
                        properties: [
                          ...(emission.rootExports ? [{ name: 'exports', type: { kind: 'type-reference' as const, name: 'Record', arguments: [{ kind: 'keyword-type' as const, keyword: 'string' as const }, { kind: 'keyword-type' as const, keyword: 'unknown' as const }] }, readonly: true as const, optional: true as const }] : []),
                          ...(emission.rootConnections
                            ? [
                                {
                                  name: 'connections',
                                  // The methods an instancer connects to the root script's signals (`useGodotScript`).
                                  type: {
                                    kind: 'type-reference' as const,
                                    name: 'Readonly',
                                    arguments: [
                                      {
                                        kind: 'type-reference' as const,
                                        name: 'Record',
                                        arguments: [
                                          { kind: 'keyword-type' as const, keyword: 'string' as const },
                                          { kind: 'function-type' as const, parameters: [{ name: 'args', rest: true as const, type: { kind: 'keyword-type' as const, keyword: 'any' as const } }], result: { kind: 'keyword-type' as const, keyword: 'void' as const } },
                                        ],
                                      },
                                    ],
                                  },
                                  readonly: true as const,
                                  optional: true as const,
                                },
                              ]
                            : []),
                          ...(emission.rootRef ? [{ name: 'ref', type: { kind: 'type-reference' as const, name: 'RefObject', arguments: [{ kind: 'union-type' as const, members: [{ kind: 'type-reference' as const, name: rootRefType, arguments: [] }, { kind: 'literal-type' as const, value: null }] }] }, readonly: true as const, optional: true as const }] : []),
                        ],
                      },
                    ],
                  }
                : props.type,
          },
        ],
        body: [
          ...(emission.rootExports || emission.rootRef || emission.rootConnections
            ? [{ kind: 'destructure-statement' as const, names: [...(emission.rootExports ? ['exports'] : []), ...(emission.rootConnections ? ['connections'] : []), ...(emission.rootRef ? ['ref'] : [])], rest: 'rest', initializer: { kind: 'identifier-expression' as const, name: 'props' } }]
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
