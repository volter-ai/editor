/**
 * Puts undo-depth pressure in front of the user through the editor's EXISTING
 * non-fatal channels — no new notification system.
 *
 * - `showTransientHint` is the editor's one toast: it reaches a user whose
 *   History panel is closed, which is the normal case while editing.
 * - `editorConsole.warn` is the durable log, so someone who has already lost
 *   undo depth can find out that it happened and why.
 *
 * The same two snapshot fields are also readable through the history door;
 * this module is only the "you are not looking at that panel" half.
 *
 * Evictions are logged but deliberately NOT hinted: once a budget is at its
 * ceiling every further commit evicts, and a toast per commit is noise. The
 * eviction message carries no running total precisely so `editorConsole`'s
 * consecutive-duplicate folding collapses the repeats into one counted entry.
 */

import { editorConsole } from '../editor-console';
import { showTransientHint } from '../transient-hint';
import type { HistoryService } from './history-service';
import type { HistoryEviction, HistoryLimitWarning } from './types';

export function connectHistoryLimitNotices(history: HistoryService): () => void {
  let seenWarning: HistoryLimitWarning | null = history.getSnapshot().limitWarning;
  let seenEviction: HistoryEviction | null = history.getSnapshot().lastEviction;
  return history.subscribe(() => {
    const { limitWarning, lastEviction } = history.getSnapshot();
    if (limitWarning !== seenWarning) {
      seenWarning = limitWarning;
      // A still-standing warning keeps its object identity, so this fires once
      // per crossing rather than once per commit spent over the threshold.
      if (limitWarning) {
        showTransientHint(limitWarning.message);
        editorConsole.warn(limitWarning.message, 'history');
      }
    }
    if (lastEviction !== seenEviction) {
      seenEviction = lastEviction;
      if (lastEviction) editorConsole.warn(lastEviction.message, 'history');
    }
  });
}
