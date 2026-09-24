/**
 * The connection pill in the status bar: `net: <state>` from the inspected
 * networking adapter, opening the Network inspector on click. Renders
 * nothing when there is no adapter or no connection-state reader — a pill
 * claiming "disconnected" for an unmeasured link would be worse than none.
 */

import { editorHost, useHostAvailabilitySelector } from '@vgai/editor-sdk/host';
import { Button } from '@vgai/editor-sdk/widgets';
import type { ConnectionState } from '@vgai/project/adapter';

export const point = 'workspace.status';
export const title = 'Connection';
export const align = 'left';
export const order = 20;

/** The Network inspector's registered utility id (`network.utility.tsx`, under
 *  the loader's `tool:` namespace). */
const NETWORK_UTILITY_ID = 'tool:network.utility';

export default function ConnectionStatus() {
  // Derived off the host's SHARED availability tick; selector-shaped so a
  // stable connection state re-renders nothing.
  const state = useHostAvailabilitySelector(
    (): ConnectionState | null =>
      editorHost().systems.inspectedNetworking()?.getConnectionState?.() ?? null,
  );
  if (state === null) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="compact"
      className="vgai-status-action"
      data-testid="status-connection"
      data-connection-state={state}
      onClick={() => editorHost().workspace.showUtility(NETWORK_UTILITY_ID)}
      title="Network connection state — open Network diagnostics"
    >
      net: {state}
    </Button>
  );
}
