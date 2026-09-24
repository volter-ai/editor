/**
 * THE COMPONENT-VERB commands of the session wire
 * (`@vgai/editor-sdk/commands`, a `workspace.command` contribution):
 * `extract-component` and `fork-component`.
 *
 * These are the same two operations the hierarchy row's menu items perform
 * (`component-verbs.service.ts`), over the control API, because an agent
 * authoring through the editor has no pointer to right-click with. They left
 * `command-listener.ts`'s switch — and their rows left `command-table.ts` —
 * with the menus, the same way the Blender verbs did when Blender's editor
 * half left the host (`blender.command.ts`'s header, WORK.md §The workbench,
 * item D).
 *
 * EACH ROW CARRIES ITS OWN RELAY BUDGET, transcribed from the host table rows
 * they left (`command-table.ts`, `alwaysRefresh(30_000)` on both): the write
 * goes through the dev server's source-plan route, and `derivedRefresh` is
 * `'always'` because both rewrite the project's own TSX.
 *
 * `id` defaults to the current selection — the menu's own subject — so the
 * command reads the same way the click does. The answer is the action's
 * sentence (created, naming the new files, or the plan's own named refusal),
 * and `ok` mirrors whether the write landed: the ok/error split is decided by
 * `isExtractedHint`/`isForkedHint`, owned beside the wording they match, so
 * the two cannot drift.
 */

import { getActiveAuthoring } from '@editor/authoring/active-adapter';
import type { EditorShellStore } from '@editor/editor-shell-store';
import { canExtractNode, isExtractedHint } from '@editor/instance-extract-actions';
import { canForkInstance, isForkedHint } from '@editor/instance-fork-actions';
import { shellStoreForHost } from '@editor/shell-store-door';
import type { CommandContribution } from '@vgai/editor-sdk/commands';
import { instanceExtractSourceFor } from '../src/component-verbs/extract-menu';
import { instanceForkSourceFor } from '../src/component-verbs/fork-menu';

/** The shell store, or the refusal that says the page has not installed one —
 *  the same shape `bridge.command.ts` takes it in, made explicit because both
 *  verbs need the SELECTION as well as the adapter. */
const NO_STORE = { ok: false as const, error: 'the editor shell has not started yet.' };

/** The row's id, or the one selected row — the menu's subject. */
function subjectId(cmd: Record<string, unknown>, store: EditorShellStore): string | undefined {
  const given = cmd['id'];
  if (typeof given === 'string' && given.trim() !== '') return given;
  return [...store.selectedEntityIds][0];
}

export const commands: CommandContribution['commands'] = {
  'extract-component': {
    timeoutMs: 30_000,
    derivedRefresh: 'always',
    handle: async (cmd) => {
      try {
        const store = shellStoreForHost();
        if (!store) return NO_STORE;
        const id = subjectId(cmd, store);
        if (!id) return { ok: false, error: 'extract-component needs an id or a selected row.' };
        const adapter = getActiveAuthoring(store);
        const source = instanceExtractSourceFor(adapter, id);
        if (!canExtractNode(adapter.hierarchy.node(id), source, id)) {
          return {
            ok: false,
            error:
              `"${id}" is not extractable: only a native source element row (not a component ` +
              'instance, group row, or document) with a writable source backend can be extracted.',
          };
        }
        const name = cmd['name'];
        const hint = await source?.extractComponent?.(
          id,
          typeof name === 'string' && name.trim() !== '' ? name : undefined,
        );
        if (hint === undefined) return { ok: false, error: `"${id}" lost its extract seam.` };
        return isExtractedHint(hint) ? { ok: true, data: { hint } } : { ok: false, error: hint };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  },
  'fork-component': {
    timeoutMs: 30_000,
    derivedRefresh: 'always',
    handle: async (cmd) => {
      try {
        const store = shellStoreForHost();
        if (!store) return NO_STORE;
        const id = subjectId(cmd, store);
        if (!id) return { ok: false, error: 'fork-component needs an id or a selected row.' };
        const adapter = getActiveAuthoring(store);
        const source = instanceForkSourceFor(adapter, id);
        if (!canForkInstance(adapter.hierarchy.node(id), source, id)) {
          return {
            ok: false,
            error:
              `"${id}" is not forkable: only a component-instance row whose callsite AND ` +
              'definition both resolve, on an adapter with a writable source backend, can be ' +
              'forked.',
          };
        }
        const hint = await source?.forkComponent?.(id);
        if (hint === undefined) return { ok: false, error: `"${id}" lost its fork seam.` };
        return isForkedHint(hint) ? { ok: true, data: { hint } } : { ok: false, error: hint };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  },
};

export const point = 'workspace.command';
