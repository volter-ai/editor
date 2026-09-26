import * as path from 'node:path';
import type {
  TargetTsExpression,
  TargetTsJsxAttribute,
  TargetTsJsxElementShape,
  TargetTsStatement,
  TargetTsType,
} from '../code/target-ts-syntax';
import { TARGET_TS_SYNTAX_VERSION, type TargetTsSourceFile } from '../code/target-ts-syntax';
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
  readonly nodeRefs: ReadonlyMap<string, string>;
  /** The generated component of each instanced scene, by source path. */
  readonly instanceComponents: ReadonlyMap<string, string>;
}

function nodeElement(
  node: DirectGodotSceneNodePlan,
  emission: SceneEmission,
  forwardedProps?: string,
): TargetTsJsxElementShape {
  let tag: string;
  const defaults: TargetTsJsxAttribute[] = [];
  switch (node.targetKind) {
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
      ...node.properties.flatMap(directGodotScenePropertyAttributes),
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

/** Nodes the Node protocol adopts at mount: plain Nodes (non-spatial) and nodes with groups. */
function adoptedNodes(node: DirectGodotSceneNodePlan, result: DirectGodotSceneNodePlan[]): void {
  if (node.targetKind === 'three-node' || node.groups.length > 0) result.push(node);
  for (const child of node.children) adoptedNodes(child, result);
}

function instancedScenes(node: DirectGodotSceneNodePlan, result: Set<string>): void {
  if (node.instance !== undefined) result.add(node.instance.sourceResPath);
  for (const child of node.children) instancedScenes(child, result);
}

function scriptBindings(
  node: DirectGodotSceneNodePlan,
  result: DirectGodotSceneScriptBinding[],
): void {
  if (node.scriptInstance !== undefined) {
    result.push({ index: result.length, nodePath: node.nodePath, instance: node.scriptInstance });
  }
  for (const child of node.children) scriptBindings(child, result);
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
  const emission: SceneEmission = {
    nodeRefs,
    instanceComponents: new Map([...instanceComponents].map(([resPath, entry]) => [resPath, entry.exportName])),
  };
    /** Godot adds a node's groups when the scene is instantiated, before it enters the tree
   * (`SceneState::instantiate`, packed_scene.cpp:511); a plain Node is non-spatial from birth. */
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
                      ...(node.targetKind === 'three-node'
                        ? [
                            {
                              kind: 'expression-statement' as const,
                              expression: {
                                kind: 'call-expression' as const,
                                callee: { kind: 'identifier-expression' as const, name: 'godot_node_adopt' },
                                arguments: [
                                  entity,
                                  {
                                    kind: 'object-expression' as const,
                                    properties: [{ key: 'kind', value: literal('node') }],
                                  },
                                ],
                              },
                            },
                          ]
                        : []),
                      ...node.groups.map((group) => ({
                        kind: 'expression-statement' as const,
                        expression: {
                          kind: 'call-expression' as const,
                          callee: { kind: 'identifier-expression' as const, name: 'add_to_group' },
                          arguments: [entity, literal(group)],
                        },
                      })),
                    ];
                  }),
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
              ...(adopted.some((node) => node.targetKind === 'three-node')
                ? [{ imported: 'godot_node_adopt', local: 'godot_node_adopt' }]
                : []),
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
      ...autoloadContextStatements,
      {
        kind: 'function-statement',
        name: scene.exportName,
        modifiers: ['export'],
        parameters: [{ name: 'props', type: groupPropsType() }],
        body: [
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
            : [directGodotSceneLifecycleEffect(bindings, rootNodeRef)]),
          { kind: 'return-statement', expression: nodeExpression(scene.root, emission, 'props') },
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
    return { ...module, syntax: sceneSourceFile(project, scene) };
  });
  if (scenes.size > 0) {
    throw new Error(`${[...scenes.keys()][0]}: accepted scene has no module plan`);
  }
  return emitted;
}
