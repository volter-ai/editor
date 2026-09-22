/**
 * Wall-clock stamps for "this design surface just painted its first frame
 * after becoming active."
 *
 * A tab flip used to look like a hung editor: the canvas went blank and
 * nothing said how long the rebuild was taking. Doctor `--timings` (and any
 * later product door) reads these stamps off `/__editor/state` so the wait
 * is a measured number rather than a guess.
 *
 * `firstFrameAtMs` is `Date.now()` at the FIRST completed render of that
 * activation, so a doctor clock started at `active-tab` send can subtract
 * and get tab-activation → first painted frame, including the board's own
 * deferred story-mount, not just the renderer constructor.
 *
 * One latest sample per document. `activation` increments every time a new
 * first frame is recorded, so a second flip is distinguishable from the
 * first without the reader inventing a generation token.
 *
 * Per-segment breakdown is OPT-IN. First-frame stamps stay always-on (a
 * Date.now is cheap); the named segments and per-story list allocate only
 * when {@link viewportTimingsEnabled} is true — doctor `--timings` sets
 * `window.__VGAI_VIEWPORT_TIMINGS__` before boot, or the URL carries
 * `?vgaiTimings=1`. Off by default so a normal session never pays for it.
 *
 * The breakdown clock starts at the ACTIVATION GESTURE (`setActive`), not at
 * board-build start. Time between those two marks is the prefix window
 * (workspace notify, React commit, reveal effect, the host's own activation)
 * that used to fall into a catch-all "unaccounted" row. `unattributedMs` is the
 * honesty term: leftover after every named segment, always published, even
 * at 0.
 */

export interface ViewportStoryMountSample {
  readonly id: string;
  readonly ms: number;
  readonly runtimeMs: number;
  readonly loadMs: number;
  readonly fiberMs: number;
  readonly settleMs: number;
  readonly ok: boolean;
}

export interface StoryDiscoveryModuleTiming {
  readonly modulePath: string;
  readonly loadMs: number;
  readonly composeMs: number;
  readonly ok: boolean;
}

export interface StoryDiscoveryTiming {
  readonly ms: number;
  readonly completedAtMs: number;
  readonly moduleCount: number;
  readonly storyCount: number;
  /** Fetch the story-file index and optional `.storybook/preview` module. */
  readonly previewAnnotationsMs: number;
  /** Resolve Storybook's portable runtime and apply project annotations. */
  readonly runtimeAnnotationsMs: number;
  /** Fetch the live story-file index used to create lazy module loaders. */
  readonly fileScanMs: number;
  /** Import and compose the immediately declared CSF modules in parallel. */
  readonly moduleLoadAndComposeMs: number;
  /** Per-module clocks reveal the critical import graph hidden by Promise.all. */
  readonly modules: readonly StoryDiscoveryModuleTiming[];
}

/** How a named segment spends its wall time. Opposite fixes: busy vs wait. */
export type ViewportSegmentKind = 'cpu' | 'idle' | 'mixed';

export interface ViewportAttributionRow {
  readonly name: string;
  readonly ms: number;
  readonly busyMs: number;
  readonly waitMs: number;
  readonly kind: ViewportSegmentKind;
}

export type ViewportActivationKind = 'first-open' | 'switch-back';

export interface ViewportActivationBreakdown {
  /** Browser-reported visibility at the activation gesture. A timing without
   *  this fact cannot distinguish product work from browser throttling. */
  readonly visibilityState: DocumentVisibilityState | 'unavailable';
  readonly startedAtMs: number;
  readonly reactActiveAtMs: number | null;
  readonly boardBuildStartedAtMs: number | null;
  readonly boardReadyAtMs: number | null;
  readonly constructStartedAtMs: number | null;
  readonly viewportReadyAtMs: number | null;
  readonly rafResumeAtMs: number | null;
  readonly firstRenderStartedAtMs: number | null;
  readonly firstFrameAtMs: number;
  readonly activationKind: ViewportActivationKind;
  readonly workspaceSyncMs: number;
  readonly revealScheduleMs: number;
  readonly componentIndexMs: number;
  readonly candidateCollectMs: number;
  readonly storyMountTotalMs: number;
  readonly storyMountBusyMs: number;
  readonly storyMountWaitMs: number;
  readonly boundsMs: number;
  readonly layoutMs: number;
  readonly assembleMs: number;
  readonly reactCommitMs: number;
  readonly webglContextMs: number;
  readonly rendererMs: number;
  readonly adapterSetupMs: number;
  readonly iblBakeMs: number;
  readonly dressingMs: number;
  readonly editorViewportMs: number;
  readonly framingMs: number;
  readonly resizeBindMs: number;
  readonly viewportBindMs: number;
  readonly rafWaitMs: number;
  readonly firstRenderMs: number;
  readonly firstPaintMs: number;
  readonly unattributedMs: number;
  readonly accountedMs: number;
  readonly candidateCount: number;
  readonly exhibitCount: number;
  readonly skippedCount: number;
  readonly modulesAlreadyLoaded: boolean;
  readonly stories: readonly ViewportStoryMountSample[];
  readonly storyDiscovery: StoryDiscoveryTiming | null;
}

export interface ViewportActivationSample {
  readonly documentId: string;
  readonly activation: number;
  readonly firstFrameAtMs: number;
  readonly breakdown?: ViewportActivationBreakdown;
}

const latest = new Map<string, ViewportActivationSample>();
const counts = new Map<string, number>();

function reportEmbeddedViewportReady(): void {
  if (typeof window === 'undefined' || window.parent === window || latest.size === 0) return;
  window.parent.postMessage({ type: 'vgai:viewport-ready', documents: [...latest.keys()] }, '*');
}

// A host may hydrate after this iframe has already painted. Answer its ready
// query as well as announcing the first frame; iframe load is only HTML ready.
if (typeof window !== 'undefined' && window.parent !== window) {
  window.addEventListener('message', (event) => {
    if (event.source === window.parent && event.data?.type === 'vgai:request-viewport-ready')
      reportEmbeddedViewportReady();
  });
}

let timingsForced: boolean | null = null;
let activeBreakdown: MutableBreakdown | null = null;
let lastDiscovery: StoryDiscoveryTiming | null = null;

interface MutableBreakdown {
  documentId: string;
  visibilityState: DocumentVisibilityState | 'unavailable';
  startedAtMs: number;
  reactActiveAtMs: number | null;
  boardBuildStartedAtMs: number | null;
  boardReadyAtMs: number | null;
  constructStartedAtMs: number | null;
  viewportReadyAtMs: number | null;
  rafResumeAtMs: number | null;
  firstRenderStartedAtMs: number | null;
  workspaceSyncMs: number;
  revealScheduleMs: number;
  componentIndexMs: number;
  componentIndexBusyMs: number;
  componentIndexWaitMs: number;
  candidateCollectMs: number;
  storyMountTotalMs: number;
  boundsMs: number;
  layoutMs: number;
  assembleMs: number;
  webglContextMs: number;
  rendererMs: number;
  adapterSetupMs: number;
  iblBakeMs: number;
  dressingMs: number;
  editorViewportMs: number;
  framingMs: number;
  resizeBindMs: number;
  viewportBindMs: number;
  firstRenderMs: number;
  candidateCount: number;
  exhibitCount: number;
  skippedCount: number;
  modulesAlreadyLoaded: boolean;
  stories: ViewportStoryMountSample[];
}

export type ViewportSegmentName =
  | 'component-index'
  | 'candidate-collect'
  | 'story-mounts'
  | 'bounds'
  | 'layout'
  | 'assemble'
  | 'webgl-context'
  | 'renderer'
  | 'adapter-setup'
  | 'ibl-bake'
  | 'dressing'
  | 'editor-viewport'
  | 'framing'
  | 'resize-bind'
  | 'viewport-bind'
  | 'first-render';

export function viewportTimingsEnabled(): boolean {
  if (timingsForced !== null) return timingsForced;
  if (typeof window === 'undefined') return false;
  const flag = (window as Window & { __VGAI_VIEWPORT_TIMINGS__?: unknown })
    .__VGAI_VIEWPORT_TIMINGS__;
  if (flag === true || flag === '1') return true;
  try {
    return new URLSearchParams(window.location.search).get('vgaiTimings') === '1';
  } catch {
    return false;
  }
}

function emptyBreakdown(
  documentId: string,
  startedAtMs: number,
  options: { readonly modulesAlreadyLoaded?: boolean },
): MutableBreakdown {
  return {
    documentId,
    visibilityState: typeof document === 'undefined' ? 'unavailable' : document.visibilityState,
    startedAtMs,
    reactActiveAtMs: null,
    boardBuildStartedAtMs: null,
    boardReadyAtMs: null,
    constructStartedAtMs: null,
    viewportReadyAtMs: null,
    rafResumeAtMs: null,
    firstRenderStartedAtMs: null,
    workspaceSyncMs: 0,
    revealScheduleMs: 0,
    componentIndexMs: 0,
    componentIndexBusyMs: 0,
    componentIndexWaitMs: 0,
    candidateCollectMs: 0,
    storyMountTotalMs: 0,
    boundsMs: 0,
    layoutMs: 0,
    assembleMs: 0,
    webglContextMs: 0,
    rendererMs: 0,
    adapterSetupMs: 0,
    iblBakeMs: 0,
    dressingMs: 0,
    editorViewportMs: 0,
    framingMs: 0,
    resizeBindMs: 0,
    viewportBindMs: 0,
    firstRenderMs: 0,
    candidateCount: 0,
    exhibitCount: 0,
    skippedCount: 0,
    modulesAlreadyLoaded: options.modulesAlreadyLoaded === true,
    stories: [],
  };
}

function storyMountSplit(stories: readonly ViewportStoryMountSample[]): {
  busyMs: number;
  waitMs: number;
} {
  let busyMs = 0;
  let waitMs = 0;
  for (const story of stories) {
    busyMs += Math.max(0, story.runtimeMs) + Math.max(0, story.fiberMs);
    waitMs += Math.max(0, story.loadMs) + Math.max(0, story.settleMs);
  }
  return { busyMs, waitMs };
}

function finalizeBreakdown(
  pending: MutableBreakdown,
  firstFrameAtMs: number,
): ViewportActivationBreakdown {
  const workspaceSyncMs =
    pending.reactActiveAtMs === null
      ? 0
      : Math.max(0, pending.reactActiveAtMs - pending.startedAtMs);
  const revealOrigin = pending.reactActiveAtMs ?? pending.startedAtMs;
  const revealEnd = pending.boardBuildStartedAtMs;
  const revealScheduleMs = revealEnd === null ? 0 : Math.max(0, revealEnd - revealOrigin);
  const reactCommitMs =
    pending.boardReadyAtMs === null || pending.constructStartedAtMs === null
      ? 0
      : Math.max(0, pending.constructStartedAtMs - pending.boardReadyAtMs);
  const loopStart = pending.viewportReadyAtMs ?? pending.rafResumeAtMs;
  const loopArrived = pending.firstRenderStartedAtMs ?? firstFrameAtMs;
  const rafWaitMs = loopStart === null ? 0 : Math.max(0, loopArrived - loopStart);
  const firstPaintMs =
    loopStart === null
      ? Math.max(0, firstFrameAtMs - pending.startedAtMs)
      : Math.max(0, firstFrameAtMs - loopStart);
  const mounts = storyMountSplit(pending.stories);
  const activationKind: ViewportActivationKind =
    pending.boardBuildStartedAtMs === null ? 'switch-back' : 'first-open';
  const named: ViewportAttributionRow[] = attributionRowsFromParts({
    workspaceSyncMs,
    revealScheduleMs,
    componentIndexMs: pending.componentIndexMs,
    componentIndexBusyMs: pending.componentIndexBusyMs,
    componentIndexWaitMs: pending.componentIndexWaitMs,
    candidateCollectMs: pending.candidateCollectMs,
    storyMountTotalMs: pending.storyMountTotalMs,
    storyMountBusyMs: mounts.busyMs,
    storyMountWaitMs: mounts.waitMs,
    boundsMs: pending.boundsMs,
    layoutMs: pending.layoutMs,
    assembleMs: pending.assembleMs,
    reactCommitMs,
    webglContextMs: pending.webglContextMs,
    rendererMs: pending.rendererMs,
    adapterSetupMs: pending.adapterSetupMs,
    iblBakeMs: pending.iblBakeMs,
    dressingMs: pending.dressingMs,
    editorViewportMs: pending.editorViewportMs,
    framingMs: pending.framingMs,
    resizeBindMs: pending.resizeBindMs,
    viewportBindMs: pending.viewportBindMs,
    rafWaitMs,
    firstRenderMs: pending.firstRenderMs,
  });
  const accountedMs = named.reduce((sum, row) => sum + row.ms, 0);
  const spanMs = Math.max(0, firstFrameAtMs - pending.startedAtMs);
  return {
    visibilityState: pending.visibilityState,
    startedAtMs: pending.startedAtMs,
    reactActiveAtMs: pending.reactActiveAtMs,
    boardBuildStartedAtMs: pending.boardBuildStartedAtMs,
    boardReadyAtMs: pending.boardReadyAtMs,
    constructStartedAtMs: pending.constructStartedAtMs,
    viewportReadyAtMs: pending.viewportReadyAtMs,
    rafResumeAtMs: pending.rafResumeAtMs,
    firstRenderStartedAtMs: pending.firstRenderStartedAtMs,
    firstFrameAtMs,
    activationKind,
    workspaceSyncMs,
    revealScheduleMs,
    componentIndexMs: pending.componentIndexMs,
    candidateCollectMs: pending.candidateCollectMs,
    storyMountTotalMs: pending.storyMountTotalMs,
    storyMountBusyMs: mounts.busyMs,
    storyMountWaitMs: mounts.waitMs,
    boundsMs: pending.boundsMs,
    layoutMs: pending.layoutMs,
    assembleMs: pending.assembleMs,
    reactCommitMs,
    webglContextMs: pending.webglContextMs,
    rendererMs: pending.rendererMs,
    adapterSetupMs: pending.adapterSetupMs,
    iblBakeMs: pending.iblBakeMs,
    dressingMs: pending.dressingMs,
    editorViewportMs: pending.editorViewportMs,
    framingMs: pending.framingMs,
    resizeBindMs: pending.resizeBindMs,
    viewportBindMs: pending.viewportBindMs,
    rafWaitMs,
    firstRenderMs: pending.firstRenderMs,
    firstPaintMs,
    unattributedMs: Math.max(0, spanMs - accountedMs),
    accountedMs,
    candidateCount: pending.candidateCount,
    exhibitCount: pending.exhibitCount,
    skippedCount: pending.skippedCount,
    modulesAlreadyLoaded: pending.modulesAlreadyLoaded,
    stories: pending.stories,
    storyDiscovery: lastDiscovery,
  };
}

function cpuRow(name: string, ms: number): ViewportAttributionRow {
  const value = Math.max(0, ms);
  return { name, ms: value, busyMs: value, waitMs: 0, kind: 'cpu' };
}

function idleRow(name: string, ms: number): ViewportAttributionRow {
  const value = Math.max(0, ms);
  return { name, ms: value, busyMs: 0, waitMs: value, kind: 'idle' };
}

function mixedRow(
  name: string,
  wallMs: number,
  busyMs: number,
  waitMs: number,
): ViewportAttributionRow {
  const ms = Math.max(0, wallMs);
  let busy = Math.max(0, busyMs);
  let wait = Math.max(0, waitMs);
  if (busy + wait > ms) {
    const scale = ms / (busy + wait);
    busy *= scale;
    wait *= scale;
  } else if (busy + wait < ms) {
    wait += ms - busy - wait;
  }
  return { name, ms, busyMs: busy, waitMs: wait, kind: 'mixed' };
}

function attributionRowsFromParts(parts: {
  readonly workspaceSyncMs: number;
  readonly revealScheduleMs: number;
  readonly componentIndexMs: number;
  readonly componentIndexBusyMs: number;
  readonly componentIndexWaitMs: number;
  readonly candidateCollectMs: number;
  readonly storyMountTotalMs: number;
  readonly storyMountBusyMs: number;
  readonly storyMountWaitMs: number;
  readonly boundsMs: number;
  readonly layoutMs: number;
  readonly assembleMs: number;
  readonly reactCommitMs: number;
  readonly webglContextMs: number;
  readonly rendererMs: number;
  readonly adapterSetupMs: number;
  readonly iblBakeMs: number;
  readonly dressingMs: number;
  readonly editorViewportMs: number;
  readonly framingMs: number;
  readonly resizeBindMs: number;
  readonly viewportBindMs: number;
  readonly rafWaitMs: number;
  readonly firstRenderMs: number;
}): ViewportAttributionRow[] {
  return [
    idleRow('workspace-sync', parts.workspaceSyncMs),
    idleRow('reveal-schedule', parts.revealScheduleMs),
    mixedRow(
      'component-index',
      parts.componentIndexMs,
      parts.componentIndexBusyMs,
      parts.componentIndexWaitMs > 0 || parts.componentIndexMs === 0
        ? parts.componentIndexWaitMs
        : parts.componentIndexMs,
    ),
    cpuRow('candidate-collect', parts.candidateCollectMs),
    mixedRow(
      'story-mounts',
      parts.storyMountTotalMs,
      parts.storyMountBusyMs,
      parts.storyMountWaitMs,
    ),
    cpuRow('bounds', parts.boundsMs),
    cpuRow('layout', parts.layoutMs),
    cpuRow('assemble', parts.assembleMs),
    idleRow('react-commit (board→viewport)', parts.reactCommitMs),
    cpuRow('webgl-context', parts.webglContextMs),
    cpuRow('renderer', parts.rendererMs),
    cpuRow('adapter-setup', parts.adapterSetupMs),
    cpuRow('ibl-bake (three PMREM)', parts.iblBakeMs),
    cpuRow('dressing', parts.dressingMs),
    cpuRow('editor-viewport', parts.editorViewportMs),
    cpuRow('framing', parts.framingMs),
    cpuRow('resize-bind', parts.resizeBindMs),
    cpuRow('viewport-bind', parts.viewportBindMs),
    idleRow('raf-wait', parts.rafWaitMs),
    cpuRow('first-render', parts.firstRenderMs),
  ];
}

/**
 * Named rows for one activation, plus the honesty term. `clockOriginMs` is
 * the doctor's send time when the printed clock starts before the editor
 * gesture; omit it to attribute from the gesture alone.
 */
export function buildViewportAttributionTable(
  breakdown: ViewportActivationBreakdown,
  clock: { readonly originMs?: number; readonly totalMs: number } = {
    totalMs: Math.max(0, breakdown.firstFrameAtMs - breakdown.startedAtMs),
  },
): { readonly rows: readonly ViewportAttributionRow[]; readonly totalMs: number } {
  const totalMs = Math.max(0, clock.totalMs);
  const originMs = clock.originMs ?? breakdown.startedAtMs;
  const commandQueueMs = Math.max(0, breakdown.startedAtMs - originMs);
  const rows: ViewportAttributionRow[] = [];
  if (commandQueueMs > 0 || clock.originMs !== undefined) {
    rows.push(idleRow('command-queue', commandQueueMs));
  }
  rows.push(
    ...attributionRowsFromParts({
      workspaceSyncMs: breakdown.workspaceSyncMs,
      revealScheduleMs: breakdown.revealScheduleMs,
      componentIndexMs: breakdown.componentIndexMs,
      componentIndexBusyMs: 0,
      componentIndexWaitMs: breakdown.componentIndexMs,
      candidateCollectMs: breakdown.candidateCollectMs,
      storyMountTotalMs: breakdown.storyMountTotalMs,
      storyMountBusyMs: breakdown.storyMountBusyMs,
      storyMountWaitMs: breakdown.storyMountWaitMs,
      boundsMs: breakdown.boundsMs,
      layoutMs: breakdown.layoutMs,
      assembleMs: breakdown.assembleMs,
      reactCommitMs: breakdown.reactCommitMs,
      webglContextMs: breakdown.webglContextMs,
      rendererMs: breakdown.rendererMs,
      adapterSetupMs: breakdown.adapterSetupMs,
      iblBakeMs: breakdown.iblBakeMs,
      dressingMs: breakdown.dressingMs,
      editorViewportMs: breakdown.editorViewportMs,
      framingMs: breakdown.framingMs,
      resizeBindMs: breakdown.resizeBindMs,
      viewportBindMs: breakdown.viewportBindMs,
      rafWaitMs: breakdown.rafWaitMs,
      firstRenderMs: breakdown.firstRenderMs,
    }),
  );
  const accounted = rows.reduce((sum, row) => sum + row.ms, 0);
  rows.push(idleRow('unattributed', Math.max(0, totalMs - accounted)));
  return { rows, totalMs };
}

export function formatViewportAttributionTable(
  breakdown: ViewportActivationBreakdown,
  clock: { readonly originMs?: number; readonly totalMs: number },
): string {
  const { rows, totalMs } = buildViewportAttributionTable(breakdown, clock);
  const accounted = rows
    .filter((row) => row.name !== 'unattributed')
    .reduce((sum, row) => sum + row.ms, 0);
  const pct = (ms: number): string => (totalMs > 0 ? `${((ms / totalMs) * 100).toFixed(1)}%` : '—');
  const lines = [
    `  activation kind: ${breakdown.activationKind}`,
    `  document.visibilityState at gesture: ${breakdown.visibilityState}`,
    `  modules already loaded at build start: ${breakdown.modulesAlreadyLoaded ? 'yes' : 'no'}`,
    `  exhibits=${breakdown.exhibitCount} skipped=${breakdown.skippedCount} candidates=${breakdown.candidateCount}`,
    `  accounted ${accounted}ms / ${totalMs}ms (${pct(accounted).trim()} of clock)`,
    '  segment                              ms    busy    wait    kind    % of clock',
  ];
  for (const row of rows) {
    if (row.ms === 0 && row.name !== 'unattributed') continue;
    lines.push(
      `  ${row.name.padEnd(32)} ${String(Math.round(row.ms)).padStart(6)} ${String(Math.round(row.busyMs)).padStart(7)} ${String(Math.round(row.waitMs)).padStart(7)}  ${row.kind.padEnd(5)}  ${pct(row.ms).padStart(7)}`,
    );
  }
  return lines.join('\n');
}

export function recordViewportFirstFrame(
  documentId: string,
  atMs: number = Date.now(),
): ViewportActivationSample {
  const activation = (counts.get(documentId) ?? 0) + 1;
  counts.set(documentId, activation);
  const sample: ViewportActivationSample = { documentId, activation, firstFrameAtMs: atMs };
  const pending = activeBreakdown;
  if (pending && pending.documentId === documentId) {
    const withBreakdown: ViewportActivationSample = {
      ...sample,
      breakdown: finalizeBreakdown(pending, atMs),
    };
    activeBreakdown = null;
    latest.set(documentId, withBreakdown);
    resolveFirstViewportFrameWaiters();
    notifyViewportActivationListeners();
    return withBreakdown;
  }
  latest.set(documentId, sample);
  resolveFirstViewportFrameWaiters();
  notifyViewportActivationListeners();
  return sample;
}

let firstViewportFrameWaiters = new Set<() => void>();
const viewportActivationListeners = new Set<() => void>();

function notifyViewportActivationListeners(): void {
  reportEmbeddedViewportReady();
  for (const listener of viewportActivationListeners) listener();
}

/**
 * Subscribe to completed viewport frames.
 *
 * The timing is part of the editor state snapshot, so its producer must wake
 * that snapshot when a frame lands. Without this signal, a remote reader had
 * to send another `active-tab` command merely to make the page re-report. On
 * a large component board that probe queues behind the synchronous first
 * render, exhausts the ordinary 5-second command budget, and leaves a false
 * `play-stall` condition even though the requested frame completes.
 */
export function subscribeViewportActivationTimings(listener: () => void): () => void {
  viewportActivationListeners.add(listener);
  return () => viewportActivationListeners.delete(listener);
}

function resolveFirstViewportFrameWaiters(): void {
  if (latest.size === 0) return;
  releaseFirstViewportFrameWaiters();
}

function releaseFirstViewportFrameWaiters(): void {
  const waiters = firstViewportFrameWaiters;
  firstViewportFrameWaiters = new Set();
  for (const resolve of waiters) resolve();
}

/** A hidden tab paints nothing, so the frame this signal names is not coming
 * (see `after-paint.ts`). Release every waiter the moment the page goes
 * hidden: the deferral exists to protect a paint critical path that does not
 * exist there, so continuing to hold callers is pure loss. */
let hiddenReleaseListenerAttached = false;
function attachHiddenRelease(): void {
  if (hiddenReleaseListenerAttached || typeof document === 'undefined') return;
  hiddenReleaseListenerAttached = true;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseFirstViewportFrameWaiters();
  });
}

/**
 * Resolves after any authored viewport has produced its first honest frame —
 * or immediately when this tab cannot produce one, because it is hidden.
 *
 * This is a presentation readiness signal, not profiling: background work
 * that can saturate Vite's module graph uses it to stay off the opening
 * viewport's critical path even when timing capture is disabled. Callers may
 * have no timeout of their own (`project-story-discovery.ts` deliberately has
 * none), so the hidden case must resolve here or a backgrounded editor never
 * discovers the project's stories at all.
 */
export function waitForFirstViewportFrame(): Promise<void> {
  if (latest.size > 0) return Promise.resolve();
  if (typeof document !== 'undefined' && document.hidden) return Promise.resolve();
  attachHiddenRelease();
  return new Promise((resolve) => firstViewportFrameWaiters.add(resolve));
}

export function viewportActivationTimings(): readonly ViewportActivationSample[] {
  return [...latest.values()];
}

export function latestViewportActivation(documentId: string): ViewportActivationSample | null {
  return latest.get(documentId) ?? null;
}

export function lastStoryDiscoveryTiming(): StoryDiscoveryTiming | null {
  return lastDiscovery;
}

/**
 * True start of an activation: the workspace `setActive` gesture. A later
 * {@link beginViewportBreakdown} joins this clock instead of resetting it,
 * so the prefix window (notify → React → reveal) is named rather than
 * dumped into unattributed.
 */
export function noteViewportActivationGesture(documentId: string): void {
  if (!viewportTimingsEnabled()) return;
  activeBreakdown = emptyBreakdown(documentId, Date.now(), {});
}

export function beginViewportBreakdown(
  documentId: string,
  options: { readonly modulesAlreadyLoaded?: boolean } = {},
): void {
  if (!viewportTimingsEnabled()) return;
  const now = Date.now();
  if (activeBreakdown && activeBreakdown.documentId === documentId) {
    if (activeBreakdown.boardBuildStartedAtMs === null) {
      activeBreakdown.boardBuildStartedAtMs = now;
    }
    if (options.modulesAlreadyLoaded === true) activeBreakdown.modulesAlreadyLoaded = true;
    return;
  }
  activeBreakdown = emptyBreakdown(documentId, now, options);
  activeBreakdown.boardBuildStartedAtMs = now;
}

export function cancelViewportBreakdown(documentId?: string): void {
  if (!activeBreakdown) return;
  if (documentId && activeBreakdown.documentId !== documentId) return;
  activeBreakdown = null;
}

export function markViewportSegment(
  name: ViewportSegmentName,
  ms: number,
  split?: { readonly busyMs?: number; readonly waitMs?: number },
): void {
  if (!activeBreakdown) return;
  const value = Math.max(0, ms);
  switch (name) {
    case 'component-index':
      activeBreakdown.componentIndexMs = value;
      activeBreakdown.componentIndexBusyMs = Math.max(0, split?.busyMs ?? 0);
      activeBreakdown.componentIndexWaitMs = Math.max(0, split?.waitMs ?? value);
      break;
    case 'candidate-collect':
      activeBreakdown.candidateCollectMs = value;
      break;
    case 'story-mounts':
      activeBreakdown.storyMountTotalMs = value;
      break;
    case 'bounds':
      activeBreakdown.boundsMs = value;
      break;
    case 'layout':
      activeBreakdown.layoutMs = value;
      break;
    case 'assemble':
      activeBreakdown.assembleMs = value;
      break;
    case 'webgl-context':
      activeBreakdown.webglContextMs = value;
      break;
    case 'renderer':
      activeBreakdown.rendererMs = value;
      break;
    case 'adapter-setup':
      activeBreakdown.adapterSetupMs = value;
      break;
    case 'ibl-bake':
      activeBreakdown.iblBakeMs = value;
      break;
    case 'dressing':
      activeBreakdown.dressingMs = value;
      break;
    case 'editor-viewport':
      activeBreakdown.editorViewportMs = value;
      break;
    case 'framing':
      activeBreakdown.framingMs = value;
      break;
    case 'resize-bind':
      activeBreakdown.resizeBindMs = value;
      break;
    case 'viewport-bind':
      activeBreakdown.viewportBindMs = value;
      break;
    case 'first-render':
      activeBreakdown.firstRenderMs = value;
      break;
    default: {
      const _exhaustive: never = name;
      void _exhaustive;
    }
  }
}

export function markViewportReactActive(documentId: string): void {
  if (!activeBreakdown || activeBreakdown.documentId !== documentId) return;
  if (activeBreakdown.reactActiveAtMs !== null) return;
  activeBreakdown.reactActiveAtMs = Date.now();
}

export function markViewportRafResume(documentId: string): void {
  if (!activeBreakdown || activeBreakdown.documentId !== documentId) return;
  if (activeBreakdown.rafResumeAtMs !== null) return;
  activeBreakdown.rafResumeAtMs = Date.now();
}

export function markViewportFirstRenderStart(documentId: string): void {
  if (!activeBreakdown || activeBreakdown.documentId !== documentId) return;
  if (activeBreakdown.firstRenderStartedAtMs !== null) return;
  activeBreakdown.firstRenderStartedAtMs = Date.now();
}

export function noteViewportBreakdownCounts(countsIn: {
  readonly candidateCount?: number;
  readonly exhibitCount?: number;
  readonly skippedCount?: number;
}): void {
  if (!activeBreakdown) return;
  if (countsIn.candidateCount !== undefined)
    activeBreakdown.candidateCount = countsIn.candidateCount;
  if (countsIn.exhibitCount !== undefined) activeBreakdown.exhibitCount = countsIn.exhibitCount;
  if (countsIn.skippedCount !== undefined) activeBreakdown.skippedCount = countsIn.skippedCount;
}

export function markViewportBoardReady(): void {
  if (!activeBreakdown) return;
  activeBreakdown.boardReadyAtMs = Date.now();
}

export function markViewportConstructStarted(): void {
  if (!activeBreakdown) return;
  activeBreakdown.constructStartedAtMs = Date.now();
}

export function markViewportConstructReady(): void {
  if (!activeBreakdown) return;
  activeBreakdown.viewportReadyAtMs = Date.now();
}

export function recordViewportStoryMount(sample: ViewportStoryMountSample): void {
  if (!activeBreakdown) return;
  activeBreakdown.stories.push(sample);
}

export function activeViewportBreakdownDocumentId(): string | null {
  return activeBreakdown?.documentId ?? null;
}

export function recordStoryDiscoveryTiming(timing: StoryDiscoveryTiming): void {
  if (!viewportTimingsEnabled()) return;
  lastDiscovery = timing;
}

/**
 * Drop the measurements of the project that just closed. Registered with
 * `onProjectSessionEnd`.
 *
 * Every sample here is keyed by DOCUMENT id, and document ids repeat across
 * projects (`workspace:game`, a scene document's own id) — so without this the
 * next project's first activation reads as its Nth, `latestViewportActivation`
 * hands back the previous project's timing for a document it never opened, and
 * a breakdown left open by the closing project keeps collecting segments under
 * the new one. `timingsForced` is NOT reset: it is a URL/debug switch, not
 * session state.
 */
export function resetViewportActivationTimingsForNewProject(): void {
  latest.clear();
  counts.clear();
  activeBreakdown = null;
  lastDiscovery = null;
}

/** Test-only reset. */
export function __resetViewportActivationTimingsForTest(): void {
  latest.clear();
  counts.clear();
  timingsForced = null;
  activeBreakdown = null;
  lastDiscovery = null;
  firstViewportFrameWaiters.clear();
}

/** Test-only override. `null` restores the window/URL check. */
export function __setViewportTimingsEnabledForTest(value: boolean | null): void {
  timingsForced = value;
}
