import type { ShareRole } from '../share';

export type CollaborationCapability =
  | 'view'
  | 'comment'
  | 'test'
  | 'edit'
  | 'terminal'
  | 'maintain';
/**
 * A collaboration role is a {@link ShareRole} PLUS the local-only `maintainer`,
 * and it is spelled that way so the relationship is CHECKED. Written as its own
 * six-member union — which is what it was — the two lists drift with no
 * compiler signal: a role added to the share wire is simply a role this session
 * cannot hold, and the only symptom is a participant the UI refuses to promote.
 */
export type CollaborationRole = ShareRole | 'maintainer';
/**
 * Least authority first; `maintainer` is local-only and has no share role.
 *
 * Declared as a `satisfies Record<CollaborationRole, …>` rather than an array
 * annotated `readonly CollaborationRole[]`, because the array form accepts an
 * INCOMPLETE list: adding a role to `CollaborationRole` and forgetting it here
 * compiles, and the only symptom is that `assignableCollaborationRoles` quietly
 * offers a participant one fewer role than they can hold. A missing key here is
 * a compile error.
 */
const COLLABORATION_ROLE_RANK = {
  viewer: 0,
  commenter: 1,
  tester: 2,
  editor: 3,
  terminal: 4,
  maintainer: 5,
} as const satisfies Record<CollaborationRole, number>;

export const COLLABORATION_ROLE_ORDER: readonly CollaborationRole[] = (
  Object.keys(COLLABORATION_ROLE_RANK) as CollaborationRole[]
).sort((a, b) => COLLABORATION_ROLE_RANK[a] - COLLABORATION_ROLE_RANK[b]);

/**
 * Which roles a UI may OFFER for one participant. Enforcement is the server's,
 * always; this only keeps the editor from presenting an option the session
 * would refuse. A participant that entered through the share gateway carries a
 * verified `account` and can never reach `maintainer`, nor exceed the ceiling
 * its invitation set.
 */
export function assignableCollaborationRoles(
  participant: { account: { id: string } | null },
  ceiling?: CollaborationRole,
): CollaborationRole[] {
  if (!participant.account) return [...COLLABORATION_ROLE_ORDER];
  const remoteLimit = COLLABORATION_ROLE_ORDER.indexOf('terminal');
  const ceilingIndex = ceiling ? COLLABORATION_ROLE_ORDER.indexOf(ceiling) : remoteLimit;
  const limit = Math.min(remoteLimit, ceilingIndex < 0 ? remoteLimit : ceilingIndex);
  return COLLABORATION_ROLE_ORDER.slice(0, limit + 1);
}

export type ParticipantKind = 'human' | 'agent';
export type ParticipantStatus = 'active' | 'idle' | 'needs-input' | 'done';

export interface CollaborationParticipantLocation {
  repositoryId: string;
  worktreeId: string;
  sessionId: string;
}

export interface CollaborationAgentIdentity {
  harness: string;
  conversationId: string;
}

export interface CollaborationCameraPose {
  x: number;
  y: number;
  z: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  fov: number;
}

export function isCollaborationCameraPose(value: unknown): value is CollaborationCameraPose {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const camera = value as Record<string, unknown>;
  const keys = ['x', 'y', 'z', 'targetX', 'targetY', 'targetZ', 'fov'] as const;
  return (
    Object.keys(camera).length === keys.length &&
    keys.every((key) => typeof camera[key] === 'number' && Number.isFinite(camera[key])) &&
    (camera['fov'] as number) > 0 &&
    (camera['fov'] as number) < 180
  );
}

/**
 * THE owner of team-message size limits, read by the HTTP route guard and by
 * `CollaborationSession`'s own methods alike.
 *
 * The two used to carry separate numbers and disagree in both directions — the
 * route accepted 20k of text the session then refused, and refused 50
 * references the session would have taken — so which error a caller saw
 * depended on which layer happened to see the message first. Each value here is
 * the tighter of the pair that split produced.
 */
export const TEAM_MESSAGE_LIMITS = {
  text: 10_000,
  mentions: 16,
  mentionLength: 80,
  references: 32,
} as const;

export const COLLABORATION_AGENT_MENTIONS = ['agent', 'claude', 'codex'] as const;

export function isCollaborationAgentMention(value: string): boolean {
  return (COLLABORATION_AGENT_MENTIONS as readonly string[]).includes(value.toLowerCase());
}

export interface CollaborationPresence {
  document: string | null;
  file: string | null;
  oid: string | null;
  selection: readonly string[];
  camera: Readonly<CollaborationCameraPose> | null;
  gesture: Readonly<Record<string, unknown>> | null;
  playtest?: {
    id: string;
    play: 'starting' | 'ready' | 'error';
    networking: 'not-declared' | 'connecting' | 'ready' | 'error';
    roomName: string | null;
    problem: string | null;
  } | null;
}

export interface CollaborationParticipant {
  participantId: string;
  /** Verified VGAI account authority. Null only for local-only host/agent
   * participants that did not enter through a public share gateway. */
  account: { id: string; email: string; name?: string } | null;
  displayName: string;
  kind: ParticipantKind;
  color: string;
  status: ParticipantStatus;
  location: CollaborationParticipantLocation | null;
  agent: CollaborationAgentIdentity | null;
  role: CollaborationRole;
  capabilities: readonly CollaborationCapability[];
  connectedAt: string;
  lastSeenAt: string;
  presence: CollaborationPresence;
}

export interface CollaborationAuthorProjection {
  participantId: string;
  account: { id: string; email: string; name?: string } | null;
  displayName: string;
  kind: ParticipantKind;
  color: string;
  location: CollaborationParticipantLocation | null;
}

const PARTICIPANT_COLORS = [
  '#4f8cff',
  '#e45c9d',
  '#20a87a',
  '#a46de8',
  '#d9782d',
  '#2f9eb8',
  '#ca4f55',
  '#6f9f32',
] as const;

export function collaborationParticipantColor(identity: string): string {
  let hash = 2_166_136_261;
  for (const codePoint of identity) {
    hash ^= codePoint.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return PARTICIPANT_COLORS[(hash >>> 0) % PARTICIPANT_COLORS.length]!;
}

export type TeamMessageReference =
  | { type: 'worktree'; worktreeId: string }
  | { type: 'revision'; revision: number }
  | { type: 'file'; path: string; revision: number }
  | { type: 'oid'; oid: string; revision: number }
  | { type: 'asset'; path: string; revision: number }
  | { type: 'screenshot'; id: string; revision: number }
  | { type: 'playtest'; id: string; revision: number }
  | { type: 'diff'; fromRevision: number; toRevision: number };

export interface TeamMessage {
  id: string;
  authorId: string;
  author: CollaborationAuthorProjection;
  text: string;
  mentions: readonly string[];
  references: readonly TeamMessageReference[];
  threadId: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  reactions: Readonly<Record<string, readonly string[]>>;
  revision: number;
  createdAt: string;
}

export interface SourceRevision {
  revision: number;
  authorId: string;
  author: CollaborationAuthorProjection;
  source: 'editor' | 'filesystem';
  resources: readonly { path: string; sha: string | null }[];
  createdAt: string;
}

export interface CollaborationAuditEvent {
  id: string;
  type: 'join' | 'leave' | 'role' | 'revision' | 'message' | 'agent' | 'playtest' | 'git';
  participantId: string;
  createdAt: string;
  detail: Readonly<Record<string, unknown>>;
}

export interface TeamPlaytest {
  id: string;
  revision: number;
  seed: number;
  roomKey: string;
  startedBy: string;
  startedAt: string;
}

export interface CollaborationSnapshot {
  sequence: number;
  revision: number;
  activePlaytest: TeamPlaytest | null;
  participants: readonly CollaborationParticipant[];
  messages: readonly TeamMessage[];
  revisions: readonly SourceRevision[];
  audit: readonly CollaborationAuditEvent[];
}

export type CollaborationEventChannel =
  | 'participants'
  | 'presence'
  | 'messages'
  | 'revisions'
  | 'audit'
  | 'team-test';

export interface CollaborationEvent {
  sequence: number;
  channel: CollaborationEventChannel;
  createdAt: string;
  payload: unknown;
}

export interface CollaborationResume {
  cursor: number;
  reset: boolean;
  events: readonly CollaborationEvent[];
  snapshot?: CollaborationSnapshot;
}
