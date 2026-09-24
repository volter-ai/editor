/**
 * "Extract Component…" — P1 structural extraction.
 *
 * The applicability rule and every sentence this action can say, kept pure and
 * adapter-free for the same reason `instance-fork-actions.ts` (H7) is — the
 * wiring that knows about adapters lives in
 * `authoring/instance-extract-menu.ts`, and the SOURCE REWRITE lives
 * server-side in `ui-source/plan-extract-component.ts`.
 *
 * FORK AND EXTRACT ARE COMPLEMENTS, split by the row's role. A COMPONENT
 * instance row already has a definition module — customizing it is H7's fork
 * (copy the module, retarget the tag). A NATIVE subtree row (`<group>`,
 * `<mesh>` — assembled in place, no module of its own) is what THIS action
 * serves: the subtree becomes a component under `src/prefabs/` with a portable
 * CSF story, and the row becomes an ordinary instance. The two applicability
 * predicates are disjoint on the same `role` field, so a hierarchy row offers
 * at most one of the pair.
 *
 * The trailing ellipsis follows the same platform convention fork records: an
 * action that writes NEW FILES — this one writes two.
 */

import type { InstanceSourceLocator } from './instance-source-actions';

export const EXTRACT_COMPONENT_LABEL = 'Extract Component…';

/**
 * The adapter surface this action reads. `canExtractComponent` is the
 * adapter's own honest answer to "could I write this?" (a write backend with
 * the extract seam exists and this id has a source element);
 * `extractComponent` performs it and returns the sentence to show.
 */
export interface InstanceExtractSource extends InstanceSourceLocator {
  readonly canExtractComponent?: ((id: string) => boolean) | undefined;
  readonly extractComponent?: ((id: string, name?: string) => Promise<string>) | undefined;
}

/**
 * Applicability — all about whether the edit is REACHABLE, never about whether
 * it would succeed (only the plan can say, and its refusals are click-time
 * hints):
 *
 * 1. the row is a NATIVE source element, not a component instance (those fork)
 *    and not the document row;
 * 2. the row resolves a source location — there is a subtree to extract;
 * 3. the adapter can actually write through the extract seam.
 *
 * An inapplicable row gets NO item rather than a disabled one — the registry
 * idiom fork records.
 */
export function canExtractNode(
  node: { readonly role?: string | undefined } | null | undefined,
  source: InstanceExtractSource | null | undefined,
  id: string,
): boolean {
  // ALLOW-list, not a block-list: only the two native-row roles are subtrees
  // assembled in place. Every other role either has a module already
  // ('component' — fork's subject), is not a source element at all
  // ('folder'/'root'/'document'/'story'), or is still mounting ('boundary').
  if (node?.role !== 'entity' && node?.role !== 'element') return false;
  if (!source || typeof source.extractComponent !== 'function') return false;
  if (typeof source.sourceLocation !== 'function' || !source.sourceLocation(id)) return false;
  return source.canExtractComponent?.(id) !== false;
}

// ------------------------------------------------------------------ sentences

/** The success hint NAMES BOTH NEW FILES — the author has to know what was
 *  created, because undo (which owns the callsite edit) will not remove them. */
export function extractedHint(
  tag: string,
  newName: string,
  componentPath: string,
  storyPath: string,
): string {
  return (
    `Extracted <${tag}> → <${newName}> (${componentPath}, story ${storyPath}). ` +
    'Undo restores the callsite; the new files stay.'
  );
}

/** The row lost its source element between menu and click. */
export function extractUnavailableHint(tag: string): string {
  return `<${tag}> is no longer in the source index — there is nothing to extract.`;
}

/** No dev-server write backend in this session (a hosted or read-only tier). */
export function extractNoBackendHint(tag: string): string {
  return `This session cannot write project source, so <${tag}> cannot be extracted.`;
}

/**
 * The new files were written and the CALLSITE edit then failed. Reported in
 * full: the module and story are inert (nothing imports them), so the failure
 * mode is clutter, not breakage — and the author is told exactly that.
 */
export function extractPartialHint(
  tag: string,
  newName: string,
  componentPath: string,
  detail: string,
): string {
  return (
    `Wrote ${componentPath} (and its story) for <${newName}>, but the <${tag}> callsite was ` +
    `not replaced (${detail}). Nothing imports the new files yet, so they are inert — ` +
    'delete them or try again.'
  );
}

/** Any other refusal: the plan's own named reason, or a transport failure. */
export function extractRefusedHint(reason: string): string {
  return `Cannot extract: ${reason}`;
}

/** Did a hint sentence report a LANDED extraction? Owned by this module —
 *  the one place the sentences are minted — so the command door's ok/error
 *  split cannot drift from the wording it matches. */
export function isExtractedHint(hint: string): boolean {
  return hint.startsWith('Extracted ');
}
