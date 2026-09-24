/**
 * WHO THIS EDITOR SESSION IS, AND WHAT REVISION IT LAST SAW — the stamp every
 * host source write carries.
 *
 * Three facts, all of them the page's own:
 *  - the PARTICIPANT ID this tab writes under, seeded by the server's
 *    bootstrap global and otherwise persisted per browser. `editor-presence.ts`
 *    re-exports it as `EDITOR_PARTICIPANT_ID`, which is the name the rest of
 *    the host knows it by.
 *  - the session's GUEST flag: this page reached the editor through a shared
 *    tunnel, so three host surfaces disable what a guest may not do
 *    (`account.ts`, `components/ProjectHeader.tsx`,
 *    `components/WorktreeSwitcher.tsx`).
 *  - the last source REVISION this page observed, which every write sends as
 *    `expectedRevision` so the server can refuse a stale one. That is
 *    optimistic concurrency on the storage seam, not a feature: the readers
 *    are `storage/http-storage.ts`, `ui-source/source-write-backend.ts`,
 *    `history/project-root-history-backends.ts`,
 *    `authoring/edit-mode-authoring.ts` and `source-conflict.ts`.
 *
 * IT WAS CALLED `collaboration-attribution.ts` UNTIL THE FINAL AUDIT, and the
 * name was the only thing that ever made it an opinion — two audits filed it
 * under 'collaboration and presence' and named a door for it that the host
 * does not need, because nothing here is a lane's: a page identifies itself
 * and stamps its writes whether or not anyone else is connected. TWO sibling
 * packages read it (`@vgai/collaboration` takes the guest flag,
 * `@vgai/game` takes the write stamp), which by the rule `@vgai/dom` was
 * landed on means it lives in neither. `WORK.md` §THE FINAL AUDIT.
 */
const participantKey = 'vgai.collaboration.participant.v1';
const remoteShareKey = 'vgai.collaboration.remote-share.v1';
const bootstrap = (
  globalThis as typeof globalThis & {
    __VGAI_EDITOR_PRESENCE_BOOTSTRAP__?: {
      participantId?: string;
      displayName?: string;
    };
  }
).__VGAI_EDITOR_PRESENCE_BOOTSTRAP__;

function storedParticipantId(): string {
  if (bootstrap?.participantId) return bootstrap.participantId;
  const generated = globalThis.crypto?.randomUUID?.() ?? `participant-${Date.now()}`;
  try {
    const stored = globalThis.localStorage?.getItem(participantKey);
    if (stored) return stored;
    globalThis.localStorage?.setItem(participantKey, generated);
  } catch {
    // Storage can be blocked; page-lifetime identity is still usable.
  }
  return generated;
}

export const COLLABORATION_PARTICIPANT_ID = storedParticipantId();
export const COLLABORATION_REMOTE_SHARE = (() => {
  try {
    return globalThis.localStorage?.getItem(remoteShareKey) === '1';
  } catch {
    return false;
  }
})();
export const COLLABORATION_PARTICIPANT_NAME = bootstrap?.displayName || 'Local editor';

let revision = 0;

export function setCollaborationRevision(value: number): void {
  if (Number.isInteger(value) && value >= revision) revision = value;
}

export function sourceMutationAttribution(): {
  participantId: string;
  expectedRevision: number;
} {
  return { participantId: COLLABORATION_PARTICIPANT_ID, expectedRevision: revision };
}
