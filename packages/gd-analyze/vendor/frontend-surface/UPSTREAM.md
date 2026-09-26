# GDScript frontend surfaces — generated from pinned Godot source

Open this file when changing either generated JSON manifest or bumping a Godot source authority.
The manifests are the completion checklist's language denominator; they are never hand-edited and
fixtures never contribute rows.

## Authorities

- Godot 3.6.2-stable: `godotengine/godot` commit
  `3cd3caab6779a7f3ec3bbeb9f200db50c735cfc8`.
- Godot 4.7-stable: `godotengine/godot` commit
  `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`.
- License: MIT, Godot Engine contributors (`LICENSE.txt` at each commit).

Each manifest records the sha256 of every source header it reads. The generator refuses a checkout
whose bytes do not match those pins, then extracts tokenizer kinds, parser AST kinds, operations,
match-pattern kinds, and parser/analyzer/compiler rule functions with their source lines.

## Regeneration

From `packages/gd-analyze`, with exact source checkouts at `<godot3>` and `<godot4>`:

```sh
node scripts/extract-frontend-surface.mjs 3 <godot3> vendor/frontend-surface/godot-3.6.2.json
node scripts/extract-frontend-surface.mjs 4 <godot4> vendor/frontend-surface/godot-4.7.json
```

Review any row delta against the authority bump, update `source-authority.ts` and the generator's
pins together, then run both `completion-checklist` majors. A manifest delta is deliberately not
auto-classified as implemented: the coverage/evidence registration must adjudicate every new row.
