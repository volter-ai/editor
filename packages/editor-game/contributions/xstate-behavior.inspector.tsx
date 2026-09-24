/**
 * The Behavior Inspector section (`selection.inspector`, §4.3): the machine a
 * selected entity is actually running.
 *
 * `match` reads the hierarchy door for the node's own live inspection mark, so
 * it matches ONLY a real live actor — a template entity (no machine) never
 * matches, and the section cannot render for it.
 */
import type {
  ToolContributionNode,
  ToolInspectorContributionProps,
} from '@vgai/editor-sdk/contributions';
import { liveBehaviorFor } from '../src/xstate/live-behaviors';
import { XStateMachineSection } from '../src/xstate/XStateBehaviorSection';

export const point = 'selection.inspector';
export const title = 'Behavior';
/** Where the host registered it before the move: the contributed band's own
 *  base, ahead of modules that claim no place. */
export const order = 0;

export function match(node: ToolContributionNode | null): boolean {
  return node !== null && liveBehaviorFor(node.id) !== undefined;
}

export default function XStateBehaviorInspector({ nodeId }: ToolInspectorContributionProps) {
  return <XStateMachineSection nodeId={nodeId} />;
}
