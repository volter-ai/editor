# Editor project contracts

Project manifests, adapter surfaces, authoring contracts and settings schemas
for Volter Editor. This package declares the contract; it does not import an
editor host, SDK or game runtime implementation.

Adapter editor-default data types live beside their schema under
`src/adapter/editor-looks.ts` and `workspace-arrangement.ts`. The extension SDK
exposes those same types to contribution authors, without a dependency back
from this package into the SDK.

Product-specific execution handles belong in product-owned extensions of the
host contexts. These shared contexts do not expose the old concrete `Game`.
Existing native Three/Pixi surface types remain explicit; this migration does
not claim that the contracts are renderer-neutral.

Run `npm run typecheck -w @volter/editor-project` through the active World.
There are no compiler aliases into another checkout. See the root WORK.md for
remaining migration and release gates. This package is private during migration.
