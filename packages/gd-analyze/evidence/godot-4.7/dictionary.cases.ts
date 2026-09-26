import * as D from '../../capabilities/catalog/project-source/src/lib/godot-compat/dictionary';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { caseCollector } from './literals';

const c = caseCollector('Dictionary');
/** The same dictionary literal in GDScript and as a JS Map in insertion order. */
const DICTIONARIES: readonly (readonly [string, string, () => Map<unknown, unknown>])[] = [
  ['empty', '{}', () => new Map()],
  ['strings', '{"b": 1, "a": 2, "c": 3}', () => new Map<unknown, unknown>([['b', 1], ['a', 2], ['c', 3]])],
  ['ints', '{3: "x", -1: "y", 0: null}', () => new Map<unknown, unknown>([[3, 'x'], [-1, 'y'], [0, null]])],
  ['mixed', '{"k": [1], true: false, null: 2.5}', () => new Map<unknown, unknown>([['k', [1]], [true, false], [null, 2.5]])],
];
const KEYS: readonly (readonly [string, string, unknown])[] = [
  ['string-a', '"a"', 'a'],
  ['name-a', '&"a"', 'a'],
  ['string-z', '"z"', 'z'],
  ['int-3', '3', 3],
  ['int-0', '0', 0],
  ['true', 'true', true],
  ['null', 'null', null],
];

c.add('construct-empty', c.constructor, 'Dictionary()', () => D.construct());
for (const [name, gd, js] of DICTIONARIES) {
  c.add(`construct-from-${name}`, c.constructor, `Dictionary(${gd})`, () => D.construct(js()));
  c.add(`is_empty-${name}`, c.member('is_empty'), `${gd}.is_empty()`, () => D.is_empty(js()));
  c.add(`keys-${name}`, c.member('keys'), `${gd}.keys()`, () => D.keys(js()));
  for (const [keyName, gdKey, jsKey] of KEYS) {
    c.add(`has-${name}-${keyName}`, c.member('has'), `${gd}.has(${gdKey})`, () => D.has(js(), jsKey));
    c.add(`get-${name}-${keyName}`, c.member('get'), `${gd}.get(${gdKey})`, () => D.get(js(), jsKey));
    c.add(`get-default-${name}-${keyName}`, c.member('get'), `${gd}.get(${gdKey}, 7)`, () => D.get(js(), jsKey, 7));
    c.add(`erase-result-${name}-${keyName}`, c.member('erase'), `var d := ${gd}\nreturn d.erase(${gdKey})`, () => D.erase(js(), jsKey));
    c.add(`erase-rest-${name}-${keyName}`, c.member('erase'), `var d := ${gd}\nd.erase(${gdKey})\nreturn d`, () => {
      const d = js();
      D.erase(d, jsKey);
      return d;
    });
  }
}
c.add('construct-from-shares', c.constructor, 'var a := {"x": 1}\nvar b := Dictionary(a)\nb.erase("x")\nreturn a', () => {
  const a = new Map<unknown, unknown>([['x', 1]]);
  D.erase(D.construct(a), 'x');
  return a;
});
c.add('erase-shared', c.member('erase'), 'var a := {"x": 1, "y": 2}\nvar b := a\nb.erase("x")\nreturn a.keys()', () => {
  const a = new Map<unknown, unknown>([['x', 1], ['y', 2]]);
  const b = a;
  D.erase(b, 'x');
  return D.keys(a);
});
c.add('keys-order-after-erase', c.member('keys'), 'var d := {"a": 1, "b": 2, "c": 3}\nd.erase("a")\nd["a"] = 4\nreturn d.keys()', () => {
  const d = new Map<unknown, unknown>([['a', 1], ['b', 2], ['c', 3]]);
  D.erase(d, 'a');
  d.set('a', 4);
  return D.keys(d);
});

const DICTIONARY_EVIDENCE: GodotEvidenceCaseFile = {
  godotClass: 'Dictionary',
  compatModule: 'lib/godot-compat/dictionary',
  cases: c.cases,
};

export default DICTIONARY_EVIDENCE;
