/**
 * A `dom` root's PLAY-mode authoring: the SAME {@link ReactRootAuthoringAdapter}
 * Edit mode uses, pointed at an EPHEMERAL destination — the running DOM — instead
 * of the JSX source.
 *
 * Why not the live-only `DomAuthoringAdapter` (the ingest React lane's
 * adapter) here: entity identity. Both this adapter and Edit mode's key nodes by
 * the OID signature `walkOidTree` derives (`o1`, `o1#2`, …); the ingest adapter
 * keys by a STRUCTURAL DOM path (`rdom:div[0]/span[0]`). Swapping adapters at play
 * entry would therefore renumber every dom node, breaking the Edit→Play selection
 * continuity that exists today (
 * asserts the play tree is the OID tree), and would additionally drop the rows
 * only this adapter serves — live component props, design tokens, matched CSS
 * rules, text, empty-container hints. So play keeps the adapter and changes the
 * DESTINATION, which is the only thing play actually needs to change.
 *
 * The destination swap is {@link createEphemeralDomWriteBackend}: a
 * `SourceWriteBackend`-SHAPED writer whose every operation lands on the live DOM
 * and none of which performs any I/O. That shape is the whole seam every write
 * path in `ReactRootAuthoringAdapter` already funnels through (`writeStyleEntry`,
 * `removeStyleProp`, `editText`, `writePropEdit`, `structOp`), so this file adds
 * no second write path and Edit mode is untouched. It deliberately omits
 * `prepare`/`readSource`/`applySource`, which is precisely how
 * `withProjectSourceHistory` (`../history/source-history-backend.ts`) knows to
 * leave it alone: an ephemeral play edit must never enter PROJECT history, and it
 * cannot, because there is no project resource behind it.
 *
 * What that buys, per gesture, matching the three/pixi play regime (edits apply
 * live to the running world, die with the session, never touch source):
 *   - style edits / the visibility toggle → the live inline style, at once;
 *   - `boxEdit` drags and arrow-key nudges → the live preview `boxEdit.apply`
 *     already paints, now COMMITTED live instead of refused at `end`;
 *   - `inspector.remove` of a longhand override → the live inline property;
 *   - text edits → the live element's text.
 * Two gestures genuinely have no live equivalent and say so at the point of use
 * rather than silently doing nothing: a component PROP is owned by the running
 * React element's fiber (there is no writable live seam — the prop lives at its
 * parent's call site), and a STRUCTURAL op would mutate a tree React's reconciler
 * owns. Both refuse with a message naming the play regime, not the misleading
 * "no dev server" text a backend-less session would print.
 *
 * A live write is honestly transient in both directions: React re-rendering the
 * element repaints over it, exactly as a game's own update loop overwrites a
 * three gizmo drag during play. That is the regime, not a defect.
 */

import type { EditorShellStore } from '@volter/editor-threejs/kit/editor-shell-store';
import type { SourceWriteBackend } from '@volter/editor-core/ui-source/source-write-backend';
import {
  type OidElementLike,
  ReactRootAuthoringAdapter,
  walkOidTree,
} from '../react/react-world-authoring-adapter';
import type { AuthoringProvenance } from '@volter/editor-project/adapter';

/** Disclosed up front on the adapter, alongside `capabilities.persist: false` and
 *  the ephemeral `persistence.destination` play-mode's own wrapper installs — the
 *  same `source: 'live'` the adopted three scene reports. */
export const EPHEMERAL_DOM_PROVENANCE: AuthoringProvenance = {
  source: 'live',
  label: 'live',
  detail:
    'Running DOM adopted from the playing game. Edits apply to this session only ' +
    'and are discarded when play stops.',
};

const STRUCTURE_REFUSAL =
  'structure is owned by the running React tree — play edits are live-DOM only and are ' +
  'discarded on stop; stop play to change structure in source';

/**
 * Every live element carrying `oid`. An OID is a SOURCE signature, so one oid can
 * resolve to many rendered elements (a `.map`ped list); a source write would change
 * all of them, so the live write does too.
 */
function elementsFor(root: OidElementLike, oid: string): OidElementLike[] {
  const matches: OidElementLike[] = [];
  for (const node of walkOidTree(root).nodes.values()) {
    if (node.oid === oid) matches.push(node.el);
  }
  return matches;
}

/** A real `CSSStyleDeclaration` or a plain-object fixture, as a writable bag. */
function styleOf(el: OidElementLike): Record<string, unknown> | null {
  return el.style ? (el.style as Record<string, unknown>) : null;
}

/**
 * The play regime's write destination — see this file's header. Returns the
 * `SourceWriteBackend` shape so `ReactRootAuthoringAdapter`'s existing write paths
 * carry it unchanged; NOTHING here reads or writes a file, opens a socket, or
 * reaches `/__ui-source`.
 */
export function createEphemeralDomWriteBackend(root: OidElementLike): SourceWriteBackend {
  return {
    writeStyle: async (oid, prop, value) => {
      const elements = elementsFor(root, oid);
      if (elements.length === 0) {
        return { changed: false, error: `no live element carries oid "${oid}"` };
      }
      for (const element of elements) {
        const style = styleOf(element);
        if (style) style[prop] = value;
      }
      return { changed: true, route: 'live-dom' };
    },
    removeStyle: async (oid, prop) => {
      const elements = elementsFor(root, oid);
      if (elements.length === 0) {
        return { changed: false, error: `no live element carries oid "${oid}"` };
      }
      // `changed: false` when the property was never set live is the same honest
      // no-op the source writer reports for an unauthored longhand — the caller
      // (`removeStyleProp`) pushes nothing and touches nothing.
      let changed = false;
      for (const element of elements) {
        const style = styleOf(element);
        const current = style?.[prop];
        if (style && current !== undefined && current !== null && current !== '') {
          delete style[prop];
          changed = true;
        }
      }
      return { changed, route: 'live-dom' };
    },
    writeText: async (oid, text) => {
      // Leaves only — the same gate `text.get` applies before offering the edit;
      // replacing the text of an element with child elements would delete live
      // children React owns.
      const elements = elementsFor(root, oid).filter((element) => element.children.length === 0);
      if (elements.length === 0) {
        return { changed: false, error: `no live leaf element carries oid "${oid}"` };
      }
      const prevText = elements[0]?.textContent ?? null;
      for (const element of elements) {
        (element as { textContent: string | null }).textContent = text;
      }
      return { changed: true, prevText };
    },
    writeProp: async (_oid, prop) => ({
      changed: false,
      error:
        `prop "${prop}" is owned by the running React element (its value lives at the ` +
        'parent call site, not in the DOM) — play edits are live-DOM only and are discarded ' +
        'on stop; stop play to change it in source',
    }),
    writeStruct: async () => ({ changed: false, error: STRUCTURE_REFUSAL }),
    writeStructMany: async () => ({ changed: false, error: STRUCTURE_REFUSAL }),
  };
}

/**
 * The `dom` play child `play-mode.ts` installs: the ordinary React root adapter
 * over the running root, writing live and disclosing that it does.
 */
export function createReactPlayAuthoringAdapter(
  root: OidElementLike,
  store: EditorShellStore,
): ReactRootAuthoringAdapter {
  return new ReactRootAuthoringAdapter(root, store.shell, {
    writeBackend: createEphemeralDomWriteBackend(root),
    provenance: EPHEMERAL_DOM_PROVENANCE,
  });
}
