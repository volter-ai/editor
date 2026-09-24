/**
 * The MACHINE DOCUMENT (`workspace.document`, `documentKind = 'machine'`): the editor every
 * `machine` table entry opens in (`machines.finder.ts`). The module is the document; its
 * machines are drawn, edited in source and watched live by `src/MachineEditor.tsx`.
 */
import type { ToolContributionProps } from '@volter/editor-sdk/contributions';
import { MachineEditor } from '../src/MachineEditor';

export const point = 'workspace.document';
export const title = 'Machine';
/** The kind this document EDITS: every `machine` table entry opens here. */
export const documentKind = 'machine';

export default function MachineDocument(props: ToolContributionProps) {
  const file = props.document?.source?.path;
  if (!file) return <div style={{ padding: 16 }}>This document names no module.</div>;
  return <MachineEditor file={file} active={props.active ?? true} />;
}
