# Blender engine

Read this when building or changing the Blender worker or its Three.js frame
presenter. This package contains Blender itself, compiled to WebAssembly, its
worker, Python session, message protocol and tab-side handle. It is independent
of the editor host and game runtime.

The package is GPL-3.0-or-later. Preserve [LICENSE](LICENSE), including all
upstream notices. No repository-wide license overrides this package's license.

## Build and check

From the repository root, install the locked dependencies and run:

```sh
npm ci
npm run typecheck
npm run build:blender-three
```

Run these commands through the active World when working in the Volter
development environment. The browser typecheck has no monorepo aliases and no
Node ambient types. The presenter build emits its standalone module and sky
worker under this package's `dist/release/` directory.

The checked-in WASM files are prebuilt. Their exact upstream source, recipe and
artifact hashes are in [wasm/BUNDLE.json](wasm/BUNDLE.json). Building the presenter
does not rebuild or verify Blender itself. The corresponding Blender source
remains in the separate `volter-ai/blender` fork.

## Distribution

The corresponding source is public at `volter-ai/blender`, and
`wasm/BUNDLE.json` pins its snapshot, release and artifact hashes. Publication
still requires the repository release checks; a successful local build alone is
not sufficient.

[The import record](../../provenance/blender-engine.json) identifies the original
source revision and hashes. Runtime, protocol and artifact bytes are preserved;
legacy internal wire markers and Blender build identifiers are intentionally not
renamed independently of their producers and consumers. Package identity and
build configuration use the public repository.

Benchmark/oracle tools remain at the pinned source revision until their inputs
and execution dependencies are migrated. Their old results are not verification
of a new editor release. The original editor still uses its existing package;
consumer cutover is tracked in the repository's `WORK.md`; do not create a
second independently edited implementation.
