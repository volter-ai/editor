/**
 * The editor tab's Blender session and the control-channel doors onto it —
 * Blender's EDITOR half, in `@volter/editor-blender` (WORK.md §Skews as packages under
 * the Code-OSS frame, item 6). Its thirteen verbs are
 * `../contributions/blender.command.ts`, a `workspace.command` contribution;
 * what it needs of the running editor it asks THROUGH THE DOOR,
 * `@volter/editor-sdk/host` — the document context it
 * presents into, the session it lives and dies with. It imports no host module
 * (WORKBENCH.md §The invariants, "Direction": a package imports only the SDK
 * and other packages' exports), which is what lets this lane ship against a
 * workbench it was not built in.
 *
 * `volter blender-mcp` is transport only: every `execute_blender_code`,
 * `get_scene_info`, `get_object_info` and `get_viewport_screenshot` arrives
 * here as a `blender-*` command and is answered by Blender running in this
 * tab's worker (`@volter/blender-engine/browser`). The model exists in that worker
 * and nowhere else; the Model document (`document:blender:runtime`, the
 * project's `blender-runtime` contribution) only displays the frames the
 * worker presents. A screenshot is the tab photographing that document
 * through `capture-active-document`, after `blender-screenshot-view` has
 * presented the model with the viewport's own camera.
 *
 * A RENDER photographs a detached revision through its own camera. three.js is
 * the renderer (ARCHITECTURE-CORE, "No second implementation of a substrate
 * capability ships"), so `bpy.ops.render.render()` arrives here as a present
 * whose capture carries the SCENE camera and `scene.render`'s resolution, and
 * the PNG goes straight back to the operator that asked — the one case where
 * presenting answers with pixels instead of remembering a view.
 */

import {
  BlenderRuntime,
  type CaptureRequest,
  type PresentAnswer,
} from '@volter/blender-engine/browser';
import type { RenderRequest } from '@volter/blender-engine/browser/protocol';
import type {
  BlenderActionClip,
  BlenderNodeTree,
  BlenderOutlinerTree,
  BlenderOutlinerWrite,
  BlenderRig,
  BlenderRnaContext,
  BlenderRnaView,
  BlenderRnaWrite,
  BlenderUvLayout,
} from '@volter/blender-engine/browser/rna';
import { createBlenderDisplayTransform, blenderDisplaySettingsForRender } from '@volter/blender-engine/browser/three/blender-display-transform';
import type { BlenderRuntimeView } from '@volter/blender-engine/browser/three/blender-runtime-view';
import type { EditorCommandResult } from '@volter/editor-sdk/commands';
import { editorHost } from '@volter/editor-sdk/host';
import { invokeViewVerb, type ViewVerbContribution } from '@volter/editor-sdk/views';
import {
  captureSceneImage,
  captureSceneLinear,
  resolveSceneLinearDisplay,
  type LinearCaptureFrame,
} from '@volter/editor-threejs/capture/scene';
import { fitClipPlanes } from '@volter/editor-threejs/viewport/clip-planes';
import { contentWorldBounds } from '@volter/editor-threejs/viewport/content-bounds';
import * as THREE from 'three';
import { blenderEngineSelection, refreshBlenderOutliner } from '../contributions/blender-outliner-model';
import {
  type NodeViewState,
  nodeViewState,
  refuseNodeViewGesture,
  requestNodeViewAll,
  setNodeViewState,
} from '../src/node-view-state';

/** Raw bytes of a base64 payload, as the half-float words a linear frame is. */
function halfFloatFrame(base64: string): Uint16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
}

/** Resolve a scene-linear frame through Blender's pinned display transform.
 *
 *  The frame is the session's own capture, or — for a COMPOSITED render — the
 *  one `linearInput` carries, because the compositor's output is scene-referred
 *  and the view transform runs over it, exactly as `pipeline.cc` orders the two.
 */
async function displayPhotograph(
  linearFrame: LinearCaptureFrame | null,
  render: {
    width: number;
    height: number;
    exposure: number;
    toneMapping: RenderRequest['toneMapping'];
    look?: string;
    gamma?: number;
    linear?: boolean;
    transparent?: boolean;
    linearInput?: { base64: string; width: number; height: number };
  },
): Promise<{ base64: string; mimeType: string }> {
  const provided = render.linearInput;
  const linear = provided
    ? {
        pixels: halfFloatFrame(provided.base64),
        width: provided.width,
        height: provided.height,
      }
    : linearFrame;
  if (!linear) throw new Error('Blender display transform requires a linear capture');
  const { pixels, width, height } = linear;
  const transform = await createBlenderDisplayTransform(blenderDisplaySettingsForRender(render));
  let bytes: Uint8Array;
  try { bytes = resolveSceneLinearDisplay(linear, transform); }
  finally { transform.dispose(); }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Blender display transform could not create its image canvas');
  const image = context.createImageData(width, height);
  // GL reads bottom-up; a PNG wants the first row first.
  const stride = width * 4;
  for (let y = 0; y < height; y++) {
    const source = (height - 1 - y) * stride;
    image.data.set(bytes.subarray(source, source + stride), y * stride);
  }
  context.putImageData(image, 0, 0);
  const dataUrl = canvas.toDataURL('image/png');
  const answer: {
    base64: string;
    mimeType: string;
    linearBase64?: string;
    linearWidth?: number;
    linearHeight?: number;
  } = { base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType: 'image/png' };
  // THE SCENE-REFERRED FRAME RIDES ALONG when the caller asked for it, which is
  // what an EXR is written from. It is the SAME capture, not a second render:
  // a file promising scene radiance must hold the values the scene had, and
  // these are the only ones that ever existed.
  if (render.linear === true) {
    const raw = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    let binary = '';
    for (let i = 0; i < raw.length; i += 0x8000)
      binary += String.fromCharCode(...raw.subarray(i, i + 0x8000));
    answer.linearBase64 = btoa(binary);
    answer.linearWidth = width;
    answer.linearHeight = height;
  }
  return answer;
}

/**
 * THE PHOTOGRAPH ITSELF: a prepared snapshot, through `renderCamera`, resolved by the scene's own
 * view transform. `assertCurrent` throws when the caller's snapshot went stale while the
 * lighting was prepared.
 */
export async function photographSnapshot(
  scene: THREE.Scene,
  renderCamera: THREE.Camera,
  snapshot: ReturnType<BlenderRuntimeView['captureSnapshot']>,
  render: RenderRequest,
  assertCurrent: () => void = () => {},
): Promise<{ base64: string; mimeType: string }> {
  await snapshot.prepare(renderCamera);
  assertCurrent();
  const captureOptions = {
    effect: snapshot.effect,
    width: render.width,
    height: render.height,
    transparent: render.transparent === true,
    toneMapping: THREE.NoToneMapping,
    exposure: 1,
  };
  if (render.linear === true) {
    const display = await displayPhotograph(captureSceneLinear(scene, renderCamera, captureOptions), render);
    assertCurrent();
    return display;
  }
  const transform = await createBlenderDisplayTransform(blenderDisplaySettingsForRender(render));
  try {
    assertCurrent();
    const dataUrl = captureSceneImage(scene, renderCamera, {...captureOptions, displayTransform: transform});
    return {base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType: 'image/png'};
  } finally { transform.dispose(); }
}

export const BLENDER_RUNTIME_DOCUMENT_ID = 'document:blender:runtime';

/**
 * THE MODEL DOCUMENT THIS TAB IS PRESENTING INTO, and the `.blend` it opened.
 *
 * A `model` entry's document is bound to the project's own `.blend`
 * (`models.finder.ts` lists them; `blender-runtime.document.tsx` opens the one
 * its entry names), so the presenter's address is no longer a constant. A
 * project with no `.blend` of its own still gets ONE Model document at the
 * standing `blender:runtime` address — that is what `blender-start` presents
 * into and what the battery photographs — and then this stays null and every
 * read falls back to the constant above.
 *
 * It is a module variable rather than a host door because both sides are THIS
 * package: the document that binds it and the session that reads it ship
 * together, so there is nothing for the SDK to carry.
 */
export interface ModelDocumentBinding {
  readonly documentId: string;
  readonly entryId: string;
  readonly blend: string;
}

let boundModel: ModelDocumentBinding | null = null;
let modelBindingGeneration = 0;

/** Bind the mounted Model document; the returned cleanup releases only this
 * binding. `null` names the standing Model without a file entry. */
export function bindModelDocument(bound: ModelDocumentBinding | null): () => void {
  const generation = ++modelBindingGeneration;
  boundModel = bound;
  noteBlenderRnaChanged();
  return () => {
    // An old pane's asynchronous cleanup must not unbind its replacement.
    if (modelBindingGeneration !== generation) return;
    boundModel = null;
    noteBlenderRnaChanged();
  };
}

/** The `.blend` the editor is showing as the Model: the active tab's own file, or the bound one.
 * The finder owns model:<path>, wrapped by the host as document:<entry>. Read the active address
 * too: activation precedes the contributed pane's effect, so an immediate command must not slip
 * through that binding gap. */
function shownModelBlend(): string | undefined {
  const activeId = editorHost().documents.activeId();
  return activeId?.startsWith('document:model:')
    ? activeId.slice('document:model:'.length)
    : boundModel?.blend;
}

/**
 * A script's Save As into a project `.blend` that no Model document lists (`followMovedDocument`): Blender edits
 * that file and saves there, and the tab it left (`from`) keeps showing Blender, since there is no tab to move to.
 * Without this, every later call was refused as a conflict naming a file no tab can show.
 */
let unlistedFollow: { readonly owner: BlenderRuntime; readonly from: string; readonly document: string } | null = null;

function modelDocumentConflict(): string | null {
  const held = runtime?.document;
  const requested = shownModelBlend();
  if (!requested || !held || requested === held) return null;
  if (unlistedFollow !== null && unlistedFollow.owner === runtime && unlistedFollow.document === held && unlistedFollow.from === requested) return null;
  // Say how to get Blender onto the document the editor shows, not only how to go back: an agent told
  // just "return to <held>" took it as the Blender door being unusable and built its level by
  // another route (2026-10-06, the WSL obby run).
  // Plain words: people see this in error notices too. Re-opening the document already showing does not
  // remount a failed open (blender-runtime.document.tsx), so the steps that do are named instead.
  return `Blender is editing ${held}, but the editor is showing ${requested}, which Blender has not loaded. ` +
    `Wait for ${requested} to finish opening and retry. If it stays, switch to another document and back, ` +
    `or reload the page; or return to ${held}.`;
}

/** The document id a present must reach: the open Model document's, or the
 *  standing address. */
function presentationDocumentId(): string {
  return boundModel?.documentId ?? BLENDER_RUNTIME_DOCUMENT_ID;
}

/** The same id, for this package's own Properties sections: they read the
 *  published `BlenderRuntimeView` through `documents.context` exactly as the
 *  presenter does, so both sides name the document one way. */
export function blenderPresentationDocumentId(): string {
  return presentationDocumentId();
}

/** The selected pane may load while a utility area (Timeline, for example)
 * has keyboard focus. Another model remains an ownership barrier. */
export function modelDocumentMayOpen(binding: ModelDocumentBinding): boolean {
  if (boundModel !== binding) return false;
  const active = editorHost().documents.activeId();
  const anotherModel = active?.startsWith('document:model:') || active === BLENDER_RUNTIME_DOCUMENT_ID;
  return !anotherModel || active === binding.documentId;
}

/** A retained photograph must belong to the file and revision still on screen,
 * not a retiring pane or the next worker's first frame. */
export function modelDocumentOwnsPresentation(
  documentId: string,
  entryId: string,
  blend: string | undefined,
  presented: { readonly session: string; readonly revision: number } | null,
): boolean {
  const binding = boundModel;
  const latest = runtime?.presented;
  return editorHost().session.open() && !!binding && binding.documentId === documentId && binding.entryId === entryId &&
    binding.blend === blend && modelDocumentMayOpen(binding) &&
    runtime?.project === editorHost().projectLocalState.projectRootPath() && runtime.document === blend &&
    !!presented && !!latest && presented.session === latest.session && presented.revision === latest.revision;
}

/**
 * OPEN A `.blend` IN THE ENGINE — the Model document's own call, the WS-F save
 * path run backwards. `session.py` opens the named file at start and saves
 * back to it, so naming it here IS opening it.
 *
 * The worker owns one file. Validate ownership before publishing a context;
 * a refused open must never expose the previous model under a new tab's
 * identity. Boot itself can present, so the context must exist before awaiting
 * boot completion. Return false when the requesting pane has since unmounted.
 */
let modelOpenTail: Promise<void> = Promise.resolve();
let modelStartup: { readonly session: BlenderRuntime; readonly project: string; readonly blend: string } | null = null;

function queueModelLifecycle<T>(operation: () => Promise<T>): Promise<T> {
  const result = modelOpenTail.then(operation);
  modelOpenTail = result.then(() => {}, () => {});
  return result;
}

export async function openModelDocumentBlend(
  binding: ModelDocumentBinding,
  publish: () => void,
): Promise<boolean> {
  let published = false;
  const publishOnce = () => {
    if (published) return;
    publish();
    published = true;
  };
  const host = editorHost();
  const starting = modelStartup;
  // A native workspace restore can remount this pane before boot's first
  // frame. Its predecessor has unpublished, but still owns the queued boot:
  // waiting behind it before publishing would make boot wait on itself.
  // Only the SAME starting resource can restore its presenter here. Another
  // file still waits for the old worker's save/retirement in the queue.
  if (starting && starting.session === runtime && host.session.open() &&
      starting.project === host.projectLocalState.projectRootPath() &&
      starting.blend === binding.blend && modelDocumentMayOpen(binding)) {
    publishOnce();
  }
  // Only one handoff may own stop/start. Re-check the mounted requester after
  // every wait: a rapid B -> C selection must not let B publish into C.
  return queueModelLifecycle(() => openBoundModelDocument(binding, publishOnce));
}

async function openBoundModelDocument(
  binding: ModelDocumentBinding,
  publish: () => void,
): Promise<boolean> {
  const host = editorHost();
  if (!host.session.open()) throw new Error('Opening a model requires an open project session.');
  const project = host.projectLocalState.projectRootPath();
  if (project === null) throw new Error('Opening a model requires a project path.');
  if (!modelDocumentMayOpen(binding)) return false;
  const previous = runtime;
  if (previous && (previous.project !== project || previous.document !== binding.blend)) {
    // stop drains accepted work and flushes the OLD worker's bound file. If
    // saving fails it stays alive; neither its history nor its ownership moves.
    const end = beginBlenderWork('saving previous model before opening another');
    try { await previous.stop(); } finally { end(); }
    if (runtime === previous) terminateBlenderRuntime();
    if (!host.session.open() || !modelDocumentMayOpen(binding)) return false;
  }
  const session = blenderRuntime();
  // start claims its resource synchronously; its first frame may arrive before
  // the returned promise resolves. The getter above rejects a conflicting file.
  const started = session.start(project, binding.blend);
  const starting = { session, project, blend: binding.blend };
  modelStartup = starting;
  try {
    publish();
    await started;
  } finally {
    if (modelStartup === starting) modelStartup = null;
  }
  if (!host.session.open() || !modelDocumentMayOpen(binding)) return false;
  // bind_document presents the opened file before start resolves. Do not
  // immediately evaluate/export it again: on Stoneguard that redundant RPC
  // took 13.8 seconds after the resumable startup had already finished.
  // A reopened pane has a NEW view, though, and an absent file presents
  // nothing at start. Compare the view's actual holding with the runtime's
  // revision so both cases still request the frame they need.
  const shown = (await runtimeView()).snapshot();
  if (!host.session.open() || !modelDocumentMayOpen(binding)) return false;
  const latest = session.presented;
  if (!shown || !latest || shown.session !== latest.session || shown.revision !== latest.revision) {
    await session.present();
  }
  return host.session.open() && modelDocumentMayOpen(binding);
}

/**
 * THE RNA DOOR, IN-PAGE. The Properties sections
 * (`../contributions/blender-properties-*`) call these three rather than the
 * `blender-rna*` commands: same session, same `session.py` functions, one
 * fewer hop, and no `EditorCommandResult` envelope to unwrap in a render.
 * The COMMANDS remain the wire's door onto the same calls, so a `cyclotron eval`
 * and the panel read one thing.
 *
 * THEY NEVER START THE ENGINE. A panel asking what the engine holds must not
 * be the reason a 880 MB Blender boots, so these answer `null` when this tab
 * has no started session — exactly the read `blender-status` makes, and for
 * the same reason.
 */
export function blenderSessionStarted(): boolean {
  return runtime?.project != null && modelDocumentConflict() === null;
}

/**
 * THE DOCUMENT'S RNA VERSION — "a tree's freshness is the tree's, not the
 * presented frame's" (orchestrator ruling 3, 2026-09-19, WORK.md §Blender in
 * the tab is Blender, I5).
 *
 * Every view over this engine draws something RNA answers, and until this
 * existed the only "the engine moved" signal in the page was a PRESENTED
 * FRAME: `blender-properties-model.ts` subscribes to the Model document's
 * frames, and its version was what the node view re-read on. MEASURED
 * 2026-09-19 by I5's socket-panel step: collapsing a panel through
 * `blender-rna-set` changes `Node.panel_states[n].is_collapsed`, which changes
 * nothing the presenter draws — so no frame ships, no version moves, and the
 * node view kept drawing the old tree until the document was reopened. It is
 * the same shape as I3's "a present is not a reliable signal for a column"
 * (`hide_render`), and the answer is the same: the WRITE asks for the re-read.
 *
 * So the version is minted HERE, at the door every RNA write goes through,
 * and it is bumped by the write rather than by the picture. Both halves of
 * each door bump it once: the in-page function is what the wire's
 * `blender-rna-set` / `blender-outliner-set` case calls, so a `cyclotron eval` and
 * a panel click are one path. `blender-execute` bumps it too — arbitrary bpy
 * can change anything RNA answers, and a view that went stale under a probe's
 * own script would be the same defect one layer out.
 *
 * WHAT SUBSCRIBES: `blender-properties-model.ts` (which invalidates its cached
 * datablock views and re-reads the context, exactly as it does on a frame),
 * and every view in `@volter/editor-blender/contributions` that draws RNA.
 */
let rnaVersion = 0;
const rnaListeners = new Set<() => void>();

export function blenderRnaVersion(): number {
  return rnaVersion;
}

export function subscribeBlenderRna(listener: () => void): () => void {
  rnaListeners.add(listener);
  return () => {
    rnaListeners.delete(listener);
  };
}

/** The engine's RNA moved. Called by the write doors below, and by the
 *  properties model when a PRESENTED FRAME says the engine ran — one version
 *  for both, because a view cannot tell the two apart and should not have to. */
export function noteBlenderRnaChanged(): void {
  rnaVersion += 1;
  for (const listener of [...rnaListeners]) listener();
}

export async function blenderRna(path: string, names?: number): Promise<BlenderRnaView | null> {
  if (!blenderSessionStarted()) return null;
  return blenderRuntime().rna(path, names);
}

export async function blenderRnaContext(
  object?: string,
  collection?: string,
): Promise<BlenderRnaContext | null> {
  if (!blenderSessionStarted()) return null;
  return blenderRuntime().rnaContext(object, collection);
}

export async function blenderRnaSet(
  path: string,
  property: string,
  value: unknown,
  index?: number,
  history = true,
): Promise<BlenderRnaWrite | null> {
  if (!blenderSessionStarted()) return null;
  const written = await blenderRuntime().rnaSet(path, property, value, index, history);
  noteBlenderRnaChanged();
  return written;
}

/** Keep a person's shading pick in the file's own 3D View (`runtime.viewShading`). */
export async function blenderViewShading(shading: 'WIREFRAME' | 'SOLID' | 'MATERIAL' | 'RENDERED'): Promise<void> {
  if (!blenderSessionStarted()) return;
  await blenderRuntime().viewShading(shading);
}

/**
 * THE SCRIPT DOOR, in-page — one bpy script, run the way the MCP add-on runs
 * one (`session.py::execute`: a namespace of its own, output captured, and a
 * PRESENT after it, so the picture that comes back is the engine's own
 * reading).
 *
 * This is what an OPERATOR goes through. The Outliner's structural verbs —
 * add, delete, duplicate — are `bpy.ops.*` calls and nothing else: Blender
 * runs the operator and we only name it (`blender-outliner-authoring.ts`'s
 * `StructureProvider`). Writing a second implementation of `object.delete`'s
 * unparenting, or of `primitive_uv_sphere_add`'s defaults, is the thing this
 * door exists to make unnecessary.
 *
 * SAME SHAPE AS {@link blenderRnaSet}, and for its reason: the RNA version is
 * minted at the door, so the wire's `blender-execute` case calls THIS rather
 * than `session.execute` beside it — arbitrary bpy can change anything RNA
 * answers, and a view left drawing the tree it had is the defect the version
 * exists for. Like every door here it never starts the engine.
 *
 * The answer is `session.py::execute`'s own record — `executed`, the captured
 * `result` text, and `error` when the script raised. A REFUSAL IS NOT A THROW:
 * Blender's traceback comes back in `error`, verbatim, and a caller that wants
 * it to be an exception raises its own (the structure provider does, so the
 * ack it hands the shell carries Blender's sentence).
 *
 * IT DOES NOT GUARD ON `blenderSessionStarted()`, and that is the one way it
 * differs from the read doors above. They are called from a panel's render and
 * must answer "nothing to show" rather than spawn a session; a script is always
 * a deliberate act, and the engine's own refusal — "The Blender session has not
 * been started with a project (blender-start)" — is the honest answer to one
 * made too early. A silent `null` there would have turned the wire's own loud
 * refusal into an empty result.
 *
 * WHAT THE SESSION ACTUALLY ANSWERS WITH IS THE MCP DOOR'S TEXT, not
 * `session.py::execute`'s `{executed, result, error}` record: the worker
 * flattens it into ONE STRING on the way out — `Code executed successfully:
 * <stdout>` or `Error executing code: <traceback>` (`worker.ts:250-260`, "a
 * script's failure is TEXT, not a rejection"), because that is what the MCP
 * tool returns to an agent. So this parses it, once, here. MEASURED 2026-09-21:
 * a first version read `answer.executed`/`answer.error` off the string, where
 * both are `undefined` — every operator RAN and every caller was told it had
 * failed, which is how an added sphere reached `bpy.data.objects` and the
 * Outliner and was never selected. `sessionDocumentPath` below parses the same
 * two prefixes and records the same lesson from its own bug; this is the
 * second time, so the parse lives at the door now and both read it.
 */
export async function blenderExecute(code: string, history = true, label = 'Blender Python'): Promise<BlenderExecuteAnswer> {
  const session = blenderRuntime();
  const text = await session.execute(code, history, label);
  // Before the caller hears back: its next call must find the tab on the file Blender now holds.
  await followMovedDocument(session);
  noteBlenderRnaChanged();
  const failed = /^Error executing code:/.exec(text);
  return {
    text,
    executed: failed === null,
    result: failed === null ? text.replace(/^Code executed successfully: ?/, '') : '',
    error: failed === null ? null : text.replace(/^Error executing code: ?/, ''),
  };
}

/**
 * A Save As the worker reported (`BlenderRuntimeOptions.documentMoved`) that the open Model tab
 * has not followed yet. Taken by the {@link blenderExecute} whose script moved it, once that
 * call's own save has landed the new file in the project.
 */
let unfollowedMove: { readonly owner: BlenderRuntime; readonly from: string; readonly document: string } | null = null;

/**
 * THE MODEL TAB FOLLOWS BLENDER'S SAVE AS. The runtime already holds the new file and its saves
 * go there (`session.py::follow_open_file`); what is left is the tab. Until it moves, the editor
 * is showing the old file while Blender edits the new one, which `modelDocumentConflict` refuses
 * on every later call. So the new file's own Model document is opened: it binds to the session
 * that already holds that file (no stop, no reload), and the old tab, no longer active, releases
 * its binding. Re-activating the old tab later opens the old file the ordinary way.
 *
 * Only a tab that was showing the old file (or the standing Model of a project that had no
 * `.blend`) is moved; a person who has since switched elsewhere is not pulled back. A new file
 * no Model document lists (outside the project's model finder) is said, not guessed at.
 */
async function followMovedDocument(owner: BlenderRuntime): Promise<void> {
  const move = unfollowedMove;
  if (!move || move.owner !== owner) return;
  unfollowedMove = null;
  const host = editorHost();
  // The tab showing Blender: the file Blender left, or, after an earlier Save As to an unlisted file, the tab
  // that one left.
  const shownFrom = unlistedFollow !== null && unlistedFollow.owner === owner && unlistedFollow.document === move.from ? unlistedFollow.from : move.from;
  unlistedFollow = null;
  const stillShowingOld = () => {
    if (runtime !== owner || owner.document !== move.document) return false;
    const shown = shownModelBlend();
    return shown === shownFrom || (shown === undefined && host.documents.activeId() === BLENDER_RUNTIME_DOCUMENT_ID);
  };
  if (!stillShowingOld()) return;
  try {
    // The table re-reads the project's files, which now include the file this call saved.
    const table = await host.project.documentTable();
    const entry = table.entries.find(candidate => candidate.kind === 'model' && candidate.source?.path === move.document);
    if (!entry) {
      if (!stillShowingOld()) return;
      unlistedFollow = { owner, from: shownFrom, document: move.document };
      host.console.warn(
        `Blender now has ${move.document} open and the model saves there. No Model document lists that file ` +
          `(the project's model finder does not include its folder), so the ${shownFrom} tab keeps showing ` +
          `Blender, which now edits ${move.document}; ${shownFrom} keeps what it last saved. Save the model ` +
          `under src/models/ to give it a Model tab of its own.`,
        'blender-document',
      );
      return;
    }
    if (!stillShowingOld()) return;
    if (!await host.workspace.open({ kind: 'document', id: entry.id })) {
      keepShowing();
      host.console.warn(`Blender now has ${move.document} open, but its Model document ${entry.id} did not open; the ${shownFrom} tab keeps showing Blender, which edits ${move.document}.`, 'blender-document');
    }
  } catch (error) {
    keepShowing();
    host.console.error(`The Model tab could not follow Blender to ${move.document}: ${error instanceof Error ? error.message : String(error)}`, 'blender-document');
  }
  /** A tab that could not move keeps working on the file Blender holds, as for an unlisted file. */
  function keepShowing(): void {
    if (stillShowingOld()) unlistedFollow = { owner, from: shownFrom, document: move!.document };
  }
}

/** Coalesce a human gesture; Blender retains the states, Code-OSS the ordering. */
export function beginBlenderGesture(): void {
  void blenderRuntime().historyGesture('history-begin').catch(error =>
    editorHost().console.error(`Could not begin Blender undo gesture: ${String(error)}`, 'blender-history'));
}

export async function endBlenderGesture(): Promise<void> {
  await blenderRuntime().historyGesture('history-end');
}

/** One script's answer, with the MCP door's text split from what it means.
 *  `text` is what the wire and an MCP client get, verbatim; the other three are
 *  what a UI caller needs, and the `error` half is the one it must not drop. */
export interface BlenderExecuteAnswer {
  /** The door's own line, as `worker.ts` composed it. */
  readonly text: string;
  readonly executed: boolean;
  /** The script's captured stdout, with the success prefix removed. */
  readonly result: string;
  /** Blender's own traceback line, or null. */
  readonly error: string | null;
}

/** THE TREE DOOR, in-page — Blender's View Layer tree, which the Model
 *  document's hierarchy provider draws (`../contributions/blender-outliner-*`).
 *  Same rule as the three above: it never starts the engine. */
export async function blenderOutliner(
  selected?: readonly string[],
): Promise<BlenderOutlinerTree | null> {
  if (!blenderSessionStarted()) return null;
  return blenderRuntime().outliner(selected);
}

/** THE NODE-TREE DOOR, in-page — one material's shader node tree, which the
 *  Shading workspace's node view draws (`../contributions/blender-node-*`).
 *  Same rule as the doors above: it never starts the engine. */
export async function blenderNodeTree(options?: {
  path?: string;
  material?: string;
}): Promise<BlenderNodeTree | null> {
  if (!blenderSessionStarted()) return null;
  return blenderRuntime().nodeTree(options);
}

/** THE UV DOOR, in-page — one mesh's UV layout, which the UV Editing
 *  workspace's view draws (`../contributions/blender-uv-*`). Same rule as the
 *  doors above: it never starts the engine. */
export async function blenderUvLayout(options?: {
  object?: string;
  uvLayer?: string;
}): Promise<BlenderUvLayout | null> {
  if (!blenderSessionStarted()) return null;
  return blenderRuntime().uvLayout(options);
}

/** THE RIG DOOR, in-page — one mesh's skin binding, which the presenter turns
 *  into a `THREE.SkinnedMesh` (`../contributions/blender-runtime-skin.ts`).
 *  WE VISUALIZE WITH THREE.JS, NOT BLENDER (owner rule, 2026-09-20): this is
 *  called once per rig, never per played frame. Same rule as the doors above:
 *  it never starts the engine. */
export async function blenderRig(options?: { object?: string }): Promise<BlenderRig | null> {
  if (!blenderSessionStarted()) return null;
  return blenderRuntime().rig(options);
}

/** THE CLIP DOOR, in-page — one action as three.js keyframe tracks plus the
 *  scene's frame range and the Timeline's summary columns. Called when the
 *  action's own revision moves, never per played frame. */
export async function blenderActionClip(options?: {
  object?: string;
  bake?: boolean;
}): Promise<BlenderActionClip | null> {
  if (!blenderSessionStarted()) return null;
  return blenderRuntime().actionClip(options);
}

export async function blenderOutlinerSet(
  path: string,
  column: string,
  value: boolean,
): Promise<BlenderOutlinerWrite | null> {
  if (!blenderSessionStarted()) return null;
  const written = await blenderRuntime().outlinerSet(path, column, value);
  noteBlenderRnaChanged();
  return written;
}

/**
 * THE NODE EDITOR'S VERBS, published ONCE and reached two ways (U8's ruling 1,
 * 2026-09-19). Under the Code-OSS frame each is a `volter.blender-node-view.<verb>`
 * command the bridge dispatches into the view; standalone `cyclotron edit`, which has
 * no command service, reaches the SAME table through the session's
 * `blender-node-view` verb below. One table, two doors — the shape
 * `key-actions.ts`'s action table already has, and the reason the next
 * three read-only editors (UV Editing, Animation, Texture Paint) add NO session
 * verb of their own: they register here instead.
 *
 * `state` reads it; `look` follows a node with the N-panel (`node`, null to look
 * at none); `view-all` is Blender's Home; `zoom` takes tree units per CSS px;
 * `pan` takes the tree-space point at the view's centre (`cx`/`cy`). Every
 * EDITING gesture is present and REFUSED by name with the same sentence the
 * pointer handlers give, so the read-only ruling is provable from the product
 * rather than merely implemented.
 */
export const NODE_VIEW_VERBS: ViewVerbContribution = {
  view: 'blender-node-view',
  title: 'Node Editor',
  verbs: (
    [
      ['state', undefined],
      ['look', undefined],
      ['view-all', 'Node Editor: Frame All'],
      ['zoom', undefined],
      ['pan', undefined],
      ['move', undefined],
      ['link', undefined],
      ['set-value', undefined],
      ['use-nodes', undefined],
      ['collapse-panel', undefined],
    ] as const
  ).map(([id, title]) => ({
    id,
    ...(title ? { title } : {}),
    run: (args?: Record<string, unknown>) =>
      driveNodeView({ type: 'blender-node-view', ...args, action: id }),
  })),
};

/**
 * `blender-node-view` — the node editor's actions and its state, as one verb.
 *
 * `action` is `state` (the default — read it), `look` (`node`: which node the
 * N-panel follows, null to look at none), `view-all` (Blender's Home), `zoom`
 * (`zoom`: tree units per CSS px) or `pan` (`cx`/`cy`: the tree-space point at
 * the view's centre). Anything else is refused BY NAME, and a gesture that
 * would EDIT is refused with the same sentence the pointer handlers give.
 */
function driveNodeView(cmd: { type: string; [key: string]: unknown }): NodeViewState {
  const action = typeof cmd['action'] === 'string' ? cmd['action'] : 'state';
  switch (action) {
    case 'state':
      break;
    case 'look':
      setNodeViewState({
        looked: typeof cmd['node'] === 'string' ? cmd['node'] : null,
        refusal: null,
      });
      break;
    case 'view-all':
      requestNodeViewAll();
      // Framing clears a refusal the way every other non-editing action does.
      // Measured live 2026-09-19: without this, a refusal outlived the gesture
      // that raised it and the status line still carried it three actions
      // later.
      setNodeViewState({ refusal: null });
      break;
    case 'zoom': {
      const zoom = typeof cmd['zoom'] === 'number' ? cmd['zoom'] : 1;
      setNodeViewState({ transform: { ...nodeViewState().transform, zoom }, refusal: null });
      break;
    }
    case 'pan': {
      const current = nodeViewState().transform;
      setNodeViewState({
        transform: {
          ...current,
          cx: typeof cmd['cx'] === 'number' ? cmd['cx'] : current.cx,
          cy: typeof cmd['cy'] === 'number' ? cmd['cy'] : current.cy,
        },
        refusal: null,
      });
      break;
    }
    // EVERY EDITING GESTURE, ANSWERED BY NAME. These are the same four
    // refusals the pointer handlers raise, reachable from the session so the
    // ruling is provable rather than merely implemented.
    case 'move':
      refuseNodeViewGesture(
        `Moving "${String(cmd['node'] ?? 'a node')}" writes Node.location — editing parity is not the program.`,
      );
      break;
    case 'link':
      refuseNodeViewGesture(
        'Dragging between sockets would make a link — editing parity is not the program.',
      );
      break;
    case 'set-value':
      refuseNodeViewGesture(
        `Changing "${String(cmd['socket'] ?? 'a socket')}" writes the socket's default_value — editing parity is not the program.`,
      );
      break;
    case 'use-nodes':
      refuseNodeViewGesture(
        'Use Nodes writes Material.use_nodes — editing parity is not the program.',
      );
      break;
    // A SOCKET PANEL'S HEADER. Blender's own callback is
    // `panel_state->flag ^= NODE_PANEL_COLLAPSED` followed by
    // `BKE_main_ensure_invariants` (`node_draw.cc:1903-1911`) — a write to the
    // node tree the document would save, so the traced panels are DRAWN in the
    // state the engine reports and never toggled from here.
    case 'collapse-panel':
      refuseNodeViewGesture(
        `Collapsing "${String(cmd['panel'] ?? 'a panel')}" writes the panel's is_collapsed — editing parity is not the program.`,
      );
      break;
    default:
      refuseNodeViewGesture(
        `blender-node-view: no action "${action}" — state, look, view-all, zoom, pan, and the refusals move, link, set-value, use-nodes, collapse-panel.`,
      );
  }
  return nodeViewState();
}

interface RuntimeView {
  stageFrame(part: { session: string; revision: number; abort?: boolean; mesh?: string; image?: string; piece?: unknown }): void;
  applyFrame(frame: unknown): unknown;
  snapshot(): ReturnType<BlenderRuntimeView['snapshot']>;
  drawStatistics(): ReturnType<BlenderRuntimeView['drawStatistics']>;
  setDrawBatching(enabled: boolean): void;
  /** Own a detached revision for render lighting, never the interactive view. */
  captureSnapshot(): ReturnType<BlenderRuntimeView['captureSnapshot']>;
  /** Keep the description of the frame just applied, and the two poses of every
   *  render photographed from it (`blender-runtime-view.ts`). Both are what an
   *  outside grader reads through the document's own REPL; neither is read by
   *  the product. A document published against this id that does not answer
   *  them is refused by name below rather than silently recording nothing. */
  recordPresentation(description: unknown): void;
  recordPhotograph(record: {
    sent: { position: number[]; target: number[]; up: number[] };
    photographed: { position: number[]; target: number[]; up: number[] };
    render: { width: number; height: number; fov: number; orthographic: boolean };
  }): void;
}

let runtime: BlenderRuntime | null = null;
const historyResources = new Set<string>();

function invalidateBlenderHistory(): void {
  if (historyResources.size) editorHost().history.invalidate([...historyResources]);
  historyResources.clear();
}
let captureLifetime: AbortController | null = null;
/** Whether this module has asked the host to tell it when the session ends.
 *  Once per page, taken on the first runtime — before one there is nothing to
 *  terminate, and the host door only exists inside a running editor. */
let watchingSessionEnd = false;

/** Diagnostics must not prevent teardown if the host has already detached. */
function beginBlenderWork(label: string): () => void {
  try {
    const end = editorHost().session.beginWork(`Blender: ${label}`);
    return () => { try { end(); } catch { /* preserve the operation's result */ } };
  } catch { return () => {}; }
}

function terminateBlenderRuntime(): void {
  const end = beginBlenderWork('invalidating history and releasing runtime');
  try {
    invalidateBlenderHistory();
    captureLifetime?.abort();
    captureLifetime = null;
    runtime?.terminate();
    runtime = null;
    lastCapture = null;
  } finally { end(); }
}

// THE ENGINE DIES WITH THE SESSION, whether or not the tab can. A page told
// `tab-close` calls `window.close()`, which Chrome refuses for a tab a person
// opened, and falls back to a "Session ended" notice -- a repaint of the
// document that terminates nothing. The Blender worker kept its whole engine
// resident behind that notice: measured 2026-09-17, two orphaned tabs from
// two editor restarts held 13 GB and 7 GB between them and put the box into a
// swap storm (26 GB of swap, kernel_task at 245%). `session.onEnded` is the
// host's one signal for every session end, graceful or not, so the worker is
// terminated there.
function watchSessionEnd(): void {
  if (watchingSessionEnd) return;
  watchingSessionEnd = true;
  editorHost().session.onBeforeClose(() => queueModelLifecycle(stopBlenderRuntime));
  editorHost().session.onEnded(terminateBlenderRuntime);
}

async function stopBlenderRuntime(): Promise<void> {
  const owner = runtime;
  await owner?.stop();
  if (runtime === owner) terminateBlenderRuntime();
}
let lastCapture: CaptureRequest | null = null;

const isRuntimeView = (value: unknown): value is RuntimeView =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as RuntimeView).applyFrame === 'function' &&
  typeof (value as RuntimeView).stageFrame === 'function' &&
  typeof (value as RuntimeView).snapshot === 'function' &&
  typeof (value as RuntimeView).captureSnapshot === 'function' &&
  typeof (value as RuntimeView).recordPresentation === 'function' &&
  typeof (value as RuntimeView).recordPhotograph === 'function';

async function runtimeView(): Promise<RuntimeView> {
  const { documents } = editorHost();
  // THE ID IS RE-READ WHILE WAITING. Which document a present reaches depends
  // on the Model document's binding (`presentationDocumentId`), and at startup
  // a present can begin before that pane has bound: reading the id once made
  // it wait the whole window for `document:blender:runtime`, which a
  // file-backed Model never publishes, while its own document published beside
  // it -- the battery's preflight failed exactly so, 18 s after its first
  // command (3 s of boot, then the full wait).
  const deadline = Date.now() + 15_000;
  let id = presentationDocumentId();
  let publication = 'no context';
  for (;;) {
    id = presentationDocumentId();
    const published = await documents.waitForContext(id, Math.max(0, Math.min(250, deadline - Date.now())));
    if (isRuntimeView(published)) return published;
    if (published !== undefined) {
      const required = ['applyFrame', 'stageFrame', 'snapshot', 'captureSnapshot', 'recordPresentation', 'recordPhotograph'];
      const handle = published as Record<string, unknown> | null;
      publication = `${typeof published} context missing ${required.filter(method => typeof handle?.[method] !== 'function').join(', ')}`;
      // An incompatible published context resolves waitForContext immediately.
      // Yield so a pending document commit can replace it; a microtask loop
      // otherwise prevents that publication for the whole timeout window.
      await new Promise<void>(resolve => setTimeout(resolve, Math.max(0, Math.min(25, deadline - Date.now()))));
    }
    if (Date.now() >= deadline) break;
  }
  throw new Error(
    `The Blender Model document is not open, or the open one is not a Model this engine can present ` +
      `to (it must answer stageFrame, applyFrame, captureSnapshot, recordPresentation and recordPhotograph): nothing ` +
      `published a presentable view as ${id} within 15 s (bound model: ${boundModel?.documentId ?? 'none'}; last publication: ${publication}). ` +
      'Open the Model document first (`volter blender-mcp` opens it before its first call).',
  );
}

export function blenderRuntime(): BlenderRuntime {
  const conflict = modelDocumentConflict();
  if (conflict) throw new Error(conflict);
  if (runtime !== null) return runtime;
  watchSessionEnd();
  const lifetime = new AbortController();
  captureLifetime = lifetime;
  let photographing = false;
  let streamedFrame: { view: RuntimeView; session: string; revision: number } | null = null;
  const discardStreamedFrame = () => {
    const staged = streamedFrame;
    streamedFrame = null;
    if (staged) staged.view.stageFrame({ session: staged.session, revision: staged.revision, abort: true });
  };
  runtime = new BlenderRuntime({
    work: beginBlenderWork,
    history: (entries) => {
      const owner = runtime;
      if (!owner) throw new Error('Blender history arrived before its runtime');
      for (const entry of entries) {
        if ('reset' in entry) {
          invalidateBlenderHistory();
          continue;
        }
        if (!entry.resource) throw new Error('A Blender edit has no document resource');
        historyResources.add(entry.resource);
        const restore = async (direction: 'undo' | 'redo'): Promise<boolean> => {
          if (runtime !== owner) throw new Error('This Blender history belongs to a closed worker');
          const moved = await owner.historyStep(entry.id, direction);
          noteBlenderRnaChanged();
          // The restored frame arrives before the Outliner's scheduled read.
          // A following structural edit resolves its targets through that index:
          // redo-duplicate -> delete must not see the tree from before redo.
          await refreshBlenderOutliner(blenderEngineSelection().selected);
          return moved;
        };
        editorHost().history.record({
          id: entry.id, label: entry.label, resources: [entry.resource],
          document: presentationDocumentId(),
          undo: () => restore('undo'), redo: () => restore('redo'),
        });
      }
    },
    stage: async part => {
      if (part.abort) { discardStreamedFrame(); return; }
      const conflict = modelDocumentConflict();
      if (conflict) throw new Error(conflict);
      if (boundModel === null) {
        discardStreamedFrame();
        return;
      }
      const documentId = presentationDocumentId();
      const view = await runtimeView();
      lifetime.signal.throwIfAborted();
      if (presentationDocumentId() !== documentId) throw new Error('Blender document changed during frame transfer');
      if (streamedFrame && streamedFrame.view !== view)
        throw new Error('Blender presenter changed during frame transfer');
      view.stageFrame(part);
      streamedFrame = { view, session: part.session, revision: part.revision };
    },
    present: async (frame, description, capture) => {
      const conflict = modelDocumentConflict();
      if (conflict) throw new Error(conflict);
      // THE ENGINE DOES NOT NEED A VIEW. With no Model document bound, no presenter is coming:
      // the frame is presented to nobody and the session keeps running (a headless agent, a save
      // on close). The Model document presents the session's current state when it binds. Only a
      // photograph needs a view, so only a capture is refused.
      if (boundModel === null) {
        // A headless present accepts no staged geometry. Abort its owned
        // transfer before the retained Model view can be opened again.
        discardStreamedFrame();
        if (capture?.render) {
          throw new Error('Rendering a Blender frame needs the Model document open; nothing is presenting.');
        }
        return {};
      }
      const documentId = presentationDocumentId();
      const endWait = beginBlenderWork('waiting for Model presenter');
      let view: RuntimeView;
      try { view = await runtimeView(); } finally { endWait(); }
      lifetime.signal.throwIfAborted();
      if (presentationDocumentId() !== documentId)
        throw new Error('Blender document changed before its frame could be presented');
      if (streamedFrame && streamedFrame.view !== view)
        throw new Error('Blender presenter changed before its frame could be presented');
      // WHAT THE PRESENTER HELD BEFORE THIS FRAME, carried back to the session
      // beside whatever this present produced. The session only has a RECORD of
      // what it sent; this view is the authority on what it actually holds, and
      // the two come apart whenever the Model document is rebuilt under a
      // still-running worker (`blender-runtime-view.ts::applyFrame` says how).
      // A document that answers `applyFrame` without one reports no `held` at
      // all, rather than a wrong `null`.
      const endApply = beginBlenderWork('applying frame to Model');
      const applied = (() => {
        try { return view.applyFrame(frame) as { held?: unknown } | null | undefined; }
        finally { endApply(); }
      })();
      streamedFrame = null;
      const reports = typeof applied === 'object' && applied !== null && 'held' in applied;
      const held = reports ? (applied.held as { session: string; revision: number } | null) : null;
      const answer = (capture: unknown): PresentAnswer => ({
        ...(capture === undefined ? {} : { capture }),
        ...(reports ? { held } : {}),
      });
      // THE RECORD OF WHAT WAS SUBMITTED, kept only once the frame was taken:
      // a refused frame is not displayed and must not be described as if it
      // were.
      view.recordPresentation(description);
      if (!capture) return answer(undefined);
      lastCapture = capture;
      if (!capture.render) return answer(undefined);
      const presented = view.snapshot();
      // A COMPOSITED FRAME IS NOT PHOTOGRAPHED. The compositor already
      // produced the scene-referred pixels, so nothing here frames, lights or
      // renders anything: the view transform runs over the values handed in
      // and answers with the PNG. Everything below is the photograph path and
      // would only re-render a frame that is about to be thrown away.
      const assertBinding = () => {
        lifetime.signal.throwIfAborted();
        if (presentationDocumentId() !== documentId || view.snapshot() !== presented)
          throw new Error('Blender capture document or source revision changed before completion');
      };
      if (capture.render.linearInput) {
        const display = await displayPhotograph(null, capture.render);
        assertBinding();
        return answer(display);
      }
      // THE PHOTOGRAPH HAS ITS OWN CAMERA, and the modeling viewport is never
      // touched by a render. Blender ships the scene camera's full pose in
      // BLENDER'S frame (Z-up, `session.py::_photograph`); every mesh hangs
      // under the Model root, whose world matrix carries the Z-up -> Y-up
      // permutation (`blender-runtime-view.ts`). So the pose is transformed
      // through THAT matrix -- copied into the detached snapshot, never written out
      // here as a quarter turn -- and a fresh camera is placed on it.
      //
      // MEASURED 2026-09-18, and the reason this code exists: handing the raw
      // Blender numbers to `presentEditorView` read them as three.js world
      // space, so a camera at Blender (0, -3, 0.42) looking +Y photographed the
      // model's underside from 3 m below the floor, and a straight-down camera
      // produced a level side view. Every hero image the battery ever graded
      // came from a misplaced camera. The old path also moved the VIEWPORT onto
      // the render camera and moved it back; a render that never touches the
      // viewport needs no such dance, so it is gone rather than made safe.
      const { render, position, target, up } = capture;
      if (!position || !target || !up)
        throw new Error(
          'A Blender render capture must carry the scene camera position, target and up',
        );
      if (photographing) throw new Error('A Blender render capture is already in progress');
      const snapshot = view.captureSnapshot();
      photographing = true;
      lifetime.signal.addEventListener('abort', snapshot.dispose, { once: true });
      try {
        assertBinding();
        const scene = new THREE.Scene();
        scene.add(snapshot.root);
        scene.updateMatrixWorld(true);
        const toDocument = snapshot.root.matrixWorld;
        const toBlender = new THREE.Matrix4().copy(toDocument).invert();
        // Points move with the full matrix; `up` is a DIRECTION and must not pick
        // up the root's translation.
        const documentBasis = new THREE.Matrix3().setFromMatrix4(toDocument);
        const blenderBasis = new THREE.Matrix3().setFromMatrix4(toBlender);
        const eye = new THREE.Vector3(position[0], position[1], position[2]).applyMatrix4(
          toDocument,
        );
        const focus = new THREE.Vector3(target[0], target[1], target[2]).applyMatrix4(toDocument);
        const upward = new THREE.Vector3(up[0], up[1], up[2]).applyMatrix3(documentBasis);
        const aspect =
          Math.min(2048, Math.round(render.width)) / Math.min(2048, Math.round(render.height));
        // Fit clipping to this snapshot and photograph's eye, independently of
        // the user's navigation. Editor furniture never enters this scene.
        const bounds = contentWorldBounds(snapshot.root).getBoundingSphere(new THREE.Sphere());
        const documentView = fitClipPlanes(eye.distanceTo(bounds.center), bounds.radius);
        let renderCamera: THREE.Camera;
        if (render.orthographic) {
          // An ORTHO scene camera. `fov` carries `ortho_scale` as the VERTICAL
          // extent in Blender units (`_vertical_extent` applies `sensor_fit`), so
          // the frustum is stated outright instead of being reverse-derived from
          // a perspective camera's distance and angle.
          const halfHeight = render.fov / 2;
          renderCamera = new THREE.OrthographicCamera(
            -halfHeight * aspect,
            halfHeight * aspect,
            halfHeight,
            -halfHeight,
            documentView.near,
            documentView.far,
          );
        } else {
          renderCamera = new THREE.PerspectiveCamera(
            render.fov,
            aspect,
            documentView.near,
            documentView.far,
          );
        }
        renderCamera.up.copy(upward);
        renderCamera.position.copy(eye);
        renderCamera.lookAt(focus);
        renderCamera.updateMatrixWorld(true);
        // THE POSE THIS PHOTOGRAPH USED, BACK IN BLENDER'S FRAME. Python asserts
        // it equals what it sent, with no tolerance: the model root's matrix is an
        // exact signed axis permutation, so a vector through it and its inverse is
        // bit-identical. A mismatch means the conversion above is wrong, and the
        // whole point of this instrument is that a misplaced render camera is
        // otherwise invisible -- photograph-vs-Cycles is a declared difference, so
        // the battery's image rows hid it for the entire life of this lane.
        const photographedFrom = {
          position: eye.clone().applyMatrix4(toBlender).toArray(),
          target: focus.clone().applyMatrix4(toBlender).toArray(),
          up: upward.clone().applyMatrix3(blenderBasis).toArray(),
        };
        // RECORDED BEFORE THE PICTURE IS TAKEN, and before Python compares the
        // two poses. The assertion on the other side THROWS on a mismatch, and
        // an exception carries the defect out of reach of a harness grading the
        // run afterwards; both poses have to survive it.
        view.recordPhotograph({
          sent: { position, target, up },
          photographed: photographedFrom,
          render: {
            width: render.width,
            height: render.height,
            fov: render.fov,
            orthographic: render.orthographic,
          },
        });
        const display = await photographSnapshot(scene, renderCamera, snapshot, render, assertBinding);
        return answer({ ...display, camera: photographedFrom });
      } finally {
        photographing = false;
        lifetime.signal.removeEventListener('abort', snapshot.dispose);
        snapshot.dispose();
      }
    },
    // The worker's OWN stdout and stderr, forwarded so a developer can read
    // Python's output where the page's output is. This is the page console on
    // purpose: the editor's console door is for conditions an agent must
    // resolve, and `blender_tools.py` deliberately keeps a failing SCRIPT's
    // traceback out of it.
    // biome-ignore lint/suspicious/noConsole: the Blender worker's log is page output by design.
    log: (level, text) => console[level](`[blender] ${text}`),
    // A SCRIPT'S SAVE AS MOVED THE DOCUMENT. Said in the editor's console, where the change of
    // file is a fact a person needs; the tab follows once the script's call answers
    // (`followMovedDocument`), when the new file is in the project to open.
    documentMoved: (moved) => {
      const owner = runtime;
      if (!owner) return;
      unfollowedMove = { owner, from: moved.from, document: moved.document };
      editorHost().console.log(
        `Blender now has ${moved.document} open (a script saved or opened it there), so the model saves to ` +
          `${moved.document} from now on; ${moved.from} keeps what it last saved.`,
        'blender-document',
      );
    },
  });
  const session = runtime;
  // MEASUREMENT, PUBLISHED THE MOMENT THE SESSION EXISTS. The worker cannot say
  // how long it has been stuck — the loop that would send the number is the loop
  // that is stuck — so this side keeps the clock and the host carries it out on
  // the heartbeat, the one channel that still beats through a blocked main
  // thread. `cyclotron status` prints the block. Published as a READ of the live
  // meter rather than a snapshot, so the host always asks the running session:
  // an in-flight call's age has to be computed at the moment it is reported.
  // The page's own long-task half is the HOST's, behind this same door.
  editorHost().session.reportWorkerCallMeter('Blender', () => session.metrics());
  return runtime;
}

/** The view the last `blender-screenshot-view` asked the tab to photograph. */
export function lastBlenderCapture(): CaptureRequest | null {
  return lastCapture;
}

/**
 * THE SESSION'S DOCUMENT when `blender-start` does not name one.
 *
 * Persistence is ON by default, because the job this lane exists to do is to
 * not lose what a script modelled: before this, closing the tab lost it, with
 * no `.blend` anywhere. `models/` rather than `public/` is what says a
 * document is the SOURCE a shipped artifact is exported from, not the artifact
 * — which is also why it carries no provenance record (`volter blender-mcp`'s
 * Mirror owns that line, for `public/`).
 *
 * It is the fallback only. A project that declares the `model` finder lists
 * its OWN `.blend` files, and the document opened for one of those binds the
 * session to it ({@link openModelDocumentBlend}).
 */
const DEFAULT_BLENDER_DOCUMENT = 'models/model.blend';

const string = (cmd: Record<string, unknown>, key: string): string => {
  const value = cmd[key];
  if (typeof value !== 'string')
    throw new Error(`${String(cmd['type'])} requires a string "${key}"`);
  return value;
};

/**
 * The project-relative path of the `.blend` the SESSION'S PYTHON currently
 * holds — `bpy.data.filepath`, which a bake script's own `open_mainfile`
 * retargets as it runs (the session's document follows only once the call has
 * ended, and only inside the project). Answers `{}` when there
 * is no file (a scene modelled from scratch has never been saved) or when the
 * path is outside the project, because a record is better absent than wrong.
 */
async function sessionDocumentPath(session: {
  execute(code: string, history?: boolean): Promise<string>;
}): Promise<{ document?: string }> {
  const project = editorHost().projectLocalState.projectRootPath();
  if (project === null) return {};
  let answer: string;
  try {
    answer = await session.execute('import bpy\nprint(bpy.data.filepath)\n', false);
  } catch {
    return {};
  }
  // PARSE WHAT `execute` ACTUALLY ANSWERS, which is the MCP door's shape and
  // not raw stdout: `Code executed successfully: <stdout>` on ONE line, or
  // `Error executing code: …`. A first version filtered for lines starting
  // with `/` and therefore matched nothing, because the path sits after that
  // prefix on the same line — and a document that cannot be read is
  // indistinguishable from a session that has none, so the failure was silent
  // and the nine bakes recorded no input at all.
  if (/^Error executing code:/m.test(answer)) return {};
  const filepath =
    answer
      .replace(/^Code executed successfully:/, '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('/'))
      .pop() ?? '';
  if (filepath === '') return {};
  const root = project.endsWith('/') ? project : `${project}/`;
  if (!filepath.startsWith(root)) return {};
  return { document: filepath.slice(root.length) };
}

export async function handleBlenderCommand(cmd: {
  type: string;
  [key: string]: unknown;
}): Promise<EditorCommandResult> {
  const host = editorHost();
  if (cmd.type === 'blender-draw-batching') {
    if (typeof cmd['enabled'] !== 'boolean') return {ok: false, error: 'blender-draw-batching requires boolean enabled'};
    if (!runtime?.project || !host.session.open()) return {ok: false, error: 'Open a Blender document before changing draw batching'};
    const view = await runtimeView();
    view.setDrawBatching(cmd['enabled']);
    return {ok: true, data: {instancing: view.drawStatistics()}};
  }
  // A read of this tab, answered ABOVE `blenderRuntime()` because that call
  // spawns the worker: this is the one Blender command that must not create
  // the session it is asked about. A caller uses it to find out whether the
  // session it last spoke to survived (an editor restart takes it).
  if (cmd.type === 'blender-status') {
    return {
      ok: true,
      data: {
        started: runtime?.project != null,
        document: host.documents.context(presentationDocumentId()) !== undefined,
        instancing: runtime?.project != null ? (await runtimeView()).drawStatistics() : null,
        lastOutput: runtime?.lastOutput ?? [],
      },
    };
  }
  // Every other verb presents, photographs or models through an open project
  // session. `blender-status` above deliberately answers without one: it is
  // the read a caller makes to find out what survived.
  if (!host.session.open())
    return {
      ok: false,
      error: `${cmd.type} needs an open project session; this editor page has none.`,
    };
  try {
    const project = cmd.type === 'blender-start' ? string(cmd, 'project') : null;
    let requestedDocument = typeof cmd['document'] === 'string' ? cmd['document'] : undefined;
    if (cmd.type === 'blender-stop' || (cmd.type === 'blender-start' && cmd['fresh'] === true)) {
      // Do not invalidate history or discard the worker if persistence fails.
      await queueModelLifecycle(stopBlenderRuntime);
      if (cmd.type === 'blender-stop') return { ok: true, data: { stopped: true } };
    }
    if (cmd.type === 'blender-start' && !host.documents.context(presentationDocumentId())) {
      // THE MODEL DOCUMENT, OPENED BY ADDRESS. `workspace.open` is the door's
      // own reveal verb — the same `{kind, …}` address the view protocol
      // routes, settled and awaited until the document is ready to be driven —
      // so this lane names a document, never a presenter. A `false` is the
      // build's answer that nothing here opens that address; the Model
      // document is this package's own contribution, so it is a build without
      // `@volter/editor-blender` rather than a broken call.
      // During startup the Model may not have mounted/bound yet. Resolve the
      // real declared table, including custom entry ids. A generic fallback
      // exists only in projects that have no file-backed Model of their own.
      const table = await host.project.documentTable();
      const models = table.entries.filter(entry => entry.kind === 'model');
      const entry = requestedDocument !== undefined
        ? models.find(candidate => candidate.source?.path === requestedDocument)
        : models.find(candidate => candidate.id === (boundModel?.entryId ?? table.default))
          ?? (models.length === 1 ? models[0] : undefined);
      if (!entry) return {
        ok: false,
        error: requestedDocument !== undefined
          ? `No declared Model document names ${requestedDocument}.`
          : `Choose a Model document before starting Blender. Available: ${models.map(model => model.id).join(', ') || '(none)'}.`,
      };
      const entryId = entry.id;
      requestedDocument = entry.source?.path;
      const opened = await host.workspace.open({ kind: 'document', id: entryId });
      if (!opened)
        return {
          ok: false,
          error:
            `blender-start could not open the Blender Model document ${entryId}: nothing in this editor ` +
            'opens that document (the Model document ships with @volter/editor-blender).',
        };
    }
    const session = blenderRuntime();
    switch (cmd.type) {
      case 'blender-start': {
        // THE OPEN MODEL DOCUMENT'S `.blend` WINS over the default: a models
        // project's document is its own `src/models/<name>.blend`, and a
        // `blender-start` that named none is asking for the session this tab
        // is showing, not for a second file beside it.
        // After a script's Save As to a file no Model lists, the session this tab
        // shows holds that file (`unlistedFollow`), and a start naming none
        // asks for it, not for the file the tab was opened on.
        const shown =
          unlistedFollow !== null && unlistedFollow.owner === session && unlistedFollow.from === (boundModel?.blend ?? DEFAULT_BLENDER_DOCUMENT)
            ? unlistedFollow.document
            : boundModel?.blend;
        const document =
          requestedDocument !== undefined
            ? requestedDocument
            : (shown ?? DEFAULT_BLENDER_DOCUMENT);
        return { ok: true, data: { ...(await session.start(project!, document)) } };
      }
      case 'blender-execute': {
        // THROUGH THE IN-PAGE DOOR, not `session.execute` beside it — the same
        // rule `blender-rna-set` below follows, and for the same reason: the
        // RNA version is minted at the door (ruling 3, 2026-09-19), and
        // ARBITRARY bpy can change anything RNA answers, so a script that
        // reached the engine around it would leave every view drawing the tree
        // it had. One path for a `cyclotron eval`, an MCP call and a panel's own
        // operator.
        // THE DOOR'S TEXT, verbatim — `execute_blender_code`'s MCP contract is
        // that one string, so the wire keeps answering it while the in-page
        // callers read the parsed halves beside it.
        const answer = await blenderExecute(string(cmd, 'code'));
        return { ok: true, data: { result: answer.text } };
      }
      case 'blender-scene-info':
        return { ok: true, data: { result: await session.sceneInfo() } };
      case 'blender-object-info':
        return { ok: true, data: { result: await session.objectInfo(string(cmd, 'name')) } };
      // THE RNA DOOR. Three verbs over `session.py`'s `rna_view` /
      // `rna_context` / `rna_set` — the same door the Properties sections call
      // in-page through {@link blenderRna} below, so the panel and the wire
      // read one thing. `data` carries the answer whole: unlike
      // `blender-scene-info`, whose MCP contract is a text blob, these answer a
      // PANEL, so the rows cross as rows.
      case 'blender-rna': {
        const names = typeof cmd['names'] === 'number' ? cmd['names'] : undefined;
        return { ok: true, data: { result: await session.rna(string(cmd, 'path'), names) } };
      }
      case 'blender-rna-context': {
        const object = typeof cmd['object'] === 'string' ? cmd['object'] : undefined;
        const collection = typeof cmd['collection'] === 'string' ? cmd['collection'] : undefined;
        return { ok: true, data: { result: await session.rnaContext(object, collection) } };
      }
      case 'blender-rna-set': {
        const index = typeof cmd['index'] === 'number' ? cmd['index'] : undefined;
        // THROUGH THE IN-PAGE DOOR, not `session.rnaSet` beside it: the door is
        // where the RNA version is minted (ruling 3, 2026-09-19), and a write
        // that reached the engine around it would leave every view drawing the
        // tree it had — which is exactly the defect the version exists for.
        return {
          ok: true,
          data: {
            result: await blenderRnaSet(
              string(cmd, 'path'),
              string(cmd, 'property'),
              cmd['value'],
              index,
            ),
          },
        };
      }
      // THE TREE DOOR on the wire, beside the RNA one: `blender-outliner`
      // answers Blender's View Layer tree and `blender-outliner-set` writes one
      // restriction column, so a `cyclotron eval` reads exactly what the hierarchy
      // panel draws.
      case 'blender-outliner': {
        const selected = Array.isArray(cmd['selected'])
          ? (cmd['selected'] as unknown[]).filter(
              (name): name is string => typeof name === 'string',
            )
          : undefined;
        return { ok: true, data: { result: await session.outliner(selected) } };
      }
      // THE NODE-TREE DOOR on the wire, beside the other two: one material's
      // shader node tree, whole, so a `cyclotron eval` reads exactly what the node
      // view draws.
      case 'blender-node-tree':
        return {
          ok: true,
          data: {
            result: await session.nodeTree({
              ...(typeof cmd['path'] === 'string' ? { path: cmd['path'] } : {}),
              ...(typeof cmd['material'] === 'string' ? { material: cmd['material'] } : {}),
            }),
          },
        };
      // THE UV DOOR on the wire, beside the node one: one mesh's UV layout,
      // so a `cyclotron eval` reads exactly what the UV view draws.
      case 'blender-uv-layout':
        return {
          ok: true,
          data: {
            result: await session.uvLayout({
              ...(typeof cmd['object'] === 'string' ? { object: cmd['object'] } : {}),
              ...(typeof cmd['uvLayer'] === 'string' ? { uvLayer: cmd['uvLayer'] } : {}),
            }),
          },
        };
      // THE RIG AND CLIP DOORS on the wire, beside the UV one: the skin
      // binding and the action as three.js tracks, so a `cyclotron eval` reads
      // exactly what the presenter bound and what the Timeline plays.
      case 'blender-rig':
        return {
          ok: true,
          data: {
            result: await session.rig({
              ...(typeof cmd['object'] === 'string' ? { object: cmd['object'] } : {}),
            }),
          },
        };
      case 'blender-action-clip':
        return {
          ok: true,
          data: {
            result: await session.actionClip({
              ...(typeof cmd['object'] === 'string' ? { object: cmd['object'] } : {}),
              ...(typeof cmd['bake'] === 'boolean' ? { bake: cmd['bake'] } : {}),
            }),
          },
        };
      // THE NODE VIEW, read and driven. It touches no engine call: the view
      // is a projection of the tree the door already answered, so its actions
      // are pure state (`src/node-view-state.ts`).
      //
      // THE SESSION IS THE STANDALONE DOOR ONTO `NODE_VIEW_VERBS`, not a second
      // implementation (U8's ruling 1). Under the Code-OSS frame each verb is a
      // `volter.blender-node-view.<verb>` command; standalone `cyclotron edit` has no
      // command service, so this verb routes the SAME table. `invokeViewVerb`
      // throws the view's own refusal, which is the sentence this door already
      // answered with.
      case 'blender-node-view': {
        const action = typeof cmd['action'] === 'string' ? cmd['action'] : 'state';
        // An action the TABLE does not carry is still the VIEW's refusal, not the
        // registry's: I5's proof is that an unknown action names the verb's whole
        // vocabulary IN THE VIEW's own frame warning, and a thrown registry message
        // would move that refusal somewhere the view does not draw. So the registry
        // answers when it can and `driveNodeView`'s own default answers when it
        // cannot — one implementation either way.
        const known = NODE_VIEW_VERBS.verbs.some((verb) => verb.id === action);
        return {
          ok: true,
          data: {
            result: known
              ? (invokeViewVerb('blender-node-view', action, cmd) as NodeViewState)
              : driveNodeView(cmd),
          },
        };
      }
      case 'blender-outliner-set':
        return {
          ok: true,
          data: {
            // The in-page door, for the reason `blender-rna-set` above takes it.
            result: await blenderOutlinerSet(
              string(cmd, 'path'),
              string(cmd, 'column'),
              cmd['value'] !== false,
            ),
          },
        };
      case 'blender-screenshot-view': {
        const maxSize = typeof cmd['maxSize'] === 'number' ? cmd['maxSize'] : 1000;
        // The package owns this address. The MCP transport must not guess a
        // standing document when the session is presenting a project's model.
        const document = { kind: 'document', id: boundModel?.entryId ?? 'blender:runtime' };
        return { ok: true, data: { ...await session.screenshotView(maxSize), document } };
      }
      case 'blender-read-file': {
        // The bytes go out as a BODY, not inside this command's answer -- see
        // `/__editor/blender-file` in `server/routes/relay.ts` for the
        // measurement that moved them. The caller mints the transfer id, so
        // the page never names anything on the host's disk.
        const bytes = await session.readFile(string(cmd, 'path'));
        const transfer = string(cmd, 'transferId');
        const posted = await fetch(`/__editor/blender-file?id=${encodeURIComponent(transfer)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: new Blob([bytes as BlobPart]),
        });
        if (!posted.ok)
          return { ok: false, error: `Transfer ${transfer} was refused: ${posted.status}` };
        return { ok: true, data: { bytes: bytes.length } };
      }
      case 'blender-write-file': {
        const binary = atob(string(cmd, 'base64'));
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        await session.writeFile(string(cmd, 'path'), bytes);
        return { ok: true, data: { written: bytes.length } };
      }
      case 'blender-list-files': {
        // WHO to attribute these files to, answered in the same breath as the
        // listing. The write-back door (`volter blender-mcp`'s Mirror) records a
        // file it lands under `public/` in the project's provenance ledger, and
        // what it can honestly name is this session and the model state it had
        // reached — taken here, at the instant of the listing, rather than
        // asked for afterwards when another call may have moved it.
        const entries = await session.listFiles(string(cmd, 'path'));
        const presented = session.presented;
        return {
          ok: true,
          data: {
            entries,
            ...(presented ? { session: presented.session, revision: presented.revision } : {}),
            // AND WHAT THE BYTES WERE MADE FROM. A session-written `.glb` is
            // exported from a `.blend`, and that path is the one fact that
            // lets a reader go DOWN by kind later — from a prefab's glTF to
            // the model document it came from (ARCHITECTURE-CORE §Roots,
            // "Drilling goes DOWN by kind"). Taken at the instant of the
            // listing, for the same reason the session identity is.
            //
            // IT IS ASKED OF PYTHON, NOT OF `boundModel`, and that distinction
            // is a measurement rather than a preference. `boundModel` is the
            // document the TAB opened; a bake script opens its own file with
            // `wm.open_mainfile`, which retargets `bpy.data.filepath` at once,
            // the tab only after the call (`followMovedDocument`), and never
            // for a file outside the project. Measured 2026-09-19: reading `boundModel` recorded
            // the SAME `.blend` as the input of all three of first-person's
            // characters — whichever one the tab happened to show — which is
            // worse than no record, because it is a confident wrong answer.
            // `bpy.data.filepath` is what the export actually came out of.
            ...(await sessionDocumentPath(session)),
          },
        };
      }
    }
    return { ok: false, error: `Unknown Blender command ${cmd.type}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
