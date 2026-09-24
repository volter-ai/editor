/**
 * The Runtime Camera Inspector section (`selection.inspector`): what the
 * engine's camera director is actually doing with a selected camera — the
 * active one, its priority, and a blend in flight.
 *
 * `match` asks the adapter for the node's `Object3D` and answers only for a
 * real camera the director knows, so the section cannot render for a subject
 * the runtime has never seen.
 *
 * On the contributed band, see `constraints.inspector.tsx`'s note; the number
 * below is this section's relative order among its siblings.
 */
import type { AuthoringAdapter } from '@vgai/project/adapter';
import type {
  ToolContributionNode,
  ToolInspectorContributionProps,
} from '@vgai/editor-sdk/contributions';
import { CameraRuntimeSection, matches } from '../src/authoring/camera-runtime-inspector-section';

export const point = 'selection.inspector';
export const title = 'Runtime Camera';
export const icon = 'camera';
export const order = 350;

export function match(node: ToolContributionNode | null, adapter: unknown): boolean {
  return matches(node as never, adapter as AuthoringAdapter);
}

export default function CameraRuntimeInspector({
  adapter,
  nodeId,
}: ToolInspectorContributionProps) {
  return <CameraRuntimeSection adapter={adapter as AuthoringAdapter} nodeId={nodeId} />;
}
