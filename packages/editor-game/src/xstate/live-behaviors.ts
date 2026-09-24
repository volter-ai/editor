/**
 * XState BEHAVIOR — the live debugger's reads over the editor's HIERARCHY
 * DOOR (`editorHost().hierarchy`), and the one subject the Behavior document
 * draws. The graph is a derived live debugger over a real actor; it is never
 * an animation view or a second persisted machine.
 *
 * NO fabricated hierarchy rows, NO demo machine anywhere: the shipped
 * `character-animation-machine.fixture.ts` is a TEST/story fixture only
 * (`packages/editor/test/xstate-fixture-ban.test.ts` pins that), and every
 * open path here requires an actual live actor — with none, nothing renders
 * and nothing can be opened. The starter template has no XState machine, so a
 * template session shows no XState UI at all.
 *
 * `Open Source` (§4.3 mentions it MAY exist): deliberately NOT built —
 * neither XState nor the inspection carries machine→source-file identity, and
 * fabricating one (e.g. grepping for the machine id) would violate §4.3's
 * "no ids decoded for magic words". When the engine grows a real
 * machine→module provenance, the section is where it lands.
 *
 * Editing stays a code change: the graph view is inspect-only.
 *
 * THE DOCUMENT IS ONE. A contributed `workspace.document` is registered under
 * its own contribution id, so the editor holds exactly one Behavior tab and
 * this module holds WHICH live actor it shows. Before the move into this
 * package the host opened a document per node (`behavior:xstate:<nodeId>`);
 * a package reaches the center through the contribution point, which has no
 * per-subject form, and one Behavior surface that follows the actor you asked
 * for is the honest shape of that point.
 */

import { editorHost } from '@vgai/editor-sdk/host';
import type { XStateBehaviorInspection } from '@vgai/threejs-runtime/behavior/xstate-inspection';
import { getUserData } from '@vgai/threejs-runtime/ecs/user-data';

/** This package's `xstate-behavior.document.tsx`, by the id the host derives
 *  from its filename (the workspace tab is `tool:` + this). */
export const BEHAVIOR_DOCUMENT_ID = 'xstate-behavior.document';

/** The node's explicitly registered live behavior, through the door. */
export function liveBehaviorFor(nodeId: string): XStateBehaviorInspection | undefined {
  const object = editorHost().hierarchy.object(nodeId);
  return object ? getUserData(object, '_xstateBehavior') : undefined;
}

export interface LiveBehaviorEntry {
  readonly nodeId: string;
  readonly machineId: string;
  readonly label: string;
}

/** Every explicitly registered live behavior actor, one row per actor. */
export function listLiveBehaviors(): LiveBehaviorEntry[] {
  const seen = new Set<XStateBehaviorInspection>();
  const out: LiveBehaviorEntry[] = [];
  for (const [nodeId, object] of editorHost().hierarchy.objects()) {
    const behavior = getUserData(object, '_xstateBehavior');
    if (!behavior || seen.has(behavior)) continue;
    seen.add(behavior);
    out.push({ nodeId, machineId: behavior.machine.id, label: object.name || nodeId });
  }
  return out;
}

// --- The document's subject -------------------------------------------------

let subjectNodeId: string | null = null;
let subjectVersion = 0;
const subjectListeners = new Set<() => void>();

export function subscribeBehaviorSubject(listener: () => void): () => void {
  subjectListeners.add(listener);
  return () => {
    subjectListeners.delete(listener);
  };
}

export function behaviorSubjectVersion(): number {
  return subjectVersion;
}

/** The node whose actor the Behavior document draws, or null before any open. */
export function behaviorSubject(): string | null {
  return subjectNodeId;
}

/**
 * Open the Behavior document on one live actor. False — and nothing opens —
 * when that node carries no live behavior, or when the document contribution
 * is not registered (a build without this package).
 */
export function openBehaviorDocument(nodeId: string): boolean {
  if (!liveBehaviorFor(nodeId)) return false;
  if (subjectNodeId !== nodeId) {
    subjectNodeId = nodeId;
    subjectVersion++;
    for (const listener of subjectListeners) listener();
  }
  return editorHost().workspace.openContributedDocument(BEHAVIOR_DOCUMENT_ID);
}

/** Open the first truthful live behavior, if one exists — what the Debug menu
 *  item and the standing palette action do. */
export function openFirstBehaviorDocument(): boolean {
  const first = listLiveBehaviors()[0];
  return first ? openBehaviorDocument(first.nodeId) : false;
}
