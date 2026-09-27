import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/callable';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { caseCollector } from './literals';

const c = caseCollector('Callable');
const LIST = 'var f := func(a = "unset", b = "unset", c = "unset", d = "unset"): return [a, b, c, d]';
const list = (a: unknown = 'unset', b: unknown = 'unset', c: unknown = 'unset', d: unknown = 'unset'): unknown[] => [a, b, c, d];

c.add('bind-none', c.member('bind'), `${LIST}\nreturn f.bind().call(1)`, () => C.bind(list)(1));
c.add('bind-one', c.member('bind'), `${LIST}\nreturn f.bind(9).call(1)`, () => C.bind(list, 9)(1));
c.add('bind-two', c.member('bind'), `${LIST}\nreturn f.bind(8, 9).call(1, 2)`, () => C.bind(list, 8, 9)(1, 2));
c.add('bind-all', c.member('bind'), `${LIST}\nreturn f.bind(1, 2, 3, 4).call()`, () => C.bind(list, 1, 2, 3, 4)());
c.add('bind-nested', c.member('bind'), `${LIST}\nreturn f.bind(1).bind(2).call(3)`, () => C.bind(C.bind(list, 1), 2)(3));
c.add('bind-values', c.member('bind'), `${LIST}\nreturn f.bind([1], "s", null).call(0.5)`, () => C.bind(list, [1], 's', null)(0.5));
c.add(
  'bind-captures-at-bind',
  c.member('bind'),
  `${LIST}\nvar x := [1]\nvar g := f.bind(x)\nx.append(2)\nreturn g.call(0)`,
  () => {
    const x: unknown[] = [1];
    const g = C.bind(list, x);
    x.push(2);
    return g(0);
  },
);

const CALLABLE_EVIDENCE: GodotEvidenceCaseFile = {
  godotClass: 'Callable',
  compatModule: 'lib/godot-compat/callable',
  cases: c.cases,
};

export default CALLABLE_EVIDENCE;
