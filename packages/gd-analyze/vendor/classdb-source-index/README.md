# Godot ClassDB source index

Open this when the pinned Godot API denominator changes or a compat row needs its upstream C++
registration site.

`godot-4.7.jsonl` is generated measurement data. Its first line is the pinned authority, compact
dictionaries, source-file hashes, and coverage audit; every following line is exactly one member
tuple. Denominator-owned class/scope/kind fields are deliberately absent and the loader rehydrates
them from the live API denominator with a strict one-to-one join. It maps every exact member in the pinned Godot 4
source-surface report to a source file and line, ownership estate, member kind, accessor metadata,
and static/virtual flags. It does not implement a member and is not behavioral verification.

The source authority is `godotengine/godot` revision
`5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. Its source archive SHA-256 is
`b3d705612228c09083d55a89ed3ea7381e6181387ecfdb74fd5cf9733b28eee6`; the generator also refuses
any extracted C++/header tree whose audited aggregate SHA-256 is not
`b25d23ca60d7a9e99c2cccda9a5a1b2e736e6d0f79a8411d6647dafd4693cbec`.

Regenerate from an extracted copy of that source revision:

```bash
npm --workspace @vgai/gd-analyze run generate-classdb-source-index -- /path/to/godot-source
```

Then audit the row/precision changes, update `AUDITED_MANIFEST_SHA256` in
`src/godot-source-index/source-index.ts`, and run the package typecheck plus
`classdb-source-index 4`. The loader refuses changed manifest bytes, missing/extra denominator
rows, duplicate members, unhashed citations, or mismatched scope/kind metadata.
