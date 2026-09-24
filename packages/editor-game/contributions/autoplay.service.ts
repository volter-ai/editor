/**
 * THE PLAY ENTRY THAT IS NOT A CLICK (`@vgai/editor-sdk/services`, a
 * `workspace.service` contribution): `?play=1`, the URL asking this session to
 * open playing.
 *
 * It was an effect in `components/DefaultEditorLayout.tsx`; the shell's layout
 * must not name Play to honour a query param. The boot gate that makes the
 * timing safe is armed before any descendant effect (see
 * `initial-project.ts`'s header), and a service starts after the contribution
 * pass — which can be before a project session's store exists — so the entry
 * waits for the store's ARRIVAL (`@editor/shell-store-door`, `onShellStore`,
 * which fires at once when one is already registered) rather than for a React
 * mount.
 *
 * It reports its failure to the editor console — `vgai console` is what reads
 * it — rather than leaving a stopped surface with no reason on it.
 */
import { onShellStore } from '@editor/shell-store-door';
import { editorHost } from '@vgai/editor-sdk/host';
import { enterPlayMode } from '../src/play/play-mode';

export const point = 'workspace.service';

function enter(reason: string): void {
  void enterPlayMode().catch((error) => {
    editorHost().console.error(
      `${reason}: ${error instanceof Error ? error.message : String(error)}`,
      'play',
    );
  });
}

export function start(): () => void {
  let timer: number | undefined;
  let urlPlayStarted = false;
  const stopStore = onShellStore(() => {
    if (urlPlayStarted) return;
    if (new URLSearchParams(window.location.search).get('play') !== '1') return;
    urlPlayStarted = true;
    // Next task, not this one: the store has only just been registered, and
    // the boot gate the entry rides is armed on the same turn.
    timer = window.setTimeout(() => enter('Could not enter requested Play mode'), 0);
  });
  return () => {
    if (timer !== undefined) window.clearTimeout(timer);
    stopStore();
  };
}
