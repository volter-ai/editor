/**
 * The reflection probe's Capture Inspector section (`selection.inspector`):
 * the probe's own capture controls for a selected probe node.
 *
 * On the contributed band, see `constraints.inspector.tsx`'s note; the number
 * below is this section's relative order among its siblings.
 */
import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import type {
  ToolContributionNode,
  ToolInspectorContributionProps,
} from '@volter/editor-sdk/contributions';
import {
  matches,
  ReflectionProbeCaptureSection,
} from '../../src/three/authoring/reflection-probe-inspector-section';

export const point = 'selection.inspector';
export const title = 'Capture';
export const icon = 'camera-rotate';
export const order = 500;

export function match(node: ToolContributionNode | null, adapter: unknown): boolean {
  return matches(node as never, adapter as AuthoringAdapter);
}

export default function ReflectionProbeCaptureInspector({
  adapter,
  nodeId,
}: ToolInspectorContributionProps) {
  return <ReflectionProbeCaptureSection adapter={adapter as AuthoringAdapter} nodeId={nodeId} />;
}
