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

This is a private migration staging package. Full editor startup, live editing,
wire/branding migration and existing-consumer cutover remain unfinished. Passing
a package build is not proof that the complete editor is ready to release.
