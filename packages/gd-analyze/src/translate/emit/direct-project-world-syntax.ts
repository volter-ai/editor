import type { BoundGodotLifecyclePhase } from '../../analyze/bound-project';
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
  DirectGodotSceneNodePlan,
  DirectGodotScriptAutoloadPlan,
  DirectGodotSettingValue,
} from '../data/direct-project-composition-plan';
import {
  directGodotAutoloadIndex,
  directGodotAutoloadPreparation,
  directGodotSceneAutoloadContextName,
  directGodotSceneAutoloadReferences,
} from './direct-autoload-syntax';

/** The project's settings file: each setting its scripts read, a built-in value as `{ Vector3: [...] }`. */
export const DIRECT_GODOT_SETTINGS_PATH = 'src/project/settings.json';
/** The project's input map file: the actions it defines and the built-ins it uses. */
export const DIRECT_GODOT_INPUT_MAP_PATH = 'src/project/input-map.json';

/** The settings file's content. */
export function directGodotSettingsJson(composition: DirectGodotProjectCompositionPlan): unknown {
  const value = (entry: DirectGodotSettingValue): unknown =>
    entry.kind === 'number' || entry.kind === 'bool' || entry.kind === 'string' ? entry.value : { [entry.kind]: entry.components };
  return composition.projectSettings.map((setting) => [setting.key, value(setting.value)]);
}

/** The input map file's content: each action's events as compat input-event records. */
export function directGodotInputMapJson(composition: DirectGodotProjectCompositionPlan): unknown {
  return composition.inputMap.map((action) => ({ name: action.name, deadzone: action.deadzone, events: action.events }));
}

/**
 * The project's settings and InputMap, loaded from its data files when the world module is
 * evaluated: before any script runs, as Godot loads them in `Main::setup` (`main/main.cpp:2102`).
 */
function projectDataLoad(composition: DirectGodotProjectCompositionPlan): {
  readonly imports: readonly TargetTsStatement[];
  readonly statements: readonly TargetTsStatement[];
} {
  const load = (loader: string, data: string): TargetTsStatement => ({
    kind: 'expression-statement',
    expression: { kind: 'call-expression', callee: { kind: 'identifier-expression', name: loader }, arguments: [{ kind: 'identifier-expression', name: data }] },
  });
  const settings = composition.projectSettings.length > 0;
  return {
    imports: [
      ...(settings
        ? [
            { kind: 'import-statement' as const, module: './lib/godot-compat/project-settings', namedBindings: [{ imported: 'godot_project_settings_load_json', local: 'godot_project_settings_load_json' }] },
            { kind: 'import-statement' as const, module: './project/settings.json', defaultBinding: 'settings', namedBindings: [] },
          ]
        : []),
      { kind: 'import-statement' as const, module: './lib/godot-compat/input', namedBindings: [{ imported: 'godot_input_map_load_json', local: 'godot_input_map_load_json' }] },
      { kind: 'import-statement' as const, module: './project/input-map.json', defaultBinding: 'inputMap', namedBindings: [] },
    ],
    statements: [
      ...(settings ? [load('godot_project_settings_load_json', 'settings')] : []),
      load('godot_input_map_load_json', 'inputMap'),
    ],
  };
}

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

/** `argument`: the callback's one parameter (a frame's delta, an input event), passed through. */
function lifecycleCallback(instance: string, method: string, argument?: string): TargetTsExpression {
  return {
    kind: 'arrow-expression',
    parameters: argument === undefined ? [] : [{ name: argument }],
    body: {
      kind: 'call-expression',
      callee: property(instance, method),
      arguments: argument === undefined ? [] : [{ kind: 'identifier-expression', name: argument }],
    },
  };
}

function lifecycleBinding(
  autoload: DirectGodotScriptAutoloadPlan,
  suffix: string,
): TargetTsExpression {
  const method = (phase: BoundGodotLifecyclePhase): string | undefined =>
    autoload.lifecycle.find((entry) => entry.phase === phase)?.methodName;
  // Each phase's binding key and its callback's parameter (`node.ts` GodotScriptLifecycleBinding).
  const callbacks = [
    ['enterTree', method('enter-tree'), undefined],
    ['ready', method('ready'), undefined],
    ['exitTree', method('exit-tree'), undefined],
    ['process', method('process'), 'delta'],
    ['physicsProcess', method('physics-process'), 'delta'],
    ['input', method('input'), 'event'],
    ['shortcutInput', method('shortcut-input'), 'event'],
    ['unhandledInput', method('unhandled-input'), 'event'],
    ['unhandledKeyInput', method('unhandled-key-input'), 'event'],
  ] as const;
  return {
    kind: 'object-expression',
    properties: [
      { key: 'native', value: { kind: 'identifier-expression', name: `$native_${suffix}` } },
      { key: 'owner', value: { kind: 'identifier-expression', name: `$instance_${suffix}` } },
      ...callbacks.flatMap(([key, methodName, argument]) =>
        methodName === undefined
          ? []
          : [{ key, value: lifecycleCallback(`$instance_${suffix}`, methodName, argument) }],
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
    {
      kind: 'import-statement',
      module: './lib/godot-compat/main',
      namedBindings: [{ imported: 'GodotMain', local: 'GodotMain' }],
    },
    {
      kind: 'import-statement',
      module: './lib/godot-compat/react-lifecycle',
      namedBindings: [
        { imported: 'GodotProjectStartup', local: 'GodotProjectStartup' },
        ...(composition.scriptAutoloads.length === 0
          ? []
          : [{ imported: 'useGodotScriptTreeAttachment', local: 'useGodotScriptTreeAttachment' }]),
      ],
    },
    ...(composition.scriptAutoloads.length === 0
      ? []
      : [
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
    // The scene names its own root.
    attributes: [],
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
  const startup: TargetTsJsxChild = {
          kind: 'jsx-element-child',
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
  // `Main`'s loop around the startup transaction: the autoloads and the main scene enter the tree
  // once the loop has made the root window, inside the `<Physics>` world it provides.
  const worldExpression: TargetTsExpression = {
    kind: 'jsx-element-expression',
    tag: 'GodotMain',
    attributes: [],
    children: [startup],
  };
  const data = projectDataLoad(composition);
  return {
    syntaxVersion: TARGET_TS_SYNTAX_VERSION,
    sourcePath: 'project.godot',
    statements: [
      ...imports,
      ...data.imports,
      ...data.statements,
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
