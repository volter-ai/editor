# Godot translation verification

Do not add unit or end-to-end tests to this package. Translation completeness is measured by the
lane's `report`/ladder workflow, regenerated native fixtures, and live editor evidence (`vgai
status`, Play, deterministic `vgai eval`, and screenshots). A temporary diagnostic probe must stay
temporary and uncommitted; once it identifies a class fix, delete the probe.

Keep `test/fixtures/`, ground-truth captures, and measurement helpers. They are inputs and
executable measurement tools, not a Vitest suite. A translated app is regenerated only through the
production command `npx tsx packages/gd-analyze/src/cli.ts import <godot-project> <target>`; do not
add a fixture-specific or test-only regeneration path, freshness gate, mount runner, gameplay
assertion program, or per-generated-project TypeScript configuration.
