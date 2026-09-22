# Volter Editor live client

Attach to an existing editor session and drive its documents, Blender commands,
inspection, history and registered project tools. This package never starts a
session or runs Blender outside the editor tab.

```js
import { connect } from '@volter/editor-live';
const { editor } = await connect('/path/to/project');
await editor.blender('blender-status');
```

Connection selection matches the project's canonical path and refuses a missing
or mismatched session. Gameplay control, recording and game-page automation are
not part of this modeling release. Runtime JavaScript is bundled for plain Node;
source and declarations ship alongside it.

Private migration staging: the new product's launcher is not available yet.
Existing session storage and wire identifiers remain until their producers move
with them. See the repository WORK.md for the remaining release gates.
