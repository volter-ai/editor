import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  CollaborationAuditEvent,
  CollaborationAuthorProjection,
  CollaborationCapability,
  CollaborationEvent,
  CollaborationEventChannel,
  CollaborationParticipant,
  CollaborationParticipantLocation,
  CollaborationPresence,
  CollaborationResume,
  CollaborationRole,
  CollaborationSnapshot,
  ParticipantKind,
  ParticipantStatus,
  SourceRevision,
  TeamMessage,
  TeamMessageReference,
  TeamPlaytest,
} from '@volter/editor-sdk/session/collaboration-types';
import {
  collaborationParticipantColor,
  isCollaborationAgentMention,
  TEAM_MESSAGE_LIMITS,
} from '@volter/editor-sdk/session/collaboration-types';
import { canonicalProjectRoot } from './canonical-path';

export type {
  CollaborationAuditEvent,
  CollaborationCapability,
  CollaborationParticipant,
  CollaborationPresence,
  CollaborationRole,
  CollaborationSnapshot,
  ParticipantKind,
  SourceRevision,
  TeamMessage,
  TeamMessageReference,
  TeamPlaytest,
} from '@volter/editor-sdk/session/collaboration-types';

const MAX_MESSAGES = 500;
const MAX_REVISIONS = 1_000;
const MAX_AUDIT = 1_000;
const MAX_DURABLE_EVENTS = 1_000;
const DURABLE_HISTORY_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1_000;

function retainedByAge<T extends { createdAt: string }>(
  values: readonly T[],
  now = Date.now(),
): T[] {
  const cutoff = now - DURABLE_HISTORY_MAX_AGE_MS;
  return values.filter((value) => {
    const created = Date.parse(value.createdAt);
    return Number.isFinite(created) && created >= cutoff;
  });
}

const ROLE_CAPABILITIES: Record<CollaborationRole, readonly CollaborationCapability[]> = {
  viewer: ['view'],
  commenter: ['view', 'comment'],
  tester: ['view', 'comment', 'test'],
  editor: ['view', 'comment', 'test', 'edit'],
  terminal: ['view', 'comment', 'test', 'edit', 'terminal'],
  maintainer: ['view', 'comment', 'test', 'edit', 'terminal', 'maintain'],
};

export function parseTeamMessageReferences(
  value: unknown,
  currentRevision: number,
): TeamMessageReference[] {
  if (!Array.isArray(value)) throw new Error('Team message references must be an array.');
  const revision = (candidate: unknown, field: string) => {
    if (
      !Number.isInteger(candidate) ||
      (candidate as number) < 0 ||
      (candidate as number) > currentRevision
    ) {
      throw new Error(`${field} must name an existing source revision.`);
    }
    return candidate as number;
  };
  const text = (candidate: unknown, field: string) => {
    if (typeof candidate !== 'string' || !candidate || candidate.length > 1_000) {
      throw new Error(`${field} must be a non-empty string.`);
    }
    return candidate;
  };
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('Invalid team message reference.');
    }
    const reference = candidate as Record<string, unknown>;
    switch (reference['type']) {
      case 'worktree':
        return { type: 'worktree', worktreeId: text(reference['worktreeId'], 'worktreeId') };
      case 'revision':
        return { type: 'revision', revision: revision(reference['revision'], 'revision') };
      case 'file':
      case 'asset':
        return {
          type: reference['type'],
          path: text(reference['path'], 'path'),
          revision: revision(reference['revision'], 'revision'),
        };
      case 'oid':
        return {
          type: 'oid',
          oid: text(reference['oid'], 'oid'),
          revision: revision(reference['revision'], 'revision'),
        };
      case 'screenshot':
      case 'playtest':
        return {
          type: reference['type'],
          id: text(reference['id'], 'id'),
          revision: revision(reference['revision'], 'revision'),
        };
      case 'diff': {
        const fromRevision = revision(reference['fromRevision'], 'fromRevision');
        const toRevision = revision(reference['toRevision'], 'toRevision');
        if (fromRevision > toRevision) throw new Error('A diff reference must move forward.');
        return { type: 'diff', fromRevision, toRevision };
      }
      default:
        throw new Error('Unknown team message reference type.');
    }
  });
}

const EMPTY_PRESENCE: CollaborationPresence = {
  document: null,
  file: null,
  oid: null,
  selection: [],
  camera: null,
  gesture: null,
};

export class CollaborationConflictError extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly currentRevision: number,
    readonly resources: readonly string[],
  ) {
    super(
      `Source changed after revision ${expectedRevision}; current revision is ${currentRevision}: ${resources.join(', ')}`,
    );
  }
}

export class CollaborationSession {
  private revision = 0;
  private readonly participants = new Map<string, CollaborationParticipant>();
  private readonly assignedRoles = new Map<string, CollaborationRole>();
  private readonly roleCeilings = new Map<string, CollaborationRole>();
  private readonly messages: TeamMessage[] = [];
  private readonly revisions: SourceRevision[] = [];
  private readonly audit: CollaborationAuditEvent[] = [];
  private readonly events: CollaborationEvent[] = [];
  private readonly resourceRevisions = new Map<string, { revision: number; sha: string | null }>();
  private readonly listeners = new Set<(snapshot: CollaborationSnapshot) => void>();
  private readonly eventListeners = new Set<(event: CollaborationEvent) => void>();
  private activePlaytest: TeamPlaytest | null = null;
  private sequence = 0;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly persistencePath?: string) {
    if (!persistencePath) return;
    try {
      const value = JSON.parse(readFileSync(persistencePath, 'utf8')) as {
        version?: unknown;
        revision?: unknown;
        assignedRoles?: unknown;
        messages?: unknown;
        revisions?: unknown;
        audit?: unknown;
        resourceRevisions?: unknown;
        sequence?: unknown;
        events?: unknown;
        activePlaytest?: unknown;
      };
      if (value.version !== 1 && value.version !== 2) {
        throw new Error(`Unsupported collaboration state version: ${String(value.version)}.`);
      }
      if (!Number.isInteger(value.revision))
        throw new Error('Invalid collaboration state revision.');
      this.revision = value.revision as number;
      this.sequence =
        value.version === 2 && Number.isInteger(value.sequence) ? (value.sequence as number) : 0;
      if (Array.isArray(value.assignedRoles)) {
        for (const entry of value.assignedRoles) {
          if (
            Array.isArray(entry) &&
            typeof entry[0] === 'string' &&
            typeof entry[1] === 'string' &&
            Object.hasOwn(ROLE_CAPABILITIES, entry[1])
          ) {
            this.assignedRoles.set(entry[0], entry[1] as CollaborationRole);
          }
        }
      }
      if (Array.isArray(value.messages)) {
        this.messages.push(
          ...retainedByAge(value.messages as TeamMessage[])
            .slice(-MAX_MESSAGES)
            .map((message) => ({
              ...message,
              author: message.author ?? this.authorProjection(message.authorId),
              threadId: message.threadId ?? null,
              editedAt: message.editedAt ?? null,
              deletedAt: message.deletedAt ?? null,
              reactions: message.reactions ?? {},
            })),
        );
      }
      if (Array.isArray(value.revisions)) {
        this.revisions.push(
          ...retainedByAge(value.revisions as SourceRevision[])
            .slice(-MAX_REVISIONS)
            .map((revision) => ({
              ...revision,
              author: revision.author ?? this.authorProjection(revision.authorId),
            })),
        );
      }
      if (Array.isArray(value.audit)) {
        this.audit.push(
          ...retainedByAge(value.audit as CollaborationAuditEvent[]).slice(-MAX_AUDIT),
        );
      }
      if (Array.isArray(value.resourceRevisions)) {
        for (const entry of value.resourceRevisions) {
          if (
            Array.isArray(entry) &&
            typeof entry[0] === 'string' &&
            entry[1] &&
            typeof entry[1] === 'object'
          ) {
            const state = entry[1] as { revision?: unknown; sha?: unknown };
            if (
              Number.isInteger(state.revision) &&
              (typeof state.sha === 'string' || state.sha === null)
            ) {
              this.resourceRevisions.set(entry[0], {
                revision: state.revision as number,
                sha: state.sha,
              });
            }
          }
        }
      }
      if (value.version === 2 && Array.isArray(value.events)) {
        this.events.push(
          ...retainedByAge(value.events as CollaborationEvent[]).slice(-MAX_DURABLE_EVENTS),
        );
      }
      if (value.version === 2 && value.activePlaytest && typeof value.activePlaytest === 'object') {
        this.activePlaytest = { ...(value.activePlaytest as TeamPlaytest) };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      // ANY malformed state, not only unparseable bytes. Structurally-invalid
      // JSON (`"messages": [null]`, a non-array `resourceRevisions`) throws out
      // of the mapping above, and a throw from this constructor takes
      // `collaborationSession()` — and with it the editor's whole project open
      // — down with it. Quarantine and start empty instead; the partially
      // applied load is discarded too, because half a history read out of a
      // file we have just declared untrustworthy is not a history.
      const quarantined = `${persistencePath}.corrupt-${Date.now()}`;
      renameSync(persistencePath, quarantined);
      this.revision = 0;
      this.sequence = 0;
      this.activePlaytest = null;
      this.assignedRoles.clear();
      this.resourceRevisions.clear();
      this.messages.length = 0;
      this.revisions.length = 0;
      this.audit.length = 0;
      this.events.length = 0;
      console.warn(`[vgai-editor] Quarantined corrupt collaboration state at ${quarantined}.`);
    }
  }

  subscribe(listener: (snapshot: CollaborationSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeEvents(listener: (event: CollaborationEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  resume(cursor: number): CollaborationResume {
    const first = this.events[0]?.sequence ?? this.sequence + 1;
    if (!Number.isSafeInteger(cursor) || cursor < first - 1 || cursor > this.sequence) {
      return { cursor: this.sequence, reset: true, events: [], snapshot: this.snapshot() };
    }
    return {
      cursor: this.sequence,
      reset: false,
      events: this.events.filter((event) => event.sequence > cursor).map((event) => ({ ...event })),
    };
  }

  clearHistory(): void {
    this.messages.length = 0;
    this.revisions.length = 0;
    this.audit.length = 0;
    this.events.length = 0;
    this.persist();
  }

  flush(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    this.persistNow();
  }

  snapshot(): CollaborationSnapshot {
    return {
      sequence: this.sequence,
      revision: this.revision,
      activePlaytest: this.activePlaytest ? { ...this.activePlaytest } : null,
      participants: [...this.participants.values()].map((participant) => ({
        ...participant,
        location: participant.location ? { ...participant.location } : null,
        agent: participant.agent ? { ...participant.agent } : null,
        presence: { ...participant.presence, selection: [...participant.presence.selection] },
      })),
      messages: this.messages.map((message) => ({
        ...message,
        mentions: [...message.mentions],
        references: [...message.references],
        reactions: Object.fromEntries(
          Object.entries(message.reactions).map(([reaction, participants]) => [
            reaction,
            [...participants],
          ]),
        ),
      })),
      revisions: this.revisions.map((revision) => ({
        ...revision,
        resources: revision.resources.map((resource) => ({ ...resource })),
      })),
      audit: this.audit.map((event) => ({ ...event, detail: { ...event.detail } })),
    };
  }

  join(input: {
    participantId: string;
    account?: { id: string; email: string; name?: string } | null;
    displayName: string;
    kind: ParticipantKind;
    location?: CollaborationParticipantLocation | undefined;
    status?: ParticipantStatus;
    agent?: { harness: string; conversationId: string } | null;
    role: CollaborationRole;
    /** Share-gateway roles are a connection-scoped ceiling, not a durable
     * assignment that can be recovered from this browser's older identity. */
    ephemeralRole?: boolean;
  }): CollaborationParticipant {
    const now = new Date().toISOString();
    const previous = this.participants.get(input.participantId);
    // `setRole`'s last-maintainer guard only covers DEMOTION, so the sole
    // maintainer closing their tab leaves a room nobody can ever manage again:
    // handing 'maintain' back needs 'maintain'. A durable join that ASKS for
    // maintainer while the room has none is therefore the one case where the
    // recalled assignment does not win. It only ever raises, so restoring a
    // stored role from ignored session state is untouched, and a share
    // participant never reaches here — its role is the ceiling below.
    const recoversMaintainer =
      !input.ephemeralRole && input.role === 'maintainer' && !this.hasMaintainer();
    const role =
      input.ephemeralRole || recoversMaintainer
        ? input.role
        : (previous?.role ?? this.assignedRoles.get(input.participantId) ?? input.role);
    if (input.ephemeralRole) this.roleCeilings.set(input.participantId, input.role);
    else {
      this.roleCeilings.delete(input.participantId);
      this.assignedRoles.set(input.participantId, role);
    }
    const participant: CollaborationParticipant = {
      participantId: input.participantId,
      account: input.account ?? previous?.account ?? null,
      displayName: input.displayName,
      kind: input.kind,
      color:
        previous?.color ?? collaborationParticipantColor(input.account?.id ?? input.participantId),
      status: input.status ?? previous?.status ?? 'active',
      location: input.location ? { ...input.location } : (previous?.location ?? null),
      agent: input.agent ? { ...input.agent } : null,
      role,
      capabilities: [...ROLE_CAPABILITIES[role]],
      connectedAt: previous?.connectedAt ?? now,
      lastSeenAt: now,
      presence: previous?.presence ?? EMPTY_PRESENCE,
    };
    this.participants.set(input.participantId, participant);
    this.recordAudit('join', input.participantId, {
      role,
      kind: input.kind,
      ...(participant.account ? { accountId: participant.account.id } : {}),
    });
    this.emit('participants', participant);
    return participant;
  }

  updateParticipant(
    participantId: string,
    patch: {
      displayName?: string;
      status?: ParticipantStatus;
      location?: CollaborationParticipantLocation | undefined;
      agent?: { harness: string; conversationId: string } | null;
    },
  ): void {
    const participant = this.require(participantId, 'view');
    this.participants.set(participantId, {
      ...participant,
      ...(patch.displayName ? { displayName: patch.displayName } : {}),
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.location ? { location: { ...patch.location } } : {}),
      ...(patch.agent !== undefined ? { agent: patch.agent ? { ...patch.agent } : null } : {}),
      lastSeenAt: new Date().toISOString(),
    });
    this.emit('participants', this.participants.get(participantId), false);
  }

  leave(participantId: string): void {
    if (!this.participants.delete(participantId)) return;
    this.roleCeilings.delete(participantId);
    this.recordAudit('leave', participantId, {});
    this.emit('participants', { participantId, left: true });
  }

  setRole(actorId: string, participantId: string, role: CollaborationRole): void {
    this.require(actorId, 'maintain');
    const participant = this.participants.get(participantId);
    if (!participant) throw new Error(`Unknown participant: ${participantId}`);
    const ceiling = this.roleCeilings.get(participantId);
    if (
      ceiling &&
      ROLE_CAPABILITIES[role].some((capability) => !ROLE_CAPABILITIES[ceiling].includes(capability))
    ) {
      throw new Error(`The ${ceiling} share invitation is this participant's role ceiling.`);
    }
    if (
      participant.role === 'maintainer' &&
      role !== 'maintainer' &&
      [...this.participants.values()].filter((candidate) => candidate.role === 'maintainer')
        .length === 1
    ) {
      throw new Error('A collaboration session must keep at least one maintainer.');
    }
    this.participants.set(participantId, {
      ...participant,
      role,
      capabilities: [...ROLE_CAPABILITIES[role]],
      lastSeenAt: new Date().toISOString(),
    });
    if (!ceiling) this.assignedRoles.set(participantId, role);
    this.recordAudit('role', actorId, { participantId, role });
    this.emit('participants', this.participants.get(participantId));
  }

  updatePresence(participantId: string, presence: CollaborationPresence): void {
    const participant = this.require(participantId, 'view');
    this.participants.set(participantId, {
      ...participant,
      lastSeenAt: new Date().toISOString(),
      presence: { ...presence, selection: [...presence.selection] },
    });
    this.emit('presence', { participantId, presence }, false);
  }

  assertSourceMutation(
    participantId: string,
    expectedRevision: number,
    paths: readonly string[],
  ): void {
    this.require(participantId, 'edit');
    if (
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 0 ||
      expectedRevision > this.revision
    ) {
      throw new Error(`Invalid expected revision: ${expectedRevision}.`);
    }
    const changed = paths.filter(
      (path) => (this.resourceRevisions.get(path)?.revision ?? 0) > expectedRevision,
    );
    if (changed.length > 0) {
      throw new CollaborationConflictError(expectedRevision, this.revision, changed);
    }
  }

  resourceStates(paths: readonly string[]): readonly {
    path: string;
    revision: number;
    sha: string | null;
  }[] {
    return paths.map((path) => {
      const state = this.resourceRevisions.get(path);
      return { path, revision: state?.revision ?? 0, sha: state?.sha ?? null };
    });
  }

  recordSourceMutation(input: {
    authorId: string;
    source: 'editor' | 'filesystem';
    resources: readonly { path: string; sha: string | null }[];
  }): SourceRevision | null {
    const changed = input.resources.filter(
      (resource) => this.resourceRevisions.get(resource.path)?.sha !== resource.sha,
    );
    if (changed.length === 0) return null;
    const invalidatedPlaytest = this.activePlaytest;
    this.activePlaytest = null;
    this.revision += 1;
    const revision: SourceRevision = {
      revision: this.revision,
      authorId: input.authorId,
      author: this.authorProjection(input.authorId),
      source: input.source,
      resources: changed.map((resource) => ({ ...resource })),
      createdAt: new Date().toISOString(),
    };
    this.revisions.push(revision);
    if (this.revisions.length > MAX_REVISIONS) {
      this.revisions.splice(0, this.revisions.length - MAX_REVISIONS);
    }
    for (const resource of changed) {
      this.resourceRevisions.set(resource.path, { revision: this.revision, sha: resource.sha });
    }
    this.recordAudit('revision', input.authorId, {
      revision: this.revision,
      source: input.source,
      resources: changed.map((resource) => resource.path),
    });
    if (invalidatedPlaytest) {
      this.recordAudit('playtest', input.authorId, {
        id: invalidatedPlaytest.id,
        action: 'invalidated',
        revision: this.revision,
      });
    }
    this.emit('revisions', {
      revision,
      activePlaytest: this.activePlaytest,
    });
    return revision;
  }

  /** Establish the current checkout baseline, or fold changes made while the
   * editor was stopped into one new revision. The caller supplies the complete
   * project-owned file set, so previously-known missing paths are deletions. */
  synchronizeSourceSnapshot(
    authorId: string,
    resources: readonly { path: string; sha: string }[],
  ): SourceRevision | null {
    const current = new Map(resources.map((resource) => [resource.path, resource.sha]));
    const changed: Array<{ path: string; sha: string | null }> = [];
    for (const [path, state] of this.resourceRevisions) {
      const sha = current.get(path) ?? null;
      if (state.sha !== sha) changed.push({ path, sha });
    }
    for (const resource of resources) {
      if (!this.resourceRevisions.has(resource.path)) {
        this.resourceRevisions.set(resource.path, { revision: this.revision, sha: resource.sha });
      }
    }
    if (changed.length > 0) {
      return this.recordSourceMutation({ authorId, source: 'filesystem', resources: changed });
    }
    this.persist();
    return null;
  }

  postMessage(input: {
    authorId: string;
    text: string;
    mentions?: readonly string[];
    references?: readonly TeamMessageReference[];
    threadId?: string | null;
  }): TeamMessage {
    this.require(input.authorId, 'comment');
    if (input.mentions?.some(isCollaborationAgentMention)) {
      this.require(input.authorId, 'terminal');
    }
    const text = input.text.trim();
    if (!text) throw new Error('A team message cannot be empty.');
    if (text.length > TEAM_MESSAGE_LIMITS.text) {
      throw new Error(`A team message cannot exceed ${TEAM_MESSAGE_LIMITS.text} characters.`);
    }
    if ((input.mentions?.length ?? 0) > TEAM_MESSAGE_LIMITS.mentions)
      throw new Error('A team message has too many mentions.');
    if (
      input.mentions?.some(
        (mention) => !mention || mention.length > TEAM_MESSAGE_LIMITS.mentionLength,
      )
    ) {
      throw new Error(
        `A team message mention must be 1 through ${TEAM_MESSAGE_LIMITS.mentionLength} characters.`,
      );
    }
    if ((input.references?.length ?? 0) > TEAM_MESSAGE_LIMITS.references) {
      throw new Error('A team message has too many references.');
    }
    if (input.threadId && !this.messages.some((message) => message.id === input.threadId)) {
      throw new Error('The team-message thread no longer exists.');
    }
    const message: TeamMessage = {
      id: randomUUID(),
      authorId: input.authorId,
      author: this.authorProjection(input.authorId),
      text,
      mentions: [...(input.mentions ?? [])],
      references: parseTeamMessageReferences(input.references ?? [], this.revision),
      threadId: input.threadId ?? null,
      editedAt: null,
      deletedAt: null,
      reactions: {},
      revision: this.revision,
      createdAt: new Date().toISOString(),
    };
    this.messages.push(message);
    if (this.messages.length > MAX_MESSAGES) {
      this.messages.splice(0, this.messages.length - MAX_MESSAGES);
    }
    this.recordAudit('message', input.authorId, { messageId: message.id });
    this.emit('messages', message);
    return message;
  }

  editMessage(actorId: string, messageId: string, text: string): TeamMessage {
    const actor = this.require(actorId, 'comment');
    const index = this.messages.findIndex((message) => message.id === messageId);
    if (index < 0) throw new Error('That team message no longer exists.');
    const previous = this.messages[index]!;
    // A deleted message is a tombstone, not a draft: editing one would put text
    // back under a deletion the room has already seen.
    if (previous.deletedAt) throw new Error('That team message no longer exists.');
    if (previous.authorId !== actorId && !actor.capabilities.includes('maintain')) {
      throw new Error('Only the author or a maintainer can edit that message.');
    }
    const nextText = text.trim();
    if (!nextText || nextText.length > TEAM_MESSAGE_LIMITS.text) {
      throw new Error(`A team message must be 1 through ${TEAM_MESSAGE_LIMITS.text} characters.`);
    }
    const next = { ...previous, text: nextText, editedAt: new Date().toISOString() };
    this.messages[index] = next;
    this.recordAudit('message', actorId, { messageId, action: 'edit' });
    this.emit('messages', next);
    return next;
  }

  deleteMessage(actorId: string, messageId: string): TeamMessage {
    const actor = this.require(actorId, 'comment');
    const index = this.messages.findIndex((message) => message.id === messageId);
    if (index < 0) throw new Error('That team message no longer exists.');
    const previous = this.messages[index]!;
    if (previous.authorId !== actorId && !actor.capabilities.includes('maintain')) {
      throw new Error('Only the author or a maintainer can delete that message.');
    }
    const next: TeamMessage = {
      ...previous,
      text: '',
      mentions: [],
      references: [],
      deletedAt: new Date().toISOString(),
    };
    this.messages[index] = next;
    this.recordAudit('message', actorId, { messageId, action: 'delete' });
    this.emit('messages', next);
    return next;
  }

  toggleMessageReaction(actorId: string, messageId: string, reaction: string): TeamMessage {
    this.require(actorId, 'comment');
    if (!reaction || reaction.length > 16) throw new Error('Invalid message reaction.');
    const index = this.messages.findIndex((message) => message.id === messageId);
    if (index < 0) throw new Error('That team message no longer exists.');
    const previous = this.messages[index]!;
    if (previous.deletedAt) throw new Error('That team message no longer exists.');
    const reactions = Object.fromEntries(
      Object.entries(previous.reactions).map(([key, participants]) => [key, [...participants]]),
    );
    const participants = new Set(reactions[reaction] ?? []);
    if (participants.has(actorId)) participants.delete(actorId);
    else participants.add(actorId);
    if (participants.size > 0) reactions[reaction] = [...participants];
    else delete reactions[reaction];
    const next = { ...previous, reactions };
    this.messages[index] = next;
    // Reactions are the one message mutation that left no audit trail, so a
    // room's own log could not answer who reacted to what.
    this.recordAudit('message', actorId, { messageId, action: 'reaction', reaction });
    this.emit('messages', next);
    return next;
  }

  recordAgentInvocation(participantId: string, detail: Readonly<Record<string, unknown>>): void {
    this.require(participantId, 'terminal');
    this.recordAudit('agent', participantId, detail);
    this.emit('audit', this.audit.at(-1));
  }

  recordPlaytest(participantId: string, detail: Readonly<Record<string, unknown>>): void {
    this.require(participantId, 'test');
    this.recordAudit('playtest', participantId, detail);
    this.emit('audit', this.audit.at(-1));
  }

  recordGitAction(participantId: string, detail: Readonly<Record<string, unknown>>): void {
    this.require(participantId, 'maintain');
    this.recordAudit('git', participantId, detail);
    this.emit('audit', this.audit.at(-1));
  }

  startPlaytest(participantId: string, playtest: TeamPlaytest): void {
    this.require(participantId, 'test');
    if (this.activePlaytest) {
      throw new Error(`Team Test ${this.activePlaytest.id} is already active.`);
    }
    this.activePlaytest = { ...playtest };
    this.recordAudit('playtest', participantId, { ...playtest, action: 'start' });
    this.emit('team-test', this.activePlaytest);
  }

  stopPlaytest(participantId: string, playtestId: string): boolean {
    this.require(participantId, 'test');
    if (this.activePlaytest?.id !== playtestId) return false;
    this.activePlaytest = null;
    this.recordAudit('playtest', participantId, { id: playtestId, action: 'stop' });
    this.emit('team-test', null);
    return true;
  }

  roleFor(participantId: string): CollaborationRole | null {
    return (
      this.participants.get(participantId)?.role ?? this.assignedRoles.get(participantId) ?? null
    );
  }

  /** Whether a CURRENT participant holds this capability. Callers that must
   * check authority before a side effect outside this session use it so they
   * do not have to copy a whole snapshot to read one flag. Every role includes
   * `view`, so asking for `view` asks "is this a current participant". */
  allows(participantId: string, capability: CollaborationCapability): boolean {
    return this.participants.get(participantId)?.capabilities.includes(capability) ?? false;
  }

  /** The verified account bound to a participant, or null when the participant
   * is unknown or local. Only the share paths bind an account, so this is how
   * a loopback caller's claimed identity is told apart from a remote one. */
  accountIdFor(participantId: string): string | null {
    return this.participants.get(participantId)?.account?.id ?? null;
  }

  /** Whether anyone currently in the room can manage roles at all. */
  hasMaintainer(): boolean {
    for (const participant of this.participants.values()) {
      if (participant.role === 'maintainer') return true;
    }
    return false;
  }

  private require(
    participantId: string,
    capability: CollaborationCapability,
  ): CollaborationParticipant {
    const participant = this.participants.get(participantId);
    if (!participant) throw new Error(`Unknown participant: ${participantId}`);
    if (!participant.capabilities.includes(capability)) {
      throw new Error(`${participant.displayName} does not have '${capability}' permission.`);
    }
    return participant;
  }

  private authorProjection(participantId: string): CollaborationAuthorProjection {
    const participant = this.participants.get(participantId);
    return participant
      ? {
          participantId,
          account: participant.account ? { ...participant.account } : null,
          displayName: participant.displayName,
          kind: participant.kind,
          color: participant.color,
          location: participant.location ? { ...participant.location } : null,
        }
      : {
          participantId,
          account: null,
          displayName: participantId === 'host' ? 'Host filesystem' : participantId,
          kind: participantId.startsWith('agent:') ? 'agent' : 'human',
          color: collaborationParticipantColor(participantId),
          location: null,
        };
  }

  private recordAudit(
    type: CollaborationAuditEvent['type'],
    participantId: string,
    detail: Readonly<Record<string, unknown>>,
  ): void {
    this.audit.push({
      id: randomUUID(),
      type,
      participantId,
      createdAt: new Date().toISOString(),
      detail,
    });
    if (this.audit.length > MAX_AUDIT) this.audit.splice(0, this.audit.length - MAX_AUDIT);
  }

  /** Local ignored collaboration history is bounded private plaintext. It is
   * deliberately not an account-token store or encrypted chat service. */
  private pruneAgedHistory(): void {
    const cutoff = Date.now() - DURABLE_HISTORY_MAX_AGE_MS;
    const prune = <T extends { createdAt: string }>(values: T[]) => {
      let remove = 0;
      while (remove < values.length && Date.parse(values[remove]!.createdAt) < cutoff) remove += 1;
      if (remove > 0) values.splice(0, remove);
    };
    prune(this.messages);
    prune(this.revisions);
    prune(this.audit);
    prune(this.events);
  }

  private persist(): void {
    if (!this.persistencePath || this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      try {
        this.persistNow();
      } catch (error) {
        // biome-ignore lint/suspicious/noConsole: the dev server's terminal is its own report channel; a failed history write must not take the session down.
        console.error(
          `[vgai-editor] Collaboration history write failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }, 25);
    this.persistTimer.unref?.();
  }

  private persistNow(): void {
    if (!this.persistencePath) return;
    mkdirSync(dirname(this.persistencePath), { recursive: true, mode: 0o700 });
    const temp = `${this.persistencePath}.${process.pid}.${randomUUID()}.tmp`;
    // Single line, not pretty-printed: this is private machine state rewritten
    // on a 25ms debounce for up to 1,000 messages plus 1,000 events, and the
    // indent was buying nothing but bytes to write.
    writeFileSync(
      temp,
      `${JSON.stringify({
        version: 2,
        sequence: this.sequence,
        revision: this.revision,
        assignedRoles: [...this.assignedRoles],
        messages: this.messages,
        revisions: this.revisions,
        audit: this.audit,
        resourceRevisions: [...this.resourceRevisions],
        events: this.events,
        activePlaytest: this.activePlaytest,
      })}\n`,
      { mode: 0o600 },
    );
    renameSync(temp, this.persistencePath);
    try {
      chmodSync(this.persistencePath, 0o600);
    } catch {
      /* a filesystem without modes */
    }
  }

  private emit(channel: CollaborationEventChannel, payload: unknown, persist = true): void {
    this.sequence += 1;
    const event: CollaborationEvent = {
      sequence: this.sequence,
      channel,
      createdAt: new Date().toISOString(),
      payload,
    };
    if (persist) {
      this.events.push(event);
      this.pruneAgedHistory();
      if (this.events.length > MAX_DURABLE_EVENTS) {
        this.events.splice(0, this.events.length - MAX_DURABLE_EVENTS);
      }
      this.persist();
    }
    for (const listener of this.eventListeners) listener(event);
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

/**
 * One room registry for the whole editor process, including Vite's bundled
 * config module graph.
 *
 * In dev, `editor-server.ts` is loaded by the host while the root Vite config
 * is bundled and loaded through Vite's config runner. Both import this file,
 * but Node can therefore evaluate two module instances. A module-local map
 * made `/__editor/collaboration` join one room while `/__ui-source/apply`
 * authorized against another empty room, rejecting every ordinary inspector
 * write as an unknown participant. The room is process state, so its registry
 * must be process-owned too; canonical project roots remain the per-room key.
 */
const collaborationSessionScope = globalThis as typeof globalThis & {
  __VGAI_COLLABORATION_SESSIONS__?: Map<string, CollaborationSession>;
};
// `const`, not `let`: a `let` typed `Map | undefined` cannot carry its
// narrowing into `collaborationSession` below (a closure may observe a later
// assignment), so every use inside the function was a type error.
const sessions: Map<string, CollaborationSession> =
  collaborationSessionScope.__VGAI_COLLABORATION_SESSIONS__ ?? new Map();
collaborationSessionScope.__VGAI_COLLABORATION_SESSIONS__ = sessions;

export function collaborationSession(projectRoot: string): CollaborationSession {
  const root = canonicalProjectRoot(projectRoot);
  let session = sessions.get(root);
  if (!session) {
    session = new CollaborationSession(join(root, '.vgai', 'collaboration.json'));
    sessions.set(root, session);
  }
  return session;
}
