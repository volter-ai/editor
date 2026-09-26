import * as path from 'node:path';
import {
  TARGET_TS_SYNTAX_VERSION,
  type TargetTsExpression,
  type TargetTsJsxChild,
  type TargetTsJsxElementShape,
  type TargetTsSourceFile,
  type TargetTsStatement,
  type TargetTsType,
} from '../code/target-ts-syntax';
import type {
  DirectGodotProjectCompositionPlan,
  DirectGodotScriptAutoloadPlan,
} from '../data/direct-project-composition-plan';
import {
  directGodotAutoloadIndex,
  directGodotAutoloadPreparation,
  directGodotSceneAutoloadContextName,
  directGodotSceneAutoloadReferences,
} from './direct-autoload-syntax';
import { directGodotScenePropertyAttributes } from './direct-scene-syntax';

function referenceType(name: string): TargetTsType {
  return { kind: 'type-reference', name, arguments: [] };
}

function nullable(type: TargetTsType): TargetTsType {
  return { kind: 'union-type', members: [type, { kind: 'literal-type', value: null }] };
}

function property(object: string | TargetTsExpression, member: string): TargetTsExpression {
  return {
    kind: 'property-expression',
    object: typeof object === 'string' ? { kind: 'identifier-expression', name: object } : object,
    property: member,
  };
}

function nullGuard(name: string): TargetTsStatement {
  return {
    kind: 'if-statement',
    condition: {
      kind: 'binary-expression',
      operator: '===',
      left: { kind: 'identifier-expression', name },
      right: { kind: 'literal-expression', value: null },
    },
    // biome-ignore lint/suspicious/noThenProperty: TargetTsSyntax names the source branch.
    then: [
      {
        kind: 'throw-statement',
        expression: {
          kind: 'new-expression',
          callee: { kind: 'identifier-expression', name: 'Error' },
          arguments: [
            { kind: 'literal-expression', value: 'Godot autoload native node was not mounted.' },
          ],
        },
      },
    ],
  };
}

function assignment(target: TargetTsExpression, value: TargetTsExpression): TargetTsStatement {
  return {
    kind: 'expression-statement',
    expression: { kind: 'assignment-expression', operator: '=', target, value },
  };
}

function lifecycleCallback(instance: string, method: string): TargetTsExpression {
  return {
    kind: 'arrow-expression',
    parameters: [],
    body: {
      kind: 'call-expression',
      callee: property(instance, method),
      arguments: [],
    },
  };
}

function lifecycleBinding(
  autoload: DirectGodotScriptAutoloadPlan,
  suffix: string,
): TargetTsExpression {
  const method = (phase: 'enter-tree' | 'ready' | 'exit-tree'): string | undefined =>
    autoload.lifecycle.find((entry) => entry.phase === phase)?.methodName;
  const callbacks = [
    ['enterTree', method('enter-tree')],
    ['ready', method('ready')],
    ['exitTree', method('exit-tree')],
  ] as const;
  return {
    kind: 'object-expression',
    properties: [
      { key: 'native', value: { kind: 'identifier-expression', name: `$native_${suffix}` } },
      { key: 'owner', value: { kind: 'identifier-expression', name: `$instance_${suffix}` } },
      ...callbacks.flatMap(([key, methodName]) =>
        methodName === undefined
          ? []
          : [{ key, value: lifecycleCallback(`$instance_${suffix}`, methodName) }],
      ),
    ],
  };
}

function autoloadComponent(
  autoload: DirectGodotScriptAutoloadPlan,
  index: number,
): TargetTsStatement {
  const suffix = `autoload_${index}`;
  return {
    kind: 'function-statement',
    name: `$Autoload_${index}`,
    parameters: [
      {
        name: 'props',
        type: {
          kind: 'object-type',
          properties: [
            {
              name: 'instanceRef',
              readonly: true,
              type: {
                kind: 'type-reference',
                name: 'RefObject',
                arguments: [nullable(referenceType(`$AutoloadScript_${index}`))],
              },
            },
          ],
        },
      },
    ],
    body: [
      {
        kind: 'variable-statement',
        declaration: 'const',
        name: `$node_${suffix}`,
        initializer: {
          kind: 'call-expression',
          callee: { kind: 'identifier-expression', name: 'useRef' },
          typeArguments: [nullable(referenceType('Group'))],
          arguments: [{ kind: 'literal-expression', value: null }],
        },
      },
      {
        kind: 'expression-statement',
        expression: {
          kind: 'call-expression',
          callee: { kind: 'identifier-expression', name: 'useGodotScriptTreeAttachment' },
          arguments: [
            { kind: 'identifier-expression', name: `$node_${suffix}` },
            {
              kind: 'arrow-expression',
              parameters: [],
              body: [
                {
                  kind: 'variable-statement',
                  declaration: 'const',
                  name: `$native_${suffix}`,
                  initializer: property(`$node_${suffix}`, 'current'),
                },
                nullGuard(`$native_${suffix}`),
                {
                  kind: 'variable-statement',
                  declaration: 'const',
                  name: `$instance_${suffix}`,
                  initializer: {
                    kind: 'new-expression',
                    callee: { kind: 'identifier-expression', name: `$AutoloadScript_${index}` },
                    arguments: [{ kind: 'identifier-expression', name: `$native_${suffix}` }],
                  },
                },
                assignment(property(property('props', 'instanceRef'), 'current'), {
                  kind: 'identifier-expression',
                  name: `$instance_${suffix}`,
                }),
                {
                  kind: 'return-statement',
                  expression: {
                    kind: 'object-expression',
                    properties: [
                      {
                        key: 'bindings',
                        value: {
                          kind: 'array-expression',
                          elements: [lifecycleBinding(autoload, suffix)],
                        },
                      },
                      {
                        key: 'release',
                        value: {
                          kind: 'arrow-expression',
                          parameters: [],
                          body: [
                            assignment(property(property('props', 'instanceRef'), 'current'), {
                              kind: 'literal-expression',
                              value: null,
                            }),
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
      {
        kind: 'return-statement',
        expression: {
          kind: 'jsx-element-expression',
          tag: 'group',
          attributes: [
            { kind: 'jsx-string-attribute', name: 'name', value: autoload.name },
            {
              kind: 'jsx-expression-attribute',
              name: 'ref',
              value: { kind: 'identifier-expression', name: `$node_${suffix}` },
            },
          ],
          children: [],
        },
      },
    ],
  };
}

function moduleSpecifier(target: string): string {
  const withoutExtension = target.replace(/\.[^.]+$/u, '');
  const relative = path.posix.relative('src', withoutExtension);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

/** Project-specific native startup composition; all reusable lifecycle policy stays in compat. */
export function emitDirectGodotWorldSyntax(
  composition: DirectGodotProjectCompositionPlan,
): TargetTsSourceFile {
  const scene = composition.scenes.find(
    (candidate) => candidate.sourceResPath === composition.mainScene,
  );
  if (scene === undefined) throw new Error(`${composition.mainScene}: main scene plan is absent`);
  const mainAutoloadReferences = directGodotSceneAutoloadReferences(scene.root);
  const autoloadPrepare = directGodotAutoloadPreparation(composition);
  const sceneBindings = [
    { imported: scene.exportName, local: scene.exportName },
    ...(mainAutoloadReferences.length === 0
      ? []
      : [
          {
            imported: directGodotSceneAutoloadContextName(scene.exportName),
            local: directGodotSceneAutoloadContextName(scene.exportName),
          },
        ]),
  ];
  const imports: TargetTsStatement[] = [
    {
      kind: 'import-statement',
      module: moduleSpecifier(scene.targetPath),
      namedBindings: sceneBindings,
    },
    ...(composition.scriptAutoloads.length === 0
      ? []
      : [
          {
            kind: 'import-statement' as const,
            module: './lib/godot-compat/react-lifecycle',
            namedBindings: [
              { imported: 'GodotProjectStartup', local: 'GodotProjectStartup' },
              {
                imported: 'useGodotScriptTreeAttachment',
                local: 'useGodotScriptTreeAttachment',
              },
            ],
          },
          {
            kind: 'import-statement' as const,
            module: 'react',
            namedBindings: [{ imported: 'useRef', local: 'useRef' }],
          },
          {
            kind: 'import-statement' as const,
            module: 'react',
            namedBindings: [{ imported: 'RefObject', local: 'RefObject' }],
            typeOnly: true as const,
          },
          {
            kind: 'import-statement' as const,
            module: 'three',
            namedBindings: [{ imported: 'Group', local: 'Group' }],
            typeOnly: true as const,
          },
          ...composition.scriptAutoloads.map((autoload, index) => ({
            kind: 'import-statement' as const,
            module: moduleSpecifier(autoload.generatedClass.modulePath),
            namedBindings: [
              {
                imported: autoload.generatedClass.exportName,
                local: `$AutoloadScript_${index}`,
              },
            ],
          })),
        ]),
  ];
  const mainSceneShape: TargetTsJsxElementShape = {
    tag: scene.exportName,
    attributes: [
      { kind: 'jsx-string-attribute', name: 'name', value: scene.root.name },
      ...scene.root.properties.flatMap(directGodotScenePropertyAttributes),
    ],
    children: [],
  };
  const mainScene: TargetTsJsxChild = { kind: 'jsx-element-child', ...mainSceneShape };
  const composedMainScene: TargetTsJsxChild =
    mainAutoloadReferences.length === 0
      ? mainScene
      : {
          kind: 'jsx-element-child',
          tag: directGodotSceneAutoloadContextName(scene.exportName),
          attributes: [
            {
              kind: 'jsx-expression-attribute',
              name: 'value',
              value: {
                kind: 'object-expression',
                properties: mainAutoloadReferences.map((reference) => ({
                  key: reference.name,
                  value: {
                    kind: 'identifier-expression',
                    name: `$autoloadInstance_${directGodotAutoloadIndex(composition, reference)}`,
                  },
                })),
              },
            },
          ],
          children: [mainScene],
        };
  const worldExpression: TargetTsExpression =
    composition.scriptAutoloads.length === 0
      ? { kind: 'jsx-element-expression', ...mainSceneShape }
      : {
          kind: 'jsx-element-expression',
          tag: 'GodotProjectStartup',
          attributes:
            autoloadPrepare.length === 0
              ? []
              : [
                  {
                    kind: 'jsx-expression-attribute',
                    name: 'prepare',
                    value: {
                      kind: 'arrow-expression',
                      parameters: [],
                      body: autoloadPrepare,
                    },
                  },
                ],
          children: [
            ...composition.scriptAutoloads.map(
              (_autoload, index): TargetTsJsxChild => ({
                kind: 'jsx-element-child',
                tag: `$Autoload_${index}`,
                attributes: [
                  {
                    kind: 'jsx-expression-attribute',
                    name: 'instanceRef',
                    value: {
                      kind: 'identifier-expression',
                      name: `$autoloadInstance_${index}`,
                    },
                  },
                ],
                children: [],
              }),
            ),
            composedMainScene,
          ],
        };
  return {
    syntaxVersion: TARGET_TS_SYNTAX_VERSION,
    sourcePath: 'project.godot',
    statements: [
      ...imports,
      ...composition.scriptAutoloads.map(autoloadComponent),
      {
        kind: 'function-statement',
        name: 'World',
        parameters: [],
        body: [
          ...composition.scriptAutoloads.map(
            (_autoload, index): TargetTsStatement => ({
              kind: 'variable-statement',
              declaration: 'const',
              name: `$autoloadInstance_${index}`,
              initializer: {
                kind: 'call-expression',
                callee: { kind: 'identifier-expression', name: 'useRef' },
                typeArguments: [nullable(referenceType(`$AutoloadScript_${index}`))],
                arguments: [{ kind: 'literal-expression', value: null }],
              },
            }),
          ),
          { kind: 'return-statement', expression: worldExpression },
        ],
        modifiers: ['export', 'default'],
      },
    ],
  };
}
