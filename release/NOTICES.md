# Bundled notices

Read this when building or updating dependencies for a modeling release.

Run `npm run build` inside the repository's World. The release build records
retained Rollup modules and esbuild inputs, then writes `BUNDLED_NOTICES` for
`editor`, `editor-core` and `editor-live`. It includes other Volter packages
when their code is incorporated into a bundle. Their licenses do not disappear
when the bundler removes the import boundary.

`provenance/bundled-notices.json` records dependency versions and hashes of the
license texts. Review and commit it together with the generated notice files.
`npm run check:packed-imports` separately checks literal import declarations;
it is not a license audit.

If an npm package omits its notice, the generator refuses unless its exact
version has a reviewed fallback in `scripts/write-bundled-notices.mjs`.
The fallback text lives in `release/licenses/`; `sources.json` records the
upstream repository, revision, path and SHA-256. Check the upstream source
before adding or updating a fallback. Do not synthesize copyright notices.

For Supercode UI 0.1.83, npm provides no git revision or license file. The
fallback preserves the Supercode repository's MIT text at the v0.4.38 source
revision; the package declares `MIT OR Apache-2.0`. This is attribution evidence,
not a claim that the UI package was built from that exact revision.

The inventory covers bundled JavaScript and TypeScript, including separately
built server and automation modules. The Blender WASM corresponding-source
release, Code-OSS distribution, extension archives, fonts and other non-code
assets retain their separate review gates. External npm packages carry their
own notices; these generated files do not establish their full source provenance.

The Code-OSS overlay copies `release/licenses/supercode.txt` into the native
chat extension as `LICENSE.txt`. Its npm archive includes `NOTICE.md` and an
MIT-or-Apache declaration but omits the permission text. Preserve both notices
in the packaged extension; checking only the editor's JavaScript bundles does
not cover this separately packaged extension.

The Blender source review is recorded in `provenance/blender-source-review.json`.
It verifies the exact source archive, materialized startup file, build recipe,
and all 34 dependency archive hashes against the source's pinned manifests.
This is source-distribution evidence, not a claim of binary reproducibility or
complete rendering parity. The source release must be publicly accessible
before conveying the engine binary outside the company.

Blender Essentials is packaged separately from that binary. Run
`node scripts/package-blender-essentials.mjs <pinned-blender-checkout>` after
materializing its `assets/**` LFS objects. The packer verifies every file
against the pinned public commit; `wasm/essentials.json` records per-file
hashes and the complete payload hash. The payload includes the upstream
CC0-1.0 license as `assets/LICENSE`. This data does not change the engine's
GPL license or its corresponding-source obligation.
