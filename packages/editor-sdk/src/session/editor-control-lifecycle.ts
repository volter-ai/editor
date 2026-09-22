/**
 * The identity envelope shared by every editor control transport.
 *
 * A page has more than one useful identity: the server process it loaded
 * from, the tab it occupies, the page load inside that tab, and the current
 * transport connection. Treating any one of those as all four is how a
 * duplicated tab could heartbeat as B while its copied control socket still
 * received commands as A. Every upstream control fact now names the complete
 * generation that made it true.
 */

export const EDITOR_CONTROL_LIFECYCLE_VERSION = 1 as const;

export interface EditorControlLifecycle {
  readonly version: typeof EDITOR_CONTROL_LIFECYCLE_VERSION;
  /** The editor server process (`processSessionId()`). */
  readonly serverGeneration: string;
  /** One accepted event-stream connection. Reconnects always mint a new one. */
  readonly connectionGeneration: string;
  /** The inline bootstrap's per-page id. */
  readonly clientId: string;
  /** The sessionStorage identity that survives reloads. */
  readonly tabId: string;
  /** The heartbeat worker's page-load epoch. */
  readonly pageGeneration: string;
}

export function parseEditorControlLifecycle(value: unknown): EditorControlLifecycle | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record['version'] !== EDITOR_CONTROL_LIFECYCLE_VERSION ||
    typeof record['serverGeneration'] !== 'string' ||
    typeof record['connectionGeneration'] !== 'string' ||
    typeof record['clientId'] !== 'string' ||
    typeof record['tabId'] !== 'string' ||
    typeof record['pageGeneration'] !== 'string'
  ) {
    return null;
  }
  return {
    version: EDITOR_CONTROL_LIFECYCLE_VERSION,
    serverGeneration: record['serverGeneration'],
    connectionGeneration: record['connectionGeneration'],
    clientId: record['clientId'],
    tabId: record['tabId'],
    pageGeneration: record['pageGeneration'],
  };
}

export type EditorControlLifecycleField = Exclude<keyof EditorControlLifecycle, 'version'>;

/** Which parent generation disagrees, or null when the envelope is current. */
export function editorControlLifecycleMismatch(
  expected: EditorControlLifecycle,
  reported: EditorControlLifecycle,
): EditorControlLifecycleField | null {
  for (const field of [
    'serverGeneration',
    'connectionGeneration',
    'clientId',
    'tabId',
    'pageGeneration',
  ] as const) {
    if (expected[field] !== reported[field]) return field;
  }
  return null;
}
