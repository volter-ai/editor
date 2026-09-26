import * as path from 'node:path';
import { idiomaticSceneSourceFile, idiomaticTransformAttributes } from './idiomatic-scene-syntax';
import { type FamilyEmission, familyElement, familyEmission, familyImports } from './scene-family-elements';
import { godotFamilyCarriesNode } from '../data/scene-families';
import type {
  TargetTsExpression,
  TargetTsJsxAttribute,
  TargetTsJsxElementShape,
  TargetTsStatement,
  TargetTsType,
} from '../code/target-ts-syntax';
import { TARGET_TS_SYNTAX_VERSION, type TargetTsSourceFile } from '../code/target-ts-syntax';
import type { TargetGodotArrayMeshPlan, TargetGodotSceneSetterPlan, TargetGodotSceneValue } from '../data/scene-document-plan';
import type {
  DirectGodotProjectCompositionPlan,
  DirectGodotSceneNodePlan,
} from '../data/direct-project-composition-plan';
import type { DirectGodotSceneModulePlan } from '../data/direct-scene-module-plan';
import {
  directGodotSceneAutoloadContextName,
  directGodotSceneAutoloadReferences,
} from './direct-autoload-syntax';
import {
  type DirectGodotSceneScriptBinding,
  directGodotSceneLifecycleEffect,
  directGodotScriptBindingDeclarations,
} from './direct-scene-lifecycle-syntax';

export interface EmittedDirectGodotSceneModule {
  readonly sourceResPath: string;
  readonly sourceDigest: string;
  readonly targetPath: string;
  readonly syntax: TargetTsSourceFile;
}

function unreachable(value: never): never {
  throw new Error(`unhandled direct scene plan variant: ${JSON.stringify(value)}`);
}

function literal(value: string | number): TargetTsExpression {
  return { kind: 'literal-expression', value };
}

function tuple(values: readonly (string | number)[]): TargetTsExpression {
  return { kind: 'array-expression', elements: values.map(literal) };
}

/** Godot's Camera3D defaults (`scene/3d/camera_3d.h:68`), as the float values Godot holds. */
const CAMERA_DEFAULTS: readonly (readonly [string, number])[] = [
  ['fov', Math.fround(75)],
  ['near', Math.fround(0.05)],
  ['far', Math.fround(4000)],
];

export function directGodotScenePropertyAttributes(
  property: DirectGodotSceneNodePlan['properties'][number],
): readonly TargetTsJsxAttribute[] {
  switch (property.targetKind) {
    case 'three-position':
      return [{ kind: 'jsx-expression-attribute', name: 'position', value: tuple(property.value) }];
    case 'three-rotation-yxz':
      return [
        {
          kind: 'jsx-expression-attribute',
          name: 'rotation',
          value: tuple([...property.value, 'YXZ']),
        },
      ];
    case 'three-scale':
      return [{ kind: 'jsx-expression-attribute', name: 'scale', value: tuple(property.value) }];
    case 'three-matrix':
      // The local transform, exactly: node-3d.ts owns the decomposition three reads.
      return [
        {
          kind: 'jsx-expression-attribute',
          name: 'matrixAutoUpdate',
          value: { kind: 'literal-expression', value: false },
        },
        { kind: 'jsx-expression-attribute', name: 'matrix', value: tuple(property.value) },
      ];
    case 'camera-fov':
      return [{ kind: 'jsx-expression-attribute', name: 'fov', value: literal(property.value[0] as number) }];
    case 'camera-near':
      return [{ kind: 'jsx-expression-attribute', name: 'near', value: literal(property.value[0] as number) }];
    case 'camera-far':
      return [{ kind: 'jsx-expression-attribute', name: 'far', value: literal(property.value[0] as number) }];
    default:
      return unreachable(property.targetKind);
  }
}

interface SceneEmission {
  /** The carried families' elements, their loaders and imports. */
  readonly family: FamilyEmission;
  readonly nodeRefs: ReadonlyMap<string, string>;
  /** The generated component of each instanced scene, by source path. */
  readonly instanceComponents: ReadonlyMap<string, string>;
  /** The instanced scenes written idiomatically: their prefab takes position, rotation and scale. */
  readonly idiomaticInstances: ReadonlySet<string>;
  /** The module-level name of each resource the scene constructs, by plan key. */
  readonly resourceNames: ReadonlyMap<string, string>;
}

/** A node's children and the nodes it places into an imported model it instances. */
function childNodes(node: DirectGodotSceneNodePlan): readonly DirectGodotSceneNodePlan[] {
  return [...node.children, ...(node.placements ?? []).map((placed) => placed.node)];
}

/** A JSON value as a literal expression. */
function jsonExpression(value: unknown): TargetTsExpression {
  if (Array.isArray(value)) return { kind: 'array-expression', elements: value.map(jsonExpression) };
  if (value !== null && typeof value === 'object') {
    return {
      kind: 'object-expression',
      properties: Object.entries(value).map(([key, entry]) => ({ key, value: jsonExpression(entry) })),
    };
  }
  return { kind: 'literal-expression', value: value as string | number | boolean | null };
}

/** An imported file's asset URL: the file (a `.glb`, an image) copied beside the app (`public/godot/…`). */
export function godotImportedModelUrl(resPath: string): string {
  return `/godot/${resPath.slice('res://'.length)}`;
}

function nodeElement(
  node: DirectGodotSceneNodePlan,
  emission: SceneEmission,
  forwardedProps?: string,
): TargetTsJsxElementShape {
  let tag: string;
  const defaults: TargetTsJsxAttribute[] = [];
  const family = familyElement(emission.family, node);
  if (family !== undefined) {
    tag = family.tag;
    defaults.push(...family.attributes);
  } else switch (node.targetKind) {
    case 'three-group':
    case 'three-node':
      tag = 'group';
      break;
    case 'three-perspective-camera':
      tag = 'perspectiveCamera';
      for (const [name, value] of CAMERA_DEFAULTS) {
        if (!node.properties.some((property) => property.targetKind === `camera-${name}`)) {
          defaults.push({ kind: 'jsx-expression-attribute', name, value: literal(value) });
        }
      }
      break;
    case 'three-mesh':
      tag = 'mesh';
      break;
    case 'three-directional-light':
      tag = 'directionalLight';
      break;
    case 'three-point-light':
      tag = 'pointLight';
      break;
    case 'imported-scene': {
      const model = node.model;
      if (model === undefined) throw new Error(`${node.nodePath}: imported scene has no model`);
      tag = 'GodotImportedScene';
      defaults.push(
        { kind: 'jsx-string-attribute', name: 'url', value: godotImportedModelUrl(model.sourceResPath) },
        { kind: 'jsx-expression-attribute', name: 'rootClasses', value: jsonExpression(model.rootClasses) },
        { kind: 'jsx-expression-attribute', name: 'nodes', value: jsonExpression(model.nodes) },
        ...(node.placements === undefined || node.placements.length === 0
          ? []
          : [
              {
                kind: 'jsx-expression-attribute' as const,
                name: 'placements',
                value: {
                  kind: 'array-expression' as const,
                  elements: node.placements.map((placed) => ({
                    kind: 'object-expression' as const,
                    properties: [
                      { key: 'at', value: literal(placed.at) },
                      { key: 'element', value: nodeExpression(placed.node, emission) },
                    ],
                  })),
                },
              },
            ]),
        ...(model.overrides.length === 0
          ? []
          : [
              {
                kind: 'jsx-expression-attribute' as const,
                name: 'overrides',
                value: {
                  kind: 'array-expression' as const,
                  elements: model.overrides.map((override) => ({
                    kind: 'object-expression' as const,
                    properties: [
                      { key: 'at', value: literal(override.at) },
                      {
                        key: 'apply',
                        value: {
                          kind: 'arrow-expression' as const,
                          parameters: [{ name: '$entity', type: { kind: 'keyword-type' as const, keyword: 'any' as const } }],
                          body: override.setters.map((setter) =>
                            setterCall(setter, { kind: 'identifier-expression', name: '$entity' }, emission.resourceNames),
                          ),
                        },
                      },
                    ],
                  })),
                },
              },
            ]),
      );
      break;
    }
    case 'scene-instance': {
      const component = emission.instanceComponents.get(node.instance?.sourceResPath ?? '');
      if (component === undefined) throw new Error(`${node.nodePath}: instanced scene has no component`);
      tag = component;
      break;
    }
    default:
      return unreachable(node.targetKind);
  }
  const ref = emission.nodeRefs.get(node.nodePath);
  return {
    tag,
    attributes: [
      { kind: 'jsx-string-attribute', name: 'name', value: node.name },
      ...(ref === undefined
        ? []
        : [
            {
              kind: 'jsx-expression-attribute' as const,
              name: 'ref',
              value: { kind: 'identifier-expression' as const, name: ref },
            },
          ]),
      ...defaults,
      // An idiomatic prefab states its transform as position, rotation and scale; a carried
      // family's element states its own properties, the transform being the scene's.
      ...(node.instance !== undefined && emission.idiomaticInstances.has(node.instance.sourceResPath)
        ? idiomaticTransformAttributes(`${node.nodePath}`, node.properties.find((entry) => entry.propertyName === 'transform')?.value)
        : node.properties
            .filter((property) => family === undefined || property.targetKind.startsWith('three-'))
            .flatMap(directGodotScenePropertyAttributes)),
      ...(forwardedProps === undefined
        ? []
        : [
            {
              kind: 'jsx-spread-attribute' as const,
              value: { kind: 'identifier-expression' as const, name: forwardedProps },
            },
          ]),
    ],
    children: [
      ...(family?.children ?? []),
      ...node.children.map((child) => ({
        kind: 'jsx-element-child' as const,
        ...nodeElement(child, emission),
      })),
      // An instance's own children, authored by the scene that instances it.
      ...(forwardedProps === undefined
        ? []
        : [
            {
              kind: 'jsx-expression-child' as const,
              value: {
                kind: 'property-expression' as const,
                object: { kind: 'identifier-expression' as const, name: forwardedProps },
                property: 'children',
              },
            },
          ]),
    ],
  };
}

function nodeExpression(
  node: DirectGodotSceneNodePlan,
  emission: SceneEmission,
  forwardedProps?: string,
): TargetTsExpression {
  return { kind: 'jsx-element-expression', ...nodeElement(node, emission, forwardedProps) };
}

/**
 * Nodes the Node protocol adopts at mount: every native node, with its Godot class chain (a plain
 * Node non-spatial) and its groups. An instance's component adopts its own nodes.
 */
function adoptedNodes(node: DirectGodotSceneNodePlan, result: DirectGodotSceneNodePlan[]): void {
  if (node.targetKind !== 'scene-instance' && node.targetKind !== 'imported-scene') result.push(node);
  for (const child of childNodes(node)) adoptedNodes(child, result);
}

function instancedScenes(node: DirectGodotSceneNodePlan, result: Set<string>): void {
  if (node.instance !== undefined) result.add(node.instance.sourceResPath);
  for (const child of childNodes(node)) instancedScenes(child, result);
}

function scriptBindings(
  node: DirectGodotSceneNodePlan,
  result: DirectGodotSceneScriptBinding[],
): void {
  if (node.scriptInstance !== undefined) {
    result.push({ index: result.length, nodePath: node.nodePath, instance: node.scriptInstance });
  }
  for (const child of childNodes(node)) scriptBindings(child, result);
}

function referenceType(name: string): TargetTsType {
  return { kind: 'type-reference', name, arguments: [] };
}

function nullable(type: TargetTsType): TargetTsType {
  return { kind: 'union-type', members: [type, { kind: 'literal-type', value: null }] };
}

function groupPropsType(): TargetTsType {
  return {
    kind: 'type-reference',
    name: 'Omit',
    arguments: [
      {
        kind: 'indexed-access-type',
        object: referenceType('ThreeElements'),
        index: { kind: 'literal-type', value: 'group' },
      },
      { kind: 'literal-type', value: 'ref' },
    ],
  };
}

function moduleSpecifier(from: string, target: string): string {
  const withoutExtension = target.replace(/\.[^.]+$/u, '');
  const relative = path.posix.relative(path.posix.dirname(from), withoutExtension);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

/**
 * Each authored connection, made once the scene's script instances exist (Godot connects while
 * instantiating, before the scene enters the tree, packed_scene.cpp:682): the source entity's
 * signal, through its compat accessor, calls the target instance's method with the signal's
 * arguments. The scene's release disconnects it.
 */
function connectionStatements(
  scene: DirectGodotProjectCompositionPlan['scenes'][number],
  bindings: readonly DirectGodotSceneScriptBinding[],
  nodeRefs: ReadonlyMap<string, string>,
): { readonly make: readonly TargetTsStatement[]; readonly release: readonly TargetTsStatement[] } {
  const make: TargetTsStatement[] = [];
  const release: TargetTsStatement[] = [];
  for (const [index, connection] of scene.connections.entries()) {
    const fromRef = nodeRefs.get(connection.fromNodePath);
    const target = bindings.find((binding) => binding.nodePath === connection.toNodePath);
    if (fromRef === undefined || target === undefined) {
      throw new Error(`${scene.sourceResPath}: connection ${connection.signal} has no mounted ends`);
    }
    const from = `$from_${String(index)}`;
    const handle = `$connection_${String(index)}`;
    const parameters = Array.from({ length: connection.arguments }, (_, argument) => `$argument_${String(argument)}`);
    make.push(
      {
        kind: 'variable-statement',
        declaration: 'const',
        name: from,
        initializer: {
          kind: 'property-expression',
          object: { kind: 'identifier-expression', name: fromRef },
          property: 'current',
        },
      },
      {
        kind: 'if-statement',
        condition: {
          kind: 'binary-expression',
          operator: '===',
          left: { kind: 'identifier-expression', name: from },
          right: { kind: 'literal-expression', value: null },
        },
        // biome-ignore lint/suspicious/noThenProperty: TargetTsSyntax names the source branch.
        then: [
          {
            kind: 'throw-statement',
            expression: {
              kind: 'new-expression',
              callee: { kind: 'identifier-expression', name: 'Error' },
              arguments: [literal('Godot connection source node was not mounted.')],
            },
          },
        ],
      },
      {
        kind: 'variable-statement',
        declaration: 'const',
        name: handle,
        initializer: {
          kind: 'call-expression',
          callee: {
            kind: 'property-expression',
            object: {
              kind: 'call-expression',
              callee: { kind: 'identifier-expression', name: connection.accessor.exportName },
              arguments: [
                { kind: 'identifier-expression', name: from },
                ...(connection.accessor.named ? [literal(connection.signal)] : []),
              ],
            },
            property: 'connect',
          },
          arguments: [
            {
              kind: 'arrow-expression',
              parameters: parameters.map((name) => ({ name, type: { kind: 'keyword-type', keyword: 'any' } })),
              body: {
                kind: 'call-expression',
                callee: {
                  kind: 'property-expression',
                  object: { kind: 'identifier-expression', name: `$instance_${String(target.index)}` },
                  property: connection.method,
                },
                arguments: parameters.map((name) => ({ kind: 'identifier-expression', name })),
              },
            },
          ],
        },
      },
    );
    release.push({
      kind: 'expression-statement',
      expression: {
        kind: 'call-expression',
        callee: {
          kind: 'property-expression',
          object: { kind: 'identifier-expression', name: handle },
          property: 'disconnect',
        },
        arguments: [],
      },
    });
  }
  return { make, release };
}

/** The three class an entity of a native node kind is, for the compat calls on it. */
const THREE_CLASS: Partial<Record<DirectGodotSceneNodePlan['targetKind'], string>> = {
  'three-mesh': 'Mesh',
  'three-directional-light': 'DirectionalLight',
  'three-point-light': 'PointLight',
  'three-perspective-camera': 'PerspectiveCamera',
};

function nativeEntity(entity: TargetTsExpression, kind: DirectGodotSceneNodePlan['targetKind']): TargetTsExpression {
  const three = THREE_CLASS[kind];
  return three === undefined ? entity : { kind: 'as-expression', expression: entity, type: referenceType(three) };
}

/** An ArrayMesh's surfaces as `godot_array_mesh_new`'s argument (`compat/array-mesh`). */
function arrayMeshArgument(mesh: TargetGodotArrayMeshPlan, resources: ReadonlyMap<string, string>): TargetTsExpression {
  const numbers = (values: readonly number[]): TargetTsExpression => ({
    kind: 'array-expression',
    elements: values.map((value) => ({ kind: 'literal-expression' as const, value })),
  });
  return {
    kind: 'object-expression',
    properties: [
      { key: 'resource_name', value: { kind: 'literal-expression', value: mesh.resourceName } },
      {
        key: 'surfaces',
        value: {
          kind: 'array-expression',
          elements: mesh.surfaces.map((surface) => ({
            kind: 'object-expression' as const,
            properties: [
              { key: 'primitive', value: { kind: 'literal-expression' as const, value: surface.primitive } },
              ...Object.entries(surface.arrays).flatMap(([key, values]) => (values === undefined ? [] : [{ key, value: numbers(values) }])),
              ...(surface.material === undefined
                ? []
                : [{ key: 'material', value: { kind: 'identifier-expression' as const, name: resources.get(surface.material) as string } }]),
            ],
          })),
        },
      },
    ],
  };
}

/** A compat protocol export's local name: its own export name. */
function compatLocal(entry: { readonly exportName: string }): string {
  return entry.exportName;
}

/** Compat modules of the built-in values a setter receives. */
const VALUE_MODULES = { Vector2: 'vector2', Vector3: 'vector3', Color: 'color', Quaternion: 'quaternion' } as const;

function sceneValue(value: TargetGodotSceneValue, resources: ReadonlyMap<string, string>): TargetTsExpression {
  switch (value.kind) {
    case 'number':
    case 'bool':
    case 'string':
      return { kind: 'literal-expression', value: value.value };
    case 'null':
      return { kind: 'literal-expression', value: null };
    case 'resource':
      return { kind: 'identifier-expression', name: resources.get(value.key) as string };
    case 'PackedVector3Array':
      return {
        kind: 'array-expression',
        elements: Array.from({ length: value.components.length / 3 }, (_, index) => ({
          kind: 'call-expression' as const,
          callee: { kind: 'identifier-expression' as const, name: 'Vector3_construct' },
          arguments: value.components.slice(3 * index, 3 * index + 3).map((component) => ({ kind: 'literal-expression' as const, value: component })),
        })),
      };
    default:
      return {
        kind: 'call-expression',
        callee: { kind: 'identifier-expression', name: `${value.kind}_construct` },
        arguments: value.components.map((component) => ({ kind: 'literal-expression', value: component })),
      };
  }
}

/** `setter(receiver, [index,] value)`: one authored property through its bound setter. */
function setterCall(
  setter: TargetGodotSceneSetterPlan,
  receiver: TargetTsExpression,
  resources: ReadonlyMap<string, string>,
): TargetTsStatement {
  return {
    kind: 'expression-statement',
    expression: {
      kind: 'call-expression',
      callee: { kind: 'identifier-expression', name: setter.setter.localName },
      arguments: [
        receiver,
        ...(setter.index === undefined ? [] : [{ kind: 'literal-expression' as const, value: setter.index }]),
        sceneValue(setter.value, resources),
      ],
    },
  };
}

/** Whether a node is written by a carried family's element, which states its properties itself. */
function carried(node: DirectGodotSceneNodePlan): boolean {
  return node.targetKind !== 'scene-instance' && node.targetKind !== 'imported-scene' && godotFamilyCarriesNode(node.classes[0] ?? '');
}

/**
 * The resources the scene constructs: those a setter the scene calls receives (a carried family's
 * element states its own), with the resources they receive in turn, in plan order.
 */
function constructedResources(scene: DirectGodotProjectCompositionPlan['scenes'][number]): DirectGodotProjectCompositionPlan['scenes'][number]['resources'] {
  const byKey = new Map(scene.resources.map((resource) => [resource.key, resource] as const));
  const used = new Set<string>();
  const use = (setters: readonly TargetGodotSceneSetterPlan[]): void => {
    for (const setter of setters) {
      if (setter.value.kind !== 'resource' || used.has(setter.value.key)) continue;
      used.add(setter.value.key);
      const resource = byKey.get(setter.value.key);
      if (resource === undefined) continue;
      use(resource.setters);
      for (const surface of resource.mesh?.surfaces ?? []) {
        if (surface.material !== undefined && !used.has(surface.material)) {
          used.add(surface.material);
          use(byKey.get(surface.material)?.setters ?? []);
        }
      }
    }
  };
  const walk = (node: DirectGodotSceneNodePlan): void => {
    if (!carried(node)) use(node.setters);
    for (const override of node.model?.overrides ?? []) use(override.setters);
    for (const child of childNodes(node)) walk(child);
  };
  walk(scene.root);
  return scene.resources.filter((resource) => used.has(resource.key));
}

/** Every setter the scene calls, on its nodes and on the resources it constructs. */
function sceneSetters(scene: DirectGodotProjectCompositionPlan['scenes'][number]): TargetGodotSceneSetterPlan[] {
  const result: TargetGodotSceneSetterPlan[] = constructedResources(scene).flatMap((resource) => [...resource.setters]);
  const walk = (node: DirectGodotSceneNodePlan): void => {
    if (!carried(node)) result.push(...node.setters);
    result.push(...(node.model?.overrides ?? []).flatMap((override) => [...override.setters]));
    for (const child of childNodes(node)) walk(child);
  };
  walk(scene.root);
  return result;
}

function sceneSourceFile(
  project: DirectGodotProjectCompositionPlan,
  scene: DirectGodotProjectCompositionPlan['scenes'][number],
): TargetTsSourceFile {
  const bindings: DirectGodotSceneScriptBinding[] = [];
  scriptBindings(scene.root, bindings);
  const nodeRefs = new Map(bindings.map((entry) => [entry.nodePath, `$node_${entry.index}`]));
  if (bindings.length > 0 && !nodeRefs.has(scene.root.nodePath)) {
    nodeRefs.set(scene.root.nodePath, '$sceneRoot');
  }
  const rootNodeRef = nodeRefs.get(scene.root.nodePath);
  const adopted: DirectGodotSceneNodePlan[] = [];
  adoptedNodes(scene.root, adopted);
  const adoptedRefs: string[] = [];
  for (const [index, node] of adopted.entries()) {
    if (!nodeRefs.has(node.nodePath)) {
      nodeRefs.set(node.nodePath, `$node_adopted_${String(index)}`);
      adoptedRefs.push(`$node_adopted_${String(index)}`);
    }
  }
  const instanced = new Set<string>();
  instancedScenes(scene.root, instanced);
  const instanceComponents = new Map<string, { readonly exportName: string; readonly module: string }>();
  for (const resPath of instanced) {
    const target = project.scenes.find((candidate) => candidate.sourceResPath === resPath);
    if (target === undefined) throw new Error(`${scene.sourceResPath}: instanced ${resPath} is absent from composition`);
    instanceComponents.set(resPath, {
      exportName: target.exportName,
      module: moduleSpecifier(scene.targetPath, target.targetPath),
    });
  }
  const constructed = constructedResources(scene);
  const resourceNames = new Map(constructed.map((resource, index) => [resource.key, `$resource_${String(index)}`] as const));
  const family = familyEmission(scene.targetPath, scene.resources);
  const emission: SceneEmission = {
    family,
    resourceNames,
    nodeRefs,
    instanceComponents: new Map([...instanceComponents].map(([resPath, entry]) => [resPath, entry.exportName])),
    idiomaticInstances: new Set(project.scenes.filter((candidate) => candidate.idiomatic === true).map((candidate) => candidate.sourceResPath)),
  };
  // The tree first: the carried families' elements register their loaders and imports.
  const rootExpression = nodeExpression(scene.root, emission, 'props');
    /** Godot adds a node's groups when the scene is instantiated, before it enters the tree
   * (`SceneState::instantiate`, packed_scene.cpp:511); a node's class, and a plain Node's being
   * non-spatial, hold from its creation. */
  // Resources: constructed once when the module is evaluated (a scene's resources are loaded with
  // it and shared by its instances), each authored property set by its setter.
  const resourceStatements: TargetTsStatement[] = constructed.flatMap((resource) => {
    const name = resourceNames.get(resource.key) as string;
    return [
      {
        kind: 'variable-statement' as const,
        declaration: 'const' as const,
        name,
        initializer: {
          kind: 'call-expression' as const,
          callee: { kind: 'identifier-expression' as const, name: `${resource.className}_construct` },
          // An imported file's resource loads it from its copy beside the app, with its importer
          // options; an ArrayMesh receives its decoded surfaces.
          arguments:
            resource.mesh !== undefined
              ? [arrayMeshArgument(resource.mesh, resourceNames)]
              : resource.load === undefined
              ? []
              : [
                  { kind: 'literal-expression' as const, value: godotImportedModelUrl(resource.load.sourceResPath) },
                  {
                    kind: 'object-expression' as const,
                    properties: Object.entries(resource.load.options).map(([key, value]) => ({
                      key,
                      value: { kind: 'literal-expression' as const, value },
                    })),
                  },
                ],
        },
      },
      ...resource.setters.map((setter) => setterCall(setter, { kind: 'identifier-expression', name }, resourceNames)),
    ];
  });
  const setters = sceneSetters(scene);
  const valueKinds = new Set<keyof typeof VALUE_MODULES>();
  const collectValue = (value: TargetGodotSceneValue): void => {
    if (value.kind === 'Vector2' || value.kind === 'Vector3' || value.kind === 'Color' || value.kind === 'Quaternion') valueKinds.add(value.kind);
    if (value.kind === 'PackedVector3Array') valueKinds.add('Vector3');
  };
  for (const setter of setters) collectValue(setter.value);
  const mounts = new Map<string, { readonly module: string; readonly exportName: string }>();
  const collectMounts = (node: DirectGodotSceneNodePlan): void => {
    if (node.mount !== undefined) mounts.set(node.mount.exportName, node.mount);
    for (const child of childNodes(node)) collectMounts(child);
  };
  collectMounts(scene.root);
  const threeTypes = new Set<string>();
  const collectTypes = (node: DirectGodotSceneNodePlan): void => {
    const three = THREE_CLASS[node.targetKind];
    if (three !== undefined && !carried(node) && (node.mount !== undefined || node.setters.length > 0)) threeTypes.add(three);
    for (const child of childNodes(node)) collectTypes(child);
  };
  collectTypes(scene.root);
  const renderImports: TargetTsStatement[] = [
    ...constructed.map((resource) => [resource.construct.module, resource.construct.exportName, resource.className].join('\0')),
  ]
    .filter((entry, index, all) => all.indexOf(entry) === index)
    .map((entry) => {
      // The resource rule's constructor export, whatever its module names it.
      const [module, exportName, className] = entry.split('\0') as [string, string, string];
      return {
        kind: 'import-statement' as const,
        module: moduleSpecifier(scene.targetPath, `src/${module}.ts`),
        namedBindings: [{ imported: exportName, local: `${className}_construct` }],
      };
    });
  const setterModules = new Map<string, Map<string, string>>();
  for (const setter of setters) {
    const locals = setterModules.get(setter.setter.module) ?? new Map<string, string>();
    locals.set(setter.setter.localName, setter.setter.exportName);
    setterModules.set(setter.setter.module, locals);
  }
  for (const mount of mounts.values()) {
    const locals = setterModules.get(mount.module) ?? new Map<string, string>();
    locals.set(mount.exportName, mount.exportName);
    setterModules.set(mount.module, locals);
  }
  const importsModel = (node: DirectGodotSceneNodePlan): boolean =>
    node.targetKind === 'imported-scene' || childNodes(node).some(importsModel);
  if (importsModel(scene.root)) {
    renderImports.push({
      kind: 'import-statement',
      module: moduleSpecifier(scene.targetPath, 'src/lib/godot-compat/packed-scene.tsx'),
      namedBindings: [{ imported: 'GodotImportedScene', local: 'GodotImportedScene' }],
    });
  }
  renderImports.push(
    ...[...setterModules].map(([module, locals]) => ({
      kind: 'import-statement' as const,
      module: moduleSpecifier(scene.targetPath, `src/${module}.ts`),
      namedBindings: [...locals].map(([local, imported]) => ({ imported, local })),
    })),
    ...[...valueKinds].map((kind) => ({
      kind: 'import-statement' as const,
      module: moduleSpecifier(scene.targetPath, `src/lib/godot-compat/${VALUE_MODULES[kind]}.ts`),
      namedBindings: [{ imported: 'construct', local: `${kind}_construct` }],
    })),
    ...(threeTypes.size === 0
      ? []
      : [
          {
            kind: 'import-statement' as const,
            module: 'three',
            namedBindings: [...threeTypes].map((name) => ({ imported: name, local: name })),
            typeOnly: true as const,
          },
        ]),
  );
  const rootEntity: TargetTsExpression = {
    kind: 'as-expression',
    expression: {
      kind: 'property-expression',
      object: { kind: 'identifier-expression', name: nodeRefs.get(scene.root.nodePath) ?? '$sceneRoot' },
      property: 'current',
    },
    type: referenceType('Object3D'),
  };
  const overriddenInstances: DirectGodotSceneNodePlan[] = [];
  const findOverridden = (node: DirectGodotSceneNodePlan): void => {
    if (node.targetKind === 'scene-instance' && node.setters.length > 0) overriddenInstances.push(node);
    for (const child of childNodes(node)) findOverridden(child);
  };
  findOverridden(scene.root);
  const adoption: readonly TargetTsStatement[] =
    adopted.length === 0
      ? []
      : [
          {
            kind: 'expression-statement',
            expression: {
              kind: 'call-expression',
              callee: { kind: 'identifier-expression', name: 'useLayoutEffect' },
              arguments: [
                {
                  kind: 'arrow-expression',
                  parameters: [],
                  body: adopted.flatMap((node): TargetTsStatement[] => {
                    const entity: TargetTsExpression = {
                      kind: 'as-expression',
                      expression: {
                        kind: 'property-expression',
                        object: { kind: 'identifier-expression', name: nodeRefs.get(node.nodePath) as string },
                        property: 'current',
                      },
                      type: referenceType('Object3D'),
                    };
                    return [
                      {
                        kind: 'expression-statement' as const,
                        expression: {
                          kind: 'call-expression' as const,
                          callee: { kind: 'identifier-expression' as const, name: 'godot_node_adopt' },
                          arguments: [
                            entity,
                            {
                              kind: 'object-expression' as const,
                              properties: [
                                ...(node.targetKind === 'three-node' ? [{ key: 'kind', value: literal('node') }] : []),
                                // A scene's nodes are owned by its root (`SceneState::instantiate`,
                                // packed_scene.cpp:570), which finds its unique ones as `%Name`.
                                ...(node.nodePath === scene.root.nodePath
                                  ? []
                                  : [{ key: 'owner', value: rootEntity }]),
                                ...(node.unique === true ? [{ key: 'unique', value: { kind: 'literal-expression' as const, value: true } }] : []),
                                {
                                  key: 'classes',
                                  value: { kind: 'array-expression' as const, elements: node.classes.map((name) => literal(name)) },
                                },
                              ],
                            },
                          ],
                        },
                      },
                      ...node.groups.map((group) => ({
                        kind: 'expression-statement' as const,
                        expression: {
                          kind: 'call-expression' as const,
                          callee: { kind: 'identifier-expression' as const, name: 'add_to_group' },
                          arguments: [entity, literal(group)],
                        },
                      })),
                      // The entity as its class creates it, then its authored properties by their
                      // setters, in authored order (`SceneState::instantiate`, packed_scene.cpp:400).
                      ...(node.mount === undefined
                        ? []
                        : [
                            {
                              kind: 'expression-statement' as const,
                              expression: {
                                kind: 'call-expression' as const,
                                callee: { kind: 'identifier-expression' as const, name: compatLocal(node.mount) },
                                arguments: [nativeEntity(entity, node.targetKind)],
                              },
                            },
                          ]),
                      ...(carried(node) ? [] : node.setters.map((setter) => setterCall(setter, nativeEntity(entity, node.targetKind), resourceNames))),
                    ];
                  }).concat(
                    // An instance root's overrides without a JSX rule: its setters, once the instanced
                    // scene's component has made and set up its root (a child's layout effect runs
                    // first), on the node the parent finds by name (`SceneState::instantiate` sets the
                    // instancing scene's values after instantiating, packed_scene.cpp:400).
                    overriddenInstances.flatMap((node) => {
                      const parentRef = nodeRefs.get(node.parentNodePath ?? scene.root.nodePath);
                      if (parentRef === undefined) throw new Error(`${node.nodePath}: an overridden instance's parent has no ref`);
                      const receiver: TargetTsExpression = {
                        kind: 'as-expression',
                        expression: {
                          kind: 'call-expression',
                          callee: { kind: 'identifier-expression', name: 'get_node_or_null' },
                          arguments: [
                            { kind: 'property-expression', object: { kind: 'identifier-expression', name: parentRef }, property: 'current' },
                            literal(node.name),
                          ],
                        },
                        type: { kind: 'keyword-type', keyword: 'any' },
                      };
                      return node.setters.map((setter) => setterCall(setter, receiver, resourceNames));
                    }),
                  ),
                },
                { kind: 'array-expression', elements: [] },
              ],
            },
          },
        ];
  const autoloadReferences = directGodotSceneAutoloadReferences(scene.root);
  const referencedAutoloads = autoloadReferences.map((reference) => {
    const autoload = project.scriptAutoloads.find(
      (candidate) =>
        candidate.name === reference.name && candidate.scriptResPath === reference.resPath,
    );
    if (autoload === undefined) {
      throw new Error(
        `${reference.name}: singleton ${reference.resPath} is absent from composition`,
      );
    }
    return autoload;
  });
  const autoloadContext = directGodotSceneAutoloadContextName(scene.exportName);
  const imports: TargetTsStatement[] = [
    {
      kind: 'import-statement',
      module: '@react-three/fiber',
      namedBindings: [{ imported: 'ThreeElements', local: 'ThreeElements' }],
      typeOnly: true,
    },
    ...[...instanceComponents.values()].map((entry) => ({
      kind: 'import-statement' as const,
      module: entry.module,
      namedBindings: [{ imported: entry.exportName, local: entry.exportName }],
    })),
    ...[...new Map(scene.connections.map((connection) => [connection.accessor.exportName, connection.accessor])).values()].map(
      (accessor) => ({
        kind: 'import-statement' as const,
        module: moduleSpecifier(scene.targetPath, `src/${accessor.module}.ts`),
        namedBindings: [{ imported: accessor.exportName, local: accessor.exportName }],
      }),
    ),
    ...(adopted.length === 0
      ? []
      : [
          {
            kind: 'import-statement' as const,
            module: moduleSpecifier(scene.targetPath, 'src/lib/godot-compat/node.ts'),
            namedBindings: [
              ...(adopted.some((node) => node.groups.length > 0)
                ? [{ imported: 'add_to_group', local: 'add_to_group' }]
                : []),
              { imported: 'godot_node_adopt', local: 'godot_node_adopt' },
              ...(overriddenInstances.length === 0 ? [] : [{ imported: 'get_node_or_null', local: 'get_node_or_null' }]),
            ],
          },
          {
            kind: 'import-statement' as const,
            module: 'three',
            namedBindings: [{ imported: 'Object3D', local: 'Object3D' }],
            typeOnly: true as const,
          },
          ...(bindings.length === 0
            ? [
                {
                  kind: 'import-statement' as const,
                  module: 'react',
                  namedBindings: [
                    { imported: 'useLayoutEffect', local: 'useLayoutEffect' },
                    { imported: 'useRef', local: 'useRef' },
                  ],
                },
              ]
            : [
                {
                  kind: 'import-statement' as const,
                  module: 'react',
                  namedBindings: [{ imported: 'useLayoutEffect', local: 'useLayoutEffect' }],
                },
              ]),
        ]),
    ...(bindings.length === 0
      ? []
      : [
          {
            kind: 'import-statement' as const,
            module: moduleSpecifier(scene.targetPath, 'src/lib/godot-compat/react-lifecycle.tsx'),
            namedBindings: [
              {
                imported: 'useGodotScriptTreeAttachment',
                local: 'useGodotScriptTreeAttachment',
              },
            ],
          },
          {
            kind: 'import-statement' as const,
            module: 'react',
            namedBindings: [
              ...(autoloadReferences.length === 0
                ? []
                : [
                    { imported: 'createContext', local: 'createContext' },
                    { imported: 'useContext', local: 'useContext' },
                  ]),
              { imported: 'useRef', local: 'useRef' },
            ],
          },
          ...(autoloadReferences.length === 0
            ? []
            : [
                {
                  kind: 'import-statement' as const,
                  module: 'react',
                  namedBindings: [{ imported: 'RefObject', local: 'RefObject' }],
                  typeOnly: true as const,
                },
              ]),
          {
            kind: 'import-statement' as const,
            module: 'three',
            namedBindings: [{ imported: 'Group', local: 'Group' }],
            typeOnly: true as const,
          },
          ...bindings.map((binding) => ({
            kind: 'import-statement' as const,
            module: moduleSpecifier(scene.targetPath, binding.instance.generatedClass.modulePath),
            namedBindings: [
              {
                imported: binding.instance.generatedClass.exportName,
                local: `$Script_${binding.index}`,
              },
            ],
          })),
          ...referencedAutoloads.map((autoload) => ({
            kind: 'import-statement' as const,
            module: moduleSpecifier(scene.targetPath, autoload.generatedClass.modulePath),
            namedBindings: [
              {
                imported: autoload.generatedClass.exportName,
                local: `$AutoloadType_${autoload.name}`,
              },
            ],
            typeOnly: true as const,
          })),
        ]),
  ];
  const autoloadContextStatements: readonly TargetTsStatement[] =
    autoloadReferences.length === 0
      ? []
      : [
          {
            kind: 'variable-statement',
            declaration: 'const',
            name: autoloadContext,
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
                        readonly: true,
                        type: {
                          kind: 'type-reference',
                          name: 'RefObject',
                          arguments: [nullable(referenceType(`$AutoloadType_${autoload.name}`))],
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
      ...renderImports,
      ...familyImports(family),
      ...family.statics,
      ...resourceStatements,
      ...autoloadContextStatements,
      {
        kind: 'function-statement',
        name: scene.exportName,
        modifiers: ['export'],
        parameters: [{ name: 'props', type: groupPropsType() }],
        body: [
          ...family.hooks,
          ...(autoloadReferences.length === 0
            ? []
            : [
                {
                  kind: 'variable-statement' as const,
                  declaration: 'const' as const,
                  name: '$autoloads',
                  initializer: {
                    kind: 'call-expression' as const,
                    callee: { kind: 'identifier-expression' as const, name: 'useContext' },
                    arguments: [{ kind: 'identifier-expression' as const, name: autoloadContext }],
                  },
                },
                {
                  kind: 'if-statement' as const,
                  condition: {
                    kind: 'binary-expression' as const,
                    operator: '===' as const,
                    left: { kind: 'identifier-expression' as const, name: '$autoloads' },
                    right: { kind: 'literal-expression' as const, value: null },
                  },
                  // biome-ignore lint/suspicious/noThenProperty: TargetTsSyntax names the source branch.
                  then: [
                    {
                      kind: 'throw-statement' as const,
                      expression: {
                        kind: 'new-expression' as const,
                        callee: { kind: 'identifier-expression' as const, name: 'Error' },
                        arguments: [
                          {
                            kind: 'literal-expression' as const,
                            value: 'Godot scene autoload composition is absent.',
                          },
                        ],
                      },
                    },
                  ],
                },
              ]),
          ...bindings.flatMap(directGodotScriptBindingDeclarations),
          ...adoptedRefs.map((name) => ({
            kind: 'variable-statement' as const,
            declaration: 'const' as const,
            name,
            initializer: {
              kind: 'call-expression' as const,
              callee: { kind: 'identifier-expression' as const, name: 'useRef' },
              typeArguments: [nullable(referenceType('Object3D'))],
              arguments: [{ kind: 'literal-expression' as const, value: null }],
            },
          })),
          ...(bindings.length > 0 && rootNodeRef === '$sceneRoot'
            ? [
                {
                  kind: 'variable-statement' as const,
                  declaration: 'const' as const,
                  name: '$sceneRoot',
                  initializer: {
                    kind: 'call-expression' as const,
                    callee: { kind: 'identifier-expression' as const, name: 'useRef' },
                    typeArguments: [nullable(referenceType('Group'))],
                    arguments: [{ kind: 'literal-expression' as const, value: null }],
                  },
                },
              ]
            : []),
          ...adoption,
          ...(bindings.length === 0 || rootNodeRef === undefined
            ? []
            : [directGodotSceneLifecycleEffect(bindings, rootNodeRef, connectionStatements(scene, bindings, nodeRefs))]),
          { kind: 'return-statement', expression: rootExpression },
        ],
      },
    ],
  };
}

/** Mechanically lower an already accepted scene-module plan to structured TSX syntax. */
export function emitDirectGodotSceneSyntax(
  project: DirectGodotProjectCompositionPlan,
  plan: DirectGodotSceneModulePlan,
): readonly EmittedDirectGodotSceneModule[] {
  const scenes = new Map(project.scenes.map((scene) => [scene.sourceResPath, scene] as const));
  if (scenes.size !== project.scenes.length) {
    throw new Error('accepted composition repeats a scene source path');
  }
  const emitted = plan.modules.map((module) => {
    const scene = scenes.get(module.sourceResPath);
    if (
      scene === undefined ||
      scene.sourceDigest !== module.sourceDigest ||
      scene.targetPath !== module.targetPath
    ) {
      throw new Error(`${module.sourceResPath}: accepted scene-module plan is inconsistent`);
    }
    scenes.delete(module.sourceResPath);
    return { ...module, syntax: scene.idiomatic === true ? idiomaticSceneSourceFile(project, scene) : sceneSourceFile(project, scene) };
  });
  if (scenes.size > 0) {
    throw new Error(`${[...scenes.keys()][0]}: accepted scene has no module plan`);
  }
  return emitted;
}
