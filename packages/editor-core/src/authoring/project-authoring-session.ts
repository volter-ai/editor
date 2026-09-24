/** The project owns its authoring session. Scene tabs attach renderers to it;
 * closing a viewport must not remove the other scenes or component canvases. */
import type { EditorShellStore } from '../editor-shell-store';
import { runProjectReady } from '../project-ready';
import {
  availableWorkspaceDocuments,
  requestAvailableWorkspaceDocument,
} from '../workspace-available-documents';
import { activeWorkspaceDocumentId, openWorkspaceDocuments } from '@volter/editor-sdk/kit/workspace-document-registry';
import type { CompositeAuthoringAdapter } from './composite-authoring-adapter';
import {
  bindEditModeRebuildOwner,
  exitEditModeAuthoring,
  installEditModeAuthoringForProject,
} from './edit-mode-authoring';

type Stage = (composite: CompositeAuthoringAdapter) => Promise<void>;
class ProjectAuthoringSession {
  private references = 0;
  private disposed = false;
  private composite: CompositeAuthoringAdapter | undefined;
  private disposeDocuments: (() => void) | undefined;
  private stages = new Set<Stage>();
  private tail: Promise<void> = Promise.resolve();
  private unbind: () => void;
  readonly ready: Promise<void>;

  constructor(private readonly store: EditorShellStore) {
    this.unbind = bindEditModeRebuildOwner(() => this.rebuild());
    this.ready = this.rebuild();
  }
  retain(): () => void {
    this.references++;
    return () => {
      if (--this.references > 0) return;
      this.disposed = true;
      this.unbind();
      this.disposeDocuments?.();
      exitEditModeAuthoring(this.composite);
      sessions.delete(this.store);
    };
  }
  attach(stage: Stage): { ready: Promise<void>; dispose: () => void } {
    const release = this.retain();
    this.stages.add(stage);
    // A stage attached during a rebuild is mounted by that rebuild. A later
    // stage attaches to the already installed project without reinstalling it.
    const ready = this.composite ? stage(this.composite) : this.tail;
    return {
      ready,
      dispose: () => {
        this.stages.delete(stage);
        release();
      },
    };
  }
  private rebuild(): Promise<void> {
    const run = this.tail.then(async () => {
      if (this.disposed) return;
      const active = activeWorkspaceDocumentId();
      const available = new Set(availableWorkspaceDocuments().map((entry) => entry.descriptor.id));
      const reopen = this.composite
        ? openWorkspaceDocuments()
            .map((document) => document.descriptor.id)
            .filter((id) => available.has(id))
        : [];
      this.disposeDocuments?.();
      this.disposeDocuments = undefined;
      exitEditModeAuthoring(this.composite);
      this.composite = undefined;
      const composite = await installEditModeAuthoringForProject(this.store);
      if (this.disposed) {
        exitEditModeAuthoring(composite);
        return;
      }
      const { installRootDocuments } = await import('../components/world-documents');
      if (this.disposed) {
        exitEditModeAuthoring(composite);
        return;
      }
      this.composite = composite;
      this.disposeDocuments = installRootDocuments(this.store, composite);
      for (const id of reopen) requestAvailableWorkspaceDocument(id, id === active);
      await Promise.all([...this.stages].map((stage) => stage(composite)));
    });
    this.tail = run.catch(() => undefined);
    return run;
  }
}
const sessions = new Map<EditorShellStore, ProjectAuthoringSession>();
function sessionFor(store: EditorShellStore): ProjectAuthoringSession {
  let session = sessions.get(store);
  if (!session) {
    session = new ProjectAuthoringSession(store);
    sessions.set(store, session);
  }
  return session;
}
export function retainProjectAuthoringSession(store: EditorShellStore) {
  const session = sessionFor(store);
  return { ready: session.ready.then(() => runProjectReady()), dispose: session.retain() };
}
export function attachProjectAuthoringStage(store: EditorShellStore, stage: Stage) {
  return sessionFor(store).attach(stage);
}
