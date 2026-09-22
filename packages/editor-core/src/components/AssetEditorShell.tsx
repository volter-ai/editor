/**
 * The asset document shell — the frame an open asset lives in, and NOTHING
 * about how it is inspected.
 *
 * "What is an asset in three.js but a hierarchical group of other three.js
 * assets" (owner, 2026-08-07). An asset document is the three paradigm scoped
 * to a SUBTREE — Unity's prefab-isolation mode: same viewport, same hierarchy,
 * same inspector box, only the root changed. So the ordinary inspector rides
 * over an asset document exactly as it rides over the scene: the same box in
 * the same corner, draggable, minimizable, expandable to the same column, with
 * the same per-surface preference (`inspection/display.ts` resolves it for the
 * `asset-lab` surface like any other). This shell renders none of it.
 *
 * What it owns is the two things that make the document a SUBJECT PRODUCER:
 *
 *  - it activates the asset-editor context, which is what makes the active
 *    inspection surface `asset-lab` (`inspection/active-surface.ts`);
 *  - it registers the document's SELECTION CONTEXT and publishes the
 *    document's own subject description (`inspection/document-subject.ts`).
 *
 * The selection context is the load-bearing half, and every asset document
 * registers one even with nothing to select. Registering it is how a document
 * says "I am the subject": without it the Inspector falls back to the shared
 * entity selection, and an image viewer would show whatever was picked in the
 * scene before it was opened. A document with live authoring of its own (the
 * Object3D editor) passes `selection` and its picked part flows through; a
 * document without passes nothing and gets `{adapter: null, nodeId: null}`,
 * which resolves to its own identity floor.
 *
 * The identity row is where that floor lives: even a document with no sections
 * at all says what it is, what kind it is, and where it came from — and no
 * section of its own stands in for that row, because identity is a property of
 * the SUBJECT (`inspection/model.ts`).
 */

import { type ReactNode, useEffect, useRef } from 'react';
import { activateAssetEditorContext } from '../asset-editor-context';
import { publishDocumentInspectionSubject } from '../inspection/document-subject';
import type { InspectionSection } from '../inspection/model';
import type { NullInspectionSubject } from '../inspection/null-subject';
import {
  registerWorkspaceDocumentSelection,
  type WorkspaceDocumentSelection,
} from '../workspace-document-registry';

/** What a document with no authoring of its own selects: itself. */
const DOCUMENT_IS_THE_SUBJECT: WorkspaceDocumentSelection = { adapter: null, nodeId: null };

/**
 * The part of a document subject whose change can alter the Inspector's
 * structure. Function identities deliberately stay out of this key: render
 * functions and field IO are read through `descriptionRef` below, so a parent
 * render updates them without feeding the Inspector's own notification back
 * into another publication.
 */
function subjectPublicationKey(subject: NullInspectionSubject): string {
  return JSON.stringify({
    id: subject.id,
    title: subject.title,
    hint: subject.hint,
    kindLabel: subject.kindLabel,
    note: subject.note,
    sections: subject.sections.map((section) => ({
      id: section.id,
      title: section.title,
      order: section.order,
      description: section.description,
      defaultOpen: section.defaultOpen,
      testId: section.testId,
      keepMounted: section.keepMounted,
      railGroup: section.railGroup,
      bodyKind: section.body.kind,
    })),
    quickActions: subject.quickActions?.map((action) => ({
      id: action.id,
      title: action.title,
      label: action.label,
      placement: action.placement,
      pressed: action.pressed,
      disabled: action.disabled,
    })),
  });
}

/**
 * The three optional props below are spelled `?: T | undefined` rather than
 * `?: T`, because `AssetEditorShell` PASSES ITS OWN THROUGH: under
 * `exactOptionalPropertyTypes` an explicit `undefined` is not the same as an
 * absent key, so `sections={sections}` on a shell whose own `sections` is
 * optional is a type error against `?: T`. Undefined is a value this component
 * genuinely handles (`sections ?? []`, `status &&`, `selection?.()`) — the
 * widened type says that, where a conditional spread at the one call site would
 * only hide it.
 */
interface AssetEditorSubjectProps {
  documentId: string;
  active?: boolean;
  type: string;
  title: string;
  /** This document's own inspection sections, for the subject it publishes
   *  when nothing inside it is picked. Identity (name/kind/provenance) is
   *  composed from `title`/`type`/`status` — a document always has one, even
   *  with no sections at all. */
  sections?: readonly InspectionSection[] | undefined;
  status?: string | undefined;
  /** What is picked INSIDE this document, for a document with authoring of
   *  its own. Read on demand (the registry calls it), so it may close over
   *  live state that changes without re-registering. */
  selection?: (() => WorkspaceDocumentSelection | null) | undefined;
}

/**
 * The non-visual half of an Asset Lab document. Kept separate from the frame
 * so project-owned contribution UIs can publish the standard subject without
 * sending React elements across the project/editor runtime boundary.
 */
export function AssetEditorSubject({
  documentId,
  active = true,
  type,
  title,
  sections,
  status,
  selection,
}: AssetEditorSubjectProps) {
  useEffect(() => {
    if (!active) return;
    return activateAssetEditorContext({
      documentId,
      title,
      type,
      ...(status ? { status } : {}),
    });
  }, [active, documentId, status, title, type]);

  // ONE owner for this document's selection context (the registry keys by
  // document id, so a second registrant would silently displace the first and
  // take the entry with it on unmount). The ref keeps the registration stable
  // while the provider it delegates to is free to change every render.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  useEffect(() => {
    if (!active) return;
    return registerWorkspaceDocumentSelection(
      documentId,
      () => selectionRef.current?.() ?? DOCUMENT_IS_THE_SUBJECT,
    );
  }, [active, documentId]);

  // The document's subject DESCRIPTION — identity plus its own sections, in
  // the same shape every surface's `describeSubject(null)` answer takes.
  // The latest description is read on demand, so section IO closures remain
  // live without publishing on every render. Publishing itself notifies the
  // Inspector; doing it after every Inspector-driven parent render creates a
  // notification -> render -> publication loop and React eventually throws
  // "Maximum update depth exceeded" when an Object3D prefab opens.
  const description: NullInspectionSubject = {
    id: documentId,
    title,
    // `kindLabel` is what earns the composed identity ROW, and a document
    // always names its kind: an Asset Lab document IS a thing with a name, a
    // type and a provenance.
    kindLabel: type,
    ...(status ? { note: { text: status, testId: 'asset-editor-status' } } : {}),
    sections: sections ?? [],
  };
  const descriptionRef = useRef(description);
  descriptionRef.current = description;
  const publicationKey = subjectPublicationKey(description);
  useEffect(() => {
    if (!active) return;
    return publishDocumentInspectionSubject(documentId, () => descriptionRef.current);
  }, [active, documentId, publicationKey]);

  return null;
}

export function AssetEditorShell({
  documentId,
  active = true,
  type,
  title,
  sections,
  status,
  fill = false,
  selection,
  children,
}: AssetEditorSubjectProps & {
  /** The child owns the whole viewport box and clips itself (a 3D canvas),
   *  rather than flowing and scrolling inside it. */
  fill?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className="vgai-asset-editor"
      data-testid={`asset-editor:${type}`}
      aria-label={`${title} Asset Editor`}
    >
      <AssetEditorSubject
        documentId={documentId}
        active={active}
        type={type}
        title={title}
        sections={sections}
        status={status}
        selection={selection}
      />
      <main
        className={`vgai-asset-editor__viewport${fill ? ' vgai-asset-editor__viewport--fill' : ''}`}
      >
        {children}
      </main>
    </section>
  );
}
