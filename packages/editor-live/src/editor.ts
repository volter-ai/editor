/** Editor and document automation over the shared session command wire.
 * Modeling executes in the editor tab; this client owns no model state. */

import type {
  ActiveDocumentCapture,
  AssetKind,
  AssetPreviewCapture,
  AssetPreviewOptions,
  AssetPreviewShotSetDefinition,
  AssetPreviewSource,
  CaptureDimensions,
  DocumentLookOutcome,
  EditorChromeCapture,
  EditorChromeCaptureOptions,
  EditorClient,
  EditorState,
  EditorView,
  EditorWorkspaceName,
  HistoryStep,
  InspectedFieldWrite,
  InspectedHierarchy,
  InspectedInspection,
  LabeledShotSetCapture,
  OpenedDocument,
  PresentedEditorView,
  ShadingMode,
  StructureOp,
  StructureOpOptions,
  StructureOpResult,
  ViewPreset,
  ViewportCapture,
} from '@volter/editor-sdk';
import { LiveEditorDocument } from './editor-document.js';

/** A panel `showPanel` can focus: the viewport tabs, the console, the build
 *  surface, or any key the editor's own static-panel registry holds
 *  (`hierarchy`, `assets`, `asset-library`, `inspector`, `history`, …) — which
 *  is why this is open: the registry, not this union, is the vocabulary. */
export type PanelName =
  | 'viewport-edit'
  | 'console'
  // Keeps the literals above in autocomplete while admitting every key the
  // editor's registry holds — the registry answers, this union only hints.
  | (string & {});

const EXTENSION_KIND: Record<string, AssetKind> = {
  '.glb': 'model',
  '.gltf': 'model',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.svg': 'image',
  '.hdr': 'image',
  '.exr': 'image',
  '.mp4': 'video',
  '.webm': 'video',
  '.mp3': 'audio',
  '.ogg': 'audio',
  '.wav': 'audio',
  '.flac': 'audio',
  '.glsl': 'source',
  '.vert': 'source',
  '.frag': 'source',
  // PROJECT SCRIPTS ARE SOURCE. Without these the guess below falls through to
  // `'json'`, the asset-document router sends the file to the generic JSON
  // viewer (`asset-documents.tsx#assetDocumentViewerRoute`: `spec.kind ===
  // 'json'` is decided before any content routing), and the LIVE MODELING
  // DOCUMENT never mounts — `editor.openAsset('src/lib/fox/fox.model.ts')`
  // silently shows a text pane instead of the model. Only `kind: 'source'`
  // reaches `SourceAssetViewer`, which is what content-routes a project script
  // to `LiveModuleDocument`. The set matches that viewer's own
  // `isProjectScriptPath` regex, `/\.(?:[cm]?[jt]sx?)$/`.
  '.ts': 'source',
  '.tsx': 'source',
  '.mts': 'source',
  '.cts': 'source',
  '.js': 'source',
  '.jsx': 'source',
  '.mjs': 'source',
  '.cjs': 'source',
};

/**
 * Lightweight extension-based `AssetKind` guess for `openAsset`'s optional
 * `kind` argument. Deliberately independent of (not shared with) the
 * editor's own `AssetBrowser.tsx#getAssetKind` — that function is a private,
 * React-component-local helper of a package `@volter/editor-live` has no dependency
 * on. Callers with an unusual extension can always pass `kind` explicitly.
 */
export function inferAssetKind(path: string): AssetKind {
  // `.prefab.json` is retired (PRs #578/#581/#589) but the `'prefab'`
  // AssetKind itself remains in `@volter/editor-sdk` for view-link compatibility.
  if (path.endsWith('.prefab.json')) return 'prefab';
  const dot = path.lastIndexOf('.');
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : '';
  return EXTENSION_KIND[ext] ?? 'json';
}

export class LiveEditor {
  /** `#`-private, not `private`: `volter-model-editor eval --list` enumerates this object's
   *  real runtime members, and TypeScript's erased `private` would leave the
   *  raw `EditorClient` advertised beside them. */
  readonly #client: EditorClient;

  /**
   * The ACTIVE center document's own DOM: read it, click it, key it, paste
   * into it. The one door onto editor chrome that is not play-mode gated, and
   * deliberately scoped to that document alone —
   * `packages/editor/src/editor-document-probe.ts` carries the design and the
   * refusal contract. Screenshotting the same subject is
   * {@link LiveEditor.captureActiveDocument}, not a fifth verb here.
   */
  readonly document: LiveEditorDocument;

  constructor(client: EditorClient) {
    this.#client = client;
    this.document = new LiveEditorDocument(client);
  }

  /**
   * THE BLENDER LANE'S VERBS, from `volter-model-editor eval`.
   *
   * Blender runs headless in the editor tab's worker (ARCHITECTURE-CORE, "THE
   * BLENDER IN THE TAB IS BLENDER") and answers `blender-start`,
   * `blender-execute`, `blender-scene-info`, `blender-object-info`,
   * `blender-screenshot-view`, `blender-read-file`, `blender-write-file`,
   * `blender-list-files`, `blender-stop` and `blender-status`. They were
   * reachable from `@volter/editor-sdk` and through `vgai blender-mcp` but from
   * no GENERAL door, so driving a session meant writing an MCP client script
   * per question — the same discovery failure `eval-surface.ts`'s header
   * records, in a lane that had not noticed it yet.
   *
   *   volter-model-editor eval "await editor.blender('blender-execute', { code: 'import bpy; print(len(bpy.data.objects))' })"
   *
   * `blender-status` is the only verb that creates nothing: it answers whether
   * this tab already has a session without starting one.
   */
  async blender<T extends object = Record<string, unknown>>(
    type: `blender-${string}`,
    fields: Record<string, unknown> = {},
  ): Promise<T> {
    return this.#client.blender<T>(type, fields);
  }

  /**
   * The active authoring adapter's persistence destination — where a save would
   * land (`status().savePath`). A read only: a three root has no scene document
   * to open, and its root is activated instead.
   */
  async scene(): Promise<string | null> {
    const state = await this.#client.getState();
    return state.savePath;
  }

  /**
   * Make the connected human editor show the same subject/view as the agent.
   * The returned URL is a compact, shareable projection — not a serialized
   * workspace or document payload.
   */
  async present(view: EditorView): Promise<PresentedEditorView> {
    return this.#client.present(view);
  }

  /** The human editor's actual active document, selection, camera and utility. */
  async currentView(): Promise<EditorView> {
    return this.#client.currentView();
  }

  /**
   * Capture the same center document the human is currently looking at.
   *
   * A number is a SQUARE of that size — the default, and the right shape for
   * an unstaged look at a model. `{width, height}` asks for a shaped frame, so
   * a video-aspect look needs no crop afterwards. Both are bounded by the
   * relay budget (64-1024 per side, total no larger than a 1024 square); see
   * `@volter/editor-sdk`'s `CaptureDimensions`.
   * Supply a view to present and photograph it in one editor request.
   */
  async captureActiveDocument(
    size?: CaptureDimensions,
    view?: EditorView,
  ): Promise<ActiveDocumentCapture> {
    return this.#client.captureActiveDocument(size, view);
  }

  /**
   * Photograph the editor PAGE — every panel, tab strip and viewport as the
   * person sees it. `vgai screenshot editor` is this verb from the shell. The
   * one door for judging chrome sighted: a skin, a workspace arrangement or a
   * contributed panel is looked at through this, never guessed at from DOM
   * probes. The page at its own layout, `scale` output pixels per CSS pixel
   * (default `devicePixelRatio`) — a 1 px border or a glyph stroke is only
   * judgeable at the scale the reference it is compared against was captured
   * at, and the result reports its own `size` and `scale`.
   */
  async captureEditorChrome(options?: EditorChromeCaptureOptions): Promise<EditorChromeCapture> {
    return this.#client.captureEditorChrome(options);
  }

  /** `'all'` -> `EditorClient.selectAll()` (mirrors `vgai select --all`); otherwise `EditorClient.select(id)` (mirrors `vgai select <entityId>`). */
  async select(id: string | 'all'): Promise<void> {
    if (id === 'all') {
      await this.#client.selectAll();
      return;
    }
    await this.#client.select(id);
  }

  /** Mirrors `vgai deselect`. */
  async deselect(): Promise<void> {
    await this.#client.select(null);
  }

  /** No `id` -> focus the current selection (mirrors bare `vgai focus`); `id` given -> focus that entity. */
  async focus(id?: string): Promise<void> {
    if (id !== undefined) {
      await this.#client.focusEntity(id);
      return;
    }
    await this.#client.focusSelection();
  }

  /**
   * Frame the edit viewport camera on one entity. Same framing as
   * `focus(id)`, but an entity id the scene does not know THROWS, naming the
   * id — where `focus` quietly does nothing. Reach for this whenever the next
   * step reads the viewport (`screenshot()`, an
   * `assetPreview(..., { stage: 'scene' })`): a framing that silently missed
   * would otherwise be indistinguishable from one that worked.
   */
  async frame(entityId: string): Promise<void>;
  /**
   * Bare `frame()` frames the OPEN Object3D document's subject instead — its
   * selection if it has one, else the whole model: the toolbar's own Frame
   * button, reachable from a script. `fit` scales the fitted distance (1 is
   * that button's tight fit, 1.5 stands back a little for a shot).
   */
  async frame(options?: { readonly fit?: number }): Promise<void>;
  async frame(target?: string | { readonly fit?: number }): Promise<void> {
    if (typeof target === 'string') {
      await this.#client.frameEntity(target);
      return;
    }
    await this.#client.frameDocument(target?.fit);
  }

  /**
   * WATCH THE AGENT LOOK AROUND THE MODEL.
   *
   * Swings the open Object3D document's camera — the camera the human's tab is
   * showing — around the framed subject by `azimuth`/`elevation` RADIANS,
   * animated over `duration` seconds (default 0.6), and resolves when the move
   * ends. This is deliberately not a jump cut: the point of the verb is that a
   * person watching sees the agent walk around the thing it is working on.
   *
   * `await editor.orbit({ azimuth: Math.PI / 2 })` — a quarter turn to the right.
   *
   * There is ONE camera, and the human owns it: a drag during the move cancels
   * it exactly where it is, and the resolved outcome says `cancelledBy:
   * 'human'` rather than throwing. A second look verb supersedes the first.
   * The move is drawn by the document's own frame loop, so a document that
   * isn't being drawn (background tab, inactive panel) doesn't orbit.
   */
  async orbit(options: {
    /** RADIANS, relative to where the camera is now. `Math.PI / 2` is a
     *  quarter turn; degrees are not accepted and `90` is fourteen turns. */
    readonly azimuth?: number;
    /** RADIANS, relative to where the camera is now. */
    readonly elevation?: number;
    /** SECONDS the move takes (default 0.6). */
    readonly duration?: number;
  }): Promise<DocumentLookOutcome> {
    // AN UNKNOWN KEY IS REFUSED BY NAME. Every member here is optional, so a
    // misspelling — `yaw` for `azimuth`, `pitch` for `elevation` — used to
    // orbit by nothing at all while the outcome still reported a plausible
    // ABSOLUTE azimuth, which reads exactly like a move that happened
    // (measured 2026-09-21, and it cost a round). The keys and their unit are
    // in the refusal because that is the moment the caller needs them.
    const known = ['azimuth', 'elevation', 'duration'];
    const unknown = Object.keys(options ?? {}).filter((key) => !known.includes(key));
    if (unknown.length > 0)
      throw new Error(
        `editor.orbit: ${unknown.join(', ')} ${unknown.length === 1 ? 'is not a key' : 'are not keys'} ` +
          'this verb takes. It takes azimuth and elevation in RADIANS (relative to where the ' +
          'camera is now) and duration in SECONDS.',
      );
    return this.#client.orbitDocument(options);
  }

  /**
   * A slow full revolution of the open document's subject — {@link orbit} with
   * the turns spelled out and a constant angular rate. Resolves at the end of
   * the last revolution.
   */
  async turntable(options?: {
    readonly seconds?: number;
    readonly revolutions?: number;
  }): Promise<DocumentLookOutcome> {
    return this.#client.turntableDocument(options);
  }

  async view(preset: ViewPreset): Promise<void> {
    await this.#client.viewPreset(preset);
  }

  /**
   * Switch the editor's NAMED WORKSPACE — `await editor.workspace('model')`.
   *
   * A workspace is a task-named LAYOUT MEMORY over the one dock
   * (ARCHITECTURE-CORE §Editor chrome): `game` (the default, the editor's
   * standing arrangement), `model`, `sculpt`, `texture`, `animate`, `look`.
   * Switching is an EXPLICIT act — nothing in the editor moves chrome on its
   * own, opening a document included — and this is the session door to it,
   * beside `Window → Workspace` and the registered actions.
   *
   * Resolves once the dock has finished rebuilding, so a capture taken
   * immediately after photographs the arrangement that was asked for. Each
   * workspace remembers the user's own hand-tuning per project, so switching
   * away and back is lossless.
   */
  async workspace(id: EditorWorkspaceName): Promise<void> {
    await this.#client.setWorkspace(id);
  }

  /**
   * Apply a STYLE BUNDLE by id — the chrome's palette, material, icon set and
   * region defaults in one gesture, the session door beside
   * `View → <Style> Style`. A bundle the open project does not offer refuses
   * and names the vocabulary; `currentView().style` reports the one worn.
   */
  async style(id: string): Promise<void> {
    await this.#client.setStyle(id);
  }

  /**
   * A document stage's viewport PRESENTATION — its draw mode, lighting, backdrop and overlays
   * (`@volter/editor-sdk/kit/viewport-presentation`) — resolved. With `layer`, that choice is
   * recorded for the view first, as a person's toolbar change would be, e.g.
   * `presentation('model:src/models/cube.blend', { all: { lighting: { studioPreset: 'kit' } } })`.
   */
  async presentation(
    documentId: string,
    layer?: Parameters<EditorClient['viewportPresentation']>[1],
  ): ReturnType<EditorClient['viewportPresentation']> {
    return this.#client.viewportPresentation(documentId, layer);
  }

  /**
   * Set the MATERIAL apart from the bundle that usually carries it.
   * Appearance is palette × material, independent axes by ruling, so
   * `style()` alone can never say whether a cost belongs to the blur or to
   * the palette. This is the door that measures them apart; it answers with
   * what the chrome wears afterwards (`style` is `null` when the mix matches
   * no registered bundle).
   */
  async appearance(appearance: {
    readonly material?: string;
  }): Promise<{ material: string; style: string | null }> {
    return this.#client.setAppearance(appearance);
  }

  /** Focus an editor panel: a viewport tab, the console, the build surface, or
   *  any key the editor's static-panel registry holds — an unknown key refuses
   *  naming the ones it does. */
  async showPanel(name: PanelName): Promise<void> {
    switch (name) {
      case 'viewport-edit':
        await this.#client.showViewport('edit');
        return;
      case 'console':
        await this.#client.toggleConsole();
        return;
      default:
        // Every other name is the EDITOR's to resolve, against its live panel
        // registry. A list kept here could only ever be a copy going stale.
        await this.#client.showPanel(name);
        return;
    }
  }

  /** `kind` inferred from `path`'s extension when omitted (`inferAssetKind`) — pass it explicitly to override. */
  async openAsset(path: string, kind?: AssetKind): Promise<void> {
    await this.#client.openAsset(path, kind ?? inferAssetKind(path));
  }

  /**
   * SELECT a project asset — the browser's single click, which fills the
   * Inspector without opening a document. `openAsset` is the double click.
   *
   * This is how a project's own `asset.inspector` section is reached: select
   * the file it matches, then `inspect()` lists the verbs that section
   * declares and `runAction(id)` runs one. Selecting a path nothing matches
   * is not an error — the Inspector shows what it has, exactly as it does
   * for a human.
   */
  async selectAsset(path: string): Promise<void> {
    await this.#client.selectAsset(path);
  }

  /**
   * Captures the editor's native four-view preview. A bare string is a
   * project-relative asset path (the common case); an explicit source object
   * targets a path, a LIVE SCENE ENTITY (`assetPreview({ entityId }, …)`) —
   * which is what makes `options.stage: 'scene'`, the entity photographed
   * where it stands under the scene's own lighting, reachable from here — or
   * RAW GLB BYTES (`assetPreview({ glbBase64 }, …)`), for a model that exists
   * only in the calling Node process's memory and has never been written to
   * disk. `stage` defaults to `'lab'`, the neutral Asset Lab staging this has
   * always produced, and the bytes form is lab-only.
   */
  async assetPreview(
    source: string | AssetPreviewSource,
    options?: AssetPreviewOptions,
  ): Promise<AssetPreviewCapture> {
    return this.#client.captureAssetPreview(
      typeof source === 'string' ? { assetPath: source } : source,
      options,
    );
  }

  /**
   * The same subject photographed as a LABELED SHOT SET instead of the four
   * views — a caller-supplied definition of turntable yaws and bone-anchored
   * crops, rendered against the asset's own skeleton, with a contact sheet.
   * Every source {@link assetPreview} takes works here, GLB bytes included:
   * a shot set stages its own subject, so it needs no place to stand.
   *
   * Sole in-repo caller today: `project.bake.preview`'s `--orbit` lane.
   */
  async assetPreviewShots(
    source: string | AssetPreviewSource,
    definition: AssetPreviewShotSetDefinition,
    options?: AssetPreviewOptions,
  ): Promise<LabeledShotSetCapture> {
    return this.#client.captureShotSetPreview(
      typeof source === 'string' ? { assetPath: source } : source,
      definition,
      options,
    );
  }

  async grid(on: boolean): Promise<void> {
    await this.#client.setGrid(on);
  }

  async helpers(on: boolean): Promise<void> {
    await this.#client.setHelpers(on);
  }

  async stats(on: boolean): Promise<void> {
    await this.#client.setStats(on);
  }

  async shading(mode: ShadingMode): Promise<void> {
    await this.#client.setShadingMode(mode);
  }

  /**
   * READ the inspector, as data — the serialized inspection subject
   * (`editor.inspect()`; design: `docs/ARCHITECTURE-CORE.md` §Editor chrome,
   * "The Inspection Model"). This is the Figma-Inspect analog: whatever a
   * human would see in the inspector right now — the subject's identity, its
   * verbs, and every identified section in display order, with a `fields`
   * section's CURRENT VALUES at their scriptable `path`s.
   *
   * Reach for it whenever the next step depends on what an object actually
   * IS: `await editor.select(id)` then `await editor.inspect()` answers "what
   * properties does this thing have, and what are they set to" in one call,
   * against the same model the panel renders — no scene-graph reads, no
   * guessing at property names.
   *
   * When the inspector is showing NOTHING — nothing selected on a surface
   * with no empty-state subject of its own, which is most of them — the answer
   * is `{none: true}`, so "the human sees no inspector" and "the read failed"
   * are never the same value. A surface whose empty space IS a real thing (an
   * open Asset Lab document) still answers with that subject, and never with
   * another surface's.
   *
   * A `custom` section body is a named opaque: the editor renders it with
   * React, so the wire reports its identity rather than pretending to describe
   * its rendering — plus, when the section can say what it DISPLAYS, a `data`
   * payload in its own vocabulary (`transform` carries
   * `{position, rotation, scale}`, rotation in Euler XYZ degrees).
   */
  async inspect(): Promise<InspectedInspection> {
    return this.#client.inspect();
  }

  /** Run one verb listed by `inspect().quickActions`, through the same action
   * the human Inspector button invokes. */
  async runAction(actionId: string): Promise<InspectedInspection> {
    return this.#client.runInspectionAction(actionId);
  }

  /**
   * Run ONE command by id — the door to everything the command palette lists.
   *
   * ONE NAME (orchestrator ruling 2026-09-19). There were briefly TWO doors
   * onto the one view-verb table — this one and `editor.viewVerb(view, verb)`,
   * which addressed the same registry by its two halves. A second addressing
   * of one table is a second name for one thing, and an agent reading
   * `--list` had to choose between them with nothing to choose on. This door
   * stays because it is strictly wider: it addresses a COMMAND ID, so under
   * the frame it reaches everything the workbench knows — a `vgai.action.<id>`
   * editor action, one of VS Code's own — and not only a view. A VIEW is
   * reached by spelling its verb's command id:
   *
   *     await editor.command('vgai.blender-uv-view.state')
   *     await editor.command('vgai.blender-uv-view.zoom', { to: 600 })
   *
   *     await editor.command('vgai.blender-node-view.view-all')
   *     await editor.command('vgai.blender-node-view.look', { node: 'Principled BSDF' })
   *
   * Under the Code-OSS frame this is the workbench's own command service, so
   * any command id works — ours and VS Code's alike. Standalone `vgai edit`
   * has no command service and answers the `vgai.<view>.<verb>` shape off the
   * SAME verb table the frame's commands call, refusing any other id by name.
   * One table, two doors, exactly like the keymap's.
   *
   * Answers with whatever the command returned — a view verb's own state, or
   * `null` for a command that returns nothing.
   */
  async command(commandId: string, args?: unknown): Promise<unknown> {
    return this.#client.runCommand(commandId, args);
  }

  /**
   * RESTRUCTURE the authored tree — the hierarchy context menu's own verbs.
   *
   * `create`, `delete`, `duplicate`, `reparent`, `reorder`, `wrap`, `unwrap`,
   * `group`, `ungroup`, `copy`, `cut`, `paste`; `extractComponent` and
   * `forkComponent` are the two that write whole new files and have their own
   * doors below. All of them run the SAME `authoring/consumer-actions.ts`
   * helpers the menu items call, so there is one implementation of each op and
   * not a second that can disagree with what a human gets.
   *
   * It exists because the menu is a POINTER surface: every one of these ops was
   * reachable only by right-clicking a hierarchy row, which is nothing an agent
   * can do — so for an ingest root, whose only authoring surface IS the editor,
   * structure was closed entirely.
   *
   * `id`/`ids` default to the current selection. The answer carries the same
   * per-edit `write` ack `setField` does, so `write.persisted` tells a saved
   * restructure from a live-only one. An op the active adapter does not provide
   * REJECTS by name — never a silent no-op.
   */
  async structure(op: StructureOp, options?: StructureOpOptions): Promise<StructureOpResult> {
    return this.#client.structureOp(op, options ?? {});
  }

  /**
   * "Extract Component…" — lift the selected native subtree into its own
   * component file (plus a story) and replace the callsite with it.
   *
   * Answers the action's own sentence, which NAMES both new files, because
   * undo owns the callsite edit and will not remove them.
   */
  async extractComponent(options?: { id?: string; name?: string }): Promise<string> {
    return (await this.#client.extractComponent(options ?? {})).hint;
  }

  /**
   * "Fork Component…" — copy the selected instance's component definition to a
   * new file and retarget THIS CALLSITE at it.
   *
   * One callsite is the unit of the edit; when that callsite sits inside a
   * component rendered many times, every one of those renders now renders the
   * fork.
   */
  async forkComponent(options?: { id?: string }): Promise<string> {
    return (await this.#client.forkComponent(options ?? {})).hint;
  }

  /**
   * READ the hierarchy panel, as data — the rows a human is looking at right
   * now, nested exactly as the panel nests them.
   *
   * The companion to {@link inspect}: that one answers "what IS the selected
   * thing", this one answers "what does the tree LOOK LIKE". It is the panel's
   * own output, not a fresh walk of the scene — the adapter's tree after the
   * component marks fold implementation subtrees (bones, particle renderers,
   * instanced pools), after the internals reveal, the document promotion, the
   * child cap, the collapse state, the search filter and the selection scope.
   *
   * Works in play mode and edit mode; the answer says which (`playState`,
   * `activeViewportTab`), because the two are different adapters and a tree
   * that looks wrong is very often the wrong adapter's tree.
   *
   * Prefer this over `status().entities`, which is deliberately a different
   * question — the RAW adapter tree, unprojected. A panel that renders the
   * wrong rows looks perfectly healthy in that facet.
   *
   * Each row carries `childCount` (what its caret opens), `internalChildCount`
   * (what is folded behind "Reveal Internals") and `expandable` (whether the
   * panel draws a caret at all), so "this subtree exists but nothing in the UI
   * opens it" is a fact you can read rather than one you have to notice.
   *
   * Rejects, naming the panel, when no hierarchy panel is mounted — an empty
   * tree would be a fabricated answer about a surface nobody is being shown.
   */
  async hierarchy(): Promise<InspectedHierarchy> {
    return this.#client.hierarchy();
  }

  /** Expand every branch through the Hierarchy panel's own action. */
  async expandHierarchyAll(): Promise<void> {
    await this.#client.expandHierarchyAll();
  }

  /** Collapse every branch through the same panel action. Expanding is
   *  persisted per project, so without this the tree's REST STATE — what a
   *  person sees on opening the project — is unreachable once any reader has
   *  expanded it. */
  async collapseHierarchyAll(): Promise<void> {
    await this.#client.collapseHierarchyAll();
  }

  /**
   * Write one editable field from `inspect()` by its stable path, through the
   * same Inspector IO and persistence boundary the human control uses.
   *
   * The answer is `{ subject, write }`, and `write` is the half worth reading
   * first: a write with no persistence route open still succeeds — it lands on
   * the live object and journals live-only — so `write.persisted` is how you
   * tell a saved edit from one that will not survive the session, without
   * diffing the tree. `write.destination` is the adapter's own words for where
   * it went ("live-only (not saved)" is a destination, never silence).
   */
  async setField(path: string, value: unknown): Promise<InspectedFieldWrite> {
    return this.#client.setInspectionField(path, value);
  }

  /**
   * REMOVE one field's authored override — the revert arrow, as a command.
   *
   * Reach for this instead of `setField` whenever you are UNDOING an edit that
   * added a property the source did not carry: `setField` can only write a
   * value, so setting the default back leaves `position={[0, 0, 0]}` in the
   * file where there was nothing before. Only this door restores the bytes.
   *
   * The answer is the same `{ subject, write }` shape, awaited past the bytes.
   * It rejects with `code: 'REMOVAL_UNAVAILABLE'` when the field is not
   * declared removable or the lane has no removal door — which is a missing
   * seam to report, not a removal that failed.
   */
  async removeField(path: string): Promise<InspectedFieldWrite> {
    return this.#client.removeInspectionField(path);
  }

  /** Open a document by its adapter-declared id, through its registered owner. */
  async open(id: string): Promise<OpenedDocument> {
    return this.#client.open(id);
  }

  /** Undo / redo one project transaction, through the session's own history
   *  queue — the same one the keyboard shortcut drives. */
  async undo(): Promise<HistoryStep> {
    return this.#client.undo();
  }

  async redo(): Promise<HistoryStep> {
    return this.#client.redo();
  }

  /** Mirrors `vgai status` — the full live editor state as JSON. */
  async status(): Promise<EditorState> {
    return this.#client.getState();
  }

  /** A live viewport PNG (`EditorClient.captureViewport`) — no direct CLI verb exists; this is the closest wire read. */
  async screenshot(size?: number): Promise<ViewportCapture> {
    return this.#client.captureViewport(size);
  }
}
