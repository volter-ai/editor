/**
 * A THREE STAGE'S TRANSFORM TOOLS, as the stage contributes them to its
 * document's chrome (`@volter/editor-sdk/kit/document-viewports`): what the
 * host's transform tools drive on it (`stage-context.ts`'s one answer), the tool
 * strip on its shelf and the gizmo's header wells. Every tool writes THIS
 * stage's own store (`stage-store-registry.ts`); the world root's stage runs on
 * the session store, so the Scene document is unchanged either way.
 */
import { stageTransformDoor } from '@volter/editor-sdk/contributions';
import { nativeViewportShelfTool } from '@volter/editor-sdk/kit/native-selection-style';
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
 * THE SHELF'S BOOT TOOL IS THE LOOK'S, applied the first time this stage's
 * shelf draws. Blender's tool shelf opens on Select Box, so a selected object
 * carries no transform gizmo until one is armed
 * (`DensityContribution.viewport.shelfTool` in `@volter/editor-sdk/looks`); this
 * editor's opens on the combined gizmo, which is what every look that names
 * nothing keeps. A BOOT default and never a standing switch: once a person arms
 * a tool the `WeakSet` above keeps this from ever second-guessing them.
 */
function armShelfBootTool(store: EditorShellStore | null): void {
  if (store === null || shelfOpened.has(store)) return;
  shelfOpened.add(store);
  if (nativeViewportShelfTool() === 'select') store.setTransformMode('select');
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
    if (driver === 'gizmo') armShelfBootTool(own);
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
