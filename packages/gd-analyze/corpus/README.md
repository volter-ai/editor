# Local Godot corpus input

**Open this file when running the external-game coverage census.**

The concrete inventory is local measurement state and must live outside git beside the read-only
candidate checkouts. It records repository, exact commit, repository-license finding, selected
Godot project root, and observed engine dialect. It is not a fixture registry and does not
authorize vendoring; repository licenses do not certify separately licensed assets.

Coverage is still regenerated, never checked in as a current percentage:

```bash
npx tsx packages/gd-analyze/src/cli.ts priority-corpus-check \
  <id>=<selected-project-dir>... --manifest /external/scratch/priority-games.json --gate

npx tsx packages/gd-analyze/src/cli.ts cohort-report \
  <id>=<selected-project-dir>... --manifest /external/scratch/priority-games.json \
  --cache-dir /external/scratch/godot-cohort-cache --json \
  > /external/scratch/godot-cohort.json

npm run cohort-progress -w @volter/gd-analyze -- \
  /external/scratch/godot-cohort.json \
  /external/scratch/godot-coverage-history \
  --engine-revision "$(git rev-parse HEAD)" \
  --expected-games 30
```

The eligibility command performs the one-time full project/runtime-closure census. Cohort runs
cheaply revalidate the manifest's ids, pins, remotes, selected roots, and clean checkouts, then
reuse content-addressed project snapshots from `--cache-dir`; keep that directory beside the local
manifest so every engine worktree shares it. A cold project is parsed once, while support-only
changes reclassify its cached requirements without rereading the game.

The final command preserves an immutable, timestamped local snapshot with its input digest and
the exact revision that generated the report. If reporting and snapshotting happen in different
worktrees, pass the reporting worktree's SHA—not the snapshot command's checkout. Its delta
separates corpus growth from actual closure of stable
game×requirement pairs, and names regressions explicitly. That local history is the evidence for
the 30-minute pace report; no snapshot file is product truth.

When adding a game, require a real `project.godot`, more than five GitHub stars at discovery time,
an exact commit, repository-license resolution, and a distinct runtime pressure. Record every
project root but select only the playable/current root for the denominator. A license marked
`NOASSERTION` remains read-only coverage input and cannot become a vendored fixture.
