# Recovering the Godot lane on another machine

Card `t_25623def`, prerequisite task `t_b3549a88`.

An offline builder's unpublished files are not a source of truth. Recovery starts from
published editor branches in an isolated worktree. The Godot importer remains private;
its source changes land on main, while public editor packages retain the release
boundary in `release/game.json`. A successful publish workflow that changes no public
package does not imply a new npm version.

Rebuild a missing bound exporter with the repository's build script, the pinned
official source archive, and a new output directory. Check the generated identity
against the source-authority record before updating the executable pin. The engine
revision, source tree, source archive, exporter source and build options must still
match. Never relabel an older exporter to satisfy the current pin.

The 2026-09-29 arm64 rebuild retained those identities and produced executable
SHA-256 `7dfe829f3098d8ac2515b114e86dc8dadf9249c56daa77eee95476caebd1425c`.
The official reference editor is unchanged. This is toolchain provenance, not a
claim of gameplay acceptance.

The editor mounts R3F worlds with `createRoot`, so it must supply the
`its-fine` `FiberProvider` normally supplied by R3F's `Canvas`. Resolve that
provider through the project's runtime doorway and deduplicate `its-fine`
with the renderer packages. A world's context bridge must use the provider
from its own module graph; this belongs to the editor's mount contract,
not a workaround emitted into each imported game.

The acceptance slate is the four games named in the original 2026-09-28 walk
record: `platformer-3d-godot4`, `starter-kit-basic-scene`, `starter-kit-racing`,
and `starter-kit-3d-platformer`. Additional corpus fixtures do not expand this
card. Acceptance still requires the card's blind editor walks and independent
review. Builds and static compilation do not satisfy those outcomes.
