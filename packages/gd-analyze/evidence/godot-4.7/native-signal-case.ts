/**
 * Cases for an engine signal read as a Signal value (`native-signal`): connect a Callable, emit,
 * disconnect and emit again, reading `is_connected` between, on official Godot and through the
 * class's accessor with compat's `Signal` members.
 */
import * as SV from '../../capabilities/catalog/project-source/src/lib/godot-compat/signal-value';
import type { GodotSignal } from '../../capabilities/catalog/project-source/src/lib/godot-compat/signal';
import type { GodotEvidenceCase } from '../../src/evidence/case';

export function signalCase(options: {
  readonly owner: string;
  readonly member: string;
  /** GDScript making the object (`holder` is a fresh Node in the tree). */
  readonly make: string;
  /** GDScript freeing it, when the case made it. */
  readonly free?: string;
  /** The signal's arguments as GDScript, and the same values on the target. */
  readonly args: string;
  readonly signal: () => { readonly signal: GodotSignal<readonly unknown[]>; readonly args: readonly unknown[] };
}): GodotEvidenceCase {
  const arity = options.args === '' ? 0 : options.args.split(',').length;
  const parameters = Array.from({ length: arity }, (_, index) => `_a${String(index)}`).join(', ');
  return {
    id: `signal-${options.member}`,
    symbol: { kind: 'native-signal', owner: options.owner, member: options.member },
    gdscript: [
      `var o = ${options.make}`,
      'var log := []',
      `var f := func(${parameters}): log.append(${String(arity)})`,
      `var s: Signal = o.${options.member}`,
      'var before := s.is_connected(f)',
      's.connect(f)',
      'var connected := s.is_connected(f)',
      `s.emit(${options.args})`,
      's.disconnect(f)',
      `s.emit(${options.args})`,
      'var result := [log, before, connected, s.is_connected(f)]',
      ...(options.free === undefined ? [] : [options.free]),
      'return result',
    ].join('\n'),
    target: () => {
      const { signal, args } = options.signal();
      const log: number[] = [];
      const f = (): void => {
        log.push(arity);
      };
      const before = SV.is_connected(signal, f);
      SV.connect(signal, f);
      const connected = SV.is_connected(signal, f);
      SV.emit(signal, ...args);
      SV.disconnect(signal, f);
      SV.emit(signal, ...args);
      return [log, before, connected, SV.is_connected(signal, f)];
    },
    comparator: 'exact',
  };
}
