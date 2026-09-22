import { themeVars } from '@volter/editor-sdk/widgets';
import { useEffect, useRef, useState } from 'react';

/**
 * The editor's ONE read-only code display surface (CodeMirror 6).
 *
 * Every door that opens a project's own source text renders through this —
 * `SourceAssetViewer`'s text route and the generic JSON viewer today. It is a
 * VIEWER: `EditorState.readOnly` + `EditorView.editable(false)`, so nothing
 * here ever writes a game's file. Doors that already own an editing surface
 * keep theirs.
 *
 * ## Why the pieces are imported individually, not `codemirror`
 *
 * The `codemirror` meta-package exports exactly three things — `EditorView`,
 * `basicSetup`, `minimalSetup` — and its own docblock says that the moment you
 * want to configure precisely, you compose the sub-packages yourself. We do:
 * `basicSetup` bundles autocompletion, close-brackets, undo history, lint and
 * ACTIVE-LINE highlighting, all of which are either inert or wrong in a
 * viewer, and it is explicitly not customizable.
 *
 * ## Why it is lazy
 *
 * CodeMirror + the JS/JSON grammars are ~400 kB of source that only a user who
 * opens a source or JSON asset ever needs, so the whole kit sits behind a
 * dynamic import (same reason `game-realm-page.ts` defers postcss). Until the
 * chunk lands the raw text renders in a plain `<pre>`, so content is never
 * withheld waiting on a network round trip — a long file is readable
 * immediately and simply gains highlighting a beat later.
 */

export type CodeViewLanguage = 'typescript' | 'json' | 'text';

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, CodeViewLanguage>> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'typescript',
  jsx: 'typescript',
  mjs: 'typescript',
  cjs: 'typescript',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
};

/** Language for a file path's extension; anything unrecognized reads as text. */
export function codeViewLanguage(path: string): CodeViewLanguage {
  const name = path.split('/').pop() ?? path;
  const dot = name.lastIndexOf('.');
  if (dot < 0) return 'text';
  return LANGUAGE_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? 'text';
}

type CodeMirrorKit = {
  readonly state: typeof import('@codemirror/state');
  readonly view: typeof import('@codemirror/view');
  readonly language: typeof import('@codemirror/language');
  readonly search: typeof import('@codemirror/search');
  readonly commands: typeof import('@codemirror/commands');
  readonly javascript: typeof import('@codemirror/lang-javascript');
  readonly json: typeof import('@codemirror/lang-json');
  readonly oneDark: typeof import('@codemirror/theme-one-dark');
};

let kitPromise: Promise<CodeMirrorKit> | null = null;

/** Loads (once per session) the CodeMirror chunk shared by every code view. */
function loadCodeMirror(): Promise<CodeMirrorKit> {
  kitPromise ??= Promise.all([
    import('@codemirror/state'),
    import('@codemirror/view'),
    import('@codemirror/language'),
    import('@codemirror/search'),
    import('@codemirror/commands'),
    import('@codemirror/lang-javascript'),
    import('@codemirror/lang-json'),
    import('@codemirror/theme-one-dark'),
  ]).then(([state, view, language, search, commands, javascript, json, oneDark]) => ({
    state,
    view,
    language,
    search,
    commands,
    javascript,
    json,
    oneDark,
  }));
  return kitPromise;
}

function cssLength(value: number | string): string {
  return typeof value === 'number' ? `${value}px` : value;
}

/**
 * Chrome drawn from the editor's OWN theme variables — every editor theme is
 * dark, so one-dark supplies the token ramp (`oneDarkHighlightStyle`) while the
 * surface, gutter, selection, and search-panel colors come from `themeVars` so
 * the view sits inside a panel without announcing itself as foreign chrome.
 * The background is deliberately transparent: the calling door owns its well.
 */
/**
 * A PERCENTAGE `maxHeight` means "fill the box you are in".
 *
 * CodeMirror sizes itself to its content unless the editor element is given a
 * definite height, so `max-height: 100%` on the scroller alone resolves against
 * an auto-height ancestor and does nothing. A percentage therefore also puts a
 * `height` on `.cm-editor` (and on the host element), which is CodeMirror's own
 * documented spelling for a filling editor. A pixel `maxHeight` keeps the
 * flow-to-content behaviour every existing caller relies on.
 */
function fillsItsBox(maxHeight: number | string | undefined): maxHeight is string {
  return typeof maxHeight === 'string' && maxHeight.trim().endsWith('%');
}

/** Source updates are transactions, so their cue follows the same document. */
function changedSourceRange(previous: string, value: string) {
  let from = 0;
  while (from < previous.length && from < value.length && previous[from] === value[from]) from++;
  let oldEnd = previous.length;
  let newEnd = value.length;
  while (oldEnd > from && newEnd > from && previous[oldEnd - 1] === value[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return { from, oldEnd, newEnd };
}

const SOURCE_CHANGE_DURATION_MS = 1800;
const sourceChangeBackground = `color-mix(in srgb, ${themeVars.semantic.warning} 42%, transparent)`;
const sourceChangeLineBackground = `color-mix(in srgb, ${themeVars.semantic.warning} 18%, transparent)`;

function createChangeHighlight(kit: CodeMirrorKit) {
  // Deleted text has no surviving range. Mark its boundary without coloring
  // an unchanged neighbour or adding width to the source line.
  class DeletionCue extends kit.view.WidgetType {
    constructor(readonly revision: number) {
      super();
    }
    eq(other: DeletionCue) {
      return this.revision === other.revision;
    }
    toDOM() {
      const element = document.createElement('span');
      element.className = `cm-source-deletion cm-source-change cm-source-change-${this.revision % 2}`;
      element.setAttribute('aria-hidden', 'true');
      return element;
    }
  }
  const mark = kit.state.StateEffect.define<{
    from: number;
    to: number;
    revision: number;
  } | null>();
  const field = kit.state.StateField.define<import('@codemirror/view').DecorationSet>({
    create: () => kit.view.Decoration.none,
    update(decorations, transaction) {
      let next = decorations.map(transaction.changes);
      for (const effect of transaction.effects) {
        if (!effect.is(mark)) continue;
        if (!effect.value) {
          next = kit.view.Decoration.none;
          continue;
        }
        const { from, to, revision } = effect.value;
        const decoration =
          from === to
            ? kit.view.Decoration.widget({ widget: new DeletionCue(revision), side: -1 }).range(
                from,
              )
            : kit.view.Decoration.mark({
                class: `cm-source-change cm-source-change-${revision % 2}`,
              }).range(from, to);
        next = kit.view.Decoration.set([decoration]);
      }
      return next;
    },
    provide: (value) => kit.view.EditorView.decorations.from(value),
  });
  return { mark, field };
}

function codeViewTheme(
  kit: CodeMirrorKit,
  fontSize: number,
  maxHeight: number | string | undefined,
) {
  return kit.view.EditorView.theme(
    {
      '&': {
        color: themeVars.content.primary,
        backgroundColor: 'transparent',
        fontSize: `${fontSize}px`,
        ...(fillsItsBox(maxHeight) ? { height: cssLength(maxHeight) } : {}),
      },
      '&.cm-focused': { outline: 'none' },
      '.cm-content': {
        fontFamily: themeVars.typography.mono,
        padding: '2px 0',
        caretColor: 'transparent',
      },
      '.cm-scroller': {
        fontFamily: themeVars.typography.mono,
        lineHeight: '1.5',
        overflow: 'auto',
        ...(maxHeight === undefined ? {} : { maxHeight: cssLength(maxHeight) }),
      },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        color: themeVars.content.dim,
        border: 'none',
        userSelect: 'none',
      },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 4px', minWidth: '2ch' },
      '.cm-content ::selection': { backgroundColor: themeVars.selection.background },
      '.cm-panels': {
        backgroundColor: themeVars.surface.raised,
        color: themeVars.content.primary,
        border: 'none',
        fontFamily: themeVars.typography.sans,
      },
      '.cm-panels.cm-panels-top': { borderBottom: `1px solid ${themeVars.boundary.default}` },
      '.cm-textfield': {
        backgroundColor: themeVars.surface.inset,
        color: themeVars.content.primary,
        border: `1px solid ${themeVars.boundary.default}`,
        borderRadius: themeVars.shape.small,
      },
      '.cm-button': {
        backgroundColor: themeVars.surface.raised,
        backgroundImage: 'none',
        color: themeVars.content.primary,
        border: `1px solid ${themeVars.boundary.default}`,
        borderRadius: themeVars.shape.small,
      },
      '.cm-searchMatch': { backgroundColor: themeVars.accent.muted },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: themeVars.accent.default,
        color: themeVars.content.onAccent,
      },
      '.cm-source-change': {
        backgroundColor: sourceChangeBackground,
        borderRadius: '2px',
      },
      '.cm-line:has(.cm-source-change)': {
        backgroundColor: sourceChangeLineBackground,
      },
      '.cm-source-change, .cm-line:has(.cm-source-change)': {
        animationDuration: `${SOURCE_CHANGE_DURATION_MS}ms`,
        animationTimingFunction: 'ease-out',
        animationFillMode: 'forwards',
      },
      '.cm-source-deletion': {
        display: 'inline-block',
        width: '0',
        position: 'relative',
      },
      '.cm-source-deletion::after': {
        content: '""',
        position: 'absolute',
        left: '-2px',
        bottom: '0',
        width: '4px',
        height: '1em',
        backgroundColor: 'inherit',
        borderRadius: '2px',
      },
      '.cm-source-change-0': { animationName: 'vgai-source-change-even' },
      '.cm-source-change-1': { animationName: 'vgai-source-change-odd' },
      '.cm-line:has(.cm-source-change-0)': { animationName: 'vgai-source-line-even' },
      '.cm-line:has(.cm-source-change-1)': { animationName: 'vgai-source-line-odd' },
      '@keyframes vgai-source-line-even': {
        '0%, 40%': { backgroundColor: sourceChangeLineBackground },
        '100%': { backgroundColor: 'transparent' },
      },
      '@keyframes vgai-source-line-odd': {
        '0%, 40%': { backgroundColor: sourceChangeLineBackground },
        '100%': { backgroundColor: 'transparent' },
      },
      '@keyframes vgai-source-change-even': {
        '0%, 40%': { backgroundColor: sourceChangeBackground },
        '100%': { backgroundColor: 'transparent' },
      },
      '@keyframes vgai-source-change-odd': {
        '0%, 40%': { backgroundColor: sourceChangeBackground },
        '100%': { backgroundColor: 'transparent' },
      },
      '@media (prefers-reduced-motion: reduce)': {
        '.cm-source-change, .cm-line:has(.cm-source-change)': { animation: 'none' },
      },
      '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
        backgroundColor: themeVars.neutralOverlay.active,
        outline: `1px solid ${themeVars.boundary.strong}`,
      },
    },
    { dark: true },
  );
}

function codeViewExtensions(
  kit: CodeMirrorKit,
  language: CodeViewLanguage,
  fontSize: number,
  maxHeight: number | string | undefined,
) {
  const languageExtension =
    language === 'typescript'
      ? [kit.javascript.javascript({ typescript: true, jsx: true })]
      : language === 'json'
        ? [kit.json.json()]
        : [];
  return [
    kit.view.lineNumbers(),
    kit.view.highlightSpecialChars(),
    kit.language.bracketMatching(),
    kit.language.syntaxHighlighting(kit.oneDark.oneDarkHighlightStyle),
    kit.search.search({ top: true }),
    kit.view.keymap.of([...kit.commands.standardKeymap, ...kit.search.searchKeymap]),
    kit.view.EditorView.lineWrapping,
    // A viewer, twice over: the state refuses writes and the view is not
    // editable. Selection and copy still work; `tabindex` keeps the view
    // focusable so mod-f reaches the search keymap.
    kit.state.EditorState.readOnly.of(true),
    kit.view.EditorView.editable.of(false),
    kit.view.EditorView.contentAttributes.of({ tabindex: '0' }),
    ...languageExtension,
    codeViewTheme(kit, fontSize, maxHeight),
  ];
}

export function CodeView({
  value,
  language,
  fontSize = 11,
  maxHeight,
  ariaLabel,
  followChanges = false,
}: {
  readonly value: string;
  readonly language: CodeViewLanguage;
  readonly fontSize?: number;
  readonly maxHeight?: number | string;
  readonly ariaLabel?: string;
  /** Reveal externally changed source without taking keyboard focus. */
  readonly followChanges?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<import('@codemirror/view').EditorView | null>(null);
  const highlightRef = useRef<ReturnType<typeof createChangeHighlight> | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revisionRef = useRef(0);
  const valueRef = useRef(value);
  valueRef.current = value;
  const [kit, setKit] = useState<CodeMirrorKit | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadCodeMirror().then(
      (loaded) => {
        if (!cancelled) setKit(loaded);
      },
      () => {
        // A viewer that cannot load its highlighter still shows the code: the
        // plain-text fallback below stays, and says why rather than pretending
        // an unhighlighted file is the finished view.
        if (!cancelled) setLoadFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !kit) return;
    const highlight = createChangeHighlight(kit);
    const view = new kit.view.EditorView({
      parent: host,
      state: kit.state.EditorState.create({
        doc: valueRef.current,
        extensions: [codeViewExtensions(kit, language, fontSize, maxHeight), highlight.field],
      }),
    });
    viewRef.current = view;
    highlightRef.current = highlight;
    return () => {
      if (highlightTimer.current !== null) clearTimeout(highlightTimer.current);
      highlightTimer.current = null;
      highlightRef.current = null;
      viewRef.current = null;
      view.destroy();
    };
  }, [kit, language, fontSize, maxHeight]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    // Use CodeMirror's line endings for both sides of the diff. Its document
    // offsets do not include the extra carriage returns in Windows files.
    const nextValue = view.state.toText(value).toString();
    const previous = view.state.doc.toString();
    if (previous === nextValue) return;
    const { from, oldEnd, newEnd } = changedSourceRange(previous, nextValue);
    const changes = view.state.changes({ from, to: oldEnd, insert: nextValue.slice(from, newEnd) });
    const highlight = highlightRef.current;
    const effects: import('@codemirror/state').StateEffect<unknown>[] = [];
    if (followChanges && kit && highlight) {
      const point = view.coordsAtPos(from);
      const viewport = view.scrollDOM.getBoundingClientRect();
      const visible =
        point &&
        point.top >= viewport.top &&
        point.bottom <= viewport.bottom &&
        point.left >= viewport.left &&
        point.right <= viewport.right;
      // Preserve the reading position explicitly for a visible edit, including
      // when replacement text changes line wrapping. Reveal only unseen edits.
      const scroll = visible
        ? view.scrollSnapshot().map(changes)
        : kit.view.EditorView.scrollIntoView(from, { y: 'nearest', x: 'nearest' });
      if (scroll) effects.push(scroll);
      effects.push(highlight.mark.of({ from, to: newEnd, revision: ++revisionRef.current }));
    } else if (highlight) {
      effects.push(highlight.mark.of(null));
    }
    view.dispatch({ changes, effects });
    if (highlightTimer.current !== null) clearTimeout(highlightTimer.current);
    highlightTimer.current = null;
    if (followChanges && highlight) {
      highlightTimer.current = setTimeout(() => {
        if (viewRef.current === view) view.dispatch({ effects: highlight.mark.of(null) });
        highlightTimer.current = null;
      }, SOURCE_CHANGE_DURATION_MS);
    }
  }, [value, followChanges, kit]);

  const fill = fillsItsBox(maxHeight) ? { height: '100%', minHeight: 0 } : {};
  if (!kit) {
    return (
      <div role="group" aria-label={ariaLabel} style={{ minWidth: 0, ...fill }}>
        {loadFailed && (
          <div style={{ color: themeVars.semantic.warning, fontSize: 10, marginBottom: 4 }}>
            Syntax highlighting failed to load — showing plain text.
          </div>
        )}
        <pre
          style={{
            margin: 0,
            fontFamily: themeVars.typography.mono,
            fontSize,
            lineHeight: 1.5,
            color: themeVars.content.primary,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflow: 'auto',
            ...(maxHeight === undefined ? {} : { maxHeight: cssLength(maxHeight) }),
            ...(fillsItsBox(maxHeight) ? { height: cssLength(maxHeight) } : {}),
          }}
        >
          {value}
        </pre>
      </div>
    );
  }
  return <div ref={hostRef} role="group" aria-label={ariaLabel} style={{ minWidth: 0, ...fill }} />;
}
