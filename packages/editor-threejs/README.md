# Three.js editor utilities

Shared bounds, layers, clipping, renderer ownership, preview environment and
detached scene capture used by Volter Editor's modeling integration.

This package does not yet own the interactive viewport. The current Three-aware
editor core retains that implementation; full extraction remains deferred.
No game-runtime, DOM authoring, physics or gameplay packages are dependencies.

Structural object marks retain their existing keys and behavior. Their readers
are included here because bounds and editor-layer filtering need them; importing
these small modules must not pull in a gameplay runtime.

Run `npm run typecheck -w @volter/editor-threejs` through the active World.
See NOTICE for the per-file license distinction. This package remains private
while the editor migration and complete distribution review are unfinished.
