/**
 * AppRoot — the editor's own tree, and what it shows before the project is
 * readable: a loading surface while detection runs, a startup ERROR surface
 * when it definitively fails, the editor when it succeeds. Only a DEFINITE bad
 * answer counts as a failure — "the server has not answered yet" keeps asking
 * (`decideProjectDetectionRecovery`), because a tab that is merely still
 * booting must never settle into a terminal screen with no listener on it.
 *
 * THERE IS NO PROJECT PICKER. A session serves ONE project — `vgai edit <dir>`
 * is how you choose it, and the workbench's own Open Folder is how you leave —
 * so a page that has no project has nothing to offer but the sentence saying
 * so. The picker, its New Project wizard, its `?create-from=` deep link and
 * the "Switch Project…" route back to it are all gone with the standalone
 * page they lived on.
 *
 * This component also holds the page's SESSION PRESENCE: one SSE connection
 * for the lifetime of the page, whatever surface is on screen, plus a report
 * of WHICH surface that is. Presence belongs at the root because the fact it
 * asserts — this page is attached to this session — is true at the root, not
 * inside the editor.
 *
 * Key principle: No Three.js, no EditorShellStore, no RAF loop until a project
 * is readable.
 */

import { commandLine, commandSequence } from '@volter/editor-sdk/kit/product-command';
import { editorDocumentTitle } from '@volter/editor-sdk/session/editor-brand';
import {
  ProjectCompatibilityError,
  type StartupRecovery,
} from '@volter/editor-sdk/session/editor-compatibility';
import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from 'react';
import { startAccountActivity } from '@volter/editor-sdk/kit/account-client';
import {
  decideProjectDetectionRecovery,
  ProjectDetectionTimeoutError,
  ServerProjectDetectionError,
  type ServerProjectFailureReport,
} from '@volter/editor-sdk/kit/boot-routing';
import { EditorProvider } from '../EditorContext';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { connectTabPresence, reportTabRoute } from '@volter/editor-sdk/kit/editor-presence';
import { type ActiveProject, detectProject } from '@volter/editor-sdk/kit/project-manager';
import { onTabAdopt } from '@volter/editor-sdk/kit/tab-lifecycle-client';
import { DefaultEditorLayout } from './DefaultEditorLayout';
import { EditorLeaseGuard } from './EditorLeaseGuard';
import { StartupErrorScreen } from './StartupErrorScreen';
import { StartupLoadingScreen } from './StartupLoadingScreen';

type State =
  | {
      status: 'detecting';
      /** When the CURRENT run of attempts began, or null while the first
       *  attempt is still in flight — an instant boot must not flash a
       *  "we're waiting" surface it will never need. */
      waitingSince: number | null;
      /** The last failed attempt's message, shown verbatim while we re-ask. */
      lastError?: string;
    }
  | { status: 'no-project'; returnProject?: ActiveProject }
  | {
      status: 'error';
      message: string;
      recovery?: StartupRecovery;
      report?: ServerProjectFailureReport;
    }
  | { status: 'ready'; project: ActiveProject };

interface EditorRuntimeBoundaryProps {
  readonly children: ReactNode;
}

/**
 * Keep the application-level EditorProvider alive when editor chrome throws.
 * The provider owns the command listener, so letting an unwrapped descendant
 * error unmount it leaves a still-beating tab that can no longer answer
 * `vgai status`, `play`, or recovery commands. The fallback is deliberately a
 * normal startup-error surface inside the provider: Retry re-renders the
 * chrome; Project Browser remains reachable; the listener never goes away.
 */
class EditorRuntimeBoundary extends Component<
  EditorRuntimeBoundaryProps,
  { readonly error: Error | null }
> {
  override state: { readonly error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { readonly error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    editorConsole.error(
      `Editor chrome crashed while the command listener stayed attached: ${error.message}\n${info.componentStack ?? ''}`,
      'editor',
    );
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <StartupErrorScreen
        error={{ message: `The editor surface crashed: ${this.state.error.message}` }}
        onRetry={() => this.setState({ error: null })}
      />
    );
  }
}

/**
 * Every surface this app can show, wrapped so the supervised lease
 * (`EditorLeaseGuard` / `editor-lease.ts`) is mounted on ALL of them.
 *
 * It used to be mounted on exactly one — a child of `EditorRuntimeBoundary`
 * inside the `ready` branch — which put the watchdog in the only place a
 * failing server tends not to leave the user. A server that dies while the
 * launcher is up, or that takes the boot probe down with it onto the error
 * screen, or that makes some piece of chrome throw and so trips the boundary
 * into replacing its children (the watchdog among them, permanently), produced
 * a page with no supervision at all: fully rendered, perfectly healthy-looking,
 * and never going to say otherwise. The surfaces a dead server actually
 * produces were the ones not watching for it.
 *
 * Being OUTSIDE the boundary is half the point and not an accident of
 * nesting: the guard's whole job is to survive the failures that break the
 * editor, so it must not be something the editor's own crash can unmount. It
 * needs no context and mounts nothing but a portal, so there is nothing for it
 * to be inside of.
 */
function EditorSurface({ children }: { readonly children: ReactNode }) {
  return (
    <>
      {children}
      <EditorLeaseGuard />
    </>
  );
}

function startupFailure(error: unknown): Extract<State, { status: 'error' }> {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof ProjectCompatibilityError) {
    return { status: 'error', message, recovery: error.recovery };
  }
  // A boot probe that failed carries the server's own answer — the served
  // path and the verbatim error — so the surface can name both instead of
  // flattening them into one sentence.
  if (error instanceof ServerProjectDetectionError) {
    return { status: 'error', message, report: error.report };
  }
  return { status: 'error', message };
}

/**
 * How long ONE detection attempt waits before giving up on that attempt.
 *
 * This is a pacing deadline, never a verdict (`decideProjectDetectionRecovery`).
 * Project detection is normally a pair of local fetches and finishes almost
 * immediately, but on the FIRST boot of a fresh checkout — Vite transforming
 * the editor graph cold — it legitimately takes far longer, and the previous
 * code turned that elapsed deadline into a terminal error screen on an
 * otherwise perfectly healthy tab. Abandoning an attempt is still worth doing:
 * a request lost under a cold boot's connection pressure never settles, and
 * re-asking is how it gets un-stuck.
 */
export const PROJECT_DETECTION_TIMEOUT_MS = 8_000;

export function detectProjectWithTimeout(
  detect: () => Promise<ActiveProject | null> = detectProject,
  timeoutMs = PROJECT_DETECTION_TIMEOUT_MS,
): Promise<ActiveProject | null> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new ProjectDetectionTimeoutError(timeoutMs));
    }, timeoutMs);
    detect().then(
      (project) => {
        window.clearTimeout(timeout);
        resolve(project);
      },
      (error: unknown) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

/** Read + shape-check the `?create-from=` deep-link param (G4). Returns the
 *  candidate id, or null when absent/malformed. Ids share the example-folder
 *  shape (`hosted-example.ts`'s gate); a malformed value is treated as absent
 *  at the routing layer — the WIZARD still opens (the user's intent to create
 *  was explicit), with a non-blocking unknown-id notice. */
export function createFromParam(search: string): string | null {
  const raw = new URLSearchParams(search).get('create-from');
  if (raw === null) return null;
  return raw.trim() || null;
}

/** Attempts before a still-retrying detection reports itself to the console. */
const PROJECT_DETECTION_REPORT_AFTER = 3;

export function AppRoot() {
  const [state, setState] = useState<State>({ status: 'detecting', waitingSince: null });
  const [detectionAttempt, setDetectionAttempt] = useState(0);

  // Account is product-global. Keep its session current on the Welcome /
  // Project Browser just as in the project editor; project selection must not
  // be a prerequisite for identity or billing management.
  useEffect(() => startAccountActivity(), []);

  // Session presence for the LIFE OF THE PAGE (see the module docstring): the
  // tab bijection counts tabs, and a tab is a tab on every surface.
  useEffect(() => connectTabPresence(), []);

  // `tab-adopt`: this tab is the session's one tab but is not on the project.
  // Re-run detection rather than opening a second tab — the same work the
  // Retry button does, which is exactly what adoption means here.
  useEffect(() => onTabAdopt(() => setDetectionAttempt((attempt) => attempt + 1)), []);

  // Detection RUNS UNTIL IT GETS AN ANSWER. A failure that means "the server
  // has not answered yet" schedules another ask (backoff in boot-routing) and
  // keeps the boot surface up, saying how long it has been waiting; only a
  // definite bad answer lands on the terminal error surface. The alternative —
  // one attempt, one deadline, one verdict — put a healthy tab (beating,
  // echoing, socket up) on a dead-end screen with no command listener for the
  // entire cold first boot of a fresh checkout.
  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    let failures = 0;
    const startedAt = Date.now();
    setState({ status: 'detecting', waitingSince: null });

    const ask = () => {
      detectProjectWithTimeout().then(
        (project) => {
          if (cancelled) return;
          if (project) {
            setState({ status: 'ready', project });
          } else {
            setState({ status: 'no-project' });
          }
        },
        (error: unknown) => {
          if (cancelled) return;
          failures += 1;
          const recovery = decideProjectDetectionRecovery(error, failures);
          if (recovery.kind === 'terminal') {
            const failure = startupFailure(error);
            // A TERMINAL failure renders `StartupErrorScreen` in the tab and,
            // until now, nothing else: the tab beat, reported `no-project`,
            // attached no command listener, and every session door read that
            // as a healthy cold boot (`vgai status`: "commandListener not
            // attached"). Measured 2026-09-17 on two sessions at once — a
            // project pinned below the editor's engine, and an editor server
            // older than the project it served — both invisible for an hour.
            // The console is server-held, so this reaches `vgai status` and
            // `vgai console` whether or not anyone looks at the tab.
            const command =
              failure.recovery && 'verbs' in failure.recovery ? commandSequence(failure.recovery.verbs) : null;
            editorConsole.error(
              `Startup failed: ${failure.message}${command ? ` Run: ${command}` : ''}`,
              'editor',
            );
            setState(failure);
            return;
          }
          const reason = error instanceof Error ? error.message : String(error);
          // A RETRY THAT NEVER SUCCEEDS IS INVISIBLE FROM OUTSIDE. The boot
          // surface says how long it has been waiting, on screen; every other
          // door -- `vgai status`, the session journal -- sees only
          // `route: unknown` and a tab with no command listener, which is also
          // what a healthy cold boot looks like. A project pinned to an older
          // engine than the editor throws here on EVERY attempt, and the tab
          // then waits for something that cannot change, silently.
          //
          // So the reason goes to the editor console, which the server holds
          // and `vgai console` prints whether or not this page ever mounts.
          // Once, on the attempt the patient loop stops being patient about.
          if (failures === PROJECT_DETECTION_REPORT_AFTER) {
            editorConsole.error(
              `Project detection has failed ${failures} times and is still retrying: ${reason}`,
              'editor',
            );
          }
          setState({
            status: 'detecting',
            waitingSince: startedAt,
            lastError: reason,
          });
          retryTimer = window.setTimeout(ask, recovery.delayMs);
        },
      );
    };
    ask();

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [detectionAttempt]);

  // The waiting clock. Only ticks once detection has actually failed at least
  // once, so an ordinary boot never mounts an interval at all.
  const waitingSince = state.status === 'detecting' ? state.waitingSince : null;
  const [waitedSeconds, setWaitedSeconds] = useState(0);
  useEffect(() => {
    if (waitingSince === null) {
      setWaitedSeconds(0);
      return;
    }
    const tick = () =>
      setWaitedSeconds(Math.max(0, Math.round((Date.now() - waitingSince) / 1000)));
    tick();
    const interval = window.setInterval(tick, 1_000);
    return () => window.clearInterval(interval);
  }, [waitingSince]);

  // Which surface this tab is showing, reported from the ONE place that
  // decides it. `detecting` says nothing: a booting tab is on its way to the
  // project, and the server reads an unreported route exactly that way. That
  // stays true through the patient retry loop — a tab still asking is still on
  // its way, so `vgai edit` refocuses it rather than opening a second one, and
  // the vocabulary is unchanged.
  useEffect(() => {
    if (state.status === 'detecting') return;
    reportTabRoute(state.status === 'ready' ? 'project' : 'no-project');
  }, [state.status]);

  const titleSubject =
    state.status === 'ready'
      ? state.project.config.name
      : state.status === 'error'
        ? "Couldn't open project"
        : null;
  useEffect(() => {
    document.title = editorDocumentTitle(titleSubject);
  }, [titleSubject]);

  if (state.status === 'detecting') {
    return (
      <EditorSurface>
        <StartupLoadingScreen
          wait={
            state.waitingSince === null
              ? undefined
              : { seconds: waitedSeconds, detail: state.lastError }
          }
        />
      </EditorSurface>
    );
  }

  if (state.status === 'no-project') {
    // A SESSION SERVES ONE PROJECT and this page has none — the folder the
    // workbench opened is not one. There is nothing to pick from here: say
    // which door opens a project and stop.
    return (
      <EditorSurface>
        <StartupErrorScreen
          error={{
            message:
              'This window has no project open. A session serves one project: open a folder ' +
              `that carries a vgai.project.json, or start one from a terminal — ${commandLine('edit <folder>')}.`,
          }}
          onRetry={() => setDetectionAttempt((attempt) => attempt + 1)}
        />
      </EditorSurface>
    );
  }

  if (state.status === 'error') {
    return (
      <EditorSurface>
        <StartupErrorScreen
          error={{
            message: state.message,
            ...(state.recovery ? { recovery: state.recovery } : {}),
          }}
          report={state.report}
          onRetry={() => setDetectionAttempt((attempt) => attempt + 1)}
        />
      </EditorSurface>
    );
  }

  return (
    <EditorSurface>
      <EditorProvider>
        <EditorRuntimeBoundary>
          <DefaultEditorLayout />
        </EditorRuntimeBoundary>
      </EditorProvider>
    </EditorSurface>
  );
}
