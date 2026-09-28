/**
 * Static node access is a ref (GODOT.md, the emitted game's shape, step 1): a script's `$Path`,
 * `%Unique` and `get_node("literal")` on self (`godotSelfNodePath`) resolve at plan time to nodes
 * of the scene the script is attached in, handed to the script as fields, so its code reads
 * `this.$Path` where Godot looks the node up by name.
 *
 * A path becomes a field when every node that runs the script (its own or a subclass's) resolves it
 * to a node of that node's own scene that a ref can hold: the scene's component holds a ref to it
 * and hands it over as it hands an authored node reference (`useGodotScript`). A path computed at
 * run time, one leaving the scene (above its root, absolute, into an instanced scene's or a model's
 * own nodes), one with a property subpath, and every path of a script something runs outside a
 * scene (an autoload of the bare script, `Class.new()`, `set_script`) keep the tree lookup.
 */

import type { BoundGodotProject } from '../../analyze/bound-project';
import { godotSelfNodePath } from '../../analyze/self-node-paths';
import { godotResolveNodePath } from './scene-animation';
import { godotSceneSubnodes, type TargetGodotSceneDocumentPlan, type TargetGodotSceneNodePlan } from './scene-document-plan';

/** A static path a script reads and the field its scene hands it in. */
export interface GodotScriptNodePath {
  readonly path: string;
  readonly field: string;
}

/** A node running a script with fields, and the node each field holds, as a path from it. */
export interface GodotScriptNodeSite {
  readonly documentPath: string;
  readonly nodePath: string;
  readonly fields: readonly { readonly field: string; readonly path: string }[];
}

export interface GodotScriptNodePathsPlan {
  /** Each script's own fields (its ancestors' are theirs, and inherited), by the script's res path. */
  readonly scripts: ReadonlyMap<string, readonly GodotScriptNodePath[]>;
  /** Every node running a script with fields: what its scene hands it. */
  readonly sites: readonly GodotScriptNodeSite[];
}

export const EMPTY_SCRIPT_NODE_PATHS: GodotScriptNodePathsPlan = { scripts: new Map(), sites: [] };

/** One node that runs a script: the scene it is a node of, and its path there. */
interface Site {
  readonly scene: TargetGodotSceneDocumentPlan;
  readonly node: TargetGodotSceneNodePlan;
  /** The scene's nodes a ref can hold (`heldNodes`). */
  readonly nodes: ReadonlyMap<string, TargetGodotSceneNodePlan>;
}

/**
 * The members lowering generates on a script class (`lower-official-bound.ts`): a field is never
 * one of them.
 */
const GENERATED_MEMBER = /^\$(native|implicit_ready|source_ready|resources|autoload_|load_|Scene_|godot_local_)/;

/** The field a path is handed in: `$` and the path, which no GDScript member name can be. */
function fieldName(path: string): string | undefined {
  const parts = path.split('/').map((part) => (part === '..' ? 'parent' : part.replace(/^%/, '')));
  const name = `$${parts.join('_').replace(/[^A-Za-z0-9_$]/g, '_')}`;
  return GENERATED_MEMBER.test(name) ? undefined : name;
}

/**
 * The scene's nodes a ref can hold: its own tree (not what it places under a model's nodes, which
 * a node reference does not reach yet), and not a collision shape, which is its body's collider.
 */
function heldNodes(scene: TargetGodotSceneDocumentPlan): ReadonlyMap<string, TargetGodotSceneNodePlan> {
  const nodes = new Map<string, TargetGodotSceneNodePlan>();
  (function collect(node: TargetGodotSceneNodePlan): void {
    if (node.idiom?.form.kind !== 'collider') nodes.set(node.nodePath, node);
    for (const child of node.children) collect(child);
  })(scene.root);
  return nodes;
}

function sceneNodes(scene: TargetGodotSceneDocumentPlan): readonly TargetGodotSceneNodePlan[] {
  const nodes: TargetGodotSceneNodePlan[] = [];
  (function collect(node: TargetGodotSceneNodePlan): void {
    nodes.push(node);
    for (const child of godotSceneSubnodes(node)) collect(child);
  })(scene.root);
  return nodes;
}

/** The scene node a path names from a site, or undefined when it names none a ref can hold. */
function resolve(site: Site, path: string): string | undefined {
  if (path.includes(':')) return undefined;
  if (path.startsWith('%')) {
    // `%Name`: the node of the scene marked unique with that name. A node that is an instance
    // looks in the scene it instances first (`Node::get_node`, its owned unique nodes), which this
    // scene does not hold.
    if (path.includes('/') || site.node.instance !== undefined) return undefined;
    const matches = [...site.nodes.values()].filter((node) => node.unique === true && node.name === path.slice(1));
    return matches.length === 1 ? matches[0]?.nodePath : undefined;
  }
  const target = godotResolveNodePath(site.node.nodePath, path);
  return target !== undefined && site.nodes.has(target) ? target : undefined;
}

/** The path from one scene node to another, as `get_node` takes it (`..` up, then down). */
function relativeNodePath(from: string, to: string): string {
  const fromParts = from === '.' ? [] : from.split('/');
  const toParts = to === '.' ? [] : to.split('/');
  let common = 0;
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) common += 1;
  const parts = [...fromParts.slice(common).map(() => '..'), ...toParts.slice(common)];
  return parts.length === 0 ? '.' : parts.join('/');
}

/**
 * The scripts something runs outside a scene, with their ancestors: an autoload of the bare
 * script, a `new()` of it, and every script when any code stores a node's script or makes an
 * instance of a script it does not know.
 */
function scriptsOutsideScenes(project: BoundGodotProject): ReadonlySet<string> {
  const outside = new Set<string>();
  const ancestors = new Map(project.scripts.map((script) => [script.resPath, script.inheritance.scriptAncestors] as const));
  const add = (resPath: string) => {
    for (const path of [resPath, ...(ancestors.get(resPath) ?? [])]) outside.add(path);
  };
  const every = new Set(project.scripts.map((entry) => entry.resPath));
  for (const script of project.scripts) {
    if (script.autoloads.length > 0) add(script.resPath);
    const nodes = script.refinedProgram.nodes;
    const literal = (id: number | undefined) => {
      const entry = id === undefined ? undefined : nodes[id];
      return entry?.kind === 'LITERAL' && (entry.value.kind === 'string' || entry.value.kind === 'string-name') ? entry.value.value : undefined;
    };
    for (const node of nodes) {
      // A store to a node's script (`node.script = s`, `set("script", s)`, `set_script(s)`).
      if (node.kind === 'ASSIGNMENT') {
        const assignee = nodes[node.assignee];
        const attribute = assignee?.kind === 'SUBSCRIPT' && assignee.isAttribute ? nodes[assignee.attribute] : undefined;
        if (attribute?.kind === 'IDENTIFIER' && attribute.name === 'script') return every;
      }
      if (node.kind !== 'CALL') continue;
      // `set(name, value)` with a name known only at run time may store the script too.
      if (node.functionName === 'set_script' || (node.functionName === 'set' && [undefined, 'script'].includes(literal(node.arguments[0])))) return every;
      if (node.functionName !== 'new') continue;
      if (node.datatype.scriptPath !== '') add(node.datatype.scriptPath);
      else if (node.datatype.kind !== 'NATIVE' && node.datatype.kind !== 'BUILTIN') return every;
    }
  }
  return outside;
}

export function planGodotScriptNodePaths(project: BoundGodotProject, scenes: readonly TargetGodotSceneDocumentPlan[]): GodotScriptNodePathsPlan {
  const byPath = new Map(project.scripts.map((script) => [script.resPath, script] as const));
  const chain = (resPath: string) => [resPath, ...(byPath.get(resPath)?.inheritance.scriptAncestors ?? [])];
  // A script runs where it or a subclass is attached.
  const sites: Site[] = [];
  for (const scene of scenes) {
    const nodes = heldNodes(scene);
    for (const node of sceneNodes(scene)) if (node.scriptResPath !== undefined) sites.push({ scene, node, nodes });
  }
  const outside = scriptsOutsideScenes(project);
  const scripts = new Map<string, readonly GodotScriptNodePath[]>();
  // Ancestors first: a subclass inherits their fields and never declares one again.
  const ordered = [...project.scripts].sort((left, right) => left.inheritance.scriptAncestors.length - right.inheritance.scriptAncestors.length || left.resPath.localeCompare(right.resPath));
  for (const script of ordered) {
    const at = sites.filter((site) => chain(site.node.scriptResPath as string).includes(script.resPath));
    if (at.length === 0 || outside.has(script.resPath)) continue;
    const taken = new Set(script.inheritance.scriptAncestors.flatMap((ancestor) => (scripts.get(ancestor) ?? []).map((entry) => entry.field)));
    const fields: GodotScriptNodePath[] = [];
    const paths = new Set<string>();
    for (const node of script.refinedProgram.nodes) {
      const path = godotSelfNodePath(script.refinedProgram, node);
      if (path !== undefined) paths.add(path);
    }
    for (const path of [...paths].sort()) {
      const field = fieldName(path);
      // Two paths spelled alike as fields: the second keeps its lookup.
      if (field === undefined || taken.has(field)) continue;
      if (!at.every((site) => resolve(site, path) !== undefined)) continue;
      taken.add(field);
      fields.push({ path, field });
    }
    if (fields.length > 0) scripts.set(script.resPath, fields);
  }
  const handed = sites.flatMap((site): GodotScriptNodeSite[] => {
    const fields = chain(site.node.scriptResPath as string).flatMap((resPath) =>
      (scripts.get(resPath) ?? []).map((entry) => ({ field: entry.field, path: relativeNodePath(site.node.nodePath, resolve(site, entry.path) as string) })),
    );
    return fields.length === 0 ? [] : [{ documentPath: site.scene.sourceResPath, nodePath: site.node.nodePath, fields }];
  });
  return { scripts, sites: handed };
}
