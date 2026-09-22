/**
 * The play log's NAMING scheme, defined once. The dev server mints the files
 * in `routes/logs.ts`, and every downstream reader (`vgai status`'s
 * play-error banner, `@vgai/sdk/build-discipline`'s evidence walk, the
 * pruner, the session catalog) sorts them lexicographically and expects
 * chronological order. Moved here from `server/recent-projects-store.ts`
 * (which re-exports for its existing importers) so the browser build can
 * import the functions without that module's `node:os` scope.
 */

import { MAX_RUN_NAME } from './run-name';

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** `slugify` under a length bound, or `null` when nothing survives (blank
 *  name, punctuation only) — an unnamed run and an unnameable one are the
 *  same case, and both must fall back to the unnamed filename exactly.
 *
 *  The bound comes from `@vgai/sdk`'s run-name module rather than a literal
 *  here: a playtest run derives its own name against the same ceiling, and two
 *  copies of "40" is how the derived name and the filename it lands in start
 *  disagreeing. */
export function playRunSlug(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;
  const slug = slugify(name).slice(0, MAX_RUN_NAME).replace(/-$/, '');
  return slug === '' ? null : slug;
}

/**
 * A play session's JSONL filename.
 *
 * `play-<stamp>-<sequence>.jsonl` unchanged when the run is unnamed — that
 * shape is depended on by the newest-log readers (`vgai status`'s play-error
 * banner, `@vgai/sdk/build-discipline`'s evidence walk) and by the pruner, all
 * of which sort lexicographically and expect chronological order.
 *
 * An OPTIONAL name is appended AFTER the sequence for exactly that reason: the
 * ordering prefix is untouched, so naming a run changes only what a human
 * greps for. There is deliberately no registry and no uniqueness check —
 * two runs with the same name are two files with different stamps, and the
 * filesystem is the query engine.
 */
export function playLogFilename(startedAt: Date, sequence: number, name?: string | null): string {
  // Milliseconds plus a process-local sequence make restart artifacts
  // distinct even when two sessions begin inside the same millisecond.
  const ts = startedAt.toISOString().replace(/[:.]/g, '-');
  const slug = playRunSlug(name);
  return `play-${ts}-${String(sequence).padStart(4, '0')}${slug ? `-${slug}` : ''}.jsonl`;
}
