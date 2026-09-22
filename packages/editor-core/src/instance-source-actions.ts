/**
 * "enter the component".
 *
 * An instance row's two source destinations, and the sentences the editor says
 * about them. Kept pure and adapter-free so the applicability mapping and the
 * fallback wording are unit-testable without a DOM, a live source tree, or a
 * mounted design session — the wiring that knows about adapters lives in
 * `authoring/instance-source-menu.ts`.
 *
 * TWO DESTINATIONS, NOT ONE. Both come from the OID index, but from DIFFERENT
 * entries of it, and conflating them is the mistake this module exists to
 * prevent:
 *
 * - **callsite** — where the instance is USED (`<Enemy position={…} />` in the
 *   world file). This is `sourceLocation(id)`, because a component boundary's
 *   node id resolves through `userData.authoringInstance`, which the oid
 *   transform propagates INTO the component from its callsite.
 * - **definition** — where the component is WRITTEN (the root `<group>` inside
 *   `Enemy.tsx`). That is the boundary object's OWN `userData.oid`, stamped by
 *   the same transform in the file the element literally appears in.
 *
 * WHY "OPEN" COPIES. There is no code-editing surface in the editor workspace
 * the dev server exposes no launch-editor route (`/__editor/reveal` opens a
 * FILE MANAGER at a path, with no line and no caller), and `launch-editor` is
 * not in the dependency tree — adding a dependency for this was explicitly out
 * of scope. So "open" degrades to copying the `file:line` locator and SAYING
 * so, which is the same honest degradation `@vgai/dom/react-inspector-section.tsx`'s
 * `SourceLocationRow` already ships for the identical problem. Never a silent
 * no-op.
 */

/** The subset of an OID index entry these actions need (structurally satisfied
 *  by `OidEntry` without importing the ui-source module here). */
export interface SourceRef {
  readonly file: string;
  readonly line: number;
}

/** Which of an instance row's two source destinations an action addresses. */
export type InstanceSourceTarget = 'callsite' | 'definition';

/**
 * The minimal adapter surface an instance-source action reads. Structurally
 * satisfied by `R3fSourceAuthoringAdapter` (which owns both methods) and by
 * any adapter that offers only `sourceLocation` — the definition item simply
 * never applies there, which is the honest answer rather than a fabricated one.
 */
export interface InstanceSourceLocator {
  readonly sourceLocation?: ((id: string) => SourceRef | undefined) | undefined;
  readonly definitionLocation?: ((id: string) => SourceRef | undefined) | undefined;
}

/** Menu capitalization follows the panel's existing Title Case idiom
 *  (`Rename`, `Duplicate`, `Group Selection`, `Select Parent`). */
export const INSTANCE_SOURCE_LABELS: Readonly<Record<InstanceSourceTarget, string>> = {
  callsite: 'Go to Callsite',
  definition: 'Open Component Source',
};

/** Probe order — the menu lists the callsite first (it is the row's own line of
 *  source; the definition is one hop further away). */
const TARGETS: readonly InstanceSourceTarget[] = ['callsite', 'definition'];

/** `src/world.tsx:42` — the exact text an action copies, and the exact text the
 *  hint then quotes back. One formatter so the two can never disagree. */
export function formatSourceRef(ref: SourceRef): string {
  return `${ref.file}:${ref.line}`;
}

/**
 * Resolve one destination, or `null`. `null` covers every honest unavailability
 * in one value: the adapter has no such accessor, the id is unknown to it, or
 * the OID index has not landed / no longer contains that entry.
 */
export function locateInstanceSource(
  locator: InstanceSourceLocator | null | undefined,
  id: string,
  target: InstanceSourceTarget,
): SourceRef | null {
  if (!locator) return null;
  const resolve = target === 'callsite' ? locator.sourceLocation : locator.definitionLocation;
  return resolve?.call(locator, id) ?? null;
}

/**
 * H3 applicability: which items a row earns. A row must BOTH be a component
 * instance (`role: 'component'` — the same predicate H1's row identity uses)
 * and have the destination actually resolve. A row with neither destination
 * gets neither item; nothing is ever rendered disabled here, because the
 * registry's items have no disabled state (`getHierarchyMenuItems` returns
 * label/action/color only) and the panel's own idiom is to omit an item whose
 * SUBJECT is absent, reserving disabled-with-reason for a present subject the
 * adapter refuses.
 */
export function instanceSourceTargets(
  node: { readonly role?: string | undefined } | null | undefined,
  locator: InstanceSourceLocator | null | undefined,
  id: string,
): InstanceSourceTarget[] {
  if (node?.role !== 'component') return [];
  return TARGETS.filter((target) => locateInstanceSource(locator, id, target) !== null);
}

// ------------------------------------------------------------------ sentences

const SUBJECT: Readonly<Record<InstanceSourceTarget, string>> = {
  callsite: 'callsite',
  definition: 'component source',
};

/** What was copied, verbatim, plus why that is all the editor can do. */
export function copiedSourceHint(target: InstanceSourceTarget, ref: SourceRef): string {
  return (
    `Copied the ${SUBJECT[target]} ${formatSourceRef(ref)} to the clipboard — ` +
    'the editor has no code surface to open it in.'
  );
}

/** The destination resolved when the menu was built and is gone by click time
 *  (a source edit or an HMR remount between the two). */
export function missingSourceHint(target: InstanceSourceTarget): string {
  return `This row's ${SUBJECT[target]} is not in the source index — there is nothing to open.`;
}

/** The clipboard refused or is unavailable (insecure context, denied
 *  permission). The locator still travels in the sentence, so the action is
 *  never a dead end. */
export function clipboardRefusedHint(target: InstanceSourceTarget, ref: SourceRef): string {
  return `Could not write to the clipboard. The ${SUBJECT[target]} is ${formatSourceRef(ref)}.`;
}

// ------------------------------------------------------------------ the action

/** Injected in tests; production uses the real clipboard. */
export type ClipboardWriter = (text: string) => Promise<void>;

const systemClipboard: ClipboardWriter = async (text) => {
  const clipboard = navigator.clipboard;
  if (!clipboard) throw new Error('no clipboard');
  await clipboard.writeText(text);
};

/**
 * Run one instance-source action end to end and return the sentence it should
 * say — ALWAYS a sentence, never silence, on every path (copied / index no
 * longer has it / clipboard refused). The caller shows it; returning it instead
 * of raising it keeps this function testable without the hint module's timers.
 */
export async function runInstanceSourceAction(
  locator: InstanceSourceLocator | null | undefined,
  id: string,
  target: InstanceSourceTarget,
  writeText: ClipboardWriter = systemClipboard,
): Promise<string> {
  const ref = locateInstanceSource(locator, id, target);
  if (!ref) return missingSourceHint(target);
  try {
    await writeText(formatSourceRef(ref));
  } catch {
    return clipboardRefusedHint(target, ref);
  }
  return copiedSourceHint(target, ref);
}
