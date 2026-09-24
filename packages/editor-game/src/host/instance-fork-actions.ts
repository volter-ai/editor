/**
 * "Fork Component…".
 *
 * The applicability rule and every sentence this action can say, kept pure and
 * adapter-free for the same reason `instance-source-actions.ts` (H3) is — the
 * wiring that knows about adapters lives in
 * `authoring/instance-fork-menu.ts`, and the SOURCE REWRITE lives server-side in
 * `ui-source/plan-fork-component.ts`.
 *
 * THE LABEL IS "Fork Component…", NOT "fork for this instance". H7's own title
 * says "for this instance", and it is worth being precise about what the edit
 * actually reaches: it retargets ONE CALLSITE. When that callsite sits inside a
 * component that is itself rendered many times, every one of those renders now
 * renders the fork. One callsite is the unit of the edit; one callsite is not
 * always one object on screen.
 *
 * The trailing ellipsis follows the platform convention the panel already
 * implies for an action with consequences beyond the row — a fork writes a NEW
 * FILE, which no other hierarchy item does.
 */

import type { InstanceSourceLocator } from '@volter/editor-sdk/kit/instance-source-actions';

export const FORK_COMPONENT_LABEL = 'Fork Component…';

/**
 * The adapter surface this action reads. `canForkComponent` is the adapter's
 * own honest answer to "could I write this?" (a write backend exists, this id
 * has both a callsite and a definition); `forkComponent` performs it and
 * returns the sentence to show.
 */
export interface InstanceForkSource extends InstanceSourceLocator {
  readonly canForkComponent?: ((id: string) => boolean) | undefined;
  readonly forkComponent?: ((id: string) => Promise<string>) | undefined;
}

/**
 * H7 applicability. Three conditions, all of them about whether the edit is
 * REACHABLE — never about whether it would succeed, which only the plan can
 * say:
 *
 * 1. the row is a component instance (`role: 'component'`, H1's own predicate);
 * 2. BOTH source destinations resolve — the callsite is the tag this action
 *    retargets and the definition is the module it copies, so a row missing
 *    either has nothing to fork;
 * 3. the adapter can actually write (a dev-server write backend is present).
 *
 * Like H3, an inapplicable row gets NO item rather than a disabled one: the
 * registry has no disabled state, and the panel's idiom is to omit an item
 * whose subject is absent. Everything the PLAN rejects is a click-time
 * transient hint carrying the plan's own named reason.
 */
export function canForkInstance(
  node: { readonly role?: string | undefined } | null | undefined,
  source: InstanceForkSource | null | undefined,
  id: string,
): boolean {
  if (node?.role !== 'component') return false;
  if (!source || typeof source.forkComponent !== 'function') return false;
  if (typeof source.sourceLocation !== 'function' || !source.sourceLocation(id)) return false;
  if (typeof source.definitionLocation !== 'function' || !source.definitionLocation(id)) {
    return false;
  }
  return source.canForkComponent?.(id) !== false;
}

// ------------------------------------------------------------------ sentences

/**
 * The success hint. It NAMES THE NEW FILE, which is the whole reason this is a
 * hint and not silence: the author has to know what was created, because undo
 * (which owns the callsite edit) will not remove it.
 */
export function forkedHint(tag: string, newName: string, newPath: string): string {
  return (
    `Forked <${tag}> → <${newName}> (${newPath}). ` +
    'Undo restores the callsite; the new file stays.'
  );
}

/** The row lost its callsite or definition between menu and click. */
export function forkUnavailableHint(tag: string): string {
  return `<${tag}> is no longer in the source index — there is nothing to fork.`;
}

/** No dev-server write backend in this session (a hosted or read-only tier). */
export function forkNoBackendHint(tag: string): string {
  return `This session cannot write project source, so <${tag}> cannot be forked.`;
}

/**
 * The new file was written and the CALLSITE edit then failed. Reported in full
 * rather than swallowed: the copy is inert (nothing imports it), so the failure
 * mode is clutter, not breakage — and the author is told exactly that, plus the
 * path, so they can delete it or retry.
 */
export function forkPartialHint(
  tag: string,
  newName: string,
  newPath: string,
  detail: string,
): string {
  return (
    `Wrote ${newPath} for <${newName}>, but the <${tag}> callsite was not retargeted (${detail}). ` +
    'Nothing imports the new file yet, so it is inert — delete it or try again.'
  );
}

/** Any other refusal: the plan's own named reason, or a transport failure. */
export function forkRefusedHint(reason: string): string {
  return `Cannot fork: ${reason}`;
}

/** Did a hint sentence report a LANDED fork? Owned by this module — the one
 *  place the sentences are minted — so the command door's ok/error split
 *  cannot drift from the wording it matches. The extract twin is
 *  `isExtractedHint`. */
export function isForkedHint(hint: string): boolean {
  return hint.startsWith('Forked ');
}
