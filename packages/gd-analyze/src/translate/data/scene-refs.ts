/**
 * Which nodes of each scene a component holds a ref to, decided at plan time (docs/GODOT.md §The
 * lane's law, row 2: emit prints the plan). A node needs a ref when a script is attached to it, when
 * a connection or a script field names it, when a WorldEnvironment's sky reads it
 * (`scene-sky-lights.ts`), when Controls hang from it, and its scene root when its nodes are found as `%Name`;
 * a scene's root is exposed to the scene that instances it when that scene refers to the instance
 * (`rootRef`), and its script's fields when that scene overrides them (`rootExports`).
 */
import type { DirectGodotSceneDocumentPlan, DirectGodotSceneNodePlan } from './direct-project-composition-plan';
import { godotResolveNodePath } from './scene-animation';
import { godotSceneHeldNodes, godotSceneSubnodes } from './scene-document-plan';

export interface GodotSceneRefsPlan {
  /** The node paths the scene's component holds refs to. */
  readonly targets: readonly string[];
  /** Whether a scene that instances this one refers to the instance: its component takes a `ref`. */
  readonly rootRef: boolean;
  /** Whether a scene that instances this one overrides its root script's fields. */
  readonly rootExports: boolean;
  /** Whether a scene that instances this one connects to its root script's signals (`connections`). */
  readonly rootConnections: boolean;
  /** The targets that are an imported model's own nodes: the model's node and the path in it. */
  readonly modelNodes: readonly { readonly nodePath: string; readonly holder: string; readonly at: string }[];
}

/** Whether a node renders a React DOM element: a Control, or an instance of a scene rooted in one. */
export function godotSceneRendersDom(node: DirectGodotSceneNodePlan): boolean {
  return (node.idiom?.form.kind ?? node.instanceOf?.rootIdiom?.form.kind) === 'dom';
}

/** Whether any scene of the project renders a Control: the game then has a page for them (`src/ui.tsx`). */
export function godotCompositionHasControls(composition: { readonly scenes: readonly { readonly root: DirectGodotSceneNodePlan }[] }): boolean {
  const walk = (node: DirectGodotSceneNodePlan): boolean => godotSceneRendersDom(node) || godotSceneSubnodes(node).some(walk);
  return composition.scenes.some((scene) => walk(scene.root));
}

function refTargets(scene: Omit<DirectGodotSceneDocumentPlan, 'refs'>): ReadonlySet<string> {
  const targets = new Set<string>();
  let unique = false;
  const walk = (node: DirectGodotSceneNodePlan): void => {
    if (node.scriptInstance !== undefined) targets.add(node.nodePath);
    if (node.unique === true) unique = true;
    for (const light of node.skyLights ?? []) targets.add(light.nodePath);
    // An instance whose root script's node fields this scene hands (`useGodotNodeReferences`).
    if ((node.instanceExports ?? []).some((field) => field.value.kind === 'node-reference')) targets.add(node.nodePath);
    for (const field of [...(node.scriptInstance?.fields ?? []), ...(node.instanceExports ?? [])]) {
      const target = field.value.kind === 'node-reference' ? godotResolveNodePath(node.nodePath, field.value.value) : undefined;
      if (target !== undefined) targets.add(target);
    }
    // An AnimationPlayer among Controls, whose animations its scene mounts on its element.
    if (node.dom?.animations !== undefined) targets.add(node.nodePath);
    // A node that renders no element holding Controls: their host stands for it (`godot_node_dom_host`).
    if (!godotSceneRendersDom(node) && node.children.some(godotSceneRendersDom)) targets.add(node.nodePath);
    for (const child of godotSceneSubnodes(node)) walk(child);
  };
  walk(scene.root);
  if (unique) targets.add(scene.root.nodePath);
  // A connection delivered as a callback (`script-connections`, `instance-prop`) needs only the target's script (`scene-signal-delivery.ts`).
  for (const connection of scene.connections) {
    if (connection.delivery === undefined) targets.add(connection.fromNodePath);
    targets.add(connection.toNodePath);
  }
  return targets;
}

/** Each scene with its refs planned, from every scene of the project. */
export function planGodotSceneRefs(scenes: readonly Omit<DirectGodotSceneDocumentPlan, 'refs'>[]): DirectGodotSceneDocumentPlan[] {
  // The component holds its root too, which `useGodotScene` seats: an inheriting scene holds its
  // root, an instance of the scene it inherits, so that scene takes its instancer's ref.
  const targets = new Map(scenes.map((scene) => [scene.sourceResPath, new Set([...refTargets(scene), scene.root.nodePath])] as const));
  const instancedBy = (scene: Omit<DirectGodotSceneDocumentPlan, 'refs'>, holds: (entry: DirectGodotSceneNodePlan, other: Omit<DirectGodotSceneDocumentPlan, 'refs'>) => boolean): boolean =>
    scenes.some((other) =>
      (function visit(entry: DirectGodotSceneNodePlan): boolean {
        return (entry.instance?.sourceResPath === scene.sourceResPath && holds(entry, other)) || godotSceneSubnodes(entry).some(visit);
      })(other.root),
    );
  return scenes.map((scene) => {
    const held = godotSceneHeldNodes(scene.root);
    const own = [...(targets.get(scene.sourceResPath) ?? [])].sort();
    const modelNodes = own.flatMap((nodePath) => {
      const entry = held.get(nodePath);
      return entry?.kind === 'model' ? [{ nodePath, holder: entry.holder, at: entry.at }] : [];
    });
    return {
      ...scene,
      refs: {
        targets: own,
        modelNodes,
        rootRef: instancedBy(scene, (entry, other) => targets.get(other.sourceResPath)?.has(entry.nodePath) === true),
        rootExports: scene.root.scriptInstance !== undefined && instancedBy(scene, (entry) => (entry.instanceExports?.length ?? 0) > 0 || (entry.fieldValues?.length ?? 0) > 0),
        rootConnections:
          scene.root.scriptInstance !== undefined &&
          instancedBy(scene, (entry, other) => other.connections.some((connection) => connection.delivery === 'instance-prop' && connection.fromNodePath === entry.nodePath)),
      },
    };
  });
}
