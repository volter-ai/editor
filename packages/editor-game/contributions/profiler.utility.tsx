/**
 * The Profiler as a drawer tab (W4/W4b): the engine's instrument bench —
 * frame cost over time (Profiler) and the single-frame draw-call capture
 * (Frame) over the inspected session's `RenderDebugAdapter` and the active
 * document's registered render loop. Always on offer: the editor's own
 * documents register profiler sources in edit mode, and Play supplies the
 * running game's.
 */
import { ProfilerPanel } from '../src/profiler/ProfilerPanel';

export const point = 'workspace.utility';
export const title = 'Profiler';
export const order = 20;

export default function ProfilerUtility() {
  return <ProfilerPanel />;
}
