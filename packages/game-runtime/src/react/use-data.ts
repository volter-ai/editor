/**
 * React hooks for data assets — the tool-hooks half, shipped with W4 (dock
 * tools).
 *
 * Lives under `packages/game-runtime/src/react/` deliberately: this is the ONE
 * directory of the engine allowed to value-import react (colocated with
 * `game-state.tsx` per the react-free-core rule proved by
 * `test/react-core-import-ban.test.ts`). Game roots that aren't react keep
 * using `DataHandle.get()`/`subscribe()` directly (§2.3).
 *
 * - {@link useData} — subscribe a component to any W1 `DataHandle`; works in
 *   project tools, react roots, and HUD overlays alike.
 * - {@link writeData} — EDITOR-TOOL plumbing: write a whole `.data.json`
 *   back through the editor dev server, closing the live-tuning loop
 *   (widget → file write → Vite HMR → `hotSwap` → {@link useData} re-render
 *   → the running game reads the new value). Not for game code.
 */

import { useSyncExternalStore } from 'react';
import type { DataHandle } from '../data/data-asset';

/**
 * Read a data asset's current values and re-render whenever a hot edit lands
 * (§3.3). A thin `useSyncExternalStore` over the handle's
 * `subscribe`/`get` — any `defineData` handle works, no provider needed:
 *
 * ```tsx
 * import { tuning } from '../data/tuning';
 * const values = useData(tuning);   // fresh parsed object after every hotSwap
 * ```
 *
 * `get()` returns the same reference between successful hot swaps, so this
 * re-renders exactly once per accepted edit and never in between.
 */
export function useData<T>(handle: DataHandle<T>): T {
  return useSyncExternalStore(
    (onStoreChange) => handle.subscribe(() => onStoreChange()),
    () => handle.get(),
  );
}

/**
 * Write a data asset's ENTIRE new value back to its `.data.json` — the write
 * half of a project tool's live-tuning loop (§3.3, D1: writes are file
 * writes, always). POSTs to the editor dev server's `/__editor/data-file`
 * route (see its doc comment in `packages/editor/server/editor-server.ts`),
 * which accepts only `src/data/**\/*.data.json` and writes immediately; the
 * running game then receives the change through the normal `.data.json` HMR
 * path, exactly as if VS Code had saved the file.
 *
 * ```tsx
 * // inside a tool's onChange — spread the live values, replace one field:
 * void writeData('src/data/tuning.data.json', { ...tuning.get(), gravity: v });
 * ```
 *
 * FOR TOOLS, NOT GAME CODE: data assets are immutable at runtime (§2.1) —
 * runtime state belongs in your game's own store, never written back into
 * data files. Outside a running editor there is no `/__editor` server, so
 * this rejects with a teaching error (a shipped game could never reach the
 * route anyway — builds strip `src/contributions/` and `src/tools/` entirely, §4).
 *
 * The body is PARSED VALUES, never serialized text: the dev server's fold
 * (`packages/editor/server/data-file-serialize.ts`) owns key order and the
 * `"$schema"`-first diff-minimal serialization, and it must — a parsed JS
 * object has already reindexed integer-like keys ("1","2","10"), so only the
 * server, which still has the file's raw text, can keep a one-field write a
 * one-line diff. When `value` carries no `"$schema"` key (the common case —
 * `DataHandle.get()` strips it), the conventional sibling reference
 * (`./<name>.schema.json`, §2.1) is restored so a tool write never silently
 * drops VS Code validation from the file. Undo for data writes is git;
 * every accepted write is recorded server-side as a project revision.
 */
export async function writeData(
  projectRelativePath: string,
  value: Record<string, unknown>,
): Promise<void> {
  if (!projectRelativePath.startsWith('src/data/') || !projectRelativePath.endsWith('.data.json')) {
    throw new Error(
      `writeData: invalid path ${JSON.stringify(projectRelativePath)} — data assets live at ` +
        'src/data/**/*.data.json, addressed project-relative, ' +
        "e.g. writeData('src/data/tuning.data.json', next).",
    );
  }

  // Restore the conventional sibling "$schema" reference when the caller's
  // object (typically `{ ...handle.get() }`, which never carries it) omits
  // it; the server fold serializes it first.
  const { $schema, ...rest } = value;
  const schemaRef =
    $schema ??
    `./${projectRelativePath
      .split('/')
      .pop()
      ?.replace(/\.data\.json$/, '')}.schema.json`;
  const values = { $schema: schemaRef, ...rest };

  let res: Response;
  try {
    res = await fetch('/__editor/data-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: projectRelativePath, values }),
    });
  } catch (err) {
    throw new Error(
      'writeData: could not reach the editor dev server (/__editor/data-file) — this helper is ' +
        'editor-tool plumbing and only works inside the running ' +
        'editor. Game code must not write data assets: they are immutable at runtime — ' +
        `keep runtime state in your game's own store. (${String(err)})`,
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `writeData: the editor rejected the write to "${projectRelativePath}" ` +
        `(HTTP ${res.status}${detail ? `: ${detail}` : ''}).`,
    );
  }
}
