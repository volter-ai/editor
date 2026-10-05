# Canonical runtime notice closure

`build-release.mjs` calls `runtime-notices.mjs` after upstream packaging and before
tar. It preserves the existing Code-OSS/editor/product notices, inventories every
shipped npm package root (including extension and nested copies), and validates
the required notice hashes against `manifest.json`. Missing reviewed notices are
added under `licenses/runtime/<name>/<version>/`; the shipped
`NOTICE-PROVENANCE.json` maps every package instance to its complete notice files,
published archive integrity/hash, and any supplement's public source revision,
URL and content hash. `BUILD.json` records this index's hash. The complete bundled
Node license is included with its source revision and the packaged binary hash.
Publish-only runs also require the closure record, so an older archive cannot
bypass the packaging step by supplying `--publish --out`.

The baseline is the retained canonical macOS archive from Code-OSS
`f16dc165c0dffe701a7bbf59aefb1c662b206cee` and editor
`55f7d26f4f3394466d556677903d2527768d5c3a`, SHA-256
`64484d94f5cf608c253c900bfa57232f2b79d53a7e106f77ea97852059397508`.
Its 125 npm package instances represent 124 distinct name/version pairs. Every
pair's official published archive was read and its integrity verified; every
retained notice matches those official bytes. Internal manifests such as
`copilot-sdk/dist/cjs/package.json` and `copilot-api/scripts/package.json` are
parts of their owning npm package, not additional npm distributions.

The missing closure is:

| Owner | Evidence and supplement |
| --- | --- |
| `@vscode/fs-copyfile@2.0.0` (root and Git extension) | Its official archive omits both notice and repository. Microsoft's pinned public `vscode/cglicenses.json` supplies the complete publisher-declared text; no implementation repository is inferred. |
| `https-proxy-agent@7.0.2` | The exact release tag resolves to `dd3b98f0f0bf1da83a58c3330415805568b297f6`; its README License section matches the official archive and is preserved verbatim. |
| `@github/copilot-sdk@1.0.13` | npm's published SLSA provenance resolves to `f13e4a2cc7e4e220974d2333142234e162a3252e`; the public source LICENSE supplies the omitted text. The CLI has its own retained license. |
| `@xterm/headless@6.1.0-beta.303`, `@xterm/addon-serialize@0.15.0-beta.301` | Both npm metadata and package manifests identify `c58ea3637f3968e0e6e79cd92cf9aace7ef89ee2`; its complete LICENSE is included for each owner. |
| `typescript@6.0.3` | npm gitHead `050880ce59e30b356b686bd3144efe24f875ebc8` supplies the two official notice files. The entire Apache license already occurs in root ThirdPartyNotices (whitespace normalized); only ThirdPartyNoticeText is added. A root name match is never treated as coverage. |
| `@vscode/spdlog@0.15.8` | Official archive includes spdlog/fmt notices stripped with `deps/**`. Tag `v0.15.8` at `69a60dd37851493bd73e34b8e92cedf73414c867` pins submodule `7e635fca68d014934b4af8a1cf874f63989352b7`; both source notice files exactly match the npm bytes and are included for the compiled dependency. |
| Node `24.18.1` | The fork's runtime target and cgmanifest identify `9623d9ad85d37d2f0610ec4a82b48182cf2c6061`; its full LICENSE includes the runtime's dependency notices. It is distinct from the Node executing the build. |

The official Copilot platform archive also has a mediaremote-adapter license. Its
entire `prebuilds/.../mediaremote-adapter` subtree is absent from this canonical
archive, so that notice is conditional on actually shipping that directory.
Other Copilot platform files retain their separate original license.

Unknown package/version pairs, absent package manifests, symlinks, changed or
missing notice bytes without a pinned supplement, and a changed Node target or
source mapping refuse before tar. Updating a runtime dependency requires reading
its exact official archive and corresponding source, then updating this reviewed
inventory; a newer version is never assigned an older version's license by name.
Only the macOS runtime inventory was audited here. A Linux build with additional
platform packages will refuse until those exact distributions are audited.

Verification for this change was source parsing and data comparison of the
retained archive, official archives, and immutable public source. No build,
installation, suite, browser, app or World lifecycle was run. A fresh canonical
build and independent artifact review must validate the resulting archive.
