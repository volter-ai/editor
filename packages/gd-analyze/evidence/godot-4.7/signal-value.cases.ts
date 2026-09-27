/**
 * Signal: emit, connect (with its flags and a repeated Callable), disconnect and is_connected on
 * an object's signal, the Callables lambdas that log what they receive.
 */
import * as S from '../../capabilities/catalog/project-source/src/lib/godot-compat/signal-value';
import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';

const cases: GodotEvidenceCase[] = [];
const SETUP = ['var o := Object.new()', 'o.add_user_signal("s")', 'var sig := Signal(o, "s")', 'var got := []', 'var a := func(v): got.append(["a", v])', 'var b := func(v): got.append(["b", v])'];
function add(id: string, member: string, body: readonly string[], target: (sig: ReturnType<typeof S.godot_script_signal>, got: unknown[], a: (v: unknown) => void, b: (v: unknown) => void) => unknown): void {
  cases.push({
    id,
    symbol: { kind: 'builtin-member', owner: 'Signal', member },
    gdscript: [...SETUP, ...body.slice(0, -1), `var out = ${(body[body.length - 1] as string).replace(/^return /u, '')}`, 'o.free()', 'return out'].join('\n'),
    target: () => {
      const sig = S.godot_script_signal();
      const got: unknown[] = [];
      const a = (v: unknown) => void got.push(['a', v]);
      const b = (v: unknown) => void got.push(['b', v]);
      return target(sig, got, a, b);
    },
    comparator: 'exact',
  });
}
add('emit-two-slots', 'emit', ['sig.connect(a)', 'sig.connect(b)', 'sig.emit(1)', 'sig.emit(2)', 'return got'], (sig, got, a, b) => {
  S.connect(sig as never, a as never);
  S.connect(sig as never, b as never);
  S.emit(sig as never, 1);
  S.emit(sig as never, 2);
  return got;
});
add('connect-returns', 'connect', ['var first := sig.connect(a)', 'var again := sig.connect(a)', 'var counted := sig.connect(a, CONNECT_REFERENCE_COUNTED)', 'return [first, again, counted]'], (sig, _got, a) => [S.connect(sig as never, a as never), S.connect(sig as never, a as never), S.connect(sig as never, a as never, 8)]);
add('connect-one-shot', 'connect', ['sig.connect(a, CONNECT_ONE_SHOT)', 'sig.emit(1)', 'sig.emit(2)', 'return [got, sig.is_connected(a)]'], (sig, got, a) => {
  S.connect(sig as never, a as never, 4);
  S.emit(sig as never, 1);
  S.emit(sig as never, 2);
  return [got, S.is_connected(sig as never, a as never)];
});
add('disconnect', 'disconnect', ['sig.connect(a)', 'sig.connect(b)', 'sig.disconnect(a)', 'sig.emit(3)', 'return got'], (sig, got, a, b) => {
  S.connect(sig as never, a as never);
  S.connect(sig as never, b as never);
  S.disconnect(sig as never, a as never);
  S.emit(sig as never, 3);
  return got;
});
add('disconnect-not-connected', 'disconnect', ['sig.disconnect(a)', 'sig.connect(b)', 'sig.emit(4)', 'return got'], (sig, got, a, b) => {
  S.disconnect(sig as never, a as never);
  S.connect(sig as never, b as never);
  S.emit(sig as never, 4);
  return got;
});
add('is_connected', 'is_connected', ['var before := sig.is_connected(a)', 'sig.connect(a)', 'var during := sig.is_connected(a)', 'var other := sig.is_connected(b)', 'return [before, during, other]'], (sig, _got, a, b) => {
  const before = S.is_connected(sig as never, a as never);
  S.connect(sig as never, a as never);
  return [before, S.is_connected(sig as never, a as never), S.is_connected(sig as never, b as never)];
});
add('reference-counted-release', 'disconnect', ['sig.connect(a, CONNECT_REFERENCE_COUNTED)', 'sig.connect(a, CONNECT_REFERENCE_COUNTED)', 'sig.disconnect(a)', 'var still := sig.is_connected(a)', 'sig.disconnect(a)', 'return [still, sig.is_connected(a)]'], (sig, _got, a) => {
  S.connect(sig as never, a as never, 8);
  S.connect(sig as never, a as never, 8);
  S.disconnect(sig as never, a as never);
  const still = S.is_connected(sig as never, a as never);
  S.disconnect(sig as never, a as never);
  return [still, S.is_connected(sig as never, a as never)];
});

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'Signal', compatModule: 'lib/godot-compat/signal-value', cases };
export default EVIDENCE;
