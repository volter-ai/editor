import { type ScriptLifecycleImports, scriptLifecycleHooks } from './script-lifecycle-hooks';
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
export const DIRECT_GODOT_SETTINGS_PATH = 'src/project/settings.ts';
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
            { kind: 'import-statement' as const, module: './project/settings', defaultBinding: 'settings', namedBindings: [] },
          ]
        : []),
      {
        kind: 'import-statement' as const,
        module: './lib/godot-compat/input',
        namedBindings: [
          { imported: 'godot_input_map_load_json', local: 'godot_input_map_load_json' },
        ],
      },
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

function assignment(target: TargetTsExpression, value: TargetTsExpression): TargetTsStatement {
  return {
    kind: 'expression-statement',
    expression: { kind: 'assignment-expression', operator: '=', target, value },
  };
}

/** `argument`: the callback's one parameter (a frame's delta, an input event), passed through. */
function autoloadComponent(
  autoload: DirectGodotScriptAutoloadPlan,
  index: number,
  imports: ScriptLifecycleImports,
): TargetTsStatement {
  const node = `$node_autoload_${index}`;
  const script = `$script_autoload_${index}`;
  const call = (name: string, args: readonly TargetTsExpression[]): TargetTsExpression => ({ kind: 'call-expression', callee: { kind: 'identifier-expression', name }, arguments: args });
  return {
    kind: 'function-statement',
    name: `$Autoload_${index}`,
    parameters: [
      {
        name: 'props',
        type: {
          kind: 'object-type',
          properties: [
            { name: 'instanceRef', readonly: true, type: { kind: 'type-reference', name: 'RefObject', arguments: [nullable(referenceType(`$AutoloadScript_${index}`))] } },
          ],
        },
      },
    ],
    body: [
      {
        kind: 'variable-statement',
        declaration: 'const',
        name: node,
        initializer: { kind: 'call-expression', callee: { kind: 'identifier-expression', name: 'useRef' }, typeArguments: [nullable(referenceType('Group'))], arguments: [{ kind: 'literal-expression', value: null }] },
      },
      {
        kind: 'variable-statement',
        declaration: 'const',
        name: script,
        initializer: call('useGodotScript', [{ kind: 'identifier-expression', name: node }, { kind: 'identifier-expression', name: `$AutoloadScript_${index}` }]),
      },
      // The world's scenes read the autoload's instance through `instanceRef`.
      {
        kind: 'expression-statement',
        expression: call('useEffect', [
          {
            kind: 'arrow-expression',
            parameters: [],
            body: [
              assignment(property(property('props', 'instanceRef'), 'current'), property(script, 'current')),
              {
                kind: 'return-statement',
                expression: { kind: 'arrow-expression', parameters: [], body: [assignment(property(property('props', 'instanceRef'), 'current'), { kind: 'literal-expression', value: null })] },
              },
            ],
          },
          { kind: 'array-expression', elements: [] },
        ]),
      },
      ...scriptLifecycleHooks(script, node, autoload.lifecycle, imports),
      // The autoload enters the tree once its script is attached (its component's last effect); it
      // renders the scenes its script adds under it.
      { kind: 'variable-statement', declaration: 'const', name: 'addedScenes', initializer: call('useGodotScene', [{ kind: 'identifier-expression', name: node }]) },
      {
        kind: 'return-statement',
        expression: {
          kind: 'jsx-element-expression',
          tag: 'group',
          attributes: [
            { kind: 'jsx-string-attribute', name: 'name', value: autoload.name },
            { kind: 'jsx-expression-attribute', name: 'ref', value: { kind: 'identifier-expression', name: node } },
          ],
          children: [{ kind: 'jsx-expression-child', value: { kind: 'identifier-expression', name: 'addedScenes' } }],
        },
      },
    ],
  };
}

/** The value of a carried engine setting, or its default. */
function settingNumbers(composition: DirectGodotProjectCompositionPlan, key: string, fallback: readonly number[]): readonly number[] {
  const value = composition.projectSettings.find((entry) => entry.key === key)?.value;
  if (value === undefined) return fallback;
  if (value.kind === 'number') return [value.value];
  if ('components' in value) return value.components;
  return fallback;
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
  const scene = composition.scenes.find((candidate) => candidate.sourceResPath === composition.mainScene);
  if (scene === undefined) throw new Error(`${composition.mainScene}: main scene plan is absent`);
  const id = (name: string): TargetTsExpression => ({ kind: 'identifier-expression', name });
  const call = (name: string, args: readonly TargetTsExpression[] = []): TargetTsExpression => ({ kind: 'call-expression', callee: id(name), arguments: args });
  const statement = (expression: TargetTsExpression): TargetTsStatement => ({ kind: 'expression-statement', expression });
  const named = (module: string, names: readonly string[], typeOnly = false): TargetTsStatement => ({
    kind: 'import-statement',
    module,
    namedBindings: [...new Set(names)].sort().map((name) => ({ imported: name, local: name })),
    ...(typeOnly ? { typeOnly: true as const } : {}),
  });
  const mainAutoloadReferences = directGodotSceneAutoloadReferences(scene.root);
  const otherScenes = composition.scenes
    .filter((candidate) => candidate !== scene)
    .map((candidate) => ({ candidate, references: directGodotSceneAutoloadReferences(candidate.root) }))
    .filter((entry) => entry.references.length > 0);
  const hooks: ScriptLifecycleImports = { react: new Set(), fiber: new Set(), rapier: new Set(), compat: new Map() };
  const autoloadComponents = composition.scriptAutoloads.map((autoload, index) => autoloadComponent(autoload, index, hooks));
  const hasAutoloads = composition.scriptAutoloads.length > 0;
  // `<Physics>` at the project's tick rate and gravity (`physics/common/physics_ticks_per_second`,
  // `physics/3d/default_gravity` along `default_gravity_vector`).
  const ticks = settingNumbers(composition, 'physics/common/physics_ticks_per_second', [60])[0] ?? 60;
  const magnitude = settingNumbers(composition, 'physics/3d/default_gravity', [9.8])[0] ?? 9.8;
  const direction = settingNumbers(composition, 'physics/3d/default_gravity_vector', [0, -1, 0]);
  const gravity = direction.map((component) => Math.fround(component * magnitude));
  const numbers = (values: readonly number[]): TargetTsExpression => ({ kind: 'array-expression', elements: values.map((value) => ({ kind: 'literal-expression', value })) });
  const mainScene: TargetTsJsxChild = { kind: 'jsx-element-child', tag: 'Scene', attributes: [{ kind: 'jsx-string-attribute', name: 'name', value: scene.root.name }], children: [] };
  const autoloadValue = (references: readonly { readonly name: string }[]): TargetTsExpression => ({
    kind: 'object-expression',
    properties: references.map((reference) => ({ key: reference.name, value: id(`$autoloadInstance_${directGodotAutoloadIndex(composition, reference as never)}`) })),
  });
  const composedMainScene: TargetTsJsxChild =
    mainAutoloadReferences.length === 0
      ? mainScene
      : { kind: 'jsx-element-child', tag: directGodotSceneAutoloadContextName(scene.exportName), attributes: [{ kind: 'jsx-expression-attribute', name: 'value', value: autoloadValue(mainAutoloadReferences) }], children: [mainScene] };
  const game: TargetTsJsxElementShape = {
    tag: 'Game',
    attributes: [],
    children: [
      ...composition.scriptAutoloads.map((_autoload, index): TargetTsJsxChild => ({
        kind: 'jsx-element-child',
        tag: `$Autoload_${index}`,
        attributes: [{ kind: 'jsx-expression-attribute', name: 'instanceRef', value: id(`$autoloadInstance_${index}`) }],
        children: [],
      })),
      composedMainScene,
    ],
  };
  // Scenes a script instantiates read their autoloads from providers around the world's content.
  const provided = otherScenes.reduce<TargetTsJsxElementShape>(
    (inner, { candidate, references }) => ({
      tag: directGodotSceneAutoloadContextName(candidate.exportName),
      attributes: [{ kind: 'jsx-expression-attribute', name: 'value', value: autoloadValue(references) }],
      children: [{ kind: 'jsx-element-child', ...inner }],
    }),
    game,
  );
  const world: TargetTsExpression = {
    kind: 'jsx-element-expression',
    tag: 'Suspense',
    attributes: [{ kind: 'jsx-expression-attribute', name: 'fallback', value: { kind: 'literal-expression', value: null } }],
    children: [
      {
        kind: 'jsx-element-child',
        tag: 'Physics',
        attributes: [
          { kind: 'jsx-expression-attribute', name: 'timeStep', value: { kind: 'binary-expression', operator: '/', left: { kind: 'literal-expression', value: 1 }, right: { kind: 'literal-expression', value: ticks } } },
          { kind: 'jsx-expression-attribute', name: 'gravity', value: numbers(gravity) },
          { kind: 'jsx-expression-attribute', name: 'colliders', value: { kind: 'literal-expression', value: false } },
        ],
        children: [{ kind: 'jsx-element-child', ...provided }],
      },
    ],
  };
  // Inside `<Physics>`: the world's wiring, the SceneTree, and the root Window, which delivers the
  // page's input and draws its canvas items from its own hooks.
  const gameComponent: TargetTsStatement = {
    kind: 'function-statement',
    name: 'Game',
    parameters: [{ name: 'props', type: { kind: 'type-reference', name: 'PropsWithChildren', arguments: [] } }],
    body: [
      statement(call('useGodotResources')),
      statement(call('useGodotWorld')),
      statement(call('useGodotTree')),
      { kind: 'variable-statement', declaration: 'const', name: 'generation', initializer: call('useGodotSceneReload') },
      statement(call('useGodotRootWindow')),
      {
        kind: 'return-statement',
        expression: {
          kind: 'jsx-fragment-expression',
          children: [
            // `reload_current_scene` mounts the main scene anew (`useGodotSceneReload`).
            {
              kind: 'jsx-element-child',
              tag: 'Fragment',
              attributes: [{ kind: 'jsx-expression-attribute', name: 'key', value: id('generation') }],
              children: [{ kind: 'jsx-expression-child', value: { kind: 'property-expression', object: id('props'), property: 'children' } }],
            },
          ],
        },
      },
    ],
  };
  const imports: TargetTsStatement[] = [
    named('react', ['Fragment', 'Suspense', ...(hasAutoloads ? ['useEffect', 'useRef'] : []), ...hooks.react]),
    named('react', ['PropsWithChildren', ...(hasAutoloads ? ['RefObject'] : [])], true),
    ...(hooks.fiber.size === 0 ? [] : [named('@react-three/fiber', [...hooks.fiber])]),
    named('@react-three/rapier', ['Physics', ...hooks.rapier]),
    ...(hasAutoloads ? [named('three', ['Group'], true)] : []),
    { kind: 'import-statement', module: moduleSpecifier(scene.targetPath), namedBindings: [{ imported: scene.exportName, local: scene.exportName }, ...(mainAutoloadReferences.length === 0 ? [] : [{ imported: directGodotSceneAutoloadContextName(scene.exportName), local: directGodotSceneAutoloadContextName(scene.exportName) }])] },
    ...otherScenes.map(({ candidate }): TargetTsStatement => ({
      kind: 'import-statement',
      module: moduleSpecifier(candidate.targetPath),
      namedBindings: [{ imported: directGodotSceneAutoloadContextName(candidate.exportName), local: directGodotSceneAutoloadContextName(candidate.exportName) }],
    })),
    named('./lib/godot-compat/main', ['useGodotResources', 'useGodotSceneReload', 'useGodotWorld']),
    named('./lib/godot-compat/advance', ['useGodotRootWindow', 'useGodotTree']),
    ...(hasAutoloads ? [named('./lib/godot-compat/react-lifecycle', ['useGodotScene', 'useGodotScript'])] : []),
    ...[...new Set(hooks.compat.values())].map((module) =>
      named(`./lib/godot-compat/${module}`, [...hooks.compat].filter(([, from]) => from === module).map(([name]) => name)),
    ),
    ...composition.scriptAutoloads.map((autoload, index): TargetTsStatement => ({
      kind: 'import-statement',
      module: moduleSpecifier(autoload.generatedClass.modulePath),
      namedBindings: [{ imported: autoload.generatedClass.exportName, local: `$AutoloadScript_${index}` }],
    })),
  ];
  const data = projectDataLoad(composition);
  return {
    syntaxVersion: TARGET_TS_SYNTAX_VERSION,
    sourcePath: 'project.godot',
    statements: [
      ...imports,
      ...data.imports,
      ...data.statements,
      ...autoloadComponents,
      gameComponent,
      {
        kind: 'variable-statement',
        declaration: 'const',
        name: 'scenes',
        initializer: { kind: 'object-expression', properties: [{ key: 'main', value: id(scene.exportName) }] },
      },
      { kind: 'variable-statement', declaration: 'const', name: 'activeScene', type: { kind: 'type-reference', name: 'keyof typeof scenes', arguments: [] }, initializer: { kind: 'literal-expression', value: 'main' } },
      {
        kind: 'function-statement',
        name: 'World',
        parameters: [],
        body: [
          { kind: 'variable-statement', declaration: 'const', name: 'Scene', initializer: { kind: 'element-expression', object: id('scenes'), index: id('activeScene') } },
          ...composition.scriptAutoloads.map((_autoload, index): TargetTsStatement => ({
            kind: 'variable-statement',
            declaration: 'const',
            name: `$autoloadInstance_${index}`,
            initializer: { kind: 'call-expression', callee: id('useRef'), typeArguments: [nullable(referenceType(`$AutoloadScript_${index}`))], arguments: [{ kind: 'literal-expression', value: null }] },
          })),
          { kind: 'return-statement', expression: world },
        ],
        modifiers: ['export', 'default'],
      },
    ],
  };
}
