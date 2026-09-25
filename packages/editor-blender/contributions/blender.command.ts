/**
 * THE BLENDER VERBS of the session wire (`@volter/editor-sdk/commands`, a
 * `workspace.command` contribution): `blender-start`, `blender-stop`,
 * `blender-execute`, `blender-scene-info`, `blender-object-info`,
 * `blender-screenshot-view`, `blender-read-file`, `blender-write-file`,
 * `blender-list-files`, `blender-status`, the RNA door's `blender-rna`,
 * `blender-rna-context` and `blender-rna-set`, and the tree door's
 * `blender-outliner` and `blender-outliner-set`.
 *
 * These left `command-listener.ts`'s switch (and their rows left
 * `command-table.ts`) when Blender's editor half left the host — WORK.md
 * §The workbench, item D. `vgai blender-mcp` is transport only: every
 * `execute_blender_code`, `get_scene_info`, `get_object_info` and
 * `get_viewport_screenshot` still arrives as the same `blender-*` command
 * through the same relay, and is answered here instead of there.
 *
 * EACH ROW CARRIES ITS OWN RELAY BUDGET, transcribed from the host table it
 * left — the page reports the rows it registered and the server sizes its
 * wait from them, so a contributed verb never falls to the generic 5s
 * default (the failure `command-table.ts`'s header records). Blender
 * runs in this tab's worker; a chunk can model for a while (the engine
 * boots on the first call), and every one presents a frame.
 *
 * THIS LANE HOLDS NO HOST INTERNAL (2026-09-19, WORK.md §Skews as packages
 * under the Code-OSS frame, item 6). It took the shell store from
 * `@editor/shell-store-door` to hand to the runtime host, which needed it for
 * one call — presenting the Model document — and that call is now
 * `host.workspace.open`, an address the door routes. A handler's whole context
 * is the command it is given plus `@volter/editor-sdk/host`.
 */
import type {
  CommandContribution,
  CommandDerivedRefresh,
  CommandSpec,
} from '@volter/editor-sdk/commands';
import { handleBlenderCommand } from '../host/blender-runtime-host';

export const point = 'workspace.command';

/** One Blender verb: its budget, and the lane's one handler. A row with no
 *  `timeoutMs` takes the host's own generic budget — the value the rows it
 *  left spelled as `noDerivedRefresh()`'s default, and not restated here so
 *  the two cannot drift. `derivedRefresh` IS always stated: the registry's
 *  default for a contributed row is `'always'`, and only the two verbs that
 *  change what the Model document shows owe a derivation.
 */
const verb = (derivedRefresh: CommandDerivedRefresh, timeoutMs?: number): CommandSpec => ({
  ...(timeoutMs === undefined ? {} : { timeoutMs }),
  derivedRefresh,
  handle: (cmd) => handleBlenderCommand(cmd as { type: string; [key: string]: unknown }),
});

export const commands: CommandContribution['commands'] = {
  'blender-start': verb('none', 120_000),
  // Stop drains accepted modeling work and persists it before teardown.
  'blender-stop': verb('none', 30 * 60_000),
  'blender-execute': verb('always', 30 * 60_000),
  'blender-scene-info': verb('none', 60_000),
  'blender-object-info': verb('none', 60_000),
  'blender-screenshot-view': verb('always', 60_000),
  'blender-read-file': verb('none', 60_000),
  'blender-write-file': verb('none', 60_000),
  // Listing waits on the worker like a read: after an execute the MCP mirror lists
  // while the page is still presenting the frame and refreshing its RNA and
  // outliner reads, which on a large document outlasts the generic 5s default and
  // turned a successful execute into a timeout.
  'blender-list-files': verb('none', 60_000),
  // THE RNA DOOR (WORK.md §Blender in the tab is Blender, "Inspection
  // parity", I1). Two READS — a datablock's `bl_rna.properties` and the
  // Properties context — and one WRITE. The reads present nothing, so they
  // owe no derivation; `blender-rna-set` mutates the model and the session
  // presents the frame, so it derives like `blender-execute`.
  'blender-rna': verb('none', 60_000),
  'blender-rna-context': verb('none', 60_000),
  'blender-rna-set': verb('always', 60_000),
  // THE TREE DOOR (I3): Blender's View Layer tree, and one restriction column
  // written. Same split — the read presents nothing; the column write mutates
  // the model and presents, so it derives.
  'blender-outliner': verb('none', 60_000),
  // THE NODE-TREE DOOR (I5). A READ, so it presents nothing and owes no
  // derivation; there is deliberately no writer beside it.
  'blender-node-tree': verb('none', 60_000),
  // THE UV DOOR (I5, UV Editing). A READ of one mesh's UV layout; pinning,
  // unwrapping and selecting are edits and there is no writer beside it.
  'blender-uv-layout': verb('none', 60_000),
  // THE RIG AND CLIP DOORS (the Timeline). Both READS — the skin binding a
  // `THREE.SkinnedMesh` is built from and the action as three.js tracks — so
  // neither presents and neither owes a derivation. There is deliberately no
  // writer beside them: keying, moving a key and setting a range are edits,
  // and the ONE write the Timeline makes (`scene.frame_current`, once on
  // pause and at scrub-end) goes through `blender-rna-set`, which already
  // exists and already presents.
  'blender-rig': verb('none', 60_000),
  'blender-action-clip': verb('none', 120_000),
  // THE NODE VIEW'S OWN ACTIONS as a session verb — the keyboard ruling's
  // `vgai.*`-command-per-action pattern, and the only way the drawer's view
  // can be read or driven at all: `editor.document.*` is scoped to the active
  // CENTER document by its own contract, and a utility is not one. Read-only
  // over the MODEL: `look` and the view transform are inspection state, and a
  // gesture that would edit is answered with the same refusal the pointer
  // handlers give.
  'blender-node-view': verb('none'),
  'blender-outliner-set': verb('always', 60_000),
  // A read of whether this tab HAS a session; it never starts one — and the
  // one verb that answers before a project session exists.
  'blender-status': verb('none'),
};
