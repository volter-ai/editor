import * as A from '../../capabilities/catalog/project-source/src/lib/godot-compat/array';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { caseCollector } from './literals';

const c = caseCollector('Array');
/** The same array literal in GDScript and as JS values. */
const ARRAYS: readonly (readonly [string, string, () => unknown[]])[] = [
  ['empty', '[]', () => []],
  ['ints', '[1, -2, 3]', () => [1, -2, 3]],
  ['mixed', '[1, 2.5, "s", null, true, Vector2(0.5, -1.0)]', () => [1, 2.5, 's', null, true, V.construct(0.5, -1)]],
  ['nested', '[[1, 2], [], ["a"]]', () => [[1, 2], [], ['a']]],
];

c.add('construct-empty', c.constructor, 'Array()', () => A.construct());
for (const [name, gd, js] of ARRAYS) {
  c.add(`construct-from-${name}`, c.constructor, `Array(${gd})`, () => A.construct(js()));
  c.add(`size-${name}`, c.member('size'), `${gd}.size()`, () => A.size(js()));
  c.add(`is_empty-${name}`, c.member('is_empty'), `${gd}.is_empty()`, () => A.is_empty(js()));
  c.add(`clear-${name}`, c.member('clear'), `var a := ${gd}\na.clear()\nreturn a`, () => {
    const a = js();
    A.clear(a);
    return a;
  });
  c.add(`pop_front-value-${name}`, c.member('pop_front'), `var a := ${gd}\nreturn a.pop_front()`, () => A.pop_front(js()));
  c.add(`pop_front-rest-${name}`, c.member('pop_front'), `var a := ${gd}\na.pop_front()\nreturn a`, () => {
    const a = js();
    A.pop_front(a);
    return a;
  });
  for (const [valueName, gdValue, jsValue] of [
    ['int', '7', () => 7],
    ['string', '"x"', () => 'x'],
    ['null', 'null', () => null],
    ['array', '[9]', () => [9]],
  ] as const) {
    c.add(`append-${name}-${valueName}`, c.member('append'), `var a := ${gd}\na.append(${gdValue})\nreturn a`, () => {
      const a = js();
      A.append(a, jsValue());
      return a;
    });
  }
}
// Shared reference: a write through one name is seen through the other, and Array(from) shares.
c.add('append-shared', c.member('append'), 'var a := [1]\nvar b := a\nb.append(2)\nreturn a', () => {
  const a: unknown[] = [1];
  const b = a;
  A.append(b, 2);
  return a;
});
c.add('construct-from-shares', c.constructor, 'var a := [1]\nvar b := Array(a)\nb.append(2)\nreturn a', () => {
  const a: unknown[] = [1];
  A.append(A.construct(a), 2);
  return a;
});
c.add('clear-shared', c.member('clear'), 'var a := [1, 2]\nvar b := a\nb.clear()\nreturn a.size()', () => {
  const a: unknown[] = [1, 2];
  const b = a;
  A.clear(b);
  return A.size(a);
});
c.add('pop_front-shared', c.member('pop_front'), 'var a := [1, 2]\nvar b := a\nb.pop_front()\nreturn a', () => {
  const a: unknown[] = [1, 2];
  const b = a;
  A.pop_front(b);
  return a;
});

const ARRAY_EVIDENCE: GodotEvidenceCaseFile = {
  godotClass: 'Array',
  compatModule: 'lib/godot-compat/array',
  cases: c.cases,
};

export default ARRAY_EVIDENCE;
