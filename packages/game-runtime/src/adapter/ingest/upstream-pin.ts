/**
 * Upstream-pin extraction — R5 ((c)/ §7.1 item 9): the fix for the overlay identity
 * gap the structural-id + `authoredAgainst.gameVersion` scheme (T7.7/D9) does not
 * close. A re-vendor of a vendored upstream game that keeps a slot's shape (index +
 * three.js type + name unchanged) reapplies a saved overlay onto a semantically
 * different object with `applied: 1, orphanedIds: []` — silent wrong-meaning success
 * — because `authoredAgainst.gameVersion` is the MANIFEST's own `version` (hand-set
 * by whoever wrote the ingest manifest, e.g. every `public/ingest/*` vendored game
 * ships `"version": "0.1.0"` regardless of which upstream commit it vendors), never
 * tied to the thing that actually changes on a re-vendor: the `UPSTREAM.md` pin.
 *
 * This module is the pure, dependency-free half (parse text -> pin, or
 * `null`): NO file I/O here, so it is usable from any context (editor
 * save/apply-time hooks over a fetched `/UPSTREAM.md`, a future Node-side
 * CLI check, tests). READ-ONLY by construction — it has no writer; this
 * codebase never generates or edits an `UPSTREAM.md` (the anti-shim rule:
 * adapters never fabricate first-party data, and a game's own vendoring
 * provenance is exactly that).
 *
 * Format (established convention, not invented here — see every
 * `public/ingest/*\/UPSTREAM.md`'s `## Upstream` section, e.g.
 * `public/ingest/tanks/UPSTREAM.md`):
 *
 *   ## Upstream
 *
 *   - Repo: https://github.com/colyseus/realtime-tanks-demo
 *   - Commit: **`6339493130b4b1d4d28f0f52d17b2fba738c7d47`**
 *
 * i.e. a Markdown bullet whose label is `Commit:` and whose value is a bold,
 * backtick-code full (or abbreviated) git SHA. Every BUNDLE-vendored game in
 * this repo (`tanks`, `simcity`) follows this exact shape. Source-tree
 * vendored games carry their pin in `vendor/games/<id>.UPSTREAM.lock`'s
 * machine-readable `commit` instead and never reach this parser.
 */

/** Matches `- Commit: **\`<sha>\`**` (any amount of internal whitespace, case-insensitive hex). */
const COMMIT_BULLET_RE = /-\s*Commit:\s*\*\*`([0-9a-fA-F]{7,40})`\*\*/;

/**
 * Extract the pinned upstream commit hash from a vendored game's
 * `UPSTREAM.md` prose, or `null` if the file doesn't follow the convention
 * (or wasn't found — the caller decides what a missing file means; this
 * function only parses text it's handed). Never throws — an unparseable
 * document is an honest `null`, not an error (anti-shim: no guessing, no
 * fabricating a pin from a game folder that doesn't declare one, e.g. an
 * externally-authored non-vendored project opened via the CLI-on-folder
 * route).
 */
export function extractUpstreamPin(markdown: string): string | null {
  return COMMIT_BULLET_RE.exec(markdown)?.[1] ?? null;
}
