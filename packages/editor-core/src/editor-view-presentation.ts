import {
  type ActiveDocumentCapture,
  type CaptureDimensions,
  EDITOR_VIEW_DOCUMENT_KINDS,
  EDITOR_VIEW_KEYS,
  EDITOR_VIEW_TOOL_UTILITY_PREFIX,
  type EditorView,
  editorViewUrl,
  isEditorViewDocumentKind,
  type PresentedEditorView,
  type ShadingMode,
} from '@volter/editor-sdk';
import type { StoryRef } from '@volter/editor-project/adapter';
import { getActiveAuthoring } from './authoring/active-adapter';
import {
  object3DDocumentSession,
  prepareObject3DDocument,
} from './authoring/object3d-document-session-registry';
import { openRegisteredDocumentAsync, registeredDocumentOpenerIds } from './document-open-registry';
import { currentEditorView } from './editor-current-view';
import { activeDocumentContainer } from './editor-document-probe';
import type { EditorShellStore } from './editor-shell-store';
import { activeEditorKeymap } from './keymap-presets';
import { liveFrameCanvas, liveInstanceContainer } from './live-session-registry';
import { projectDocumentKinds } from './project-shape';
import { DOCUMENT_REGISTRATION_TIMEOUT_MS, waitUntil } from './wait-until';
import { GAME_DOCUMENT_ID } from '@volter/editor-sdk/kit/workspace-document-ids';
import {
  activateWorkspaceDocument,
  activeWorkspaceDocument,
  activeWorkspaceDocumentId,
  workspaceDocumentSelection,
} from './workspace-document-registry';
import { openAvailableWorkspaceDocument } from './workspace-available-documents';
import {
  activeWorkspaceStaticPanel,
  showWorkspaceStaticPanel,
  showWorkspaceUtility,
} from './workspace-host-commands';
import {
  activeEditorWorkspace,
  editorWorkspaceIds,
  isEditorWorkspaceId,
  setEditorWorkspace,
  whenEditorWorkspaceApplied,
} from './workspace-presets';
import { WORKSPACE_STATIC_PANELS, type WorkspaceStaticPanelKind } from './workspace-static-panels';
import { applyWorkspaceStyle, workspaceStyles } from './workspace-style';
import {
  availableWorkspaceUtilities,
  subscribeWorkspaceUtilities,
} from '@volter/editor-sdk/kit/workspace-utility-registry';
import {
  activateRootDocument,
  rootDocumentGap,
  workspaceDocumentGap,
} from './world-document-routing';

async function captureLiveCanvasFrame(
  canvas: HTMLCanvasElement,
): Promise<CanvasImageSource | null> {
  const { liveCanvasFrame } = await import('./live-canvas-frame');
  return liveCanvasFrame(canvas);
}

/**
 * THE TWO LAZY DOORS, and the reason they are lazy rather than plain imports:
 * THIS FILE IS A DOOR EVERY PACKAGE CALLS (`packages/blender/host/
 * blender-runtime-host.ts:32` imports `presentEditorView`), so whatever it
 * reaches statically, a package that merely wants to present a view PAYS FOR.
 * Measured 2026-09-18 (phase 1 unit 14): after the five document families left
 * for the registry, these two edges were the WHOLE remainder of the game realm
 * shim in this closure — `composite-screenshot` → the two game-CSS scopers,
 * and `tool-loader` → `browser-project-scripts` → `browser-transpile` →
 * `gated-globals` and the six realm modules behind it, plus
 * `creation-site-registry` and (via `account.ts`) `editor-session-attribution`.
 * Neither belongs to PRESENTING anything: one is the capture path for the Game
 * document, the other is the project-tool discovery a LATE utility address
 * drives. Both call sites are already async, and both modules are eagerly
 * loaded by the shell itself long before either runs, so the import resolves
 * from cache. `captureLiveCanvasFrame` above is the precedent this transcribes.
 */
async function captureComposite(
  ...args: Parameters<typeof import('./composite-screenshot').capturePlayComposite>
) {
  const { capturePlayComposite } = await import('./composite-screenshot');
  return capturePlayComposite(...args);
}

async function projectToolContributions() {
  return import('./tool-loader');
}

/**
 * THE THIRD LAZY DOOR, for the same reason and by the same precedent as the
 * two above — and it is the one the unit's own measurement missed. After the
 * families left and those two edges went lazy, this file still reached TWO
 * files of the four buckets phase 1 item 13 named, not one: the notice module
 * is `collaboration and presence` by the inventory's own bucket, imported here
 * statically since long before the cut. The other,
 * `editor-session-attribution`, arrives `keymap-presets -> settings-store ->
 * api/settings -> storage/index -> http-storage` — the storage backend's own
 * edge, a 'keep' chain, and the collaboration package's question.
 *
 * The precondition the precedent requires holds: `AppRoot ->
 * DefaultEditorLayout -> AgentPresentationNotice` loads this module at boot,
 * so in a real editor the import resolves from cache, and the call site is
 * already async. Notifying is not PRESENTING: a package that calls this door
 * must not carry the shell's notice surface to do it.
 */
async function presentationNotice() {
  return import('./editor-presentation-notice');
}

const SCENE_MODES = new Set<ShadingMode>([
  'solid',
  'clay',
  'unlit',
  'wireframe',
  'normals',
  'overdraw',
]);

/**
 * Reveal the bottom-drawer utility a view names — the ONE door onto the
 * drawer, routing to the same `showWorkspaceUtility` reveal a menu click uses.
 *
 * Every id names a utility id, and a `tool:` one names a tab a PACKAGE or the
 * OPEN PROJECT contributes (`tool-loader.ts` registers each
 * `workspace.utility` contribution as `tool:<contribution-id>` in the
 * registry's `project` cluster). Which of those exist depends entirely on
 * what is installed, so existence is checked HERE, against the live registry:
 * `showWorkspaceUtility` silently ignores an id it cannot find, which is
 * precisely the "the door did nothing and said nothing" failure this door
 * exists to prevent.
 */
function waitForWorkspaceUtility(id: string, timeoutMs = 5_000): Promise<void> {
  if (availableWorkspaceUtilities().some((item) => item.id === id)) return Promise.resolve();
  return new Promise((resolve) => {
    let timeout = 0;
    let unsubscribe = () => {};
    const finish = () => {
      clearTimeout(timeout);
      unsubscribe();
      resolve();
    };
    unsubscribe = subscribeWorkspaceUtilities(() => {
      if (availableWorkspaceUtilities().some((item) => item.id === id)) finish();
    });
    if (availableWorkspaceUtilities().some((item) => item.id === id)) finish();
    else timeout = window.setTimeout(finish, timeoutMs);
  });
}

async function revealUtility(utility: EditorView['utility']): Promise<void> {
  if (!utility) return;
  if (!availableWorkspaceUtilities().some((item) => item.id === utility)) {
    // A cold Vite graph can register the project catalog before its
    // contribution modules finish loading — the same race the `tool` ADDRESS
    // resolves in its own `settle`, by driving the owning discovery pass
    // rather than racing it.
    const contributed = utility.startsWith(EDITOR_VIEW_TOOL_UTILITY_PREFIX);
    if (contributed) {
      await (await projectToolContributions()).refreshProjectToolContributions();
      // Discovery can already have started another refresh. The pass above
      // then yields to that newer epoch rather than publishing stale results;
      // wait for its registry publication before deciding the deep link is
      // broken. This is event-driven and bounded so a genuinely absent tool
      // still gets the teaching error below.
      await waitForWorkspaceUtility(utility);
    }
    if (!availableWorkspaceUtilities().some((item) => item.id === utility)) {
      const registered = availableWorkspaceUtilities().map((item) => item.id);
      const hint = contributed
        ? (await projectToolContributions()).contributionFailureHint(
            utility.slice(EDITOR_VIEW_TOOL_UTILITY_PREFIX.length),
          )
        : '';
      throw new Error(
        `Utility is not registered: ${utility}.` +
          hint +
          ` Registered utilities: ${registered.length > 0 ? registered.join(', ') : '(none)'}.` +
          ' A project contributes one by exporting a `workspace.utility` tool contribution;' +
          ' its view id is `tool:<contribution-id>`.',
      );
    }
  }
  showWorkspaceUtility(utility);
}

/**
 * Focus a static workspace panel by key — the ONE resolution behind the
 * session verb (`show-panel`) and a view's `panel`, routing to the same
 * `showWorkspaceStaticPanel` reveal the Window menu's own items use.
 *
 * The vocabulary is read from the static-panel REGISTRY at call time, never
 * kept by hand here: a door with its own list is how `showPanel` came to know
 * five names and none of the seven panels a human can click. An unknown key
 * refuses naming the keys the registry holds; a key the registry holds but
 * this layout does not show (the Inspector under its compact presentation,
 * the Conversations panel with the harness collapsed) refuses saying so,
 * because a silent no-op is the same failure one layer in.
 */
export async function revealStaticPanel(panel: string): Promise<WorkspaceStaticPanelKind> {
  const kinds = WORKSPACE_STATIC_PANELS.map((entry) => entry.kind);
  const kind = kinds.find(
    (candidate): candidate is WorkspaceStaticPanelKind => candidate === panel,
  );
  if (!kind) {
    throw new Error(`"${panel}" is not a panel of this editor. Panels: ${kinds.join(', ')}.`);
  }
  showWorkspaceStaticPanel(kind);
  if (!(await waitUntil(() => activeWorkspaceStaticPanel() === kind))) {
    throw new Error(
      `The ${kind} panel is not in this workspace's layout, so it could not be focused. ` +
        `Panels: ${kinds.join(', ')}.`,
    );
  }
  return kind;
}

type ViewDocument<K extends NonNullable<EditorView['document']>['kind']> = Extract<
  NonNullable<EditorView['document']>,
  { kind: K }
>;

/**
 * Reveal the workspace scene document.
 *
 * `path` is purely PROVENANCE here — the active adapter's persistence
 * destination, whatever its format — so restoring this view activates the
 * scene surface and lets its adapter own what is on it. Nothing fetches or
 * parses the path.
 */
function openSceneView(_store: EditorShellStore, _document: ViewDocument<'scene'>) {
  activateWorkspaceDocument('workspace:scene');
  return 'workspace:scene';
}

/**
 * Reveal the edit-time document that owns a manifest root.
 *
 * The wait is for the BOOT RACE — a root's document is installed
 * asynchronously, and an explicit view is durable intent, so a document that is
 * merely late must still land. It is NOT a way to discover that a root has no
 * document at all: `rootDocumentGap` is that answer, registered by whoever owns
 * the decision, and it ends the wait the moment it exists.
 *
 * MEASURED, and the reason this branch exists: a `dom` root in a project with
 * no UI board sat here for the full registration window and then threw the
 * generic "not registered" — by which time the asking side (the eval relay
 * gives up at ~5 s) had already reported a timeout against an unresponsive
 * page. The truth was decided within the first second and nobody ever heard it.
 */
async function openRootView(document: ViewDocument<'world'>) {
  let activated = false;
  await waitUntil(() => {
    activated = activateRootDocument(document.id);
    return activated || rootDocumentGap(document.id) !== null;
  }, DOCUMENT_REGISTRATION_TIMEOUT_MS);
  if (activated) return activeWorkspaceDocumentId();
  const gap = rootDocumentGap(document.id);
  if (gap) throw new Error(gap);
  throw new Error(`World document is not registered: ${document.id}`);
}

/**
 * The board story selector (design ledger item 4): resolve the address's
 * `story` against THE BOARD'S OWN provider and apply it through the same seam
 * a board click uses. Unknown or ambiguous refuses loudly WITH the candidates:
 * a view that silently opened the default frame would hand back a confident
 * capture of the wrong story.
 *
 * MEASURED, AND CHANGED, 2026-09-18 (unit 11, edge 8). This used to resolve
 * against the project story REGISTRY (id / export name / label) and then check
 * that the board's provider would accept the id anyway — so the provider's own
 * list was always the real answer and the registry read was a detour. It is
 * the only story edge in this file that is not a registry question at heart:
 * `StoriesProvider` is the CONTRACT and stays host. `StoryRef` carries
 * `{ id, label }`, so an address may name a story by either; the one spelling
 * that no longer resolves is the CSF EXPORT name where an author gave the
 * story a different display name, and the refusal now lists exactly what this
 * board will accept.
 */
async function applyBoardStory(documentId: string, requested: string): Promise<void> {
  const matching = (stories: readonly StoryRef[]) =>
    stories.filter((candidate) => candidate.id === requested || candidate.label === requested);
  let known: readonly StoryRef[] = [];
  const reached = await waitUntil(() => {
    // The BOARD's own adapter, through its registered per-document selection
    // (the same seam waitForAssetDocumentInspector reads) — the store's
    // active-authoring pointer may still be the previous document's, and
    // applying an unknown story id there is a measured warn-and-ignore.
    const provider = workspaceDocumentSelection(documentId)?.adapter?.stories;
    if (!provider) return false;
    known = provider.storiesFor('');
    const matches = matching(known);
    if (matches.length === 1) {
      provider.apply(matches[0]!.id, matches[0]!.id);
      return true;
    }
    // A provider that has listed SOMETHING has answered; waiting longer will
    // not turn an unknown name into a known one.
    return known.length > 0;
  }, DOCUMENT_REGISTRATION_TIMEOUT_MS);
  if (!reached) {
    throw new Error(
      `The board mounted no stories provider within the wait window; story ` +
        `${JSON.stringify(requested)} was not applied.`,
    );
  }
  const matches = matching(known);
  if (matches.length === 1) return;
  throw new Error(
    matches.length === 0
      ? `No story matches ${JSON.stringify(requested)}. This board's stories: ` +
          `${known.map((candidate) => candidate.label).join(', ') || '(none)'}.`
      : `${JSON.stringify(requested)} is ambiguous (${matches.length} stories match) — ` +
          `use the story id: ${matches.map((candidate) => candidate.id).join(' | ')}`,
  );
}

/**
 * A workspace id is the ONE address with two answers, and the order is the
 * point: a module that CONSTRUCTS a workspace document under that id (the
 * account document, the project-tools catalog) claims it through the registry
 * first; everything else is a document some other part of the session has
 * already opened, which the host activates by id out of its own registry. The
 * host used to spell the two constructed ids here by hand.
 */
async function openWorkspaceView(store: EditorShellStore, document: ViewDocument<'workspace'>) {
  const claimed = await openRegisteredDocumentAsync(document.kind, store, document);
  if (claimed !== null) return claimed;
  // Pinned component boards are registered from asynchronous story-media
  // discovery. A URL is durable intent, so wait for the same bounded project
  // bootstrap window as a manifest-world route instead of treating the first
  // pre-registration read as proof that the document does not exist — and end
  // that wait the instant the session can SAY the document is never coming
  // (`workspaceDocumentGap`, the same seam and the same reasoning as
  // `openRootView` above). MEASURED before this branch existed: a workspace id
  // this project has no document for burned the whole 10 s window and then
  // reported the generic "not available", by which time the eval relay had
  // already given up at ~5 s and filed a `play-stall` error against a tab that
  // was answering fine.
  let activated = false;
  await waitUntil(() => {
    // An available document a package registered opens on this request; an
    // open one is activated.
    activated =
      openAvailableWorkspaceDocument(document.id) || activateWorkspaceDocument(document.id);
    return activated || workspaceDocumentGap(document.id) !== null;
  }, DOCUMENT_REGISTRATION_TIMEOUT_MS);
  if (activated) {
    if (document.story !== undefined) await applyBoardStory(document.id, document.story);
    return document.id;
  }
  const gap = workspaceDocumentGap(document.id);
  if (gap) throw new Error(gap);
  throw new Error(`Workspace document is not available: ${document.id}`);
}

/**
 * A VIEW ADDRESS IS AN OPENER ID. Every document kind the host does not
 * construct itself is asked of `document-open-registry.ts` under its OWN kind:
 * a package that can open that kind registers an opener there, and the host
 * addresses the document without importing one (WORKBENCH.md §host versus
 * package). A build whose package list carries no opener for the kind refuses
 * by name rather than pretending — the same honest `null` an undeclared story
 * medium has always given.
 */
async function openDelegatedView(
  store: EditorShellStore,
  document: NonNullable<EditorView['document']>,
): Promise<string> {
  const opened = await openRegisteredDocumentAsync(document.kind, store, document);
  if (opened === null) {
    // The SUBJECT as the address spelled it — an id where the kind has one, the
    // rest of the address where it does not (a story names a module and an
    // export). The host does not know which fields a kind carries, so it prints
    // what it was given rather than reaching for one field's name.
    const { kind, ...subject } = document as { kind: string } & Record<string, unknown>;
    const registered = registeredDocumentOpenerIds();
    throw new Error(
      `Nothing in this editor can open a '${kind}' document (${JSON.stringify(subject)}). ` +
        `Either no package registered an opener for that view address, or the subject ` +
        `does not exist. Registered view addresses: ` +
        `${registered.length > 0 ? registered.join(', ') : '(none)'}.`,
    );
  }
  return opened;
}

/**
 * The second sentence of the refusal above, read from the PROJECT'S OWN
 * document table rather than from a list written here — `project-shape`'s
 * supplier is the resolved table's kinds, which is what makes "model" an
 * answerable mistake instead of an unknown word.
 */
function documentKindAdvice(kind: string): string {
  const kinds = projectDocumentKinds();
  if (kinds === null) return '';
  if (kinds.includes(kind)) {
    return (
      `"${kind}" is a kind in this project's document table, not an address — a document opens ` +
      `in the editor registered for its KIND, so address it as ` +
      `{ kind: "document", id: "<that table entry's id>" }.`
    );
  }
  if (kinds.length === 0) return '';
  return (
    `This project's document table holds ${kinds.map((one) => `"${one}"`).join(', ')}; ` +
    'each opens as { kind: "document", id: "<the table entry\'s id>" }.'
  );
}

async function openRequestedDocument(
  store: EditorShellStore,
  document: EditorView['document'],
): Promise<string | null> {
  if (!document) return activeWorkspaceDocumentId();
  // AN UNRECOGNIZED KIND IS A REFUSAL, exactly as an unrecognized KEY is
  // (`presentEditorView`'s own note). The switch below is exhaustive over the
  // published union, so TypeScript is satisfied — and at RUNTIME a kind outside
  // it fell off the end, returned `undefined`, and presented `ok` having moved
  // nothing, with `view.doc=undefined` in the url it handed back as
  // confirmation. Measured on `{kind: 'model', path: …}`, which is the most
  // likely mistake there is: `model` IS a real kind, of a row in the project's
  // document table, and a table row's address is `{kind: 'document', id}`.
  if (!isEditorViewDocumentKind(document.kind)) {
    throw new Error(
      `present-view does not know the document kind "${String(document.kind)}". ` +
        `An EditorView addresses a document by one of: ${EDITOR_VIEW_DOCUMENT_KINDS.join(', ')}. ` +
        documentKindAdvice(String(document.kind)),
    );
  }
  switch (document.kind) {
    // THE HOST'S OWN TWO, and they construct nothing: the scene surface is a
    // fixed workspace id, and a manifest root's document is routed by
    // `world-document-routing.ts`, the seam whoever owns a root registers into.
    case 'scene':
      return openSceneView(store, document);
    case 'world':
      return openRootView(document);
    // EVERY OTHER KIND IS AN ADDRESS. Resolving a story's module and export,
    // what an asset extension means and when its Inspector is ready, which
    // editor a table entry's KIND opens in and what that document's id turns
    // out to be, which contribution a tool id names — all of it is the kind's
    // own job, answered through `document-open-registry.ts` by whichever
    // module (host family or package) registered that address. The switch
    // stays exhaustive because the ADDRESS SPACE is `@volter/editor-sdk`'s
    // `EditorView`, published and finite; the implementations are not the
    // host's.
    case 'asset':
    case 'tool':
    case 'document':
    case 'story':
    case 'project-tool':
    case 'generation':
      return openDelegatedView(store, document);
    case 'workspace':
      return openWorkspaceView(store, document);
  }
}

function captureDataUrl(dataUrl: string): Pick<ActiveDocumentCapture, 'base64' | 'mimeType'> {
  const comma = dataUrl.indexOf(',');
  return { base64: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl, mimeType: 'image/png' };
}

/** The capture and the scoped probe (`editor-document-probe.ts`) must never
 *  disagree about which element IS the active document, so they share one
 *  lookup rather than two copies of the same query. */
const activeDocumentContent = activeDocumentContainer;

/**
 * A BLACK FRAME IS NOT AN ANSWER — the refusal text when a document holding a
 * live three ingest's own canvas photographs blank, or `null` when it did not.
 *
 * MEASURED (`vgai doctor public/ingest/three-clipping-intersection`): the Game
 * document came back "~100% one flat surface (#000000)" and the walk filed it
 * as that ingestion's play evidence until the flatness measure caught it.
 *
 * The mechanism is NOT that the document is empty — an ingested three game's
 * own canvas IS mounted in it. It is that the canvas is the GAME'S, created
 * without `preserveDrawingBuffer`, so its pixels are readable only from inside
 * the game's own render pass (`ingest/ingest-frame-snapshot.ts` arms exactly
 * that bracket). When the game does not draw inside the snapshot window — a
 * render-on-demand world sitting idle, or a loop the Edit-tab input gate has
 * frozen — the read falls back to a late `drawImage` and the browser hands
 * back the discarded buffer: black, silently, in a PNG that looks like a real
 * photograph.
 *
 * Gated on the composite's OWN degeneracy rather than on the route alone: a
 * three ingest that IS drawing photographs correctly through this door and
 * must keep doing so.
 */
function ingestBlankFrameRefusal(
  documentId: string,
  content: Element,
  flatness: { degenerate: boolean; warning?: string } | undefined,
): string | null {
  if (!flatness?.degenerate) return null;
  const gameCanvas = liveFrameCanvas();
  if (!gameCanvas || !content.contains(gameCanvas)) return null;
  return (
    `This door photographs the "${documentId}" document, which for a live three ingest holds the ` +
    "GAME'S own canvas — created without `preserveDrawingBuffer`, so its pixels can only be read " +
    "from inside the game's own render pass. This game did not draw inside that window (a " +
    'render-on-demand world sitting idle, or a loop the Edit-tab input gate has frozen), so the ' +
    `frame came back BLANK (${flatness.warning ?? 'essentially one flat colour'}) — a PNG that reads ` +
    "as a real image. The editor's own renderer is drawing this same world in the Scene viewport " +
    '(the mount adopts the captured scene), so capture `workspace:scene` instead — or drive the ' +
    'game until it renders and ask again.'
  );
}

/**
 * Capture the active center subject through its native session when one
 * exists, otherwise through the common mounted-document surface.
 *
 * `size` is a square by default and `{width, height}` when a caller wants a
 * shaped frame ({@link CaptureDimensions}). The Object3D document session
 * renders its buffer and camera at that aspect. Composite captures (Scene,
 * Game and DOM documents) photograph the mounted panel at its own size,
 * including its visible overlays, and do not use `size`.
 */
export async function captureActiveEditorDocument(
  store: EditorShellStore,
  size?: CaptureDimensions,
): Promise<ActiveDocumentCapture> {
  const active = activeWorkspaceDocument();
  if (!active) throw new Error('No active editor document to capture.');
  const { descriptor, title } = active;
  const view = currentEditorView(store);
  const documentInfo = {
    id: descriptor.id,
    title,
    kind: descriptor.kind,
    ...(descriptor.provenance?.sourcePath ? { sourcePath: descriptor.provenance.sourcePath } : {}),
    ...(descriptor.provenance?.rootId ? { rootId: descriptor.provenance.rootId } : {}),
  };
  const session = object3DDocumentSession(descriptor.id);
  if (session) {
    const dataUrl = session.captureImage(size);
    if (!dataUrl) throw new Error(`Object3D document could not be captured: ${descriptor.id}`);
    return {
      ...captureDataUrl(dataUrl),
      document: documentInfo,
      view,
      source: 'object3d-document',
    };
  }
  // THE GAME DOCUMENT'S SUBJECT IS THE GAME STACK, not the dock panel holding
  // it — `getInstanceContainer()`, exactly what `bridge-screenshot` photographs.
  //
  // MEASURED (canvas ingest, `flappy`): capturing the PANEL put 64% of the
  // frame at alpha 0. `composite-screenshot.ts`'s overlay leg clones the
  // container's CHILDREN into a neutral wrapper, so from the panel those
  // children are editor-CSS-classed layout divs whose styling a detached
  // serialization drops — the game's own surface then lays out against the
  // wrong containing block and contributes nothing, leaving a hole wherever
  // the canvas leg did not draw. From the runtime container the game's surface
  // IS the child, its inline box survives the clone, and the frame is opaque.
  //
  // It also removes a whole class of defect on its own: two doors onto the same
  // pixels that photograph two different elements will disagree, and a reader
  // has no way to tell which one is the game.
  const content =
    descriptor.id === GAME_DOCUMENT_ID
      ? (liveInstanceContainer() ?? activeDocumentContent(descriptor.id))
      : activeDocumentContent(descriptor.id);
  if (!content) throw new Error(`Active document surface is not mounted: ${descriptor.id}`);
  // `liveCanvasFrame` answers only for a canvas some live surface owns — a
  // registered Pixi `Application` (the `2D` board's exhibits, the first-party
  // canvas root, a canvas ingest) or the three ingest mount's own canvas;
  // every other canvas takes the seam's documented "read it directly" path, so
  // this is inert for every document that presents neither. Without it those
  // canvases photograph blank — a game's own canvas has no
  // `preserveDrawingBuffer`, and this read happens well after its frame. It is
  // the SAME seam `bridge-screenshot` passes, deliberately: two doors onto the
  // same pixels that disagree about which lane they can see is exactly the
  // defect (`live-canvas-frame.ts`).
  const composite = await captureComposite(content, {
    canvasFrame: captureLiveCanvasFrame,
    // The Game document's subject is the game stack and must never inherit
    // editor CSS. Every other composite subject is an editor-owned document;
    // its design-system classes are part of what the user is looking at.
    includeDocumentStyles: descriptor.id !== GAME_DOCUMENT_ID,
  });
  // A blank frame over a live three ingest is REFUSED with its mechanism named
  // rather than handed back as a photograph — see `ingestBlankFrameRefusal`.
  const blank = ingestBlankFrameRefusal(descriptor.id, content, composite.flatness);
  if (blank) throw new Error(blank);
  return {
    base64: composite.base64,
    mimeType: composite.mimeType,
    document: documentInfo,
    view,
    source:
      descriptor.id === GAME_DOCUMENT_ID
        ? 'game-composite'
        : descriptor.id === 'workspace:scene'
          ? 'scene-viewport'
          : 'document-composite',
    layers: composite.layers,
    // The composite already MEASURES whether what it grabbed is a flat,
    // contentless frame (`sampleFlatness`), and `ActiveDocumentCapture`
    // declares the field — this door simply dropped it, so a blank-white
    // headless play frame came back through it looking exactly like a good
    // one. `vgai doctor` files that frame as an ingestion's evidence, so a
    // degenerate capture that cannot say so is a capture that lies.
    ...(composite.flatness ? { flatness: composite.flatness } : {}),
  };
}

type ObjectSession = NonNullable<ReturnType<typeof object3DDocumentSession>>;

/**
 * WHICH STAGE THIS VIEW DRIVES — a plain lookup, and deliberately nothing else.
 *
 * A kind declares when its document is ready to be DRIVEN in its own opener's
 * `ready` (`document-open-registry.ts`), and the registry awaits it inside the
 * open `openRequestedDocument` has already performed above. So by the moment
 * this reads, a document that mounts a stage has one, and a document that
 * mounts none never will: there is nothing left here to wait for and no way
 * for this file to know what a wait would even be waiting on. A view asking
 * for a selection or a viewport on a session-less document takes the
 * store-level path `applyGrid` and `applyDiagnostic` already take for it.
 */
function resolveObjectSession(documentId: string | null): ObjectSession | null {
  return documentId ? object3DDocumentSession(documentId) : null;
}

function applyGrid(store: EditorShellStore, session: ObjectSession | null, grid?: boolean): void {
  if (grid === undefined) return;
  if (session) session.setGrid(grid);
  else if (store.showGrid !== grid) store.toggleGrid();
}

function applyDiagnostic(
  store: EditorShellStore,
  session: ObjectSession | null,
  diagnostic: NonNullable<EditorView['viewport']>['diagnostic'],
  warnings: string[],
): void {
  if (!diagnostic) return;
  if (session) {
    session.setSkeleton(diagnostic === 'skeleton');
    session.setBounds(diagnostic === 'bounds');
    if (diagnostic === 'skeleton' || diagnostic === 'bounds') {
      session.setMode('solid');
    } else {
      session.setMode(diagnostic);
    }
  } else if (SCENE_MODES.has(diagnostic as ShadingMode))
    store.setShadingMode(diagnostic as ShadingMode);
  else warnings.push(`Diagnostic ${diagnostic} is unavailable for this document.`);
}

function applyCamera(
  store: EditorShellStore,
  session: ObjectSession | null,
  camera: NonNullable<EditorView['viewport']>['camera'],
  warnings: string[],
): void {
  if (!camera) return;
  if (typeof camera !== 'string') {
    if (session) session.setCameraPose(camera.position, camera.target, camera.fov);
    else store.setCameraPose(camera.position, camera.target, camera.fov);
    return;
  }
  if (session && camera === 'perspective') {
    session.setProjection('perspective');
    session.frame();
  } else if (session && camera !== 'perspective') session.setViewPreset(camera);
  else if (camera !== 'isometric') store.setViewPreset(camera);
  else warnings.push('Isometric camera is unavailable for this document.');
}

function applyFraming(
  store: EditorShellStore,
  session: ObjectSession | null,
  view: EditorView,
  warnings: string[],
): void {
  if (view.selection?.focus || view.viewport?.frame === 'selection') {
    if (session && !session.frameSelection()) {
      warnings.push('The requested selection could not be framed.');
    } else if (!session) store.focusOnSelection();
  } else if (view.viewport?.frame === 'document') {
    if (session) session.frame();
    else warnings.push('Document framing is unavailable for this document.');
  }
}

function applyPresentation(
  store: EditorShellStore,
  session: ObjectSession | null,
  view: EditorView,
  warnings: string[],
): void {
  if (view.selection) {
    if (session) session.select(view.selection.ids);
    else store.selectMultiple(view.selection.ids);
  }
  applyGrid(store, session, view.viewport?.grid);
  applyDiagnostic(store, session, view.viewport?.diagnostic, warnings);
  applyCamera(store, session, view.viewport?.camera, warnings);
  applyFraming(store, session, view, warnings);
}

/**
 * The one imperative presenter behind both the agent wire command and URL
 * restoration. It applies semantic intent to the current workspace layout;
 * it never encodes physical coordinates.
 */
export async function presentEditorView(
  store: EditorShellStore,
  view: EditorView,
  options: { updateUrl?: boolean; origin?: 'agent' | 'link' | 'return' } = {},
): Promise<PresentedEditorView> {
  if (view?.version !== 1) throw new Error('present-view requires EditorView version 1.');
  // AN UNRECOGNIZED KEY IS A REFUSAL, not a silent pass-through. Every named
  // field below refuses by name; an unnamed one used to be ignored AND echoed
  // back in the answer, so `{version: 1, kind: 'story', …}` — the document's
  // address spelled one level too high — presented `ok`, moved nothing, and
  // handed the caller its own mistake as confirmation (found live, unit 17).
  // The vocabulary is `@volter/editor-sdk`'s `EDITOR_VIEW_KEYS`, published and
  // finite, so the refusal can be complete.
  const unknown = Object.keys(view).filter(
    (key) => !(EDITOR_VIEW_KEYS as readonly string[]).includes(key),
  );
  if (unknown.length > 0) {
    throw new Error(
      `present-view does not know ${unknown.map((key) => `"${key}"`).join(', ')}. ` +
        `An EditorView carries: ${EDITOR_VIEW_KEYS.join(', ')}. ` +
        `A document's own address (kind, and the fields that kind reads) goes under "document".`,
    );
  }
  const previousView = currentEditorView(store);
  // The style bundle, if named: chrome appearance only, refused by name the
  // way `set-style` refuses — never a silent no-op.
  if (view.style !== undefined) {
    const ids = workspaceStyles().map((bundle) => bundle.id);
    if (!ids.includes(view.style)) {
      throw new Error(
        `present-view requires a style of ${ids.join(', ')}, got ${String(view.style)}.`,
      );
    }
    applyWorkspaceStyle(view.style);
  }
  // The workspace first: a layout decides which documents and utilities the
  // rest of the view can reach. An id the open project does not offer refuses
  // by name, the same sentence as `set-workspace` — never a silent no-op.
  if (view.workspace !== undefined) {
    if (!isEditorWorkspaceId(view.workspace)) {
      throw new Error(
        `present-view requires a workspace of ${editorWorkspaceIds().join(', ')}, got ${String(view.workspace)}.`,
      );
    }
    if (activeEditorWorkspace() !== view.workspace) {
      const rebuilt = whenEditorWorkspaceApplied();
      setEditorWorkspace(view.workspace);
      await Promise.race([rebuilt, new Promise<void>((resolve) => setTimeout(resolve, 3000))]);
    }
  }
  const warnings: string[] = [];
  // The keymap is REPORTED, not presented (see `EditorView.keymap`): a link
  // carrying one says so out loud instead of silently rewriting the bindings
  // of whoever opens it.
  if (view.keymap !== undefined && view.keymap !== activeEditorKeymap()) {
    warnings.push(
      `Keymap "${view.keymap}" was not applied — a view reports the keymap, it does not set it. ` +
        `This project is on "${activeEditorKeymap()}" (its adapter's declaration, or its own settings).`,
    );
  }
  const documentId = await openRequestedDocument(store, view.document);
  await revealUtility(view.utility);
  const session = resolveObjectSession(documentId);
  if (session && documentId) await prepareObject3DDocument(documentId);
  // A shared scene/world link can arrive before the source-backed hierarchy
  // mounts. Applying selection to that empty shell loses it when the world is
  // adopted. Wait for the owning adapter to expose the requested identities.
  if (
    !session &&
    view.selection?.ids.length &&
    (view.document?.kind === 'scene' || view.document?.kind === 'world')
  ) {
    const ids = view.selection.ids;
    const ready = await waitUntil(
      () => ids.every((id) => getActiveAuthoring(store).hierarchy.node(id) !== null),
      DOCUMENT_REGISTRATION_TIMEOUT_MS,
    );
    if (!ready) throw new Error(`Shared view selection is not available: ${ids.join(', ')}`);
  }
  // Utility layout reconciliation may restore focus to the previous center
  // tab while an async Object3D document is mounting. Presentation is atomic:
  // after that mount settles, the requested document must be the active one.
  if (documentId && activeWorkspaceDocumentId() !== documentId) {
    activateWorkspaceDocument(documentId);
  }
  applyPresentation(store, session, view, warnings);
  // The panel LAST: opening a document and reconciling the utility drawer both
  // take the dock's focus, so a view naming a panel must END on it.
  if (view.panel !== undefined) await revealStaticPanel(view.panel);

  const url = editorViewUrl(view, window.location.href);
  if (options.updateUrl !== false) window.history.replaceState(window.history.state, '', url);
  const presented = { view, url, warnings };
  if ((options.origin ?? 'agent') === 'agent') {
    (await presentationNotice()).showEditorPresentationNotice({ presented, previousView });
  }
  return presented;
}
