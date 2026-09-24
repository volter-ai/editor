/**
 * The Network inspector as a drawer tab (W3b): replicated-state tree,
 * message log, rate sparklines and the conditioner over the inspected
 * session's `NetworkingAdapter`. On offer only while such an adapter is
 * registered — a tab over nothing would be a measurement nobody made.
 */
import { editorHost } from '@volter/editor-sdk/host';
import { NetworkInspectorPanel } from '../src/network/NetworkInspectorPanel';

export const point = 'workspace.utility';
export const title = 'Network';
export const order = 25;
export const available = (): boolean => editorHost().systems.inspectedNetworking() !== null;

export default function NetworkUtility() {
  return <NetworkInspectorPanel />;
}
