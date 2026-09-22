/**
 * "warnings live on the row".
 *
 * The join that carries an R3F authorability diagnostic from where it is
 * PRODUCED (a whole-file analysis, `r3fAuthoringDiagnostics`) to where it is
 * READ (one hierarchy row). Pure, browser-safe, and unit-testable without a
 * dev server: the two halves below are the entire mapping, and both the
 * server-side annotator (`currentOidIndex`, `vite-plugin-ui-oid.ts`) and the
 * client-side reader (`R3fSourceAuthoringAdapter.diagnosticsFor`) call one of
 * them rather than re-deriving it.
 *
 * ## Why the join is by IDENTITY the index already holds, never by name
 *
 * Before H5 these diagnostics reached exactly one place: the dev server's
 * terminal (and the `/__editor/state` warnings map), formatted to a string by
 * `server/project-validation.ts`'s `validateSource`. A string in a log has no
 * row identity at all, so the first question was what identity to give it.
 *
 * A diagnostic carries `{file, line, col, component}`. An `OidEntry` carries
 * `{file, line, col, component, tag}` — where `component` is the component
 * whose BODY lexically contains the element. Those two `component` fields mean
 * the same thing on the definition side, and both positions come from
 * `node.getStart()`, so the entry-side selection below needs no name
 * resolution, no import walking, and no second derivation that could disagree
 * with the first:
 *
 * - **at this element** — the diagnostic's `(file,line,col)` IS this entry's.
 *   That is R3F004 ("`<Enemy>` has no name"), whose subject is the callsite
 *   element itself. (R3F002/3/5 point at a function/variable NAME identifier
 *   or a `ref={…}` identifier, never at a `<`, so they can never collide with
 *   an element position and be misread as this kind.)
 * - **inside this component** — the diagnostic names the component whose body
 *   contains this element (`d.component === entry.component`, same file). That
 *   is R3F002/R3F003/R3F005, which are ABOUT a definition.
 *
 * The second rule is what gets a definition-side warning onto an INSTANCE row
 * in another file, and it needs no cross-file resolution: the oid transform
 * stamps a component boundary with BOTH its callsite oid
 * (`userData.authoringInstance`) and its definition-root oid (`userData.oid`),
 * so the client already holds both index entries for one row — the same two
 * entries H3's `sourceLocation`/`definitionLocation` return. {@link
 * mergeRowDiagnostics} unions them.
 *
 * ## Why this cannot drift from index freshness
 *
 * It is not a separate channel. The diagnostics are attached to the entries of
 * the very payload `refreshSourceState()` already fetches, computed in the same
 * pass from the same file bytes. There is no second fetch to fall behind, no
 * cache to invalidate, and no clock of its own: whatever makes the index stale
 * makes them stale together, and whatever refreshes it refreshes them.
 *
 * ## A diagnostic that lands on no row does not vanish
 *
 * Some will not reach a row, and that is expected rather than a hole to be
 * plugged: a component defined but never instantiated has no live object, a
 * component whose definition file is not stamped as R3F is never analyzed here
 * at all, and a hosted (no-dev-server) session has no analyzer (see
 * `browser-oid-index.ts`). Nothing is LOST in any of those cases — this join is
 * PURELY ADDITIVE. The channel these diagnostics have always had is untouched:
 * `server/project-validation.ts`'s `validateSource` still formats every one of
 * them into the dev server's terminal warning block and into the project
 * warnings map that `/__editor/state` (and so `vgai status`) reports. Rows are
 * a second, better-placed audience, not a replacement.
 */

import type { OidEntry, R3fAuthoringDiagnostic } from './oid-transform';

/** The per-entry selector {@link fileDiagnosticJoin} builds. */
export type EntryDiagnosticSelector = (
  entry: Pick<OidEntry, 'line' | 'col' | 'component' | 'parentOid'>,
) => R3fAuthoringDiagnostic[] | undefined;

const position = (at: { line: number; col: number }): string => `${at.line}:${at.col}`;

/**
 * Build the selector for ONE file: which of that file's diagnostics pertain to
 * each of that file's oid entries. Both arguments must belong to the same
 * file — the caller already has them grouped that way, so nothing here
 * re-filters by file.
 *
 * The two rules of the module doc are applied as a PARTITION, not as an `||`,
 * and that distinction is load-bearing. A diagnostic whose position is one of
 * this file's stamped elements is ABOUT that element (R3F004); everything else
 * is about a component definition (R3F002/3/5). Without the partition, an
 * R3F004 on `<Enemy>` in a file that ALSO defines `Enemy` would match the
 * component rule too and badge every element inside `Enemy`'s body — a warning
 * about one callsite smeared across the definition's internals.
 *
 * Deriving the split from the data (does this position name a stamped
 * element?) rather than from a hand-kept list of which codes are
 * callsite-scoped is deliberate: a new R3F00x code classifies itself.
 *
 * The component rule additionally lands on that component's ROOT element only
 * — the outermost stamped element of its body, recognized through `parentOid`
 * (no parent, or a parent belonging to a different component). Two reasons,
 * one practical and one exact: a definition's internals are not what an author
 * is being warned about, and the root element is PRECISELY the entry an
 * instance row reaches, because that oid is what the transform stamps on the
 * boundary object as `userData.oid`. Anything looser would badge every
 * `<mesh>` inside the component as well.
 *
 * The returned selector yields a fresh array, or `undefined` when nothing
 * pertains — so the caller omits the field entirely instead of shipping an
 * empty array on every entry.
 */
export function fileDiagnosticJoin(
  fileEntries: ReadonlyMap<string, OidEntry>,
  fileDiagnostics: readonly R3fAuthoringDiagnostic[],
): EntryDiagnosticSelector {
  if (fileDiagnostics.length === 0) return () => undefined;
  const elementPositions = new Set<string>();
  for (const [, entry] of fileEntries) elementPositions.add(position(entry));

  const atElement: R3fAuthoringDiagnostic[] = [];
  const aboutComponent: R3fAuthoringDiagnostic[] = [];
  for (const diagnostic of fileDiagnostics) {
    (elementPositions.has(position(diagnostic)) ? atElement : aboutComponent).push(diagnostic);
  }

  const isComponentRoot = (entry: Pick<OidEntry, 'component' | 'parentOid'>): boolean => {
    if (entry.parentOid === undefined) return true;
    return fileEntries.get(entry.parentOid)?.component !== entry.component;
  };

  return (entry) => {
    const pertinent = [
      ...atElement.filter((d) => d.line === entry.line && d.col === entry.col),
      ...(entry.component === null || !isComponentRoot(entry)
        ? []
        : aboutComponent.filter((d) => d.component === entry.component)),
    ];
    return pertinent.length > 0 ? pertinent : undefined;
  };
}

/** Stable identity of one diagnostic, for the union below. Code + position is
 *  exact: two diagnostics of the same code at the same place ARE the same
 *  finding reached through two entries, which is the normal case when a
 *  component is defined and instantiated in one file. */
function diagnosticKey(diagnostic: R3fAuthoringDiagnostic): string {
  return `${diagnostic.code}|${diagnostic.file}|${diagnostic.line}|${diagnostic.col}`;
}

/**
 * Union of the diagnostics reachable from one ROW's index entries — its
 * callsite entry and its definition-root entry — in that order, deduped.
 * `undefined`/absent entries are skipped, so a row with only one of the two
 * (a plain host element; an instance whose index entry has not landed) is the
 * ordinary case, not a special one.
 */
export function mergeRowDiagnostics(
  ...entries: ReadonlyArray<Pick<OidEntry, 'diagnostics'> | undefined>
): R3fAuthoringDiagnostic[] {
  const seen = new Set<string>();
  const merged: R3fAuthoringDiagnostic[] = [];
  for (const entry of entries) {
    for (const diagnostic of entry?.diagnostics ?? []) {
      const key = diagnosticKey(diagnostic);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(diagnostic);
    }
  }
  return merged;
}
