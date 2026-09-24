/**
 * The compact `Capture frame` control in the Game document toolbar while play
 * runs (`GameDocumentToolbar`, CenterDocuments.tsx). Captures one frame into
 * the shared ring (`frame-debugger-store.ts`) and opens the Frame view of the
 * Profiler utility. Disabled — with honest title text — when the world
 * registered no render-debug adapter.
 *
 * It sits HERE rather than beside the panel it opens because the panel moved
 * to `@volter/editor-game` (the game skew as a package) and this button's caller is a
 * host module: the host imports no package (WORKBENCH.md §The invariants), so
 * the button stays on this side of the line with the store and model it reads.
 */
import { getInspectedRenderDebug } from '@volter/editor-core/authoring/active-systems';
import { useAvailabilitySelector } from '@volter/editor-sdk/kit/availability-tick';
import { deriveRenderDebugCapabilities } from '../host/components/frame-debugger-model';
import { profilerView } from '../host/components/utility-view-state';
import { Button } from '@volter/editor-sdk/widgets';
import { captureFrame } from '../profiler/frame-debugger-store';

export function GameCaptureFrameButton() {
  const adapter = useAvailabilitySelector(() => getInspectedRenderDebug() ?? null);
  const caps = deriveRenderDebugCapabilities(adapter);
  const available = caps?.capture === true;
  return (
    <Button
      type="button"
      size="compact"
      variant="ghost"
      data-testid="game-capture-frame"
      className="vgai-frame-capture-game-button"
      disabled={!available}
      title={
        available
          ? 'Capture one rendered frame and open the Frame debugger'
          : 'No render-debug adapter registered for this world — frame capture is unavailable'
      }
      onClick={() => {
        void captureFrame(adapter);
        profilerView.open('frame');
      }}
    >
      Capture frame
    </Button>
  );
}
