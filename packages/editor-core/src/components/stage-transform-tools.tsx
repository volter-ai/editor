/**
 * A THREE STAGE'S TRANSFORM TOOLS, as the stage contributes them to its
 * document's chrome (`@volter/editor-sdk/kit/document-viewports`): what the
 * host's transform tools drive on it (`stage-context.ts`'s one answer), the tool
 * strip on its shelf and the gizmo's header wells. Every tool writes THIS
 * stage's own store (`stage-store-registry.ts`); the world root's stage runs on
 * the session store, so the Scene document is unchanged either way.
 */
import { stageTransformDoor } from '@volter/editor-sdk/contributions';
import { type ViewportInteraction, viewPresentation } from '@volter/editor-sdk/kit/viewport-presentation';
import { useEffect, useSyncExternalStore } from 'react';
import { useEditorStore } from '../editor-runtime';
import type { EditorShellStore } from '../editor-shell-store';
import { threeStageTransformDriver } from './stage-transform-chrome';
import { stageStore, stageStoresVersion, subscribeStageStores } from '../stage-store-registry';
import { threeStateOf } from '../three-state';
import { ToolStrip, TransformHeaderControls } from './Toolbar';

/**
 * THE STAGES WHOSE SHELF HAS ALREADY OPENED — a `WeakSet` because a store
 * outlives nothing here: it is the stage's, and when the stage goes so does the
 * entry.
 */
const shelfOpened = new WeakSet<EditorShellStore>();

/**
 * THE SHELF'S BOOT TOOL IS THE STAGE'S FUNCTION (its view presentation's
 * `interaction.bootTool`, ARCHITECTURE.md rule 7), applied the first time this stage's shelf
 * draws. Blender's tool shelf opens on Select Box, so a selected object carries no transform
 * gizmo until one is armed (the Blender stage's starting values); this editor's opens on the
 * combined gizmo. A BOOT default and never a standing switch: once a person arms a tool the
 * `WeakSet` above keeps this from ever second-guessing them.
 */
function armShelfBootTool(store: EditorShellStore | null, documentId: string): void {
  if (store === null || shelfOpened.has(store)) return;
  shelfOpened.add(store);
  const mode = {
    select: 'select',
    transform: null,
    move: 'translate',
    rotate: 'rotate',
    scale: 'scale',
  } as const satisfies Record<ViewportInteraction['bootTool'], string | null>;
  const boot = mode[viewPresentation(documentId).interaction.bootTool];
  if (boot !== null) store.setTransformMode(boot);
}

export function ThreeStageTransformTools({ documentId }: { readonly documentId: string }) {
  useSyncExternalStore(subscribeStageStores, stageStoresVersion, stageStoresVersion);
  const shell = threeStateOf(useEditorStore());
  const driver = threeStageTransformDriver(documentId);
  const own = stageStore(documentId);
  // In an effect rather than in the body because arming notifies the store, and
  // a store notification during another component's render is React's own
  // "cannot update while rendering" case.
  useEffect(() => {
    if (driver === 'gizmo') armShelfBootTool(own, documentId);
  }, [driver, own]);
  if (driver === 'none') return null;
  const door = driver === 'modal' ? stageTransformDoor(documentId) : null;
  return <ToolStrip store={own ?? shell} {...(door ? { door } : {})} />;
}

export function ThreeStageTransformControls({ documentId }: { readonly documentId: string }) {
  useSyncExternalStore(subscribeStageStores, stageStoresVersion, stageStoresVersion);
  const shell = threeStateOf(useEditorStore());
  return <TransformHeaderControls store={stageStore(documentId) ?? shell} />;
}
