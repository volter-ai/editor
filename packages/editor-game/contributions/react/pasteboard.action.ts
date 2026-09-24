/**
 * "MATERIALIZE PASTEBOARD FROM UI BOARD" in the command palette
 * (`@volter/editor-sdk/chrome`, a `workspace.action` contribution) — the ONE
 * action that turns the UI board's derived auto-grid into an authored
 * pasteboard `.tsx`.
 *
 * It was a row in the host's own `action-registry.ts:404-423`, lazily
 * importing `pasteboard-materialize.ts` — a host action about THIS package's
 * design-time surface, which is the only thing that kept both files in the
 * host (WORK.md §The open-source launch item 17). Shape transcribed from
 * `@volter/editor-game/contributions/profiler.action.ts`: a static `actions` array, no
 * subscribe, because this action's availability never changes — it either
 * materializes or it refuses by name.
 *
 * THE OUTCOME LANDS IN THE EDITOR CONSOLE EITHER WAY, unchanged from the row
 * it left: the success sentence names the file (which also opens), a refusal
 * names its remedy.
 */

import { editorConsole } from '@volter/editor-core/editor-console';
import type { ActionContribution } from '@volter/editor-sdk/chrome';

export const point = 'workspace.action';

export const actions: ActionContribution['actions'] = [
  {
    id: 'pasteboard.materialize',
    label: 'Materialize Pasteboard from UI Board',
    execute: async () => {
      const { materializePasteboard } = await import('../../src/react/pasteboard-materialize');
      try {
        editorConsole.log(`[pasteboard] ${await materializePasteboard()}`, 'authoring');
      } catch (error) {
        editorConsole.error(
          `[pasteboard] materialize refused: ${error instanceof Error ? error.message : String(error)}`,
          'authoring',
        );
      }
    },
  },
];
