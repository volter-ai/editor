# Godot frontend evidence

These reports are generated measurements from the exact pinned Godot frontend, not fixtures and
not implementation claims. A report may verify only the exact checklist rows named in its `rows`
field. Regenerate `godot-4.7-annotation-enum.json` with
`scripts/report-bound-program-seed.ts`, and regenerate `godot-4.7-keyword-tokens.json` with
`scripts/report-bound-program-keyword-tokens.ts`. Both require the pinned source-built exporter
and the official release archive/binary identities recorded in their report.
Regenerate `godot-4.7-symbol-tokens.json` with that same token script plus
`--symbol-tokens`; this second batch excludes legacy `yield`, for which Godot 4.7 has no valid
parser production.
Regenerate `godot-4.7-operators.json` with `scripts/report-bound-program-operators.ts`; every row
is an analyzed official assignment/binary-operation enum plus an independently accepted strict
deletion mutant.
Regenerate `godot-4.7-expression-nodes.json` with
`scripts/report-bound-program-expression-nodes.ts`; every credited AST node is exported from the
analyzed official tree at an exact source span wholly contained by one contiguous deletion, and
both baseline and deletion mutant are independently accepted by the official 4.7 release.
Regenerate `godot-4.7-control-patterns.json` with
`scripts/report-bound-program-control-patterns.ts`; it applies the same exact-span deletion proof
to statement/control-flow nodes and every official match-pattern variant.
Regenerate `godot-4.7-final-parser.json` with
`scripts/report-bound-program-final-parser.ts`; it proves the remaining cast, nested-class, and
type-test nodes by exact-span deletion, audits `NONE` as the official non-produced node sentinel,
and proves legacy `yield` by its exact official removed-keyword parser diagnostic and deletion.

The source-built executable is deliberately not committed. Build it with
`scripts/build-godot-bound-exporter.mjs` against the source archive and audited tree recorded in
the report.
