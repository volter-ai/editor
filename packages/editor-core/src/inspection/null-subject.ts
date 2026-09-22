/**
 * The NO-SELECTION subject seam — `describeSubject(null)`, per adapter
 * (design: `docs/ARCHITECTURE-CORE.md` §Editor chrome, "The Inspection
 * Model"; build ledger: `docs/WORK.md` §Inspection Model program, W3).
 *
 * An empty inspector is not a shared blank: it is a SUBJECT, and whose
 * subject it is depends entirely on which surface you are looking at. The
 * defect this exists for (measured live, 2026-08-05): with a react/DOM
 * document active and nothing selected in it, the inspector rendered the
 * THREE scene's Background/Fog/Bake-NavMesh controls — another surface's
 * subject leaking in, because "nothing selected" was ONE hardcoded branch in
 * `components/Inspector.tsx` instead of an answer the active adapter gave.
 *
 * So the answer moves behind a provider keyed on the ADAPTER. A provider
 * matches the adapters whose surface it speaks for and returns that surface's
 * own empty-state subject; `composeInspectionSubject` turns it into the same
 * {@link InspectionSubject} a real selection produces, and both projections
 * stay dumb. No provider matching means the surface honestly has no
 * empty-state subject — the inspector shows nothing at all, which is the
 * correct answer, not a gap to fill with someone else's content.
 *
 * Why a provider list and not a method on `AuthoringAdapter`: an empty-state
 * subject carries React section bodies, and the engine's adapter seam stays
 * React-free (D6) — the same constraint that put
 * `inspector-section-registry.ts` in the editor. Why not fold it INTO that
 * registry: a registration there contributes one SECTION to a subject, while
 * this names the subject itself (its title and its quiet hint). Registrations
 * are import-time side effects (`authoring/null-inspection-subjects.tsx`,
 * imported by `main.tsx`), so there is no store here — only a list and a
 * first-match lookup.
 */

import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import type { EditorShellStore } from '../editor-shell-store';
import type {
  InspectionAction,
  InspectionNote,
  InspectionSection,
  InspectionSurfaceKind,
} from './model';

export interface NullSubjectContext {
  /** The adapter whose surface is showing — the basis for the match. */
  readonly adapter: AuthoringAdapter;
  /** That adapter's surface, resolved once by the shell
   *  (`inspection/active-surface.ts`) so every provider matches against the
   *  same answer instead of re-deriving one. Absent in a bounded host, where
   *  no provider matches and the honest answer is no empty-state subject. */
  readonly surface?: InspectionSurfaceKind | undefined;
  readonly store: EditorShellStore;
  /** Notify the shell that the adapter's (or scene's) truth changed. */
  readonly onEdit: () => void;
}

/** One surface's answer to "what am I inspecting when nothing is selected?" */
export interface NullInspectionSubject {
  /** Stable subject id (`InspectionSubject.id`). */
  readonly id: string;
  /** What this surface calls its empty state ("Scene", the UI root's name). */
  readonly title: string;
  /** The quiet line under the title, for a subject with nothing to edit. */
  readonly hint?: string;
  /** What to CALL this thing's type, under the name — an Asset Lab document
   *  says what KIND of document it is. Present ⇒ the composer gives the
   *  subject a read-only identity ROW instead of a bare headline (a document
   *  is a thing with a name, a type and a provenance; the three scene's empty
   *  state is not). */
  readonly kindLabel?: string;
  /** The provenance line under the identity row (an asset's source path). */
  readonly note?: InspectionNote;
  /** The surface's own no-selection sections, in any order — the composer
   *  sorts. Empty is a legitimate answer (title + hint, nothing to edit). */
  readonly sections: readonly InspectionSection[];
  /** Verbs this subject offers, the same shape a selected node's carry: the
   *  panel renders them and `editor.runAction(id)` runs them. An asset
   *  selection's come from the `asset.inspector` contributions that matched
   *  it, which is what gives a project's own Inspector section a door in the
   *  control API instead of only a mouse. */
  readonly quickActions?: readonly InspectionAction[];
}

export interface NullSubjectProvider {
  /** Which surfaces this provider speaks for. A provider that matches a
   *  surface it does not own is exactly the leak this seam removes. */
  readonly match: (ctx: NullSubjectContext) => boolean;
  readonly describe: (ctx: NullSubjectContext) => NullInspectionSubject | null;
}

const providers: NullSubjectProvider[] = [];

/** Register a provider. FIRST match wins, so a narrower provider must be
 *  registered before a broader one. Returns an unregister function. */
export function registerNullSubjectProvider(provider: NullSubjectProvider): () => void {
  providers.push(provider);
  return () => {
    const index = providers.indexOf(provider);
    if (index >= 0) providers.splice(index, 1);
  };
}

/** The active adapter's no-selection subject, or `null` when this surface
 *  has none. */
export function describeNullInspectionSubject(
  ctx: NullSubjectContext,
): NullInspectionSubject | null {
  for (const provider of providers) {
    if (provider.match(ctx)) return provider.describe(ctx);
  }
  return null;
}

/** Test-only reset (mirrors `__resetInspectorSectionRegistryForTest`). */
export function __resetNullSubjectProvidersForTest(): void {
  providers.length = 0;
}
