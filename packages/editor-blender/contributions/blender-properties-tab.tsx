/**
 * ONE PROPERTIES TAB IS ONE `selection.inspector` CONTRIBUTION — the factory
 * every `properties-*.inspector.tsx` in this package is built from (WORK.md
 * §Blender in the tab is Blender, "Inspection parity", I1, item 3).
 *
 * WHY A TAB IS A SECTION, and not a rail of our own: under the `properties`
 * presentation the inspector's sections ARE the vertical icon rail, 1:1
 * (`packages/editor/src/components/InspectionProjection.tsx`,
 * `PropertiesColumn`). So the way to make Blender's tab rail appear is to
 * contribute Blender's tabs as sections — which is also exactly the shape I2
 * needs, because each of these modules then grows a CURATED body over the same
 * door while the generic view stays beneath it.
 *
 * WHICH TABS STAND is `buttons_context.cc`'s answer, computed in the engine
 * (`session.py::rna_context`) and read here. Two kinds of tab:
 *
 *  - `standing: 'any' | 'object'` — a tab `buttons_context.cc` builds a path
 *    to UNCONDITIONALLY given a scene (`buttons_context_path_scene`,
 *    `_view_layer`, `_world`) or given an object at all
 *    (`buttons_context_path_object`, of which only the OBJECT tab is standing
 *    here — Physics and Constraints share that path but are context-gated,
 *    because Blender's Properties editor follows the ACTIVE OBJECT rather
 *    than the row that was clicked, and only the door knows there is one).
 *    These match from the SELECTION alone, synchronously.
 *  - everything else — Modifiers (an object type set), Particles (a mesh),
 *    Object Data (the object has data), Bone (an active bone), Material,
 *    Collection, Texture — which only the engine can answer, so they match
 *    against the context the door last returned.
 *
 * THE STANDING TABS EXIST SO THE RAIL IS NEVER EMPTY: `match()` is
 * synchronous and the first composition has read nothing, so if every tab
 * waited on the door there would be no rail at all. The READ itself is driven
 * from `match` (see the note there), and when its answer lands it calls
 * `documents.contextChanged`, which re-derives the whole inspection and brings
 * the rest of the rail in.
 */

import type {
  ToolContributionNode,
  ToolInspectorContributionProps,
} from '@volter/editor-sdk/contributions';
import {
  blenderPropertiesState,
  resolveBlenderSubject,
  showBlenderSubject,
} from './blender-properties-model';
import { type BlenderCuratedPanel, BlenderPropertiesSection } from './blender-properties-view';

export interface BlenderPropertiesTab {
  /** `BCONTEXT_*` in lower case, as the door spells it. */
  readonly id: string;
  /** Whether this tab needs the engine's answer to exist, or stands on the
   *  selection alone — see the header. */
  readonly standing?: 'any' | 'object';
  /** BLENDER'S OWN PANELS for this tab, in Blender's order, transcribed from
   *  the matching `scripts/startup/bl_ui/properties_*.py`
   *  ({@link BlenderCuratedPanel}). The generic RNA view stays beneath them
   *  under "All properties"; a tab that declares none is the generic view
   *  alone, which is what I1 shipped. */
  readonly curated?: readonly BlenderCuratedPanel[];
}

export function blenderPropertiesTabMatch(tab: BlenderPropertiesTab) {
  return (node: ToolContributionNode | null, adapter: unknown): boolean => {
    const subject = resolveBlenderSubject(node, adapter);
    if (subject === null) return false;
    // THE READ IS DRIVEN FROM `match`, NOT FROM A BODY, and that is a
    // correction the live walk forced: under the `properties` presentation
    // the host mounts ONLY THE ACTIVE TAB's body, so a read driven from a
    // body never happened at all unless the person had already clicked a
    // Blender tab — the rail showed the standing tabs and nothing else, for
    // good (measured 2026-09-19). A matcher runs on every composition,
    // active tab or not, so this is the one place that always sees the
    // subject. It is idempotent by construction: `showBlenderSubject`
    // returns immediately unless the subject moved.
    showBlenderSubject(subject);
    if (tab.standing === 'any') return true;
    if (tab.standing === 'object') return subject.kind === 'object';
    const state = blenderPropertiesState();
    // The context must be the one read for THIS subject: a stale answer from
    // the previously selected object would show its tabs over the new one.
    // BOTH halves of the subject, because a COLLECTION row and the Scene
    // Collection row both read with no object and would otherwise pass each
    // other's context.
    const object = subject.kind === 'object' ? subject.name : null;
    const collection = subject.kind === 'collection' ? subject.path : null;
    if (state.object !== object || state.collection !== collection) return false;
    return state.context?.tabs.some((entry) => entry.id === tab.id) ?? false;
  };
}

export function blenderPropertiesTabSection(tab: BlenderPropertiesTab) {
  return function BlenderPropertiesTabSection({ node, adapter }: ToolInspectorContributionProps) {
    const subject = resolveBlenderSubject(node, adapter);
    if (subject === null) return null;
    return (
      <BlenderPropertiesSection tabId={tab.id} subject={subject} curated={tab.curated ?? []} />
    );
  };
}
