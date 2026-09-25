/**
 * State Watch as a drawer tab: a read-only tree and per-project pins over the
 * focused game's native `DebugAdapter` providers — the same adapter
 * `@volter/editor-live` reads. On offer only while that seam exists; a tab over no
 * providers would be a measurement nobody made.
 *
 * `available` reads the PRIMARY authoring mount's debug adapter, exactly what
 * the panel itself reads, so the gate and the content can never disagree.
 */
import { getActiveDebug } from '@volter/editor-sdk/kit/authoring/active-systems';
import { StateWatchPanel } from '../src/state-watch/StateWatchPanel';

export const point = 'workspace.utility';
export const title = 'State Watch';
export const order = 19;
export const available = (): boolean => getActiveDebug() != null;

export default function StateWatchUtility() {
  return <StateWatchPanel />;
}
