/**
 * THE GAME as an inspection subject — the play surface's empty state (owner
 * ruling, `docs/ARCHITECTURE-CORE.md`, 2026-08-19: "while a runtime is live,
 * nothing-selected on the play surface composes THE GAME as the inspector's
 * subject").
 *
 * It passes the recorded empty-state test rather than weakening it: "with
 * nothing selected the inspector shows nothing" holds except where a surface's
 * empty space IS a real thing, and the play surface's empty space is the
 * running game. Edit mode is unchanged — no runtime, no subject — and that is
 * enforced by LIFETIME, not by a predicate: `play-mode.ts` registers this
 * provider when a session starts and disposes it when the session stops, so
 * outside play there is no provider to match at all.
 *
 * Sections are project contributions scoped to this subject. A game with no
 * sections has nothing to inspect; its identity alone does not open a card.
 */

import { GAME_DOCUMENT_ID } from '@volter/editor-sdk/kit/workspace-document-ids';
import { activeWorkspaceDocumentId } from '../workspace-document-registry';
import type { NullInspectionSubject } from './null-subject';
import { registerNullSubjectProvider } from './null-subject';

/**
 * The Game subject's id — and therefore the SCOPING KEY a project inspector
 * contribution matches on (`context.nullSubjectId === GAME_SUBJECT_ID`). It is
 * a stable literal rather than a per-instance id precisely because it is a
 * contract: a contribution scopes itself to "the game", and which mount that
 * is follows the inspected instance underneath it.
 */
export const GAME_SUBJECT_ID = 'game';

/** The live facts the subject shows. Read at describe time, never captured. */
export interface GameSubjectFacts {
  /** The project's display name (`vgai.project.json`'s `name`). */
  readonly projectName: string | null;
  /**
   * The inspected seat's name, and ONLY when more than one seat is live —
   * with a single mount "which game is this?" is not a question, and a row
   * answering it would be chrome. With several, this is the one thing that
   * distinguishes two mounts of the same project.
   */
  readonly instanceName: string | null;
}

/** The Game subject, shaped. Pure, so the identity contract is testable
 *  without a play session or a DOM. */
export function gameNullInspectionSubject(facts: GameSubjectFacts): NullInspectionSubject {
  const name = facts.projectName?.trim();
  return {
    id: GAME_SUBJECT_ID,
    // The project's own name, because the subject IS this project's game. The
    // fallback is not a display choice — a project with no name is a broken
    // manifest, and the row still has to say what kind of thing it is.
    title: name && name.length > 0 ? name : 'Game',
    // Present ⇒ the composer gives the subject a read-only identity ROW. The
    // identity row is editor-owned per the facet ruling; no contribution
    // stands in for it.
    kindLabel: 'Game',
    ...(facts.instanceName ? { note: { text: facts.instanceName } } : {}),
    sections: [],
  };
}

/**
 * Publish the Game subject for the lifetime of one play session.
 *
 * `read` is a live reader rather than a snapshot: the subject FOLLOWS the
 * inspected instance, so which seat's name it shows is resolved every time the
 * inspector composes, not once at Play.
 *
 * The match is the active-document test and nothing more. The Game document is
 * play-time only, so "a runtime is live" is already this registration's
 * existence, and asking it twice would be two answers to one question. It also
 * keeps the provider off every other surface: an Asset Lab document active
 * means `activeWorkspaceDocumentId()` is that document's, so this never
 * matches, and the asset-lab provider — registered at import time, therefore
 * FIRST in the first-match-wins list — answers instead.
 */
export function registerGameNullSubject(read: () => GameSubjectFacts): () => void {
  return registerNullSubjectProvider({
    match: () => activeWorkspaceDocumentId() === GAME_DOCUMENT_ID,
    describe: () => gameNullInspectionSubject(read()),
  });
}
