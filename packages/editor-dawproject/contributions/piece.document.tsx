/**
 * THE PIECE DOCUMENT (`workspace.document`, `documentKind = 'piece'`): the editor every `piece`
 * table entry opens in (`pieces.finder.ts`). The module is the document; its default export is
 * mounted live (`src/live-piece.ts`), drawn as an arrangement and a note editor, played, and
 * edited in its own source (`src/PieceEditor.tsx`).
 */
import type { ToolContributionProps } from '@volter/editor-sdk/contributions';
import { PieceEditor } from '../src/PieceEditor';

export const point = 'workspace.document';
export const title = 'Piece';
/** The kind this document EDITS: every `piece` table entry opens here. */
export const documentKind = 'piece';

export default function PieceDocument(props: ToolContributionProps) {
  const file = props.document?.source?.path;
  if (!file) return <div style={{ padding: 16 }}>This document names no module.</div>;
  return (
    <PieceEditor
      file={file}
      active={props.active ?? true}
      {...(props.notify ? { notify: props.notify } : {})}
      {...(props.publishContext ? { publishContext: props.publishContext } : {})}
      documentId={props.documentId ?? null}
    />
  );
}
