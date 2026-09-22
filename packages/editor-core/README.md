# Volter Editor core

Shared document host, panels, Three viewport infrastructure and Code-OSS bridge.
Products compose this host with contributions through `frame/product`; document
owners register their openers. The modeling host does not install a game-world
mount or built-in scene evaluator.

The source was transferred from the revision recorded in
`../../provenance/editor-host.json`. Three-aware core is deliberate for this
release; this is not a renderer-neutral viewport extraction. Runtime world
mounting, game input and game fixtures are outside this package.

Build plugins ship as JavaScript under `dist/build` so Node can load them from
an installed archive. Source remains available for review and public types.
Run `npm run build:plugins` before building a product from a fresh checkout;
`npm pack` runs this step automatically.

This package is private staging. Session route composition, installed-editor
startup, live modeling verification and final notices remain outstanding.

The `server/*` exports preserve the existing workbench proxy, registry writer,
worktree identity, opener and shutdown mechanisms. They do not yet compose a
complete editor server. Build them with `npm run build:session`; packing builds
them automatically. Tests exercise HTTP routing/isolation and bounded cleanup.
