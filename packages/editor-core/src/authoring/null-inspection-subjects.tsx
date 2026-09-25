/**
 * The shipped NO-SELECTION subjects (`inspection/null-subject.ts` is the
 * seam; `main.tsx` imports this module for its import-time registration).
 *
 * With nothing selected, the inspector shows NOTHING (owner, 2026-08-07) —
 * no box, no hint, no scene-global settings. A surface earns an empty-state
 * subject only when its empty space IS a real thing: the one shipped case is
 * an open Asset Lab document, where clicking empty space means "the
 * document", and the box shows the document's own identity and sections.
 * Every other surface's honest answer is `null`, which unmounts the box
 * entirely (`inspection/null-subject.ts`'s no-provider contract).
 *
 * Scene-GLOBAL affordances do not ride the empty state: the navmesh
 * bake/clear verbs live in the Debug menu (`components/ApplicationMenus.tsx`),
 * dispatched through the same `navmesh-actions.ts` events as always.
 */

import { getActiveAssetEditorContext } from '@volter/editor-sdk/kit/asset-editor-context';
import { documentInspectionSubject } from '@volter/editor-sdk/kit/inspection/document-subject';
import { registerNullSubjectProvider } from '@volter/editor-sdk/kit/inspection/null-subject';
import { activeWorkspaceDocumentId } from '@volter/editor-sdk/kit/workspace-document-registry';

/**
 * An open asset document's empty state: the DOCUMENT itself. Pick a part
 * inside it and the ordinary selection path composes that part's subject
 * through the document's own adapter; pick nothing and this is what the
 * document says it is — its name, its kind, its provenance, and whatever
 * sections it declared (`components/AssetEditorShell.tsx` publishes the
 * description to `inspection/document-subject.ts`).
 */
registerNullSubjectProvider({
  match: (ctx) => ctx.surface === 'asset-lab',
  describe: () => {
    const context = getActiveAssetEditorContext();
    if (!context) return null;
    const published = documentInspectionSubject();
    // Only THIS document's subject. A stale publication from a document that
    // has since been closed is not what the human is looking at — the honest
    // fallback is the document's identity alone.
    return published?.documentId === context.documentId
      ? published.subject
      : {
          id: context.documentId,
          title: context.title,
          kindLabel: context.type,
          sections: [],
        };
  },
});

/**
 * ANY active document's own subject — the general case the Asset Lab provider
 * above is the specialized one of.
 *
 * A document that stands behind no authoring adapter still has things to say
 * about what you picked inside it, and `publishDocumentInspectionSubject` is
 * where it says them. Until this existed the only READER was keyed on the
 * `asset-lab` surface, so the 2D components board published a picked frame's
 * identity into a holder nothing ever consulted and a human clicked frame
 * after frame against an empty panel (runhuman pass 92). The match is
 * document identity and nothing more, the same test
 * `inspection/game-subject.ts` makes.
 *
 * Registered AFTER the Asset Lab provider so first-match-wins keeps that
 * surface's fallback-to-document-identity behavior, which this deliberately
 * does not have: a document that published nothing is describing no subject,
 * and an empty inspector is the honest answer.
 */
registerNullSubjectProvider({
  match: () => {
    const published = documentInspectionSubject();
    return published !== null && published.documentId === activeWorkspaceDocumentId();
  },
  describe: () => documentInspectionSubject()?.subject ?? null,
});
