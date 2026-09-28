/**
 * A signal is a prop or a callback (GODOT.md, the emitted game's shape, step 2): a scene
 * connection to a signal whose source element raises it from its own event handler is a callback
 * that handler takes, calling the method directly, where the rest stay connections to the signal.
 *
 * The table is by the signal's accessor (the compat binding the connection reaches the signal
 * through), never by a class name: an Area3D's body signals are raised by its sensor's
 * intersection handler (`godot_area_3d_intersection`), a dynamic body's by its contact handler
 * (`godot_rigid_body_3d_contact`), each calling the scene's methods first, as Godot calls a scene's
 * connections before any script's.
 */

import type { BoundGodotProject } from '../../analyze/bound-project';
import type { DirectGodotSceneDocumentPlan, DirectGodotSceneNodePlan } from './direct-project-composition-plan';
import { godotSceneSubnodes, type TargetGodotSceneConnectionPlan } from './scene-document-plan';

type Delivery = NonNullable<TargetGodotSceneConnectionPlan['delivery']>;

/** The signals each accessor's source raises from its own handler or script, by the accessor. */
const DELIVERED: ReadonlyMap<string, { readonly source: 'area' | 'body' | 'script'; readonly signals?: ReadonlySet<string> }> = new Map([
  ['godot_area_3d_signal', { source: 'area', signals: new Set(['body_entered', 'body_exited']) }],
  ['godot_rigid_body_3d_signal', { source: 'body', signals: new Set(['body_entered', 'body_exited']) }],
  // A script's own signal (every name its script declares).
  ['godot_node_script_signal', { source: 'script' }],
]);

type SceneWithoutRefs = Omit<DirectGodotSceneDocumentPlan, 'refs'>;

/**
 * The scenes with each connection its source delivers itself stamped so: an area's or a dynamic
 * body's handler takes the scene's methods as callbacks; a script's own signal takes them as its
 * `useGodotScript` attaches it, the script's own node's in this scene (`script-connections`), an
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
    // Who delivers the source's signal: its own element's handler (an area's sensor, a dynamic
    // body), its own script, or the instance's scene's root script; a source this scene instances
    // otherwise is that scene's component, whose element this scene does not write.
    const deliveryOf = (connection: TargetGodotSceneConnectionPlan): Delivery | undefined => {
      const row = DELIVERED.get(connection.accessor.exportName);
      const node = nodes.get(connection.fromNodePath);
      if (row === undefined || node === undefined || node.model !== undefined) return undefined;
      if (row.signals !== undefined && !row.signals.has(connection.signal)) return undefined;
      const form = node.idiom?.form;
      switch (row.source) {
        case 'area':
          return node.instance === undefined && form?.kind === 'body' && form.sensor ? 'area-handler' : undefined;
        case 'body':
          return node.instance === undefined && form?.kind === 'body' && form.type === 'dynamic' ? 'contact-handler' : undefined;
        case 'script':
          // A node that runs its own script here (an instance that sets one included) takes them on
          // it; an instance running its scene's root script, through the instance's prop.
          if (node.scriptInstance !== undefined) return 'script-connections';
          if (node.instance === undefined) return undefined;
          return bySource.get(node.instance.sourceResPath)?.root.scriptInstance === undefined ? undefined : 'instance-prop';
      }
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
