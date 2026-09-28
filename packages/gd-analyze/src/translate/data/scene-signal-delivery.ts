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

const HANDLER_DELIVERED: ReadonlyMap<string, { readonly delivery: NonNullable<TargetGodotSceneConnectionPlan['delivery']>; readonly signals: ReadonlySet<string> }> = new Map([
  ['godot_area_3d_signal', { delivery: 'area-handler', signals: new Set(['body_entered', 'body_exited']) }],
  ['godot_rigid_body_3d_signal', { delivery: 'contact-handler', signals: new Set(['body_entered', 'body_exited']) }],
]);

type SceneWithoutRefs = Omit<DirectGodotSceneDocumentPlan, 'refs'>;

/**
 * The scenes with each connection its source's handler delivers stamped so. A connection stays one
 * where the method's script is not this scene's (an instanced scene's root runs its own), or where
 * any script looks at the signal's connections (analysis's `signalIntrospection`): the handler's
 * callback is not one of them.
 */
export function planGodotSceneSignalDelivery(scenes: readonly SceneWithoutRefs[], project: BoundGodotProject): SceneWithoutRefs[] {
  const looked = new Set(project.scripts.flatMap((script) => script.signalIntrospection.signals));
  const lookedAtAny = project.scripts.some((script) => script.signalIntrospection.any);
  return scenes.map((scene) => {
    const nodes = new Map<string, DirectGodotSceneNodePlan>();
    (function collect(node: DirectGodotSceneNodePlan): void {
      nodes.set(node.nodePath, node);
      for (const child of godotSceneSubnodes(node)) collect(child);
    })(scene.root);
    // The handler is the source's own element's (an area's sensor, a dynamic body): a source this
    // scene instances is that scene's component, whose element this scene does not write.
    const handles = (nodePath: string, delivery: NonNullable<TargetGodotSceneConnectionPlan['delivery']>) => {
      const node = nodes.get(nodePath);
      const form = node?.idiom?.form;
      if (node === undefined || node.instance !== undefined || node.model !== undefined || form?.kind !== 'body') return false;
      return delivery === 'area-handler' ? form.sensor : form.type === 'dynamic';
    };
    return {
      ...scene,
      connections: scene.connections.map((connection) => {
        const row = HANDLER_DELIVERED.get(connection.accessor.exportName);
        const delivered =
          row !== undefined &&
          row.signals.has(connection.signal) &&
          handles(connection.fromNodePath, row.delivery) &&
          nodes.get(connection.toNodePath)?.scriptInstance !== undefined &&
          !lookedAtAny &&
          !looked.has(connection.signal);
        return delivered ? { ...connection, delivery: row.delivery } : connection;
      }),
    };
  });
}
