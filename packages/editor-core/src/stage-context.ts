/**
 * WHAT A STAGE IS SHOWING — the ONE derived answer every stage capability asks.
 *
 * ARCHITECTURE-CORE §One stage: there is one 3D stage host, and a capability is
 * present on a stage wherever its CONDITION holds — never by the origin or kind
 * of the document that happens to have opened it. Before this, four gates spelled
 * that question four ways in three places (`threeSurfaceToolsApply` for the shelf
 * rail, `showThreejsTools` in the scene panel, `studioStage`/`hasShell` in the
 * document host), which is why a prefab's stage and the world root's stage could
 * not be the same code.
 *
 * It is a FUNCTION over the stores the panels already subscribe to, not a store
 * of its own — the method transcribed from `inspection/active-surface.ts`, whose
 * docblock states the rule: the surface is derived, never held. Callers keep
 * their existing `useSyncExternalStore` subscriptions (shell store, active
 * authoring, the session registry); this module only reads.
 */

import { stageTransformDoor } from '@volter/editor-sdk/contributions';
import { getActiveAuthoring } from './authoring/active-adapter';
import { CompositeAuthoringAdapter } from './authoring/composite-authoring-adapter';
import { object3DDocumentSession } from './authoring/object3d-document-session-registry';
import {
  isViewportToolContextVisible,
  resolveViewportToolContext,
} from './authoring/viewport-tool-context';
import { isThreejsSurfaceVisible } from './authoring/world-hidden-viewport';
import type { EditorShellStore } from './editor-shell-store';
import { stageStore } from './stage-store-registry';
import { activeWorkspaceDocumentId, openWorkspaceDocuments } from '@volter/editor-sdk/kit/workspace-document-registry';

export type StageSurface = 'three' | 'canvas' | 'dom';

/** What the stage's document IS — the document's own `presentation()` kind
 *  (`WorkspaceDocumentDescriptor.presentation`), folded to the subjects a
 *  stage distinguishes. `unknown` when the descriptor declares none. */
export type StageSubject =
  | { readonly kind: 'composition' } // presentation 'scene' | 'world' (a scene, a manifest root)
  | { readonly kind: 'story' } // 'story' — a piece in isolation with its parameters
  | { readonly kind: 'artifact' } // 'asset' — an ecosystem artifact (glTF, particles, a model)
  | { readonly kind: 'data' } // 'document' — an adapter-table document (a model, a page)
  | { readonly kind: 'unknown' };

export interface StageSelection {
  readonly count: number;
  /** The surface that owns the whole selection; null when empty or mixed. */
  readonly surface: StageSurface | null;
  /** Whether that owner is painted on this stage (hidden roots are not). */
  readonly visible: boolean;
}

/**
 * Whether the stage has chrome of its own, or is EMBEDDED in another surface
 * with none (the inspector's object preview). It is a genuine condition OF THE
 * STAGE — the same kind of fact as `surface`, `selection` and `play` — never
 * the origin or kind of a document; and the HOST is the only thing that knows
 * it, because an embedded preview has no workspace document at all (which is
 * exactly why `subjectOf` answers `unknown` for one). So the host supplies it
 * and nothing is inferred (decided 2026-09-18, an application of
 * ARCHITECTURE-CORE §One stage's own rule).
 */
export type StageChrome = 'document' | 'embedded';

export interface StageContext {
  readonly documentId: string | null;
  readonly chrome: StageChrome;
  readonly subject: StageSubject;
  /** The surface the stage paints; null when nothing is showing. */
  readonly surface: StageSurface | null;
  readonly selection: StageSelection;
  readonly play: 'stopped' | 'playing' | 'paused';
}

const EMPTY_SELECTION: StageSelection = { count: 0, surface: null, visible: false };

function stageSurfaceOf(kind: string | undefined): StageSurface | null {
  return kind === 'three' || kind === 'canvas' || kind === 'dom' ? kind : null;
}

function subjectFromKind(kind: string | undefined): StageSubject {
  switch (kind) {
    case 'scene':
    case 'world':
      return { kind: 'composition' };
    case 'story':
      return { kind: 'story' };
    case 'asset':
      return { kind: 'artifact' };
    case 'document':
      return { kind: 'data' };
    default:
      return { kind: 'unknown' };
  }
}

function subjectOf(documentId: string | null): StageSubject {
  if (documentId === null) return { kind: 'unknown' };
  const open = openWorkspaceDocuments().find((doc) => doc.descriptor.id === documentId);
  if (!open) return { kind: 'unknown' };
  const presentation = open.descriptor.presentation?.() ?? null;
  const projected = subjectFromKind(presentation?.kind);
  if (projected.kind !== 'unknown') return projected;
  // The document's own declared KIND is the fallback, and it is a real answer
  // rather than a guess: `presentation()` is the ADDRESSABLE projection of a
  // document, and a document can legitimately have none while still being an
  // artifact — `asset-documents.tsx:258` returns null for an ONLINE asset and
  // for one with no project path, and reading only the projection took the
  // studio stage off exactly those (measured 2026-09-18, which is why the
  // `documentKind` prop could not simply be deleted without this).
  return subjectFromKind(open.descriptor.kind);
}

/**
 * Whether this adapter PAINTS a three surface at all, selection or not — the
 * no-selection branch of what `threeSurfaceToolsApply` asked before this module
 * existed, transcribed verbatim. A composite paints three when some child does;
 * a single adapter paints three when it is not rect-capable and can hand back an
 * `Object3D` for a node.
 */
function adapterPaintsThree(adapter: ReturnType<typeof getActiveAuthoring>): boolean {
  if (adapter instanceof CompositeAuthoringAdapter)
    return adapter.childAdapters().some((child) => child.kind === 'three');
  return !adapter.rects && typeof adapter.hierarchy.object3D === 'function';
}

function worldStageContext(
  store: EditorShellStore,
  documentId: string | null,
  subject: StageSubject,
  chrome: StageChrome,
): StageContext {
  const adapter = getActiveAuthoring(store.shell);
  const surface: StageSurface | null =
    isThreejsSurfaceVisible(store.shell) && adapterPaintsThree(adapter) ? 'three' : null;
  const play = store.shell.playState;
  const count = store.shell.selectedEntityIds.size;
  if (count === 0)
    return { documentId, chrome, subject, surface, selection: EMPTY_SELECTION, play };
  const context = resolveViewportToolContext(adapter, store.shell.selectedEntityIds);
  return {
    documentId,
    chrome,
    subject,
    surface,
    selection: {
      count,
      surface: stageSurfaceOf(context?.kind),
      visible: isViewportToolContextVisible(store.shell, context),
    },
    play,
  };
}

/**
 * The stage a given document is showing.
 *
 * Two shapes answer this, and which one applies is a FACT about the document —
 * not a kind it declares: a DOCUMENT stage has registered an
 * `Object3DDocumentSession` (a model, a prefab story, an isolation scene) and
 * its selection is its session's own; everything else is the WORLD stage — the
 * manifest's roots under the shell store, whose selection is the shell's and
 * whose surface is subject to the world-hidden eye.
 */
export function documentStageContext(
  store: EditorShellStore,
  documentId: string,
  chrome: StageChrome = 'document',
): StageContext {
  const subject = subjectOf(documentId);
  const session = object3DDocumentSession(documentId);
  if (session === null) {
    // A RESOURCE document with no stage session of its own (a table, a
    // report, a text document) shows no stage at all; only the world's own
    // documents answer with the world stage.
    const kind = openWorkspaceDocuments().find((doc) => doc.descriptor.id === documentId)
      ?.descriptor.kind;
    if (kind !== undefined && kind !== 'game' && kind !== 'scene' && kind !== 'world')
      return {
        documentId,
        chrome,
        subject,
        surface: null,
        selection: EMPTY_SELECTION,
        play: store.shell.playState,
      };
    return worldStageContext(store, documentId, subject, chrome);
  }
  // A document stage's own selection: the session reads it straight off its
  // authoring adapter, and its stage is the only thing painting it, so an owner
  // it reports is by construction three-owned and visible here.
  const count = session.selection().length;
  return {
    documentId,
    chrome,
    subject,
    surface: 'three',
    selection: { count, surface: count > 0 ? 'three' : null, visible: true },
    play: store.shell.playState,
  };
}

/** The stage the FOCUSED document is showing; the world stage when no document
 *  is active (the shell with nothing focused still paints the world root). */
export function focusedStageContext(store: EditorShellStore): StageContext {
  const documentId = activeWorkspaceDocumentId();
  if (documentId !== null) return documentStageContext(store, documentId);
  return worldStageContext(store, null, { kind: 'unknown' }, 'document');
}

/**
 * THE STORE THE FOCUSED STAGE RUNS ON — where a shared panel reads per-stage
 * state (selection, scene/objectMap, camera pose, orbit target, tool state,
 * view options like `showStats`/shading).
 *
 * `shell` is the answer for a focused document with no stage of its own — a
 * tool tab, a text document, the Game tab. That is not a fallback in name
 * only: the world root's stage runs on the session store (see
 * `StageHost.tsx`'s world-root install), so a panel asked while focus sits
 * off every stage keeps reporting the world, exactly as it did before §One
 * stage unit 4.
 *
 * It is a FUNCTION, like the rest of this module: the caller keeps its own
 * subscriptions, and a panel that reads this subscribes to
 * `subscribeStageStores` and `subscribeWorkspaceDocuments` so a mount or a
 * tab switch re-renders it against the new answer.
 */
export function focusedStageStore(shell: EditorShellStore): EditorShellStore {
  return stageStore(activeWorkspaceDocumentId()) ?? shell;
}

/** The host transform strip on a stage's shelf (Blender's persistent rail),
 *  where the editor viewport's own gizmo is what it drives. This is the
 *  `gizmo` arm of {@link stageTransformDriver} and nothing else asks it. */
export function transformToolsApply(ctx: StageContext): boolean {
  if (ctx.surface !== 'three') return false;
  if (ctx.selection.count === 0) return true;
  return ctx.selection.surface === 'three' && ctx.selection.visible;
}

/**
 * WHAT THE HOST'S TRANSFORM TOOLS DRIVE ON THIS STAGE — one answer the shelf's
 * strip and the header's transform wells both ask.
 *
 * `gizmo`  `EditorViewport`'s `TransformControls`, through the stage's own
 *          `EditorShellStore.transformMode` (`stage-store-registry.ts` — NOT
 *          the shell's; see `ToolStrip`'s note for the measurement that
 *          separates them). The header's four wells configure that same gizmo,
 *          so they are drawn with it.
 * `modal`  the stage transforms MODALLY instead and declared how
 *          (`registerStageTransform`): a mesh module's `G`/`R`/`S`. The three
 *          single-channel tools arm it; the all-handles tool and the header
 *          wells are NOT DRAWN, because a modal transform is no gizmo and has
 *          nothing for a well to configure.
 * `none`   not a three stage, or the selection belongs to another surface —
 *          `transformToolsApply`'s own condition, unchanged.
 *
 * A DOCUMENT STAGE IS NOT AUTOMATICALLY THE MODAL CASE, and assuming it was is
 * the error this docblock replaces: measured 2026-09-19 on a prefab story, a
 * session-painted stage DOES draw the host's gizmo on its selection. Only a
 * stage that declares a door takes the modal arm.
 */
export type StageTransformDriver = 'gizmo' | 'modal' | 'none';

export function stageTransformDriver(ctx: StageContext): StageTransformDriver {
  if (!transformToolsApply(ctx)) return 'none';
  return stageTransformDoor(ctx.documentId) === null ? 'gizmo' : 'modal';
}

/** The three tools that need a selection (ViewportOverlay, CameraInfo). */
export function threeSelectionToolsApply(ctx: StageContext): boolean {
  return (
    ctx.surface === 'three' &&
    ctx.selection.count > 0 &&
    ctx.selection.surface === 'three' &&
    ctx.selection.visible
  );
}

/**
 * THE ARTIFACT-FLAVOURED SUBJECT — a piece shown IN ISOLATION that is not the
 * project's own live composition: an artifact (a glTF, a particle system, a
 * model asset), a story (a prefab mounted with its parameters), or a stage
 * EMBEDDED in another surface with no workspace document at all (the
 * inspector's object preview, which is why nothing can infer this one and the
 * host supplies `chrome`).
 *
 * This is the question `documentKind: 'source' | 'asset'` asked as a PROP the
 * caller chose, and it is the base the two conditions below are written
 * against, so they cannot drift apart: it drives the source adapter's
 * `documentKind` (its "derived asset" provenance line and its `model-asset`
 * hierarchy kind) and the `asset` performance-source kind.
 *
 * DATA is deliberately not here. A mesh module is the project's own CODE — it
 * opens in an isolation scene (§A model is data) but nothing about it is a
 * derived asset, and saying so is what the `documentKind` prop did by
 * accident once the studio grew a data arm.
 */
export function assetSubjectApplies(ctx: StageContext): boolean {
  return (
    ctx.chrome === 'embedded' || ctx.subject.kind === 'story' || ctx.subject.kind === 'artifact'
  );
}

/**
 * THE STUDIO PRESENTATION — the alpha clear and the editor's own backdrop
 * behind a piece in isolation.
 *
 * ARCHITECTURE-CORE §A model is data: "opening data opens an ISOLATION SCENE
 * around it … whose story is the STUDIO". So the studio is every
 * artifact-flavoured subject PLUS data — a mesh module, a page, anything the
 * adapter's table calls a document.
 *
 * The one condition on the data arm is the LOOK, and it is a condition rather
 * than a kind: the studio's backdrop is the EDITOR'S (the alpha canvas over the
 * `.vgai-object3d-studio-stage` bloom), and a look that declares its own
 * `color.viewport` group has already said what the 3D viewport is painted —
 * Blender's flat #3f3f3f — so painting the studio over it would be the editor
 * overruling the skew.
 *
 * `lookPaintsViewport` is that group's presence, and it is a PARAMETER rather
 * than a read inside here for two reasons: this module is derived-never-held
 * and the look is not one of the stores its callers already subscribe to (the
 * host subscribes to the theme root itself, `StageHost.tsx`); and importing
 * the renderer's token reader here put `native-selection-style.ts` into
 * `main.tsx`'s pinned closure for a layout predicate, which is the erosion the
 * closure gate exists to stop (measured 2026-09-18: +1 file on `main.tsx` and
 * on both builds). `native-selection-style.ts`'s `lookDeclaresViewportColors`
 * is the one reader of that token, so the stage and the renderer cannot
 * disagree about what is on screen.
 */
export function studioStageApplies(ctx: StageContext, lookPaintsViewport: boolean): boolean {
  if (assetSubjectApplies(ctx)) return true;
  return ctx.subject.kind === 'data' && !lookPaintsViewport;
}

/**
 * THE IDENTITY-ROW FRAME — the Asset Lab shell around the stage: the row that
 * names the thing, its type and its path, and the one registrar of the
 * document's own workspace selection (the host registers it wherever this
 * shell is absent, and exactly one of the two must).
 *
 * ARCHITECTURE-CORE §One stage: "the identity row when the subject is an
 * ARTIFACT rather than source". It was the studio presentation's own answer
 * until the studio gained a data arm, and it must not follow it there: a mesh
 * module is the project's CODE, so an Asset-Lab row naming it a type and a
 * file path, wrapped around the mesh editor's own header, would say the
 * opposite of what the document is.
 *
 * An EMBEDDED stage never takes it — it has no chrome of its own by
 * definition. Whether a STORY should keep it is the ruling's own open reading
 * (a prefab's truth is source too); no frame of a story document has been
 * read against that sentence, so this stays exactly what
 * `assetSubjectApplies` says and nothing is re-decided blind.
 */
export function identityRowApplies(ctx: StageContext): boolean {
  return ctx.chrome === 'document' && assetSubjectApplies(ctx);
}
