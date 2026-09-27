/**
 * RootTextEditor — spec 27 §6 D3.b double-click-to-edit-text: an inline canonical
 * multiline text control positioned over the double-clicked node's rect. Escape cancels;
 * Enter (no shift) or blur commits. Purely a controlled presentational component —
 * `RootSelectionOverlay` decides WHETHER to render this (via `adapter.text`/`textForId`,
 * rule zero) and supplies the initial text + the commit/cancel callbacks; this file has
 * no adapter/DOM reach of its own.
 */

import { TextArea, zIndex } from '@volter/editor-sdk/widgets';
import { useEffect, useRef, useState } from 'react';

export interface RootTextEditorProps {
  rect: { x: number; y: number; width: number; height: number };
  initialText: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}

export function RootTextEditor({
  rect,
  initialText,
  onCommit,
  onCancel,
}: RootTextEditorProps): React.ReactNode {
  const [value, setValue] = useState(initialText);
  const ref = useRef<HTMLTextAreaElement>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const commit = (): void => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(value);
  };

  const cancel = (): void => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCancel();
  };

  return (
    <TextArea
      ref={ref}
      data-testid="world-text-editor"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          cancel();
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          commit();
        }
      }}
      data-variant="inline-editor"
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: Math.max(rect.width, 40),
        height: Math.max(rect.height, 20),
        boxSizing: 'border-box',
        zIndex: zIndex.overlayLow,
        pointerEvents: 'auto',
        resize: 'none',
      }}
    />
  );
}
