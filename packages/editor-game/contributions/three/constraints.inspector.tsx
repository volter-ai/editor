/**
 * The Constraints Inspector section (`selection.inspector`): the IK and
 * look-at constraints the engine's `constraintsOf` marks on a selected
 * `Object3D`, with each one's resolve status.
 *
 * `match` reads the marks off the adapter's own `hierarchy.object3D`, so it
 * matches only a node that actually carries one — the section cannot render
 * for a subject with no constraints.
 *
 * IT SITS IN THE CONTRIBUTED BAND NOW, after the kit's own blocks rather than
 * between the group and stories blocks. That is what a contribution IS: the
 * built-in band is the kit's and `contributedSectionOrder` adds
 * `CONTRIBUTED_SECTION_ORDER` to whatever a module declares. The number below
 * is the relative order this section kept among its three siblings.
 */
import type { AuthoringAdapter } from '@vgai/project/adapter';
import type {
  ToolContributionNode,
  ToolInspectorContributionProps,
} from '@vgai/editor-sdk/contributions';
import { ConstraintStackSection, matches } from '../src/authoring/constraint-inspector-section';

export const point = 'selection.inspector';
export const title = 'Constraints';
export const icon = 'link';
export const order = 450;

export function match(node: ToolContributionNode | null, adapter: unknown): boolean {
  return matches(node as never, adapter as AuthoringAdapter);
}

export default function ConstraintsInspector({ adapter, nodeId }: ToolInspectorContributionProps) {
  return <ConstraintStackSection adapter={adapter as AuthoringAdapter} nodeId={nodeId} />;
}
