export const ASSET_WORKFLOW_BUDGETS = {
  firstResultsMs: 500,
  filterResponseMs: 50,
  scrollFrameMs: 16.7,
  importProgressLatencyMs: 100,
  maxMountedLibraryCards: 120,
  maxPreviewConcurrency: 2,
  maxActiveAssetEditorWebGlContexts: 1,
  maxRetainedAssetEditorResources: 0,
  maxTelemetryEntries: 200,
} as const;

export type AssetMetricStage =
  | 'query'
  | 'thumbnail'
  | 'preview'
  | 'delivery'
  | 'conversion'
  | 'validation'
  | 'commit';
export interface AssetWorkflowMetric {
  stage: AssetMetricStage;
  durationMs: number;
  outcome: 'ok' | 'failed' | 'cancelled';
  issueCode?: string;
  at: number;
}

const metrics: AssetWorkflowMetric[] = [];
const listeners = new Set<() => void>();

/** Local-only, path-free asset telemetry for the Debugger/Console. */
export function recordAssetWorkflowMetric(metric: Omit<AssetWorkflowMetric, 'at'>): void {
  metrics.push({ ...metric, durationMs: Math.max(0, metric.durationMs), at: Date.now() });
  if (metrics.length > ASSET_WORKFLOW_BUDGETS.maxTelemetryEntries)
    metrics.splice(0, metrics.length - ASSET_WORKFLOW_BUDGETS.maxTelemetryEntries);
  for (const listener of listeners) listener();
}
export function assetWorkflowMetrics(): readonly AssetWorkflowMetric[] {
  return metrics;
}
export function resetAssetWorkflowMetrics(): void {
  metrics.length = 0;
}

export const ASSET_ACTION_RISKS = {
  delete: { destructive: true, confirmation: 'required' },
  overwrite: { destructive: true, confirmation: 'required' },
  'batch-import': { destructive: false, confirmation: 'summary' },
  'external-source': { destructive: false, confirmation: 'external-origin' },
  reveal: { destructive: false, confirmation: 'none' },
  'license-blocked-delivery': { destructive: false, confirmation: 'refuse' },
} as const;
export type AssetRiskAction = keyof typeof ASSET_ACTION_RISKS;

export function confirmAssetAction(action: AssetRiskAction, message: string): boolean {
  const confirmation = ASSET_ACTION_RISKS[action].confirmation;
  if (confirmation === 'refuse') return false;
  if (confirmation === 'none') return true;
  return window.confirm(message);
}
