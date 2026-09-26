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

export function directGodotScenePropertyAttribute(
  property: DirectGodotSceneNodePlan['properties'][number],
): TargetTsJsxAttribute {
  switch (property.targetKind) {
    case 'three-position':
      return { kind: 'jsx-expression-attribute', name: 'position', value: tuple(property.value) };
    case 'three-rotation-yxz':
      return {
        kind: 'jsx-expression-attribute',
        name: 'rotation',
        value: tuple([...property.value, 'YXZ']),
      };
    case 'three-scale':
      return { kind: 'jsx-expression-attribute', name: 'scale', value: tuple(property.value) };
    default:
      return unreachable(property.targetKind);
  }
}

function nodeElement(
  node: DirectGodotSceneNodePlan,
  nodeRefs: ReadonlyMap<string, string>,
  forwardedProps?: string,
): TargetTsJsxElementShape {
  let tag: string;
  switch (node.targetKind) {
    case 'three-group':
      tag = 'group';
      break;
    default:
      return unreachable(node.targetKind);
  }
  return {
    tag,
    attributes: [
      { kind: 'jsx-string-attribute', name: 'name', value: node.name },
      ...(nodeRefs.has(node.nodePath)
        ? [
            {
              kind: 'jsx-expression-attribute' as const,
              name: 'ref',
              value: { kind: 'identifier-expression' as const, name: nodeRefs.get(node.nodePath)! },
            },
          ]
        : []),
      ...node.properties.map(directGodotScenePropertyAttribute),
      ...(forwardedProps === undefined
        ? []
        : [
            {
              kind: 'jsx-spread-attribute' as const,
              value: { kind: 'identifier-expression' as const, name: forwardedProps },
            },
          ]),
    ],
    children: node.children.map((child) => ({
      kind: 'jsx-element-child',
      ...nodeElement(child, nodeRefs),
    })),
  };
}

function nodeExpression(
  node: DirectGodotSceneNodePlan,
  nodeRefs: ReadonlyMap<string, string>,
  forwardedProps?: string,
): TargetTsExpression {
  return { kind: 'jsx-element-expression', ...nodeElement(node, nodeRefs, forwardedProps) };
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
    ...(bindings.length === 0
      ? []
      : [
          {
            kind: 'import-statement' as const,
            module: moduleSpecifier(scene.targetPath, 'src/lib/godot-compat/index.ts'),
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
          ...(bindings.length === 0 || rootNodeRef === undefined
            ? []
            : [directGodotSceneLifecycleEffect(bindings, rootNodeRef)]),
          { kind: 'return-statement', expression: nodeExpression(scene.root, nodeRefs, 'props') },
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
