import type { ToolDocumentEntry } from '@volter/editor-sdk/contributions';
import { space, themeVars } from '@volter/editor-sdk/widgets';
/**
 * Project-global tool host (W4; re-homed by workspace-shell W3) — renders one
 * project tool's component wrapped in an error boundary: tools are PROJECT
 * code running in the editor (§4's trust note), and a crashing tool must
 * never take the editor down with it. A render crash swaps the content for a
 * teaching message naming the source file; every other tool keeps working. An
 * HMR reload of the tool remounts the host fresh (its hosts key it on the
 * load version — see `tool-documents.tsx` and `tool-loader.ts`'s utility
 * registrations), which also clears a tripped boundary — fix the file, save,
 * retry for free.
 *
 * Chrome stays editor-styled (§3.4): the host provides the scrollable
 * editor-toned container. Contributions use ordinary React for composition
 * and the public editor widgets for shared interactive controls.
 */

import {
  Component,
  createElement as createEditorElement,
  type ErrorInfo,
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createRoot as createEditorRoot } from 'react-dom/client';
import { accountVersion, contributionAccount, subscribeAccount } from '../account';
import {
  markContributedDocumentMounted,
  publishDocumentContext,
} from '../document-context-registry';
import { notify } from '../editor-notifications';
import { toolGameplaySessions } from '../gameplay-sessions';
import { beginPageWork } from '../play-boot-phase';
import {
  subscribeToolContributionPlay,
  toolContributionPlay,
  toolContributionPlayKey,
} from '../tool-contribution-play';
import { getToolContributionClient, type SurfaceToolContribution } from '../tool-loader';

// The analytics timeline is the play-session shell's — recordings, the
// play-log ledger, the server transport behind them — and only the
// `workspace.analytics` point mounts it. A lazy door keeps those 97 files
// out of every host that mounts contributions without play.
const GameplaySessionTimeline = lazy(() =>
  import('./GameplaySessionTimeline').then((m) => ({ default: m.GameplaySessionTimeline })),
);

import { toolContributionSurfaces } from './ToolContributionSurfaces';

interface ToolErrorBoundaryProps {
  /** Project-relative source file, shown in the crash message. */
  file: string;
  children: ReactNode;
}

interface ToolErrorBoundaryState {
  error: Error | null;
}

/** Shared by the dock host below and `InspectorToolSection.tsx` (W3) — one
 *  crash-containment story for every project-tool mount point. */
export class ToolErrorBoundary extends Component<ToolErrorBoundaryProps, ToolErrorBoundaryState> {
  override state: ToolErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ToolErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Loud in the editor console too (same channel the tool-loader's
    // teaching errors use), with React's component stack for context.
    // biome-ignore lint/suspicious/noConsole: deliberate, greppable — a crashed project tool must be diagnosable from the console (§6.5 "errors teach"), mirroring tool-loader.ts
    console.error(
      `[tools] ${this.props.file} crashed while rendering:`,
      error,
      info.componentStack,
    );
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: space[6],
            fontSize: 'var(--vgai-font-md)',
            color: themeVars.semantic.danger,
            maxWidth: 640,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: space[2] }}>
            Tool crashed: <code>{this.props.file}</code>
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{String(this.state.error)}</div>
          <div style={{ color: themeVars.content.muted, marginTop: space[3] }}>
            The editor is fine — fix the tool file and save; it reloads in place.
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * ONE React FOR A CONTRIBUTION, AND IT IS THE EDITOR'S.
 *
 * This root is ISOLATED (its own tree, its own `onUncaughtError`) so a
 * crashing tool cannot take the editor's chrome down — but isolation is about
 * the TREE, never about the instance: the root is created with the editor's
 * own `react-dom/client`, the same React the contribution's modules import.
 *
 * That agreement is the whole contract, and it is easy to break from the other
 * side. Under the packaged runtime a project's `src/contributions/**` module has its
 * `react` resolved to the SHELL's own chunk (`vite-plugin-shared-react.ts` —
 * the doorway that made inspector contributions render at all), while this
 * mount used to create its root from the PROJECT's `react-dom/client`
 * (`/__vgai-react-world-runtime`). Hooks from one React inside a tree
 * reconciled by another is "Invalid hook call", and it killed EVERY workspace
 * document and utility on a packaged editor while the same contributions
 * rendered fine in a checkout — measured on `node dist-server/packaged.mjs`:
 * `[tools] <a project document contribution> crashed while rendering: Minified
 * React error #321`, thrown at the document's FIRST hook, with a one-frame
 * component stack (this root) rather than the editor's.
 *
 * The checkout path was always this way (`dev.ts` serves both halves through
 * one Vite), so this is convergence, not a new design: packaged now mounts a
 * contribution exactly the way dev and `InspectorToolSection` already did.
 * Editor surfaces are therefore handed over directly — no bridge root, because
 * there is no longer a graph boundary for one to cross.
 */
function ProjectToolMount({
  contribution,
  Component: override,
  documentId,
  active,
  document: documentEntry,
  accountRevision,
  playKey,
}: {
  contribution: SurfaceToolContribution;
  /** Mount THIS component of the contribution instead of its default — the
   *  document's `Toolbar` in the host's header strip, with the same props. */
  Component?: React.ComponentType<Record<string, unknown>> | undefined;
  documentId?: string;
  active?: boolean;
  /** The adapter-table entry this mount edits (`kind-documents.tsx`). */
  document?: ToolDocumentEntry | undefined;
  accountRevision: number;
  /** Identity of the bound play instance. In the deps below for the same
   *  reason `accountRevision` and `active` are: the props this effect renders
   *  are captured when it runs, so a change the effect does not observe is a
   *  contribution left describing a game that is no longer the one showing. */
  playKey: string;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const rootRef = useRef<ReturnType<typeof createEditorRoot> | null>(null);
  const endWork = useRef<(() => void) | null>(null);
  const contributionFile = useRef(contribution.file);
  contributionFile.current = contribution.file;
  const mountedDocumentId = useRef(documentId);
  mountedDocumentId.current = documentId;

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    setError(null);
    const fail = (reason: unknown, info?: { componentStack?: string | undefined }) => {
      if (disposed) return;
      const caught = reason instanceof Error ? reason : new Error(String(reason));
      // biome-ignore lint/suspicious/noConsole: project tool failures remain loud while the isolated root protects editor chrome
      console.error(
        `[tools] ${contributionFile.current} crashed while rendering:`,
        caught,
        info?.componentStack,
      );
      setError(caught);
      // A CRASH IS ALSO AN ANSWER. React tears the whole inner root down on an
      // uncaught render error, so the mount signal below never fires — and an
      // opener's `ready`, which waits for that signal to learn whether this
      // document mounted a stage, would sit out the entire registration window
      // before proceeding. MEASURED on a `full` scaffold: presenting the
      // template's deliberately-throwing `data.document` stub took 10.018s
      // against 0.045s for a healthy one. A contribution that crashed has
      // decided what it is — it has no stage — and this is the host's own
      // path, outside the root that just died.
      if (mountedDocumentId.current) markContributedDocumentMounted(mountedDocumentId.current);
    };
    // Prop updates (account polling, tab activation, play binding) reconcile
    // the existing tree. Recreating its root discards tool state and GPU
    // contexts. Only this host's lifetime owns the root and its container.
    // Cleanup stays deferred: React cannot unmount a nested root during the
    // parent root's commit. A fresh container also makes StrictMode safe.
    const container = element.appendChild(document.createElement('div'));
    container.style.display = 'contents';
    const root = createEditorRoot(container, { onUncaughtError: fail });
    rootRef.current = root;
    return () => {
      disposed = true;
      rootRef.current = null;
      endWork.current?.();
      endWork.current = null;
      queueMicrotask(() => {
        root.unmount();
        container.remove();
      });
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    setError(null);
    const shared: Record<string, unknown> = {
      contributionId: contribution.id,
      client: getToolContributionClient(),
      surfaces: toolContributionSurfaces,
      account: contributionAccount(),
      // A contribution's notice is a REPORT (Blender's info line): the same
      // title from the same contribution replaces its card rather than
      // stacking, and info/warning cards fade — nine refusals from one
      // session left nine cards over the Conversations panel (2026-09-06).
      // An error stays until dismissed, as every error card does.
      work: (label: string | null) => {
        endWork.current?.();
        endWork.current =
          label === null ? null : beginPageWork(`building ${label.replace(/^building /, '')}`);
      },
      notify: (notice: { tone: 'info' | 'warning' | 'error'; title: string; detail?: string }) =>
        notify({
          ...notice,
          id: `contribution:${contribution.id}:${notice.title}`,
          ...(notice.tone === 'warning' ? { fades: true } : {}),
        }),
      ...(contribution.point === 'workspace.analytics'
        ? { gameplaySessions: toolGameplaySessions }
        : { play: toolContributionPlay() }),
      ...(documentId
        ? {
            documentId,
            publishContext: (context: unknown) => publishDocumentContext(documentId, context),
          }
        : {}),
      ...(active !== undefined ? { active } : {}),
      ...(documentEntry ? { document: documentEntry } : {}),
    };
    // Utilities AND documents may present without a callable (a pure-view
    // Data Book); the generation points always carry one.
    // The union collapses to the widest props shape; each component's own
    // signature narrows what it actually reads.
    const Component =
      override ??
      (contribution.Component as unknown as React.ComponentType<Record<string, unknown>>);
    const element = createEditorElement(Component, {
      ...shared,
      ...(contribution.tool ? { tool: contribution.tool } : {}),
    });
    // THE MOUNT SIGNAL RIDES INSIDE THE CONTRIBUTION'S OWN ROOT, never outside
    // it: `root.render` is SCHEDULED, so an effect in the host's own tree fires
    // while this root has not rendered a thing. Wrapped here, the signal is a
    // parent of the contribution in ITS root, and React runs every child effect
    // first — including the stage announcement a document mounts through
    // `ToolContributionSurfaces`. That ordering is what makes "no announcement"
    // mean "this document has no stage" for an opener's `ready`.
    root.render(
      documentId ? createEditorElement(ContributionMountSignal, { documentId }, element) : element,
    );
  }, [accountRevision, active, contribution, override, documentId, documentEntry, playKey]);

  // THE HOST DIV STAYS MOUNTED THROUGH A CRASH. Swapping it for the message
  // hands this root's container to React's own removal while the inner root
  // still owns the nodes inside it, and the unmount then throws
  // `NotFoundError: … removeChild … not a child of this node` — a second,
  // louder error about the teardown, on top of the one the tool actually hit.
  return (
    <>
      {error ? (
        <div style={{ padding: space[6], color: themeVars.semantic.danger }}>
          Tool crashed: <code>{contribution.file}</code>
          <div style={{ whiteSpace: 'pre-wrap', marginTop: space[2] }}>{String(error)}</div>
        </div>
      ) : null}
      <div ref={host} style={{ minHeight: 0, width: '100%' }} />
    </>
  );
}

/** See the render site above: this is a PARENT of the contribution inside the
 *  contribution's own React root, so its effect runs after every child's. */
function ContributionMountSignal({
  documentId,
  children,
}: {
  readonly documentId: string;
  // Supplied as `createElement`'s third argument at the render site, which the
  // props-object overload cannot see.
  readonly children?: ReactNode;
}) {
  useEffect(() => markContributedDocumentMounted(documentId), [documentId]);
  return <>{children}</>;
}

/** One project-global tool's content host: editor-styled scroll container +
 *  boundary. Analytics receives its universal session rail here; all other
 *  contribution content remains entirely project-owned. */
export function ToolHost({
  contribution,
  Component,
  documentId,
  active,
  document: documentEntry,
}: {
  contribution: SurfaceToolContribution;
  /** Mount this component of the contribution instead of its default (the
   *  document's `Toolbar` — see `tool-documents.tsx`). */
  Component?: React.ComponentType<Record<string, unknown>> | undefined;
  documentId?: string;
  active?: boolean;
  /** The adapter-table entry a kind document edits (`kind-documents.tsx`). */
  document?: ToolDocumentEntry | undefined;
}) {
  const accountRevision = useSyncExternalStore(subscribeAccount, accountVersion, accountVersion);
  const playKey = useSyncExternalStore(
    subscribeToolContributionPlay,
    toolContributionPlayKey,
    toolContributionPlayKey,
  );
  const mountKey = contribution.point === 'workspace.analytics' ? 'gameplay-sessions' : playKey;
  return (
    <div
      data-testid={`tool-panel-${contribution.id}`}
      style={{
        flex: 1,
        minHeight: 0,
        overflow: contribution.point === 'workspace.analytics' ? 'visible' : 'auto',
        color: themeVars.content.primary,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {contribution.point === 'workspace.analytics' ? (
        <Suspense fallback={null}>
          <GameplaySessionTimeline />
        </Suspense>
      ) : null}
      <ToolErrorBoundary file={contribution.file}>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <ProjectToolMount
            contribution={contribution}
            {...(Component ? { Component } : {})}
            accountRevision={accountRevision}
            playKey={mountKey}
            {...(documentId ? { documentId } : {})}
            {...(active !== undefined ? { active } : {})}
            {...(documentEntry ? { document: documentEntry } : {})}
          />
        </div>
      </ToolErrorBoundary>
    </div>
  );
}
