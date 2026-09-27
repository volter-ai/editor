/**
 * THE AUDIO CLIP'S EDITOR: what the lower pane shows for a clip that plays a recording
 * (`<Audio file offset gain>`) instead of notes. The file is named; its start in the file
 * (`offset`, seconds) and its level (`gain`, dB) are fields that write the element's literals, one
 * undo entry each.
 */
import type { Piece, PieceClip } from '@volter/dawproject/piece';
import { themeVars } from '@volter/editor-sdk/widgets';
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useState } from 'react';
import { type SourceIndex, setProps, setRefusal } from './source-index';

const small = { fontSize: 11, color: themeVars.content.muted } as const;

export function AudioClip(props: {
  readonly clip: PieceClip;
  readonly piece: Piece;
  readonly index: SourceIndex;
  readonly file: string;
  readonly documentId: string | null;
  readonly onMessage: (message: string | null) => void;
}) {
  const audio = props.clip.audio;
  if (!audio) return null;
  const write = (prop: 'offset' | 'gain', text: string): void => {
    const value = Number(text);
    if (!Number.isFinite(value) || (prop === 'offset' && value < 0)) {
      props.onMessage(`${prop} is a number${prop === 'offset' ? ' of seconds, 0 or more' : ' of dB'}.`);
      return;
    }
    const count = audio.oid ? (props.piece.oidCounts.get(audio.oid) ?? 0) : 0;
    const why = setRefusal(props.index, audio.oid, prop, count);
    if (why || !audio.oid) {
      props.onMessage(why);
      return;
    }
    props.onMessage(null);
    setProps(`Set Audio ${prop}`, props.index, audio.oid, { [prop]: value }, { file: props.file, documentId: props.documentId }).catch((error: unknown) =>
      props.onMessage(error instanceof Error ? error.message : String(error)),
    );
  };
  return (
    <div tabIndex={-1} data-audio-clip={props.clip.id} style={{ outline: 'none', padding: 12, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
      <div>
        <span style={small}>recording </span>
        <span data-audio-file="" style={{ fontFamily: 'monospace' }}>
          {audio.file}
        </span>
      </div>
      <Field name="offset" label="starts at (s into the file)" value={audio.offset} onCommit={(text) => write('offset', text)} />
      <Field name="gain" label="gain (dB)" value={audio.gain} onCommit={(text) => write('gain', text)} />
    </div>
  );
}

function Field(props: { readonly name: string; readonly label: string; readonly value: number; readonly onCommit: (text: string) => void }) {
  const [text, setText] = useState(String(props.value));
  useEffect(() => setText(String(props.value)), [props.value]);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      props.onCommit(text);
      // Focus back into the document, as the arranger's fields do: a focused field would take
      // the workbench's Undo as its own text undo, and the edit's entry would not be reached.
      (event.currentTarget.closest('[tabindex]') as HTMLElement | null)?.focus({ preventScroll: true });
    }
    if (event.key === 'Escape') setText(String(props.value));
  };
  return (
    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <span style={{ ...small, width: 170 }}>{props.label}</span>
      <input
        data-audio-field={props.name}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (text !== String(props.value)) props.onCommit(text);
        }}
        style={{ width: 80, fontFamily: 'monospace' }}
      />
    </label>
  );
}
