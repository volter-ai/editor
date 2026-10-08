/**
 * What every finder answers with.
 *
 * A finder is a PURE function over project source/files with explicit inputs
 * and outputs — it never reads a filesystem, never fetches, and never consults
 * ambient state. What it cannot answer it says so in {@link FinderResult.notes}
 * rather than degrading silently: "has none" and "nobody could look" are
 * different facts, and only the second is a defect.
 */

import type { DocumentEntry } from '../adapter-module';

export interface FinderResult {
  /** Scene-table entries this finder produced, in discovery order. */
  readonly entries: readonly DocumentEntry[];
  /**
   * The entry this finder's own answer makes the default, when its answer
   * settles it UNAMBIGUOUSLY (one candidate). A finder never picks between
   * candidates — that is the adapter author's declaration to make, and an
   * absent default stays the honest fact that none was declared.
   */
  readonly default?: string;
  /**
   * Loud, non-fatal diagnostics: a selection identifier that is not in the
   * source, an entrypoint whose bytes could not be read. Every note names the
   * file it is about. The host surfaces these; it never swallows them.
   */
  readonly notes: readonly string[];
}
