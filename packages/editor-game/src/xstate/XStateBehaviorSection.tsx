/**
 * The compact **Behavior** Inspector section (§4.3): the selected entity's
 * live machine — its id, where the actor IS, the machine's FULL state chart
 * with the active path marked, and the way into the Behavior document.
 *
 * It renders ONLY when `xstate-behavior.inspector.tsx`'s `match` found a real
 * live behavior mark on the selected node, so a template entity (no machine)
 * never sees it.
 */

import { Button, themeVars } from '@volter/editor-sdk/widgets';
import {
  subscribeXStateBehaviorInspections,
  xstateBehaviorInspectionsVersion,
} from '@volter/threejs-runtime/behavior/xstate-inspection';
import { useSyncExternalStore } from 'react';
import type { AnyStateMachine, AnyStateNode } from 'xstate';
import { liveBehaviorFor, openBehaviorDocument } from './live-behaviors';
import { useLiveActorState } from './use-live-actor-state';

/** Every descendant state node of the machine (depth-first, root excluded),
 *  for the full-state-list readout below — the same direct `.states` walk
 *  `xstate-graph.ts` documents as the sanctioned traversal. */
function allMachineStates(machine: AnyStateMachine): AnyStateNode[] {
  const out: AnyStateNode[] = [];
  const visit = (node: AnyStateNode): void => {
    for (const child of Object.values(node.states)) {
      out.push(child);
      visit(child);
    }
  };
  visit(machine.root);
  return out;
}

export function XStateMachineSection({ nodeId }: { nodeId: string | null }) {
  useSyncExternalStore(
    subscribeXStateBehaviorInspections,
    xstateBehaviorInspectionsVersion,
    xstateBehaviorInspectionsVersion,
  );
  const behavior = nodeId ? liveBehaviorFor(nodeId) : undefined;
  const machine = behavior?.machine;
  // Follow live transitions (re-render per snapshot) — the state list and
  // layer readout below re-derive from each.
  const activeIds = useLiveActorState(machine as AnyStateMachine, behavior?.actor);
  if (!behavior || !machine || !nodeId) return null;
  const activeIdSet = new Set(activeIds ?? []);
  const states = allMachineStates(machine);
  return (
    <div
      data-testid="inspector-xstate-section"
      style={{
        pointerEvents: 'auto',
        padding: 8,
        borderBottom: `1px solid ${themeVars.boundary.default}`,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: themeVars.content.dim,
          textTransform: 'uppercase',
          marginBottom: 4,
        }}
      >
        Behavior
      </div>
      <div
        style={{ fontSize: 11, color: themeVars.content.primary, fontWeight: 600, marginBottom: 2 }}
      >
        {machine.id}
      </div>
      <div style={{ fontSize: 10, color: themeVars.content.muted, marginBottom: 4 }}>
        <span style={{ color: themeVars.semantic.success, fontWeight: 700 }}>●</span> Live —{' '}
        {activeIds?.map((stateId, index) => (
          <span key={stateId}>
            {index > 0 && ' · '}
            <span
              style={{ fontFamily: themeVars.typography.mono, color: themeVars.accent.default }}
            >
              {stateId.startsWith(`${machine.id}.`)
                ? stateId.slice(machine.id.length + 1)
                : stateId}
            </span>
          </span>
        ))}
      </div>
      {/* The FULL state chart, active path highlighted — the section must
          show what the machine can do, not only where it is (owner
          feedback, 2026-08-06). */}
      <div data-testid="xstate-section-states" style={{ marginBottom: 6 }}>
        {states.map((state) => {
          const relative = state.id.startsWith(`${machine.root.id}.`)
            ? state.id.slice(machine.root.id.length + 1)
            : state.id;
          const depth = relative.split('.').length - 1;
          const active = activeIdSet.has(state.id);
          return (
            <div
              key={state.id}
              data-testid={`xstate-section-state-${relative}`}
              style={{
                paddingLeft: 4 + depth * 12,
                fontSize: 10,
                lineHeight: 1.7,
                fontFamily: themeVars.typography.mono,
                color: active ? themeVars.accent.default : themeVars.content.muted,
                fontWeight: active ? 700 : 400,
              }}
            >
              {active ? '● ' : '○ '}
              {state.key}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 10, color: themeVars.content.dim, marginBottom: 6 }}>
        Source: hand-authored XState TypeScript — inspect-only.
      </div>
      <Button
        size="compact"
        data-testid="xstate-open-graph"
        onClick={() => void openBehaviorDocument(nodeId)}
      >
        Inspect Behavior
      </Button>
    </div>
  );
}
