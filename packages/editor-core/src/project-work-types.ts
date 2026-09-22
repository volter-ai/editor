import {
  type ExternalWorkActivity,
  ExternalWorkActivitySchema,
  type PromptContextItem,
} from 'ztrack/supercode';
import type { Payload } from 'ztrack/visualizer-kit';

export type ProjectWorkTrackerState =
  | { state: 'ready'; payload: Payload }
  | { state: 'missing' }
  | { state: 'error'; message: string }
  | { state: 'unsupported'; reason: string };

export interface ProjectWorkAssociation {
  sessionIdentity: string;
  issueId: string | null;
  state: 'resolved' | 'unresolved' | 'conflict' | 'stale' | 'loading' | 'error';
  source: 'explicit' | 'ambient' | null;
  reason: string;
  observedAt: number | null;
}

export interface ProjectWorkSnapshot {
  schema: 'vgai.project-work.v1';
  revision: number;
  projectKey: string | null;
  tracker: ProjectWorkTrackerState;
  associations: ProjectWorkAssociation[];
  activityByIssue: Record<string, ExternalWorkActivity[]>;
  presentation: {
    extensionHash: string | null;
    extensionError: string | null;
    theme: Record<string, string>;
    themeError: string | null;
  };
}

export type ProjectWorkAction = { type: 'context'; issueId: string };
export interface ProjectWorkContextResult {
  context: PromptContextItem;
}

/** Whether the chat-side roll-up has anything actionable to show. Tracker setup and loading
 * states are not content; the full board can still surface those states when explicitly opened. */
export function hasVisibleProjectWork(snapshot: ProjectWorkSnapshot): boolean {
  if (snapshot.tracker.state !== 'ready') return false;
  const durableIssues = snapshot.tracker.payload.issues.length;
  const observedActivity = Object.values(snapshot.activityByIssue).some(
    (entries) => entries.length > 0,
  );
  const associationWarning = snapshot.associations.some(
    (association) =>
      association.state === 'conflict' ||
      association.state === 'stale' ||
      association.state === 'error',
  );
  return durableIssues > 0 || observedActivity || associationWarning;
}

export function unavailableProjectWorkSnapshot(reason: string): ProjectWorkSnapshot {
  return {
    schema: 'vgai.project-work.v1',
    revision: 0,
    projectKey: null,
    tracker: { state: 'unsupported', reason },
    associations: [],
    activityByIssue: {},
    presentation: { extensionHash: null, extensionError: null, theme: {}, themeError: null },
  };
}

function validTrackerState(tracker: Record<string, unknown> | undefined): boolean {
  if (!tracker) return false;
  if (tracker['state'] === 'missing') return true;
  if (tracker['state'] === 'error') return typeof tracker['message'] === 'string';
  if (tracker['state'] === 'unsupported') return typeof tracker['reason'] === 'string';
  if (tracker['state'] !== 'ready' || !tracker['payload'] || typeof tracker['payload'] !== 'object')
    return false;
  return Array.isArray((tracker['payload'] as Record<string, unknown>)['issues']);
}

function validAssociation(item: unknown): boolean {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const association = item as Record<string, unknown>;
  return (
    typeof association['sessionIdentity'] === 'string' &&
    (association['issueId'] === null || typeof association['issueId'] === 'string') &&
    ['resolved', 'unresolved', 'conflict', 'stale', 'loading', 'error'].includes(
      String(association['state']),
    ) &&
    (association['source'] === null ||
      association['source'] === 'explicit' ||
      association['source'] === 'ambient') &&
    typeof association['reason'] === 'string' &&
    (association['observedAt'] === null || typeof association['observedAt'] === 'number')
  );
}

function validActivityMap(activity: unknown): boolean {
  return (
    !!activity &&
    typeof activity === 'object' &&
    !Array.isArray(activity) &&
    Object.values(activity as Record<string, unknown>).every(
      (items) =>
        Array.isArray(items) &&
        items.every((item) => ExternalWorkActivitySchema.safeParse(item).success),
    )
  );
}

function validPresentationState(presentation: Record<string, unknown> | undefined): boolean {
  return (
    !!presentation &&
    (presentation['extensionHash'] === null || typeof presentation['extensionHash'] === 'string') &&
    (presentation['extensionError'] === null ||
      typeof presentation['extensionError'] === 'string') &&
    !!presentation['theme'] &&
    typeof presentation['theme'] === 'object' &&
    !Array.isArray(presentation['theme']) &&
    Object.values(presentation['theme'] as Record<string, unknown>).every(
      (item) => typeof item === 'string',
    ) &&
    (presentation['themeError'] === null || typeof presentation['themeError'] === 'string')
  );
}

export function parseProjectWorkSnapshot(value: unknown): ProjectWorkSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Malformed Project Work snapshot.');
  const record = value as Record<string, unknown>;
  const tracker = record['tracker'] as Record<string, unknown> | undefined;
  const projectKey = record['projectKey'];
  const associations = record['associations'];
  const activity = record['activityByIssue'];
  const presentation = record['presentation'] as Record<string, unknown> | undefined;
  if (
    record['schema'] !== 'vgai.project-work.v1' ||
    typeof record['revision'] !== 'number' ||
    (projectKey !== null && typeof projectKey !== 'string') ||
    !validTrackerState(tracker) ||
    !Array.isArray(associations) ||
    !associations.every(validAssociation) ||
    !validActivityMap(activity) ||
    !validPresentationState(presentation)
  )
    throw new Error('Malformed Project Work snapshot.');
  return structuredClone(value) as ProjectWorkSnapshot;
}
