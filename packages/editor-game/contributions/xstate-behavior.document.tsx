/**
 * THE BEHAVIOR DOCUMENT (`workspace.document`): the REAL live actor of the
 * machine you asked to inspect, drawn as its graph — the same asset-document
 * pattern the animation and model editors use, inspect-only.
 *
 * Its subject is `live-behaviors.ts`'s (`openBehaviorDocument(nodeId)` sets it
 * and opens this tab, from the section's button, the Debug menu and each
 * `Inspect Behavior: <id>` palette action). With no live actor for that node —
 * the game stopped, the actor detached — the document says so rather than
 * drawing a machine nothing is running.
 *
 * No `tool`: it drives no registered callable.
 */

import type { ToolContributionProps, ToolDocumentToolbar } from '@volter/editor-sdk/contributions';
import {
  subscribeXStateBehaviorInspections,
  xstateBehaviorInspectionsVersion,
} from '@volter/threejs-runtime/behavior/xstate-inspection';
import { useSyncExternalStore } from 'react';
import {
  behaviorSubject,
  behaviorSubjectVersion,
  liveBehaviorFor,
  subscribeBehaviorSubject,
} from '../src/xstate/live-behaviors';
import { XStateMachineInspector } from '../src/xstate/XStateMachineInspector';

export const point = 'workspace.document';
export const title = 'Behavior';

/** Re-render on both live facts this document draws: which node it is on, and
 *  whether that node still carries an inspection. */
function useSubjectBehavior() {
  useSyncExternalStore(subscribeBehaviorSubject, behaviorSubjectVersion, behaviorSubjectVersion);
  useSyncExternalStore(
    subscribeXStateBehaviorInspections,
    xstateBehaviorInspectionsVersion,
    xstateBehaviorInspectionsVersion,
  );
  const nodeId = behaviorSubject();
  return nodeId ? liveBehaviorFor(nodeId) : undefined;
}

/** The document's header, in the host's own strip: which machine, and that it
 *  is a live actor you may read but not edit. */
export const Toolbar: ToolDocumentToolbar = () => {
  const behavior = useSubjectBehavior();
  return (
    <span data-testid="xstate-behavior-toolbar" style={{ fontSize: 11 }}>
      {behavior ? `${behavior.machine.id} · Live actor · inspect-only` : 'Behavior unavailable'}
    </span>
  );
};

export default function XStateBehaviorDocument(_props: ToolContributionProps) {
  const behavior = useSubjectBehavior();
  return (
    <div className="vgai-behavior-document" data-testid="xstate-behavior-document">
      {behavior ? (
        <XStateMachineInspector
          machine={behavior.machine}
          actor={behavior.actor}
          title={behavior.machine.id}
        />
      ) : (
        <div className="vgai-behavior-document__empty">
          This live behavior is no longer registered.
        </div>
      )}
    </div>
  );
}
