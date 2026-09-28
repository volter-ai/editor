/**
 * A signal is a prop or a callback (GODOT.md, the emitted game's shape, step 2): a scene
 * connection to a script's own signal is a callback its `useGodotScript` takes and connects as the
 * script attaches, where the rest stay connections to the signal (`useGodotConnection`).
 *
 * The table is by the signal's accessor (the compat binding the connection reaches the signal
 * through), never by a class name. An engine body's signals (an area's or a body's
 * `body_entered`) stay connections: the area's own bookkeeping raises them, and a callback its
 * handler kept apart from the signal would be a second connection list compat holds.
 */

import type { BoundGodotProject } from '../../analyze/bound-project';
import type { DirectGodotSceneDocumentPlan, DirectGodotSceneNodePlan } from './direct-project-composition-plan';
import { godotSceneSubnodes, type TargetGodotSceneConnectionPlan } from './scene-document-plan';

type Delivery = NonNullable<TargetGodotSceneConnectionPlan['delivery']>;

/** The accessors of a script's own signals (every name its script declares), whose script takes the scene's methods. */
const DELIVERED: ReadonlySet<string> = new Set(['godot_node_script_signal']);

type SceneWithoutRefs = Omit<DirectGodotSceneDocumentPlan, 'refs'>;

/**
 * The scenes with each connection its source delivers itself stamped so: a script's own signal
 * takes the scene's methods as its `useGodotScript` attaches it, the script's own node's in this scene (`script-connections`), an
 * instance's root script's through the instance's `connections` prop (`instance-prop`). A
 * connection stays one where the method's script is not this scene's (an instanced scene's root
 * runs its own), or where any script looks at the signal's connections (analysis's
 * `signalIntrospection`): the callback is not one of them.
 */
export function planGodotSceneSignalDelivery(scenes: readonly SceneWithoutRefs[], project: BoundGodotProject): SceneWithoutRefs[] {
  const looked = new Set(project.scripts.flatMap((script) => script.signalIntrospection.signals));
  const lookedAtAny = project.scripts.some((script) => script.signalIntrospection.any);
  const bySource = new Map(scenes.map((scene) => [scene.sourceResPath, scene] as const));
  const byScript = new Map(project.scripts.map((script) => [script.resPath, script] as const));
  return scenes.map((scene) => {
    const nodes = new Map<string, DirectGodotSceneNodePlan>();
    (function collect(node: DirectGodotSceneNodePlan): void {
      nodes.set(node.nodePath, node);
      for (const child of godotSceneSubnodes(node)) collect(child);
    })(scene.root);
    // Who takes the scene's methods on the source's script signal: a node that runs its own script
    // here (an instance that sets one included) on that script; an instance running its scene's
    // root script through the instance's prop.
    const deliveryOf = (connection: TargetGodotSceneConnectionPlan): Delivery | undefined => {
      const node = nodes.get(connection.fromNodePath);
      if (!DELIVERED.has(connection.accessor.exportName) || node === undefined || node.model !== undefined) return undefined;
      if (node.scriptInstance !== undefined) return 'script-connections';
      if (node.instance === undefined) return undefined;
      return bySource.get(node.instance.sourceResPath)?.root.scriptInstance === undefined ? undefined : 'instance-prop';
    };
    // The method the connection calls, on the target's script or the nearest ancestor declaring it:
    // a callback takes and passes on its parameters (Godot calls it with that many of the signal's
    // arguments), which one taking the rest in an array does not fix.
    const methodOf = (connection: TargetGodotSceneConnectionPlan) => {
      const script = nodes.get(connection.toNodePath)?.scriptInstance?.scriptResPath;
      if (script === undefined) return undefined;
      for (const path of [script, ...(byScript.get(script)?.inheritance.scriptAncestors ?? [])]) {
        const method = byScript.get(path)?.class.methods.find((entry) => entry.name === connection.method);
        if (method !== undefined) return method;
      }
      return undefined;
    };
    const planned = scene.connections.map((connection) => {
      const delivery = deliveryOf(connection);
      const method = methodOf(connection);
      const delivered = delivery !== undefined && method !== undefined && !method.rest && !lookedAtAny && !looked.has(connection.signal);
      return delivered ? { ...connection, delivery, methodParameters: method.parameters } : connection;
    });
    // A source's signal is delivered only when all its connections are: callbacks run before the
    // signal's connections, which would reorder a mix.
    const key = (connection: TargetGodotSceneConnectionPlan) => `${connection.fromNodePath}\0${connection.signal}`;
    const mixed = new Set(planned.filter((connection) => connection.delivery === undefined).map(key));
    return {
      ...scene,
      connections: planned.map((connection) => {
        if (connection.delivery === undefined || !mixed.has(key(connection))) return connection;
        const { delivery: _delivery, methodParameters: _parameters, ...kept } = connection;
        return kept;
      }),
    };
  });
}
