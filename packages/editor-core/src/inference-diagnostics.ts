/**
 * THE FALLBACK RUNG IS LOUD.
 *
 * ARCHITECTURE-CORE §The editor protocol, "Zero inference": the runtime answers
 * a question by reading a declaration, walking ground truth, or diagnosing
 * declared-vs-measured drift — loudly. A few editor surfaces still end in a
 * text heuristic when no declaration reaches them: the inspector's widget type
 * for a prop whose component declares nothing usable, and a design token's
 * category when neither its name nor its value settles it.
 *
 * Those heuristics stay (a guessed widget still beats a blank row), but they
 * stop being SILENT. A silent guess is indistinguishable from a declaration
 * that worked, so nobody ever learns which rows are load-bearing and which are
 * the editor improvising — and the guess is exactly the thing an author could
 * have stated. Reporting names the file, the subject, and what was guessed, so
 * the fix is one edit away.
 *
 * It goes to the editor's OWN Console panel, not `window.console`: the editor's
 * doors answer questions about the editor. Warn-once per (where, what, guess),
 * because inspector rows rebuild on every selection and a per-frame repeat
 * would be noise rather than a signal.
 */

import { editorConsole } from './editor-console';

const warned = new Set<string>();

/**
 * The warn-once key for one (where, what, guess) triple.
 *
 * `JSON.stringify` of the tuple rather than a joined string: the three parts are
 * free text, so any plain separator (`:`, `|`) can appear inside one of them and
 * collapse two distinct guesses into one key. JSON quotes and escapes each part,
 * which makes the encoding unambiguous — and keeps this module PLAIN TEXT. The
 * separator this replaced was a raw NUL byte typed into the source literal,
 * which made git classify the whole file as BINARY (`Bin 0 -> 2281 bytes`, no
 * reviewable diff, no `.gitattributes` text normalization) while rendering as an
 * innocent space in every editor — so the next person to touch the line would
 * have deleted the separator without ever seeing it.
 */
function warnKey(where: string, what: string, guess: string): string {
  return JSON.stringify([where, what, guess]);
}

/**
 * Report that a widget/category was GUESSED from text because no declaration
 * covered it.
 *
 * @param where  Project-relative file (or other addressable location).
 * @param what   The subject inside it — a prop name, a token name.
 * @param guess  What the heuristic settled on, in the vocabulary the reader
 *               sees on screen.
 */
export function warnGuessedFromText(where: string, what: string, guess: string): void {
  const key = warnKey(where, what, guess);
  if (warned.has(key)) return;
  warned.add(key);
  editorConsole.warn(
    `No declaration covers \`${what}\` in ${where}, so the editor GUESSED \`${guess}\` from its ` +
      'text. Declare it (a typed prop on the component, a token value that states its own kind) ' +
      'and the editor reads the declaration instead of a heuristic.',
    'inspector',
  );
}

/** Test seam: forget what has already been reported. */
export function __resetInferenceDiagnosticsForTest(): void {
  warned.clear();
}
