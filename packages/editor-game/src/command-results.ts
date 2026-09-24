/**
 * The two result builders the game skew's command verbs answer with — copied
 * out of the editor's `command-listener.ts` with the verbs that used them
 * (WORK.md §The workbench), because they are result SHAPES, not host API: a
 * few lines of object literal each, owned by whoever produces the answer.
 *
 * They live in `src/` rather than inside one contribution module because
 * three of this package's command contributions (`gameplay`, `bridge`,
 * `game-eval`) answer with the same two shapes, and a third copy of a
 * structured-error mapping is how `data.code` drifts between verbs the SDK
 * matches on by code.
 */

import type { EditorCommandResult } from '@vgai/editor-sdk/commands';

/** The genuinely-no-live-world answer: a structured failure, never a
 *  fabricated success. */
export const notPlayingResult = (): EditorCommandResult => ({
  ok: false,
  error: 'not in play mode — start play before using the debug seam',
});

/** Surface a thrown engine error carrying a machine-readable `code`
 *  (`DebugError`, `InputActionError` — duck-typed, so no engine-module
 *  identity coupling) as a structured relay failure: `data.code` plus the
 *  error's own data (registered-name lists, zod issues). The SDK maps these
 *  to operation error codes — never by parsing message prose. */
export function structuredErrorResult(err: unknown): EditorCommandResult {
  const message = err instanceof Error ? err.message : String(err);
  const e = err as { code?: unknown; data?: unknown };
  if (typeof e?.code === 'string') {
    const extra = typeof e.data === 'object' && e.data !== null ? e.data : {};
    return { ok: false, error: message, data: { ...extra, code: e.code } };
  }
  return { ok: false, error: message };
}
