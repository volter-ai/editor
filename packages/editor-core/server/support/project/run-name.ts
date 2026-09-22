/**
 * What a run is CALLED — one owner of the bound.
 *
 * WHY THIS EXISTS. `vgai play --name <text>` exists so a run is findable by
 * what it was testing.
 *
 * WHAT STAYS UNNAMED, deliberately: interactive `vgai play` with no `--name`.
 * A person pressing play is not testing a named thing, and inventing a label
 * for it would put noise in exactly the directory this makes greppable.
 *
 * Pure — no filesystem, no clock. `editor-server.ts`'s `playRunSlug` is the
 * OTHER half (slugging a name into a filename segment) and reads the bound
 * from here, so the two can never disagree about how long a run name may be.
 */

/** Bound on a run's name — long enough to stay recognisable in a directory
 *  listing, short enough that the timestamp beside it is still readable. */
export const MAX_RUN_NAME = 40;
