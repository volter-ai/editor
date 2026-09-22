import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { resolveProjectIdentity, resolveWorkTarget, trackerConfigPath } from 'ztrack';
import { createZtrackSupercodeBridge, type ZtrackSupercodeBridge } from 'ztrack/supercode';
import type { Payload } from 'ztrack/visualizer-kit';
import {
  buildVisualizerExtensionModule,
  loadVisualizerPayload,
  loadVisualizerTheme,
} from 'ztrack/visualizer-node';
import type { ProjectWorkAssociation, ProjectWorkSnapshot } from '../src/project-work-types';
import { unavailableProjectWorkSnapshot } from '../src/project-work-types';
import type { HarnessChatService } from './harness-chat-service';

export interface ProjectWorkCoordinatorOptions {
  getProjectRoot: () => string;
  harnessChat: HarnessChatService;
  onChange: (snapshot: ProjectWorkSnapshot) => void;
}

function cloneSnapshot(snapshot: ProjectWorkSnapshot): ProjectWorkSnapshot {
  return structuredClone(snapshot);
}

function missingTracker(error: unknown, configPath: string): boolean {
  if (!existsSync(configPath)) return true;
  return /tracker-config|No tracker|ENOENT/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

export class ProjectWorkCoordinator {
  private revision = 0;
  private generation = 0;
  private closed = false;
  private watcher: FSWatcher | null = null;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private bridge: ZtrackSupercodeBridge | null = null;
  private unsubscribeBridge: (() => void) | null = null;
  private payload: Payload | null = null;
  private extensionCode: string | null = null;
  private hydrated = new Set<string>();
  private failedHydration = new Map<
    string,
    { attempts: number; message: string; retryAt: number }
  >();
  private hydrationInFlight = false;
  private hydrationRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshotValue: ProjectWorkSnapshot = unavailableProjectWorkSnapshot(
    'Project Work is loading.',
  );

  constructor(private readonly options: ProjectWorkCoordinatorOptions) {}

  snapshot(): ProjectWorkSnapshot {
    return cloneSnapshot(this.snapshotValue);
  }
  extension(hash: string): string | null {
    return hash === this.snapshotValue.presentation.extensionHash ? this.extensionCode : null;
  }

  async initialize(): Promise<ProjectWorkSnapshot> {
    await this.reload();
    return this.snapshot();
  }

  async setWorkspace(): Promise<void> {
    this.generation += 1;
    this.hydrated.clear();
    this.failedHydration.clear();
    await this.reload();
  }

  contextForIssue(issueId: string) {
    if (!this.bridge) throw new Error('Project Work is unavailable for this project.');
    return this.bridge.contextForIssue(issueId);
  }

  private publish(next: Omit<ProjectWorkSnapshot, 'revision'>): void {
    this.snapshotValue = { ...next, revision: ++this.revision };
    this.options.onChange(this.snapshot());
  }

  private disposeLiveState(): void {
    this.unsubscribeBridge?.();
    this.unsubscribeBridge = null;
    this.bridge?.dispose();
    this.bridge = null;
    void this.watcher?.close();
    this.watcher = null;
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = null;
    if (this.hydrationRetryTimer) clearTimeout(this.hydrationRetryTimer);
    this.hydrationRetryTimer = null;
  }

  private watch(paths: string[]): void {
    this.watcher = chokidar.watch([...new Set(paths)], { ignoreInitial: true, persistent: true });
    this.watcher.on('all', () => {
      if (this.reloadTimer) clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => void this.reload(), 150);
    });
  }

  private async reload(): Promise<void> {
    if (this.closed) return;
    const generation = ++this.generation;
    this.disposeLiveState();
    const projectRoot = resolve(this.options.getProjectRoot());
    const configPath = trackerConfigPath(projectRoot);
    try {
      const [board, extension, theme] = await Promise.all([
        loadVisualizerPayload({ projectRoot }),
        buildVisualizerExtensionModule({ projectRoot }),
        loadVisualizerTheme({ projectRoot }),
      ]);
      if (generation !== this.generation || this.closed) return;
      this.payload = board.payload;
      this.extensionCode = extension.code;
      const project = resolveProjectIdentity(projectRoot);
      const trackerListeners = new Set<() => void>();
      this.bridge = createZtrackSupercodeBridge({
        projectRoot,
        tracker: {
          resolveProjectIdentity,
          resolveWorkTarget,
          payload: () => this.payload!,
          subscribe: (listener) => {
            trackerListeners.add(listener);
            return () => trackerListeners.delete(listener);
          },
        },
        supercode: this.options.harnessChat.bridgeAdapter(),
      });
      this.unsubscribeBridge = this.bridge.subscribe(() => this.rebuildFromBridge());
      this.watch([...board.watchPaths, ...extension.watchPaths, ...theme.watchPaths, configPath]);
      this.rebuildFromBridge({
        extensionHash: extension.contentHash,
        extensionError: extension.error,
        theme: theme.variables,
        themeError: theme.error,
        projectKey: project.projectKey,
      });
    } catch (error) {
      if (generation !== this.generation || this.closed) return;
      this.payload = null;
      this.extensionCode = null;
      this.watch([configPath]);
      const tracker = missingTracker(error, configPath)
        ? { state: 'missing' as const }
        : {
            state: 'error' as const,
            message: error instanceof Error ? error.message : String(error),
          };
      this.publish({
        schema: 'vgai.project-work.v1',
        projectKey: null,
        tracker,
        associations: [],
        activityByIssue: {},
        presentation: { extensionHash: null, extensionError: null, theme: {}, themeError: null },
      });
    }
  }

  private rebuildFromBridge(
    presentation?: ProjectWorkSnapshot['presentation'] & { projectKey: string },
  ): void {
    if (!this.bridge || !this.payload) return;
    const harness = this.options.harnessChat.snapshot();
    const bridgeSnapshot = this.options.harnessChat.bridgeAdapter().getSnapshot();
    const associations: ProjectWorkAssociation[] = bridgeSnapshot.sessions.map((session) => {
      const result = this.bridge!.resolveSession({ session });
      const hydrationFailure = this.failedHydration.get(session.identity);
      const observed =
        session.key === bridgeSnapshot.activeSessionKey || this.hydrated.has(session.identity);
      return {
        sessionIdentity: session.identity,
        issueId: observed ? result.issueId : null,
        state: observed ? result.state : hydrationFailure ? 'error' : 'loading',
        source: observed ? result.source : null,
        reason: observed
          ? result.reason
          : hydrationFailure
            ? `Unable to inspect this session: ${hydrationFailure.message}. Retrying automatically.`
            : 'persisted session has not been observed yet',
        observedAt: session.updatedAt,
      };
    });
    const activityByIssue: ProjectWorkSnapshot['activityByIssue'] = {};
    for (const activity of this.bridge.activitySnapshot()) {
      if (activity.freshness === 'last-observed' && !this.hydrated.has(activity.sessionIdentity))
        continue;
      const issueActivity = activityByIssue[activity.issueId] ?? [];
      issueActivity.push(activity);
      activityByIssue[activity.issueId] = issueActivity;
    }
    const currentPresentation = presentation ?? {
      ...this.snapshotValue.presentation,
      projectKey:
        this.snapshotValue.projectKey ??
        resolveProjectIdentity(this.options.getProjectRoot()).projectKey,
    };
    this.publish({
      schema: 'vgai.project-work.v1',
      projectKey: currentPresentation.projectKey,
      tracker: { state: 'ready', payload: this.payload },
      associations,
      activityByIssue,
      presentation: {
        extensionHash: currentPresentation.extensionHash,
        extensionError: currentPresentation.extensionError,
        theme: currentPresentation.theme,
        themeError: currentPresentation.themeError,
      },
    });
    if (harness.operation === null && harness.turn.state === 'idle') void this.hydrateOne();
  }

  private async hydrateOne(): Promise<void> {
    if (this.hydrationInFlight || !this.bridge || this.closed) return;
    const snapshot = this.options.harnessChat.snapshot();
    const now = Date.now();
    const candidates = snapshot.sessions.filter(
      (candidate) =>
        candidate.id !== snapshot.activeSessionId && !this.hydrated.has(candidate.identity),
    );
    const session = candidates.find(
      (candidate) => (this.failedHydration.get(candidate.identity)?.retryAt ?? 0) <= now,
    );
    if (!session) {
      const nextRetry = candidates.reduce((earliest, candidate) => {
        const retryAt = this.failedHydration.get(candidate.identity)?.retryAt;
        return retryAt === undefined ? earliest : Math.min(earliest, retryAt);
      }, Number.POSITIVE_INFINITY);
      if (Number.isFinite(nextRetry) && !this.hydrationRetryTimer) {
        const generation = this.generation;
        this.hydrationRetryTimer = setTimeout(
          () => {
            this.hydrationRetryTimer = null;
            if (generation === this.generation) void this.hydrateOne();
          },
          Math.max(0, nextRetry - now),
        );
      }
      return;
    }
    const generation = this.generation;
    this.hydrationInFlight = true;
    try {
      const loaded = await this.options.harnessChat.loadSessionForProjectWork(session.id);
      if (generation !== this.generation || this.closed || !this.bridge) return;
      this.hydrated.add(session.identity);
      this.failedHydration.delete(session.identity);
      this.bridge.resolveSession({
        session: {
          key: session.id,
          identity: session.identity,
          cwd: session.cwd,
          title: session.title,
          updatedAt: session.updatedAt,
        },
        loadedSession: loaded,
      });
      this.rebuildFromBridge();
    } catch (error) {
      if (generation !== this.generation || this.closed || !this.bridge) return;
      const previous = this.failedHydration.get(session.identity);
      const attempts = (previous?.attempts ?? 0) + 1;
      this.failedHydration.set(session.identity, {
        attempts,
        message: error instanceof Error ? error.message : String(error),
        retryAt: Date.now() + Math.min(30_000, 1_000 * 2 ** (attempts - 1)),
      });
      this.rebuildFromBridge();
    } finally {
      this.hydrationInFlight = false;
      if (!this.closed) queueMicrotask(() => void this.hydrateOne());
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.generation += 1;
    this.disposeLiveState();
  }
}
