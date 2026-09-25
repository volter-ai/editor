/**
 * Lightweight registry for live Object3D document sessions.
 *
 * State/control readers only need to find a session that some document has
 * already constructed. Keeping this map beside the implementation made every
 * reader load the implementation's postprocessing, skeleton, outline and
 * diagnostic-rendering graph during a plain Scene boot. The class remains the
 * native session type; this module owns only its live identities.
 */
import { viewGridVisible } from '@volter/editor-sdk/kit/viewport-presentation';
import {
  type DocumentViewport,
  registerDocumentViewport,
} from '@volter/editor-sdk/kit/document-viewports';
import { lazy } from 'react';
import type { Object3DDocumentSession } from './object3d-document-session';
import { registerDocumentStageSession } from '@volter/editor-sdk/kit/document-stage-sessions';

// The document header's shading, helpers and capture menus. Behind `lazy()`, so
// this registry stays the light read it is for every other caller.
const Object3DDocumentToolbar = lazy(() =>
  import('../components/Object3DDocumentToolbar').then((m) => ({ default: m.Object3DDocumentToolbar })),
);

const sessions = new Map<string, Object3DDocumentSession>();
const preparations = new Map<string, () => Promise<void>>();
let registryVersion = 0;
const registryListeners = new Set<() => void>();

function notifyRegistry(): void {
  registryVersion++;
  for (const listener of registryListeners) listener();
}

/** `stage` is what the mounting stage adds to the document's viewport (its
 *  transform tools, which only the stage host knows how to draw). */
export function registerObject3DDocumentSession(
  session: Object3DDocumentSession,
  stage: Partial<DocumentViewport> = {},
): () => void {
  sessions.set(session.documentId, session);
  const stopStageSession = registerDocumentStageSession(session);
  const stopViewport = registerDocumentViewport(session.documentId, {
    ...object3DDocumentViewport(session),
    ...stage,
  });
  notifyRegistry();
  return () => {
    stopViewport();
    stopStageSession();
    if (sessions.get(session.documentId) !== session) return;
    sessions.delete(session.documentId);
    notifyRegistry();
  };
}

const xyz = ([x, y, z]: readonly [number, number, number]) => ({ x, y, z });

/** An Object3D document's own viewport: its session's camera, view mode, grid,
 *  framing, selection and photograph (`@volter/editor-sdk/kit/document-viewports`). */
function object3DDocumentViewport(session: Object3DDocumentSession): DocumentViewport {
  type Preset = Parameters<Object3DDocumentSession['setViewPreset']>[0];
  type Mode = Parameters<Object3DDocumentSession['setMode']>[0];
  return {
    read: () => {
      const pose = session.cameraPose();
      const presentation = session.presentation();
      return {
        camera: { position: xyz(pose.position), target: xyz(pose.target), ...(pose.fov ? { fov: pose.fov } : {}) },
        diagnostic: presentation.skeleton ? 'skeleton' : presentation.mode,
        grid: viewGridVisible(session.documentId),
      };
    },
    setDiagnostic: (diagnostic) => {
      session.setSkeleton(diagnostic === 'skeleton');
      session.setBounds(diagnostic === 'bounds');
      session.setMode(diagnostic === 'skeleton' || diagnostic === 'bounds' ? 'solid' : (diagnostic as Mode));
      return true;
    },
    setCamera: (camera) => {
      if (typeof camera !== 'string') {
        session.setCameraPose(camera.position, camera.target, camera.fov);
      } else if (camera === 'perspective') {
        session.setProjection('perspective');
        session.frame();
      } else session.setViewPreset(camera as Preset);
      return true;
    },
    frame: (target) => (target === 'selection' ? session.frameSelection() : (session.frame(), true)),
    selection: { read: () => session.selection(), apply: (ids) => session.select(ids) },
    idsNamed: (name) => {
      const ids: string[] = [];
      session.root.traverse((object) => {
        if (object.name !== name) return;
        const id = session.idForObject(object);
        if (id) ids.push(id);
      });
      return ids;
    },
    setTransformMode: (mode) => session.viewport.setTransformMode(mode),
    capture: (size) => session.captureImage(size ?? 512),
    prepare: () => prepareObject3DDocument(session.documentId),
    HeaderControls: Object3DDocumentToolbar,
  };
}

export function object3DDocumentSession(documentId: string): Object3DDocumentSession | null {
  return sessions.get(documentId) ?? null;
}

/** Async source-backed documents refresh their graph before a requested view
 * is presented. The callback owns its build and failure semantics. */
export function registerObject3DDocumentPreparation(
  documentId: string,
  prepare: () => Promise<void>,
): () => void {
  preparations.set(documentId, prepare);
  return () => {
    if (preparations.get(documentId) === prepare) preparations.delete(documentId);
  };
}

export async function prepareObject3DDocument(documentId: string): Promise<void> {
  await preparations.get(documentId)?.();
}

/** Every live CHROMED document session — the ones that own a toolbar, an
 *  inspector context and a performance source. This is a presentation registry,
 *  not the Edit-static one: whether a surface's CONTENT time is held is asked of
 *  `coverage/design-time-surfaces.ts`, which every mount publishes into
 *  (chromeless preview cards included). */
export function allObject3DDocumentSessions(): readonly Object3DDocumentSession[] {
  return [...sessions.values()];
}

export function subscribeObject3DDocumentSessions(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => registryListeners.delete(listener);
}

export function object3DDocumentSessionsVersion(): number {
  return registryVersion;
}

export function __resetObject3DDocumentSessionsForTest(): void {
  sessions.clear();
  preparations.clear();
  notifyRegistry();
}
