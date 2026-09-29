/**
 * The capability files a game reaches, decided when the plan is made (docs/GODOT.md §The lane's
 * law, row 6): a capability's module is planned only when the game's own files require it or a
 * planned module of it imports it. The game's requirements are read from the plan (each idiom's and
 * resource's compat module, each lowered script's imports, the world's and the data files'); a
 * module's imports are read from the capability's own source, a plan input the toolchain snapshot
 * froze. Emit prints what this plans and refuses an import of a capability file it does not list.
 */
import * as path from 'node:path';
import ts from 'typescript';
import type { BoundGodotLifecycleEntry } from '../../analyze/bound-project';
import type { CapabilityCopyArtifact } from '../../snapshot/toolchain-snapshot';
import type { OfficialBoundCodePlan } from '../code/lower-official-bound';
import type { DirectGodotProjectCompositionPlan, DirectGodotSceneNodePlan } from '../data/direct-project-composition-plan';
import type { TargetGodotAnimationBindingsPlan } from '../data/scene-animation';
import { godotSceneSubnodes, type TargetGodotSceneResourcePlan } from '../data/scene-document-plan';

/** A module as the plan names it (`vector3`, `lib/godot-compat/vector3`, `lib:reflections/index`), as a project path without extension. */
export function godotCapabilityModulePath(module: string): string {
  if (module.startsWith('lib:')) return `src/lib/${module.slice('lib:'.length)}`;
  if (module.startsWith('lib/')) return `src/${module}`;
  return `src/lib/godot-compat/${module}`;
}

/** The capability modules a script's lifecycle hooks import (`script-lifecycle-hooks.ts`). */
function lifecycleModules(lifecycle: readonly BoundGodotLifecycleEntry[]): readonly string[] {
  const phases = new Set<string>(lifecycle.map((entry) => entry.phase));
  return [
    ...(phases.has('process') || phases.has('physics-process') ? ['node'] : []),
    ...(phases.has('integrate-forces') ? ['rigid-body-3d'] : []),
    ...(['input', 'shortcut-input', 'unhandled-key-input', 'unhandled-input'].some((phase) => phases.has(phase)) ? ['react-lifecycle'] : []),
  ];
}

function bindingModules(plan: TargetGodotAnimationBindingsPlan | undefined): readonly string[] {
  if (plan === undefined) return [];
  return [
    ...plan.values.flatMap(({ binding }) => ('setter' in binding ? [binding.setter.module] : [])),
    ...plan.methods.map(({ binding }) => binding.module),
  ];
}

/** What a planned resource is written with: its idiom's module, or its class's constructor. */
function resourceModules(resource: TargetGodotSceneResourcePlan): readonly string[] {
  const idiom = resource.idiom;
  if (idiom === undefined) return [resource.construct.module];
  switch (idiom.kind) {
    case 'loaded':
      return [idiom.module];
    case 'texture':
      return ['compressed-texture-2d'];
    // Constructed, then sampled as a material's map (`gradientMap`).
    case 'gradient-texture':
      return [resource.construct.module, 'gradient-texture-2d', 'base-material-3d'];
    case 'shader':
      return ['shader'];
    case 'shader-material':
      return ['shader-material'];
    case 'mesh-library':
      return ['mesh-library'];
    case 'navigation-mesh':
      return ['navigation-mesh'];
    // A collider's shape is Rapier's; a shape a node takes as a value (a cast's) is constructed.
    case 'collider':
      return [resource.construct.module];
    case 'animation-library':
      return ['animation-library'];
    case 'animation-tree':
      return ['animation-tree'];
    case 'array-mesh':
      return ['array-mesh'];
    // The function the plan stamped for a plane to be handed once made, as emit prints it: its turn
    // to a facing other than three's own.
    case 'plane':
      return idiom.made === undefined ? [] : [idiom.made.module];
    case 'material':
      return [...(idiom.factory === undefined ? [] : [idiom.factory.module]), ...idiom.props.flatMap((prop) => (prop.value.kind === 'compat' ? [prop.value.module] : []))];
    default:
      return [];
  }
}

/** What a planned node is written with. */
function nodeModules(node: DirectGodotSceneNodePlan): readonly string[] {
  const modules: string[] = [];
  const form = node.idiom?.form;
  switch (form?.kind) {
    case 'element':
    case 'component':
    case 'plain-node':
      modules.push(form.module);
      break;
    case 'reflection-probe':
      modules.push('lib:reflections/index', 'reflection-probe');
      break;
    case 'light':
      if (form.directional) modules.push('directional-light-3d');
      // A spot light aims itself by compat's hand (`scene-light-idioms.ts`).
      if (node.light?.aim !== undefined) modules.push(node.light.aim.module);
      break;
    case 'camera':
      if (node.setters.some((setter) => setter.setter.exportName === 'set_environment')) modules.push('camera-3d');
      break;
    case 'body':
      if (form.sensor) modules.push('area-3d');
      if (form.type === 'dynamic') modules.push('rigid-body-3d');
      // The body's driver (a vehicle's controller), rendered inside it.
      if (form.driver !== undefined) modules.push(form.driver.module);
      break;
    default:
      break;
  }
  if (node.setters.some((setter) => setter.setter.exportName.startsWith('set_visibility_range'))) modules.push('geometry-instance-3d');
  if (node.model !== undefined) {
    modules.push('packed-scene');
    // The model's external images load through the scene's texture hook.
    if ((node.model.images ?? []).length > 0) modules.push('compressed-texture-2d');
    for (const override of node.model.overrides) modules.push(...bindingModules(override.animation));
  }
  modules.push(...bindingModules(node.animation));
  if (node.scriptInstance !== undefined) modules.push('react-lifecycle', ...lifecycleModules(node.scriptInstance.lifecycle));
  return modules;
}

/**
 * The capability modules the game's own files import, as project paths without extension: its
 * world, scenes, lowered scripts and the data files typed by a compat interface (`typedData`).
 */
export function godotCapabilityRequirements(
  composition: DirectGodotProjectCompositionPlan,
  code: OfficialBoundCodePlan,
  typedData: Iterable<string>,
): ReadonlySet<string> {
  const modules: string[] = [...typedData];
  // The world (`direct-project-world-syntax.ts`): the host hooks, the settings and InputMap loads, its autoloads.
  modules.push('main', 'advance', 'input');
  if (composition.projectSettings.length > 0) modules.push('project-settings');
  // The world sets the bus layout through the audio protocol (`projectDataLoad`).
  if (composition.audioBuses.length > 1 || composition.audioBuses.some((bus) => bus.volumeDb !== 0 || bus.mute || bus.solo || bus.bypassFx)) modules.push('audio-stream');
  // A preloaded resource's module (`resource-module-syntax.ts`): its resources, the images it loads
  // as it is evaluated and the handle of its resource.
  for (const module of composition.resourceModules) {
    for (const resource of module.resources) modules.push(...resourceModules(resource));
    if (module.resources.some((resource) => resource.load !== undefined)) modules.push('compressed-texture-2d', 'base-material-3d');
    if (module.handle !== undefined) modules.push(module.handle.module);
  }
  for (const autoload of composition.scriptAutoloads) modules.push('react-lifecycle', ...lifecycleModules(autoload.lifecycle));
  for (const scene of composition.scenes) {
    // Every scene component enters the tree through `useGodotScene`.
    modules.push('react-lifecycle');
    for (const resource of scene.resources) {
      modules.push(...resourceModules(resource));
    }
    for (const connection of scene.connections) modules.push(connection.accessor.module);
    const visit = (node: DirectGodotSceneNodePlan): void => {
      modules.push(...nodeModules(node));
      for (const child of godotSceneSubnodes(node)) visit(child);
    };
    visit(scene.root);
  }
  const required = new Set(modules.map(godotCapabilityModulePath));
  // A lowered script imports what its syntax names, relative to `src/scripts/<sourcePath>`.
  for (const file of code.sourceFiles) {
    for (const statement of file.statements) {
      if (statement.kind !== 'import-statement' || !statement.module.startsWith('.')) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(`src/scripts/${file.sourcePath}`), statement.module));
      if (target.startsWith('src/lib/')) required.add(target);
    }
  }
  return required;
}

/**
 * The module specifiers a capability source file imports: static imports and re-exports, `import()`,
 * `new URL(…, import.meta.url)`, and the declaration files its `/// <reference path>` directives name
 * (a package's types compat declares itself).
 */
function capabilityImports(copy: CapabilityCopyArtifact): readonly string[] {
  const text = Buffer.from(copy.bytes).toString('utf8');
  const source = ts.createSourceFile(copy.path, text, ts.ScriptTarget.Latest, false, copy.path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] !== undefined && ts.isStringLiteralLike(node.arguments[0])) {
      found.push(node.arguments[0].text);
    } else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'URL' &&
      node.arguments?.[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[1]?.getText(source) === 'import.meta.url'
    ) {
      found.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const reference of source.referencedFiles) found.push(reference.fileName);
  return found;
}

/** A bare specifier's package: `three/examples/…` is `three`, `@react-three/fiber/x` is `@react-three/fiber`. */
function packageOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] as string);
}

/** The npm packages capability files import, each by its bare specifier's package. */
export function godotCapabilityPackages(copies: readonly CapabilityCopyArtifact[]): ReadonlySet<string> {
  return new Set(copies.filter((copy) => isCode(copy.path)).flatMap((copy) => capabilityImports(copy).filter((specifier) => !specifier.startsWith('.')).map(packageOf)));
}

/** The copied file a project path names, as a bundler resolves it (`x`, `x.ts`, `x.tsx`, `x/index.ts`). */
function resolveCopy(target: string, copies: ReadonlyMap<string, CapabilityCopyArtifact>): CapabilityCopyArtifact | undefined {
  for (const candidate of [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`]) {
    const copy = copies.get(candidate);
    if (copy !== undefined) return copy;
  }
  return undefined;
}

const isCode = (file: string): boolean => /\.(ts|tsx|mts|js|mjs)$/u.test(file);

/**
 * The capability copies the game reaches: each required module and every file its static imports
 * reach within the capabilities, and a capability's license texts beside any file of it the game
 * carries. A required module no capability provides refuses the plan.
 */
export function reachedGodotCapabilityCopies(
  copies: readonly CapabilityCopyArtifact[],
  required: ReadonlySet<string>,
): readonly CapabilityCopyArtifact[] {
  const byPath = new Map(copies.map((copy) => [copy.path, copy] as const));
  const reached = new Set<string>();
  const queue: CapabilityCopyArtifact[] = [];
  const reach = (copy: CapabilityCopyArtifact): void => {
    if (reached.has(copy.path)) return;
    reached.add(copy.path);
    queue.push(copy);
  };
  for (const module of [...required].sort()) {
    const copy = resolveCopy(module, byPath);
    if (copy === undefined) throw new Error(`${module}: the game requires a module no capability provides`);
    reach(copy);
  }
  while (queue.length > 0) {
    const copy = queue.pop() as CapabilityCopyArtifact;
    if (!isCode(copy.path)) continue;
    for (const specifier of capabilityImports(copy)) {
      if (!specifier.startsWith('.')) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(copy.path), specifier.replace(/\?.*$/u, '')));
      const imported = resolveCopy(target, byPath);
      if (imported === undefined) throw new Error(`${copy.path}: imports ${specifier}, which its capability does not carry`);
      reach(imported);
    }
  }
  // A capability's license texts travel with any of its files the game carries.
  const directories = new Set([...reached].map((file) => path.posix.dirname(file)));
  for (const copy of copies) {
    if (/^LICENSE/u.test(path.posix.basename(copy.path)) && directories.has(path.posix.dirname(copy.path))) reached.add(copy.path);
  }
  return copies.filter((copy) => reached.has(copy.path));
}
