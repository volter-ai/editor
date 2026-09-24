/**
 * THE OBJECT3D MODEL DOCUMENT'S INSPECTOR SECTIONS
 * (`@vgai/editor-sdk/services`, a `workspace.service` contribution): the
 * Source / Geometry / Materials / Animation rail a loaded three model shows,
 * and the per-node sections inside it.
 *
 * A SERVICE and not a `selection.inspector`, unlike the three sections beside
 * it, and the reason is measured rather than stylistic: these are SECTION
 * PRODUCERS (`InspectorSectionsProducer` — `sections(node, adapter)` returning
 * a list), because one subject earns a whole rail of identified sections, and
 * the `selection.inspector` point carries exactly ONE component. Registering
 * through `registerInspectorSections` from a service reaches the same registry
 * the point reaches, with the shape this subject actually has.
 *
 * The stop is a no-op: the registrations live in an HMR group the module owns,
 * and the model document outlives any one contribution pass.
 */

import { ensureModelAssetSectionsRegistered } from '../src/authoring/model-asset-inspector-section';

export const point = 'workspace.service';

export function start(): () => void {
  ensureModelAssetSectionsRegistered();
  return () => {};
}
