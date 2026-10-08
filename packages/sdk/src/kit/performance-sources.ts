import type { PerformanceProfiler } from './performance-profiler';

export interface EditorPerformanceSource {
  readonly id: string;
  readonly label: string;
  readonly kind: 'scene' | 'source' | 'asset' | 'game';
  readonly profiler: PerformanceProfiler;
  /** Mount identity for a Game runtime source. Document identity stays
   * `workspace:game`; this disambiguates the runtime inspected inside it. */
  readonly instanceId?: string;
}

const sources = new Map<string, EditorPerformanceSource>();
const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version++;
  for (const listener of listeners) listener();
}

/** Register one real render loop as a profiler source. */
export function registerPerformanceSource(source: EditorPerformanceSource): () => void {
  sources.set(source.id, source);
  notify();
  return () => {
    if (sources.get(source.id) !== source) return;
    sources.delete(source.id);
    notify();
  };
}

export function performanceSourceForDocument(
  documentId: string | null,
): EditorPerformanceSource | null {
  return documentId ? (sources.get(documentId) ?? null) : null;
}

/** Every registered render loop. The self-vitals checks
 *  (`coverage/session-vitals.ts`) ask "did the thing that is running draw a
 *  frame", which is a question about whichever loop exists, not about the
 *  document the user happens to be looking at. */
export function allPerformanceSources(): readonly EditorPerformanceSource[] {
  return [...sources.values()];
}

export function performanceSourceForGameInstance(
  instanceId: string | null,
): EditorPerformanceSource | null {
  if (instanceId === null) return null;
  for (const source of sources.values()) {
    if (source.kind === 'game' && source.instanceId === instanceId) return source;
  }
  return null;
}

export function subscribePerformanceSources(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function performanceSourcesVersion(): number {
  return version;
}

export function __resetPerformanceSourcesForTest(): void {
  sources.clear();
  notify();
}
