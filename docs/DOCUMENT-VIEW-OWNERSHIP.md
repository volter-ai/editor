**Trigger: changing document/pane lifetimes, splitting a media editor, removing media or Play code from the core, or implementing Scene/Canvas preview providers.**

# Document, view, and execution ownership

Implementation specification. Written in `volter-ai/vgai-engine`
(`docs/DOCUMENT-VIEW-OWNERSHIP.md` at `526dbcfb9`, 2026-09-22) and carried here with
this repository's package names. [ARCHITECTURE.md](../ARCHITECTURE.md) states the
decision; [WORK.md](../WORK.md) is the completion ledger. This specification defines
required behavior; it is not a claim that the current implementation satisfies it.

**Scope, owner decision 2026-09-24:** the extraction proceeds. The 2026-09-22 deferral
(a Three-aware core for the first modeling release) is lifted: editor-core is the library
other editors are built on, Blender is one editor that uses it, and the core must not be
tied to Blender or to Three. "Volter Editor" names the whole stack; the model editor is
`@volter/model-editor`, the game editor `@volter/game-editor`.

**Corrections measured against this repository (2026-09-24)** — these amend the sections
below where they differ:

- **The adapter contract is editor-side.** A game is idiomatic code in its own libraries and
  the editor and its adapters make it the engine (owner ruling 2026-09-24). The Three-typed
  half of `@volter/editor-project`'s adapter contract (`root-adapter`, `authoring`,
  `system-adapter`, `host-context`, `asset-cache`) moves to `@volter/editor-threejs`, not to a
  shipped runtime. The shipped runtimes keep helpers that return the library's own objects;
  their framework a game is written against (`createRuntime`, `input-manager`, system
  adapters) retires in a later unit into the ingest-style adapter the editor already has. `game-runtime`'s imports of
  the contract are recorded debt until then.
- **The model editor's closure.** `@volter/editor-threejs` ships in the model release; its
  shared viewport entry imports no React Three Fiber, React authoring, `@volter/threejs-runtime`
  or `@volter/game-runtime`. Checked on the model editor's closure, not inferred.
- **Blender's defaults leave the shared viewport.** Core's viewport carries Blender's lens,
  grid brightness, axis colours and opening direction (`editor-viewport.ts`); they become
  `@volter/editor-blender`'s specialization, and the game's Three integration states its own.
- **Measured size of the viewport unit:** `editor-viewport.ts` 5,306 lines, `StageHost.tsx`
  2,152, `projection/three.ts` 898, `three-viewport/` 1,109, `viewport-door.ts` 237, the stage
  registries and Object3D document sessions; 73 core files and 35 `@volter/editor-game` files
  import them; `@volter/editor-blender` reaches the viewport only through the SDK's
  `surfaces.Object3DAuthoring`. `EditorShellStore`'s 80 members split three ways: document
  state (selection, history, change notification) stays in the kit; per-view Three state
  (camera, tools, snapping, helpers, shading, LOD) goes to each viewport instance; per-document
  evaluation state (scene, object map, Play adoption) goes to Three's document owner; Play state
  (`playState`, the Edit/Play tab, the play-edit regime) goes to the game product.
- **The kit's own tab policy is replaced, not extended.** The Scene/Game focus mirror and
  Play's store adoption over an empty scene are symptoms of duplicated workbench state; they go
  with the unit that makes Code-OSS authoritative.

## 1. Outcome and boundaries

Two panes can edit the same document with independent navigation, provider-scoped
selection, shared source edits, and no duplicate gameplay execution. A non-Three editor can
use the same host without importing Three. Scene and Canvas Content tiles have
real previews without borrowing or perturbing the user's interactive view.

Keep the native Code-OSS frame and our in-realm editor panes. Do not introduce a
webview migration, universal scene graph, renderer abstraction over native media
objects, second undo stack, or second tab manager.
Do not restore archived integrations merely to demonstrate generality.

The implementation includes Three, the existing DOM/React document path,
Blender's use of shared Three presentation, and game Play ownership. Pixi code
still in the host must move to a medium-owned location or leave the core import
closure; this does not authorize restoring an archived Pixi product.

## 2. Owners and dependency direction

| Owner | Required responsibility | Must not own |
| --- | --- | --- |
| Code-OSS | Editor inputs/groups, tab order/preview tabs, focus, native view visibility, restoration, files, configuration, undo/redo infrastructure | Media objects or game execution |
| Editor kit (deferred target) | Adapter contracts and binding adapter capabilities/lifetimes/edits to Code-OSS panels and services | Duplicate workbench infrastructure; camera types, scene traversal, gizmos, media projection, game transitions, product defaults |
| Integration | Source interpretation, native object projection, rendering, picking, navigation, gizmos, inspector content, preview production | Native group/tab policy or private source history |
| Product | Composition, initial defaults, purpose-specific actions; game product owns Play, transport and immersive presentation | A replacement native layout persistence system |
| Project | Authored source/data and explicit preview framing | User tab arrangement, camera navigation history, generated preview images |

Integration code imports SDK contracts and published exports of dependencies,
never `@volter/editor-core` internals internals. Core runtime AND public core contract imports must
not require Three, R3F, Pixi, or Blender types. A type-only Object3D import still
makes a core contract media-specific. Media-native types belong in the media's
API. Do not replace Object3D with `any` or a cast and call that separation.

Resolve shared rendering through side-effect-free exports of the existing
`@volter/editor-threejs` package, initially under `src/viewport/` and `src/capture/`.
Blender explicitly depends on those exports. Do not add `@volter/threejs-editor`:
the contribution loader reads product-composed and project-declared packages,
not transitive dependencies, so importing a Three renderer does not itself
activate Three's document finders or inspectors. Keep the exports' import closure
free of contribution registration, DOM integration, product code and host
internals. Adjust the existing package description that calls stages core-owned.

A separate rendering package is warranted only by a demonstrated dependency,
license or release constraint; the present tree does not establish one. Preserve
Apache runtime package paths and licensing. This extraction is editor-side only.

### Viewport ownership correction (2026-09-22)

The reusable Three viewport is a complete implementation in `@volter/editor-threejs`.
Blender imports and extends it; the game product's Three integration imports
and extends it for Unity-like authoring. The game product remains independent
of its media integrations. Core only hosts contributed views. Extension can
use composition or ordinary subclassing where appropriate; this decision does
not authorize a second plugin framework or a universal viewport abstraction.

Do not add camera callbacks, product flags, or a larger dressing schema to core
as a substitute for this move. Native Three contracts travel with their
implementation. User settings are still configuration, owned and interpreted
by the implementation that uses them.

The earlier utility extractions are preparation, not completed ownership
transfers. Their direct core-to-Three imports are migration debt. The next
viewport migration is one reviewable unit with these obligations:

| Current owner/location | Required destination/action |
| --- | --- |
| `editor-viewport.ts`, its Three picking, transforms, projection and helpers | Three's assembled viewport; no imports of editor internals |
| Blender lens, opening direction, grid, axis compass and handle presentation inside that file | Blender's specialization of the Three viewport |
| `StageHost.tsx`, `Object3DDocumentSession`, Three stage registries and dressing | Three document/view implementation; generic occurrence attachment remains core-owned |
| `EditorShellStore` camera, native scene/object map, rendering and transform state | Three evaluation/view owners; do not inject the whole shell store into the extracted viewport |
| SDK `Object3DAuthoring`, `Object3DPreview`, `ViewportRig` and native helper contracts | Three's public API (`@volter/editor-threejs/object3d-contributions`); the SDK imports no three |
| `ToolContributionSurfaces` lazy Three factories | Three registers its surfaces by name in the kit's neutral `contribution-surfaces`; they stay on the props because project contributions cannot import editor components |
| Game authoring chrome, Play transitions and gameplay defaults | Game's integration/product; not the shared Three viewport or Blender |

Retain useful shared rendering/capture exports. Do not move whole host files
with their `@volter/editor-core` internals dependencies, pass host internals through an options
object, or replace native types with `any` to make the move compile. Neutral
file/history, diagnostics and occurrence services use existing SDK contracts.
Inventory the shell-store and stage consumers before changing those contracts;
the new owner must retain their observable behavior, not silently drop it.

Acceptance requires all of the following, beyond builds and rendering probes:

- Core no longer constructs/imports the assembled Three viewport or supplies
  its media-specific factories through the SDK.
- Three exports contain no core internals or product implementation imports;
  loading them alone registers no contributions.
- Blender can change lens/navigation/overlays in its own code, and the game's
  Three integration can change its authoring presentation independently.
- A non-Three composition has no Three viewport runtime or public-type closure.
- Existing native lifecycle, source editing and capture gates still apply.

Freeze existing reverse edges by exact importer and imported module, including
types and lazy imports. The baseline is debt to remove, not an allowed export
catalog to expand. Smaller file counts cannot establish any acceptance above.

#### Measured consumer inventory (2026-09-24)

Measured from `editor-viewport.ts`, `StageHost.tsx`, `viewport-door.ts` and
`projection/three.ts`: their closure in `editor-core` holds 44 modules that import
three, R3F, quarks or `@volter/editor-threejs`. Those 44 import 35 neutral kit
modules, and 54 other kit modules import them.

- **Licensing.** `editor-core` code is AGPL-3.0-only, imported from `@vgai/editor`
  (`provenance/editor-host.json`), and `@volter/editor-sdk` is Apache-2.0. Kit
  modules therefore do not move into the SDK. The SDK gains contracts (new
  interfaces and host doors), and core implements them.
- **The hub is `StageHost.tsx`.** It takes 20 of the 35 neutral doors: stage store and
  stage context registration, performance and design-time surface registration,
  retained document states, workspace history, `AssetEditorShell`, `StageOverlays`,
  `TransportStrip`, stage transport and keyboard. These are occurrence-hosting
  duties. `Object3DDocumentViewport` (about 1,650 lines) holds them together with
  the Three renderer, gesture controller, dressing and document session.
- **The other doors** are few and narrow: `ShellStore`, stage invalidation, six
  authoring consumer actions, the root-hidden eye, selection scope, the orbit-gesture
  hint, the no-authoring adapter, the active and composite adapters, the performance
  profiler, preview resource lifetime, compare math and bitmap labels.

Extrapolation, not yet measured: the first cut is `StageHost.tsx`. A core occurrence
host keeps the host duties and hosts a contributed Three document view through an
SDK view contract. The Three view then needs only the narrow doors above.

## 3. Identity and state

Use distinct types for DocumentId, ViewId, and ExecutionId. No fallback that
silently interprets one as another. None is an Object3D UUID or DOM element.

- DocumentId identifies the provider plus canonical resource/address (including
  export/story identity where applicable). One source file may yield several
  documents; one document may depend on several files. Providers canonicalize
  addresses; the host does not guess by stripping export names.
- ViewId identifies one logical editor occurrence. It survives hide/reveal and
  moving that occurrence between groups; splitting creates a new identity.
  A Code-OSS pane and group are reused for different inputs, so neither their
  IDs alone nor a document ID alone is a ViewId. Keep an occurrence record at
  the native input/group boundary and carry it across native move operations.
- ExecutionId identifies an explicitly started run. Splitting, focusing,
  thumbnail capture, and attaching a view do not create a gameplay run.

Document state: source/revision, source-edit coordination, diagnostics, and
subscriptions to authoritative files. Source stays authoritative. Integrate
edits through existing native file/history services; do not make each view a
writer/history owner. Different documents editing the same file must use the
same source transaction path and native resource undo ordering.

View state: camera/projection, zoom/scroll, active tool and helper preferences.
Three/DOM selection is view-local and uses stable source IDs. A provider backed
by native document-wide selection (Blender) declares that scope and shares it.
Preview playback is evaluation-owned, not universally view-local. Seed a
split from the originating view's snapshot, then keep both independent. Frame
services store view state locally; ordinary navigation never writes the project.
After a source revision, resolve selection against the new projection and clear
only IDs that no longer exist. Do not retain stale native object pointers.

Execution state: physics, tick scheduling, audio, runtime roots, input ownership,
and run termination. It is separate from a React render and from a GPU lease.
The default is one design evaluation per document revision shared by its views,
with one clock. An integration may offer explicit independent previews when it
can safely create isolated evaluations; ordinary splitting does not do that. Such evaluations are read-only consumers
of shared source, have their own identity/disposal, do not start game services,
and are never counted as new document models. Do not promise that an arbitrary
native Object3D graph can have two parents or two independent animation times.

## 4. Lifecycle contract

These are operations and semantics to implement through the existing SDK and
native bridge, not permission to create a parallel service framework.

1. Resolve a document provider/address to a canonical DocumentId. Acquire one
   model per DocumentId, deduplicating concurrent async opens. Failed/cancelled
   resolution releases partial resources and gives the native editor a named
   error with retry. No fallback document or silent omission.
2. Each native editor occurrence acquires a model reference and creates a view
   using that model, a ViewId, and optional serialized view state.
3. Attach the view to its native DOM slot. A view owns a stable portal target;
   moving it does not recreate the source owner or execution. Different views
   never share a mutable portal target. DOM-slot existence is not document life.
4. Visibility and focus are separate signals. Both split panes can be visible;
   only the focused one receives keyboard commands. Inspector and hierarchy
   context follows the active editor occurrence, including same-input group
   focus changes. If focus moves into its inspector, preserve the owning view.
   Focusing a different editor without a capability clears/disables that action;
   never fall back to the first registered stage.
5. Hiding an authoring view releases its interactive rendering lease and retains
   serializable view state. A shared design evaluation pauses when its last
   visible consumer disappears; hiding one split must not pause the other.
   Showing it reads the current source revision, reacquires rendering, and restores state. HMR while
   hidden cannot revive an obsolete projection.
6. Closing one occurrence disposes its view and releases its model reference.
   Closing the last releases the model once native dirty/save handling permits.
   Capture work uses a short-lived, cancellable model reference and always
   releases it. An explicitly running game is owned by its execution service,
   not kept alive through a hidden authoring-view reference.
7. Native restore restores occurrences/groups/order, then resolves providers.
   Delayed registration is not deletion. A missing provider shows an actionable
   unavailable editor in the restored position. Do not reopen defaults over a
   restored workspace or copy the open-tab set into the project manifest.
8. Serialize provider-owned view state through native editor view-state/storage
   facilities, versioned and validated. Discard invalid view state with a
   diagnostic and safe view defaults, never discard the underlying document.

Every async view build/capture carries its source revision and a cancellation
signal. Disposal or replacement makes its result ineligible for attachment;
release results that arrive late. Disposal is idempotent. Avoid teardown inferred
from a timeout, a global active-document variable, or a React unmount alone.

## 5. SDK and native bridge changes

- `workbench/src/vgaiDocumentInput.ts`, `vgaiDocuments.ts`, and
  `vgai.contribution.ts`: own native occurrence tracking, native input identity,
  model references, dirty/save integration and native view-state handoff.
  Reuse native editor services. Same-document splitting is enabled only once
  its provider supports the lifecycle; a refused split explains why.
- `src/workspace-document-registry.ts`: retain provider discovery/resolution;
  remove duplicate open-order, preview replacement, and neighbor-focus policy
  as the native counterpart lands. Native events are authoritative observations,
  not instructions to reconcile two independently owned tab sets.
- `src/frame/bridge.tsx`, `WorkspaceDocumentSurface.tsx`: attach views and route
  focus. Do not create a hidden substitute Content component when a slot vanishes.
- `editor-sdk/src/host.ts`: replace universal stage/rig/Object3D doors with the
  neutral document/view operations actually needed. Move Three stage/capture
  contracts to the existing Three integration exports. Generic commands receive view context;
  Three commands use their own typed implementation. Unsupported capabilities
  produce an explicit unavailable result. Do not add stringly generic RPC for
  in-realm native calls or a speculative registry for every conceivable tool.
- `StageHost.tsx`, `object3d-document-session.ts`, `editor-viewport.ts`,
  `viewport-door.ts`, Three projection/gizmos and Three camera presentation:
  separate source, view and render ownership, then relocate to the Three editor
  implementation. No root-scene exception bound to the global shell store.
- DOM/Pixi authoring, projections and previews move to their respective media
  owners; shared syntax/source-edit machinery stays neutral only where it
  genuinely has multiple users. `@volter/editor-react` remains the existing React package
  name for this work.
- `project-adapter.ts`'s injected `blender:runtime` default moves to the model
  product. The kit loads registered providers without naming Blender.

Any intermediate SDK forwarding export must be removed in the same migration
unit as its final caller. Do not land a permanent core-to-integration import as
an extraction shortcut. Preserve license boundaries and public runtime paths.

## 6. Play and rendering

The game product owns one explicitly started execution per configured run.
A runtime provider declares whether it supports multiple views. When it does,
views observe the same execution; only the focused eligible view owns input,
and audio/ticking happen once. Moving/closing a view does not restart
or stop it. Stop (or session shutdown) disposes the execution. A provider that owns one non-replicable DOM/canvas surface remains a native
singleton editor: native split/move semantics move the existing view rather
than duplicate it. Advertise that limitation and disable any integration-owned
"additional view" action. This is a supported capability, not migration debt.
Never implement split by starting another game.

Three-specific camera flight and rendering live in the Three integration;
the game product orchestrates them. Game UI has its own presentation: no authoring
gizmos; top-aligned gameplay bar with centered transport, FPS and sound controls.
Shared rendering does not impose Blender navigation, hierarchy or furniture.

Immersive Play is optional product policy using native visibility/Zen mechanisms
and the existing game-owned restoration contract. Normal Play does not rewrite
saved layout. Failure, cancellation, Stop and rapid restart must all restore
state correctly. Account/menu/layout toggles remain native frame responsibilities.

Replace the Rapier timeout adjustment with explicit execution/evaluation ownership.
If design and Play physics legitimately overlap, they are distinct scoped owners;
if a shared resource must be exclusive, hand it off explicitly before acquiring.
Preserve the last authored image through the transition without requiring the
old simulation to stay running. Never silence contention by lengthening a grace
period to match a camera animation.

Renderer allocation remains integration-owned with the existing bounded policy:
exclusive leases for visible interactive views, at most one idle interactive
renderer, and one serialized lower-priority preview lane. Hidden authoring views
hold no interactive GPU lease. Explicit gameplay execution can continue while
hidden; its rendering can suspend independently of simulation.

## 7. Scene and Canvas thumbnails

Keep the detailed visual contract in VIEWPORT-CONTENT.md (vgai-engine).
The Content UI requests a preview for a document/revision; the document's provider
supplies capture and framing operations. Core owns scheduling and cache mechanics,
not camera choice, traversal, or artboard geometry. Content category names/order
are contributed product policy: Prefabs, Scenes, Canvases first in game-editor.

- Scene: saved explicit preview pose (including orthographic projection/extent),
  else explicitly declared authored camera, else meaningful-content framing.
  Never choose the first camera found by traversal. Omit editor helpers and
  exclude sky/background from fit bounds while preserving authored appearance.
- Canvas: capture the design composition/artboards using the same placement
  calculation as its editor; fit the whole composition without cropping.
- Capture unopened documents through a short-lived provider capture context.
  It may reuse safe immutable/source resources; it must not mutate an interactive
  scene, camera, selection or time. No native tab or gameplay activation.
- Cache identity includes provider/recipe version, canonical document address
  including export identity, dependency revision, framing and output parameters.
  Reject obsolete results. Relevant edits debounce 750 ms; Refresh invalidates
  only the requested document. Ordinary camera navigation invalidates nothing.
- Produce 320 × 180 images displayed with containment. Persist explicit framing
  through source history to project metadata; cache images are gitignored.
  Preserve the last successful image on failure; show stale/error state and Retry.
  Unsupported and empty compositions are reported explicitly, without fabricated
  screenshots. Cancelled captures release leases even when providers fail.

## 8. Migration units, in order

The first delivery is the open-source Blender/model-editor system, including
everything it imports or distributes. This order supersedes the earlier
Three-first sequence. The complete editor migration still requires A1–A18;
shipping Blender does not mark the deferred game work complete.

1. Preserve unrelated changes. Inventory the actual model-editor release graph
   and packed files using the release gates below. Record every offending edge
   and its intended owner in WORK before extraction; lazy loading is not removal.
2. Transfer the assembled Three viewport, its native contracts and its callers
   together as specified in §2's ownership correction. The already extracted
   rendering/capture utilities are retained, but further utility-only moves do
   not complete this unit. Blender and the game's Three integration specialize
   the imported viewport. Remove media implementations/factories from the neutral
   SDK/host; do not add another host or retain reverse imports. Unrelated Three
   authoring work can follow, but shared viewport ownership cannot be deferred.
3. Make Blender the first working consumer of document-owned evaluation and
   native occurrence-owned views. Prove open/edit/save/undo, same-file splits,
   hide/reveal, move, restore, revision handling, capture and final disposal.
   Keep inputs singleton until that provider satisfies these gates. Preserve
   the already verified scoped-physics prerequisite wherever it is needed.
4. Build and pack the full release closure, then install and exercise it outside
   the checkout. Complete the corresponding-source/build gate under WORK's L0
   clean-room restrictions before conveying Blender bytes. Keep private release
   gates until all Blender release evidence below exists.
5. Complete Three shared evaluation and DOM lifecycle (A1–A10), then product-owned
   Play/default-document policy and execution handoff (A11–A13). Work required
   to remove an actual Blender dependency belongs in steps 2–4, not this deferral.
6. Finish Scene/Canvas provider capture, cache/framing and resource behavior
   (A14–A17), then remaining core boundary and product acceptance (A18). Retain
   only independently verified fixes from earlier patches. Merge coherent
   verified units; WORK remains the sole remaining-work ledger.

### Blender release gates

These are acceptance requirements, not claims that the current implementation
passes. Record the artifact versions/hashes, commands, observations and unresolved
edges with the release evidence in WORK and the implementing PRs.

| Gate | Required evidence |
| --- | --- |
| Release inventory | Start from model-editor, its CLI, workbench/bridge and Blender packages. Enumerate transitive runtime and public-type imports, dynamic imports, workers, assets/WASM, generated bundles, build inputs and host-injected implementations. Separately enumerate every packed/distributed file: unreachable code still shipped is still release scope. Resolve external package versions and availability; bare npm specifiers are not terminal proof. |
| Shared boundary | Blender uses explicit shared renderer/capture exports without editor-internal imports, game services or unrelated contribution activation. Neutral host, SDK and project contracts require no native media types. Verify public declarations as well as runtime imports and the actual product bundle. A smaller static value-import count alone cannot pass. |
| Native document lifecycle | With a real `.blend`, observe one model/evaluation and two native ViewIds; independent cameras/helpers, shared native selection/time, one edit and native resource undo history. Save/reopen, undo across views, hide/reveal, move and reload retain correct revision/view state. Closing one leaves the other usable; final close respects dirty state and disposes once. Failed/stale rebuilds cannot replace the last good revision. Different-file conflicts never retarget the live worker. |
| Capture isolation | Exercise same-file capture during edits, cancellation, provider failure and late completion; no live model replacement or change to selection/time/cameras, no stale image publication, no leaked snapshot/renderer. Different-file capture either has an explicitly isolated evaluation or refuses without changing the live binding. Observe resource counts through repeated split/hide/capture/close cycles. |
| Packed consumer | In a clean directory/profile outside the checkout, install the exact packed closure without workspace links, source aliases or private credentials. Build a public-type consumer and use current `model-editor create` and `vgai edit` entrypoints with the declared workbench. Exercise the lifecycle above; verify worker/WASM/asset URLs resolve from shipped files and the editor console is clear. Any local registry test must serve the actual packed artifacts and include all required packages. |
| Source and distribution | Audit licenses/notices for all distributed files and bundled dependencies. Tie the exact WASM and worker payload hashes to the actual modified fork commit, corresponding source, dependency sources and build recipe; reproduce under L0's clean-room rules. An upstream-only SHA, machine-local path or older registry dry-run is insufficient. Release evidence must describe the bytes being conveyed, including the workbench. |

The current `validate-editor-closure.mjs` is a static value-import ratchet. Its
exclusion of dynamic/type imports and treatment of bare packages as leaves are
measurement limits, not release exclusions. Extend existing guards where useful
and inspect artifact manifests for edges that an import scan cannot establish.

## 9. Acceptance matrix

Run apps and checks through the product's session. Use the product-owned editor
session and its control API, not a separate browser skill. Record observations
and resource counts in the PR; do not commit a routine autoplay suite. Strengthen
existing static boundary guards where practical. All rows are required for final completion, with provider-specific capabilities
checked explicitly. Three authoring, DOM authoring and same-file Blender views
must support splits; arbitrary ingested Game surfaces need not.

| ID | Action | Required evidence |
| --- | --- | --- |
| A1 | Open the same Three document twice concurrently and split it | One model/source owner; two ViewIds; no second gameplay execution |
| A2 | Navigate/select/change helpers in either view | Independent Three view state; inspector and keyboard command target follows focused view |
| A3 | Edit in one view; undo in the other and from source editor | Both update from authoritative files; one native resource history; no double write |
| A4 | Switch documents in a group; move a tab; hide/reveal repeatedly | No cross-document state reuse; moved view retained; no hidden fallback mount |
| A5 | Edit source while hidden, including deleting selected node | Reveal current revision; invalid selection removed; stale async build cannot attach |
| A6 | Close either split, then final occurrence | Remaining view works; final owner/resources disposed exactly once; dirty close respected |
| A7 | Reload split groups with different cameras and delayed provider | Native order/visibility and per-view state restored; no default-tab overwrite |
| A8 | Repeat split/edit/hide/close with an existing DOM/React document | Same host lifecycle; no Three rig or root required |
| A9 | Open Blender model, split, navigate, capture | One same-file engine/evaluation; independent navigation, shared native selection/time; no reparenting or command retargeting |
| A10 | Build a minimal composition with DOM/React and no Three integration | Runtime and public core dependency closures contain no Three/R3F/Pixi/Blender |
| A11 | Play, split/move Game, switch focus, close a view | Multi-view provider: one run/tick/audio owner and focused input; singleton provider: native move, no clone/run; both preserve execution |
| A12 | Stop/restart rapidly and cancel/fail startup during immersive transition | Correct native layout restoration; no leaked run or physics owner; no timing grace workaround |
| A13 | Toggle optional immersive policy, Zen, panels; reload | User choices persist through native services; tabs/inspector/chat not forcibly hidden |
| A14 | Capture unopened Scene and Canvas; save/reload orthographic framing | Real correctly framed image; identical interactive view/layout/selection/run counts |
| A15 | Two exports from one file; change one dependency; Refresh one tile | Distinct images/cache keys; only affected documents recapture; debounce respected |
| A16 | Force capture failure, cancel while building, then Retry | Old image survives; errors visible; no lease leak; retry succeeds; stale result rejected |
| A17 | Open/hide/split/capture repeatedly | Renderer/source/run counts return to expected baseline; bounded capture concurrency |
| A18 | Typecheck, required repository guards, product builds, live regression walk | No reverse host imports in migrated code; no media in core contracts/closure; unresolved editor console empty or explicitly investigated/acknowledged |

No acceptance row may be marked passed from types or screenshots alone when it
asserts ownership. Observe actual model/evaluation/run creation and disposal
through scoped diagnostics. Remove temporary probes after recording evidence.

## 10. Implementation walkthrough and resolved edge cases

This section is a source-level design walkthrough, not runtime acceptance.
It narrows the first draft's assumptions. Source anchors refer to the current
repository or the pinned Code-OSS checkout, not new infrastructure to invent.

### Native occurrence mapping

Keep one canonical `VgaiDocumentInput` per document. Code-OSS's default
`EditorInput.copy()` returns that input; sharing it does not mean sharing the
view. Maintain an occurrence lookup by `(group.id, input)` whose value is a
ViewId and model reference. This is attachment bookkeeping, not a second tab
list. Observe every group's native model events, including inactive opens and
closes; constructing occurrences only from `setInput` loses background tabs.

On normal open, reuse an existing occurrence in that group or create one. On
copy into another group, create a new occurrence seeded from view state. On
move, `EditorGroupView.doMoveOrCopyEditorAcrossGroups` fires `onWillMoveEditor`
with source/target group IDs, opens the target, then closes the source with
`EditorCloseContext.MOVE`. Transfer the occurrence rather than dispose/recreate
it. Keep a pending transfer until native membership confirms the result; a
cancelled/failed move leaves its source valid. If the target already contains
that document, native consolidation retains the target occurrence and releases
the redundant source occurrence. Do not leave two views for one native tab.

Use `AbstractEditorWithViewState`/editor mementos for `(group, resource)` state.
`fillActiveEditorViewState` already copies `getViewState()` into open options.
Return a versioned provider snapshot, never the source ViewId, or split would
copy identity. Persist background state when the input is cleared/hidden. For
inactive moves/copies use the occurrence's retained snapshot; native active-pane
view-state forwarding alone does not cover them. A reload creates fresh runtime
ViewIds from restored native memberships and restores their saved snapshots.
Subscribe to `onDidChangeActiveGroup` as well as editor changes: same-input group
focus is a different view. Do not use the registry's global active ID as truth.

### Three source and rendering

Opening A acquires model M and one design evaluation E. Splitting gives V1 and
V2, each with its own camera, tools, helper objects and renderer lease. E owns
the mounted R3F tree, its authored scene and content clock. The views render E;
they do not both call its `advance`, mount its effects, or dispose its objects.
The current `mountedStoryViewportSource.build()` returns the SAME root and
`StageHost` calls `scene.add(source.root)`. Calling it twice reparents the root
out of the first view. Refcounts alone cannot fix that.

Render the authored scene in its existing ownership tree through each view's
camera. Draw view-owned helpers in a separate overlay pass with deliberate depth
behavior. Selection outlines/postprocessing reference the view's selected native
objects without moving them. Provider dressing and authored environment are
separate: scope any unavoidable scene/material overrides to a synchronous draw,
restore in `finally`, and never keep them across an await. Do not clone arbitrary
R3F scenes as a substitute: effects, physics handles and source IDs would diverge.

The evaluation ticks once, independently of how many views render. Shared scene
animation time is therefore shared. Truly independent story previews require an
explicit isolated evaluation capability; they are not the default split behavior.
A source edit commits once through native file/history services, builds revision
E2, then swaps all surviving views to E2. Keep E1 until no render borrower holds
it. Failure leaves the last good image with a diagnostic, not a falsely current
model. A closing view cannot cancel a build another view still awaits.

A gesture captures document ID, evaluation revision, selected source IDs and its
write transaction at start. Changing focus never retargets that gesture. Before
replacing its evaluation, settle or explicitly cancel/rollback the gesture.
Two views cannot write concurrent conflicting previews to the same objects;
serialize gestures at the document edit coordinator, not with a page-global lock.
Undo invalidates all affected document projections, including other exports of
that source, through authoritative file revision notifications.

### Blender is not an arbitrary independent scene mount

`blender-runtime.document.tsx` uses the module singleton `blenderModelView`;
`blender-runtime-host.ts` holds one `boundModel` and one runtime. A second
component currently reuses the same root and can clear the binding on unmount.
Move binding into the document/evaluation owner and dispose it by identity, not
by calling a global `bindModelDocument(null)` from each view. Same-file views
render one presenter scene through different cameras without reparenting it.
Blender's selection and timeline remain native shared state; camera and overlays
are view-local. A viewport gesture invokes the native engine once, then every
view observes the resulting revision.

Do not silently present the current file under another file's title. With the
existing single-document worker, acquiring a different `.blend` while one is
bound returns an explicit resource-conflict result without changing the current
binding. Multiple simultaneous `.blend` workers are a separate resource/product
decision, not an automatic consequence of fixing same-document split views.

Blender capture must not load a thumbnail's file into the live bound worker.
For the bound file, the provider must create a detached render snapshot for a
specific revision, with no mutable engine-backed buffers, live callbacks or
shared disposable resources. Capture owns and releases that snapshot. Prove
that contract before reusing the presenter data; otherwise capture requires an
explicitly isolated evaluation. With the current single-worker policy, an
unbound different-file capture returns the resource conflict rather than
silently creating another worker or replacing the live file. Capture failure
preserves the prior thumbnail and offers retry after the conflict is resolved.

### Execution, physics and capture

`live-document.ts` currently waits for a document component to supply its DOM
container. Move the container's ownership to the game execution service; views
attach that stable surface. It may be parked by that service when no view shows
it, without mounting a substitute document. Reopening attaches the same run;
Stop/session shutdown releases it. Provider-specific rendering suspension must
not accidentally pause or duplicate the simulation. Unmodified DOM games can
remain single-surface providers.

Physics commands must reach the world they name. The editor's physics observer
(`editor-game/src/services/game-physics.ts`) is attached per root and resolves
the `<Physics>` world inside the R3F root that renders that root's scene on every
call, so no module-global slot decides which world a command reaches. Not yet
validated: two concurrent worlds, editing a body in each and observing only its
own world change.

Capture acquires a separate design evaluation when rendering could invoke
project callbacks or mutate shared state. A reusable immutable render snapshot
is also valid when the provider guarantees it. It never borrows the interactive
scene merely because `renderer.render` appears read-only. Capture carries a
revision token: an edit during capture makes the result stale and non-publishable.
A thrown provider, cancellation or late completion releases its model/evaluation
and renderer references. Arbitrary project effects are not sandboxed by setting
R3F's frameloop to never; unsupported isolation must be reported and providers
must use the existing design-time mounting boundary explicitly.

### Dependency extraction and implementation order correction

Every provider's first working unit must include evaluation ownership. For
Three/Rapier, preserve scoped physics binding where two evaluations coexist;
do not postpone that correctness work until Play package relocation. Blender's
native engine does not acquire a Rapier dependency to satisfy this rule. Source
model/view separation alone cannot pass A1 if its mounts still contend globally.

Move the Three implementation as a coherent import closure into
`@volter/editor-threejs` exports. For each dependency in `StageHost`, choose its actual
owner: media code moves with it; native host services are injected through
existing neutral SDK doors; game coverage/Play policy is contributed by game.
A moved file that imports the old host store is not an extraction. The shared
entry used by Blender must not import Three's contribution modules or its DOM
board integration. Verify entry-point closure and contribution activation
separately; an installed package dependency is not an activated contribution.

Follow §8's Blender-first release order: prove the applicable native lifecycle
directly with Blender, then finish the Three, DOM, Play and preview matrix.
The final static
boundary gate must include SDK contracts and project adapter contracts as well
as the runtime host closure; leaving required native media types in neutral
contracts would preserve the coupling even if the bundle became smaller.
