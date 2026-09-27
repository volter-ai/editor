import * as ST from '../../capabilities/catalog/project-source/src/lib/godot-compat/scene-tree';
import * as TW from '../../capabilities/catalog/project-source/src/lib/godot-compat/tween';
import * as TR from '../../capabilities/catalog/project-source/src/lib/godot-compat/tweener';
import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { signalCase } from './native-signal-case';
import { frames, type Op, type Segment, tweenCase } from './tween-timeline';

const cases: GodotEvidenceCase[] = [];
function add(id: string, segments: readonly Segment[]): void {
  const built = tweenCase(segments);
  cases.push({ id, symbol: { kind: 'native-signal', owner: 'Tweener', member: 'finished' }, gdscript: built.gdscript, target: built.target, comparator: 'exact' });
}
const now = (...ops: Op[]): Segment => ({ ops });

// Each tweener's `finished` against its step's and the tween's, in parallel and in sequence.
add('finished-order', [
  now(
    { node: 'a', kind: 'Node2D' },
    { tween: 't', on: 'a' },
    { watch: 't', signal: 'step_finished' },
    { watch: 't', signal: 'finished' },
    { prop: 'p', tween: 't', target: 'a', property: 'position', to: { v2: [1, 0] }, duration: 0.03 },
    { watchTweener: 'p' },
    { tweenCall: 't', call: 'parallel' },
    { prop: 'q', tween: 't', target: 'a', property: 'rotation', to: 1, duration: 0.05 },
    { watchTweener: 'q' },
    { callback: 'c', tween: 't', log: 'called' },
    { watchTweener: 'c' },
  ),
  ...frames(6, { value: 'a', property: 'position' }),
]);

const EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'Tweener',
  compatModule: 'lib/godot-compat/tweener',
  cases: [
    ...cases,
    signalCase({
      owner: 'Tweener',
      member: 'finished',
      make: 'create_tween().tween_callback(func(): pass)',
      args: '',
      signal: () => {
        const tween = ST.create_tween(ST.godot_tree());
        const tweener = TW.tween_callback(tween, () => undefined) as object;
        TW.kill(tween);
        return { signal: TR.finished(tweener) as never, args: [] };
      },
    }),
  ],
};
export default EVIDENCE;
