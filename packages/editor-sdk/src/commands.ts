/**
 * THE COMMAND POINT — a package contributes session commands (WORKBENCH.md
 * §Contribution points, `command`): the verbs `vgai eval` / `vgai <verb>` and
 * every agent ride through the editor's ONE relay (`POST /__editor/command`),
 * answered in the page by the editor's own switch for the host's vocabulary
 * and by a contributed handler for a package's.
 *
 * A contribution module declares the point and exports one table:
 *
 *   `instances.command.ts`
 *     export const point = 'workspace.command';
 *     export const commands: CommandContribution['commands'] = {
 *       'list-instances': { derivedRefresh: 'if-content-changed', handle: () => … },
 *     };
 *
 * Each row carries what the host's own table carries per verb — the budget
 * the relay waits for the WORK (`timeoutMs`, 5 s when omitted) and whether a
 * completed command owes a tree-scale status derivation (`derivedRefresh`) —
 * because the server sizes its wait from the same row: the page reports the
 * rows it registered, and a contributed verb never falls to the generic
 * budget by accident (the failure `command-table.ts` records).
 *
 * A type already in the host's table, or claimed by another contribution,
 * refuses at registration by name.
 */

export interface EditorCommandMessage {
  readonly type: string;
  readonly _requestId?: string;
  readonly [key: string]: unknown;
}

/** The relay's answer shape (`command-table.ts`'s `CommandResult`): `ok`, an
 *  `error` sentence on failure, and `data` for verbs that answer with a
 *  payload — structured markers (`{ code: … }`) the SDK matches on, never
 *  message prose. */
export interface EditorCommandResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly data?: Record<string, unknown>;
}

/** Whether a completed command owes a status derivation: none, only when
 *  the tree's content changed, or always. */
export type CommandDerivedRefresh = 'none' | 'if-content-changed' | 'always';

export interface CommandSpec {
  /** How long the relay waits for this verb's WORK; the host default when omitted. */
  readonly timeoutMs?: number;
  /** Default `'always'`, the host's own default for an unknown verb. */
  readonly derivedRefresh?: CommandDerivedRefresh;
  readonly handle: (
    command: EditorCommandMessage,
  ) => EditorCommandResult | Promise<EditorCommandResult>;
}

export interface CommandContribution {
  readonly commands: Readonly<Record<string, CommandSpec>>;
}

/** One registered row as the page reports it to the server. */
export interface ContributedCommandRow {
  readonly type: string;
  readonly timeoutMs: number;
  readonly derivedRefresh: CommandDerivedRefresh;
}
