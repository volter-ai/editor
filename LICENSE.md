# Licenses

Volter Editor contains components under different licenses. The root
[Apache-2.0 license](LICENSE) covers root tooling unless a file states otherwise;
it does not replace package or third-party licenses.

| Component | License texts and attribution |
| --- | --- |
| Model editor product | [AGPL-3.0-only](packages/model-editor/LICENSE), [Blender-derived GPL material](packages/model-editor/LICENSE-BLENDER), [MIT MCP notice](packages/model-editor/LICENSE-MCP), [NOTICE](packages/editor/NOTICE) |
| Shared editor host | [AGPL-3.0-only](packages/editor-core/LICENSE), [Apache-2.0 portions](packages/editor-core/NOTICE) |
| Blender integration | [AGPL/GPL texts](packages/editor-blender/LICENSE) |
| Blender engine | [GPL-3.0-or-later and third-party notices](packages/blender-engine/LICENSE) |
| Shared Three.js code | [License texts](packages/editor-threejs/LICENSE), [source ownership](packages/editor-threejs/NOTICE) |
| Editor SDK | [Apache-2.0](packages/editor-sdk/LICENSE), [NOTICE](packages/editor-sdk/NOTICE) |
| Project contracts | [Apache-2.0](packages/editor-project/LICENSE) |
| Automation client | [Apache-2.0](packages/editor-live/LICENSE) |

The Blender and Code-OSS forks remain separate. Their pinned sources, build
inputs, third-party notices and corresponding-source availability are part of
release review. Workbench theme assets carry their own notices under
`packages/model-editor/workbench/extensions/theme-blender/`; Inter's OFL notice also
ships in the pinned Code-OSS fork's `ThirdPartyNotices.txt`.

Transfers and original revisions are recorded under [provenance/](provenance/).
Relocating source does not relicense it. A package's `NOTICE` identifies files
with a different source license from the surrounding package.

Bundled code retains additional notices in the [product](packages/model-editor/BUNDLED_NOTICES),
[core](packages/editor-core/BUNDLED_NOTICES) and [automation client](packages/editor-live/BUNDLED_NOTICES).
See [the release notice procedure](release/NOTICES.md) for coverage and provenance.
