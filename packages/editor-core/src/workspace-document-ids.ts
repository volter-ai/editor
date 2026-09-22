/** Stable ids for the editor-owned PINNED center documents. Kept outside their
 * React implementations so root-document routing and the center tab-strip
 * order contract can name them without
 * importing the stage host or the three board. */
export const GAME_DOCUMENT_ID = 'workspace:game';
export const SCENE_DOCUMENT_ID = 'workspace:scene';

/**
 * THE canvas root's Scene document.
 *
 * A three project's `Scene` is the one stage host showing the world root — the editor's own WebGL
 * viewport, which a canvas world has no use for (it draws through its own Pixi
 * renderer). So a canvas project's scene is a document of its own, presenting
 * the native display tree through an independent world-space editor camera.
 * It takes the same `Scene` TITLE and the same slot in the pinned strip,
 * because to the author it is the same thing: the game's world composition.
 *
 * Separate ID rather than a second Content behind {@link SCENE_DOCUMENT_ID}
 * because `CenterDocuments.syncCenterDocuments` owns that id's whole lifetime
 * and CLOSES it on every store notify for a project with no three root — two
 * owners for one id is a fight, not a design.
 */
export const CANVAS_SCENE_DOCUMENT_ID = 'workspace:canvas-scene';

/**
 * THE project's 3D board — the three-side design document. The board is a
 * project-wide singleton: one generated view of one registry, under a stable
 * project-level id, so a persisted layout never strands the panel when a root
 * or file is renamed.
 */
export const THREE_COMPONENTS_DOCUMENT_ID = 'workspace:3d-components';

/**
 * THE project's 2D board — the canvas-side design document, and the exact
 * counterpart of {@link THREE_COMPONENTS_DOCUMENT_ID} on the Pixi surface.
 */
export const CANVAS_COMPONENTS_DOCUMENT_ID = 'workspace:2d-components';

/**
 * THE project's UI board — one document per PROJECT, not one per root, and the
 * exact counterpart of {@link THREE_COMPONENTS_DOCUMENT_ID} on the dom side.
 */
export const UI_COMPONENTS_DOCUMENT_ID = 'workspace:ui-components';

/**
 * The pinned documents whose registration is ASYNC — a project's own
 * authoring bootstrap opens them, after the workspace restore has already
 * asked for the stored active tab. Restoring one as the active document
 * therefore REMEMBERS the request until that stable descriptor opens
 * (`restorePinnedWorkspaceDocumentActivation`), which arbitrary ids may not
 * do: a persisted tool/asset id that never reopens would otherwise become
 * latent state that steals activation from a standing tab much later.
 */
export const PINNED_ASYNC_DOCUMENT_IDS: ReadonlySet<string> = new Set([
  CANVAS_SCENE_DOCUMENT_ID,
  CANVAS_COMPONENTS_DOCUMENT_ID,
  THREE_COMPONENTS_DOCUMENT_ID,
  UI_COMPONENTS_DOCUMENT_ID,
]);
