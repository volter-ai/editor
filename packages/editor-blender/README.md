# Blender integration

Blender modeling documents, inspectors, commands, layouts and presentation for
Volter Editor. The integration talks to the independent Blender engine over its
worker wire and contributes its editing surfaces through the editor SDK.

The package uses the project contracts and shared Three rendering/capture
utilities. It imports no editor-core internals and no game runtime. Its
contributions are enumerated in package.json; the eventual product composes
that list through the host's contribution loader.

Run `npm run typecheck -w @volter/editor-blender` through the active World.
See LICENSE for the AGPL code and Blender-derived GPL icon notices.

Switching `.blend` documents drains accepted work and saves the previous file
before retiring its worker and opening the next file. Opens, explicit stops and
graceful session shutdown share one lifecycle queue. A failed save retains the
previous worker; a superseded file selection never becomes the current owner.
If the native workspace remounts the same file's pane during startup, its new
pane restores the presenter immediately instead of waiting behind the boot
that needs it. Context cleanup belongs to each publication, so a retiring pane
cannot withdraw its replacement's publication of the shared view.
While opening, the document shows the last available model photograph as a
labeled read-only preview and a loading panel. Without a preview it shows a
full status surface. A failed open offers Retry and Return to previous model.

This is a private migration staging package. Full editor startup, live editing,
wire/branding migration and existing-consumer cutover remain unfinished. Passing
a package build is not proof that the complete editor is ready to release.
