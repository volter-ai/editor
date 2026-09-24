/**
 * The Audio debugger as a drawer tab (W3c): node graph, transport strip,
 * per-bus meters and the event log over the inspected session's
 * `AudioAdapter`. Always on offer: the editor project registers the same
 * first-party graph in edit mode, and Play supplies the running game's.
 */
import { AudioDebuggerPanel } from '../src/audio/AudioDebuggerPanel';

export const point = 'workspace.utility';
export const title = 'Audio';
export const order = 26;

export default function AudioUtility() {
  return <AudioDebuggerPanel />;
}
