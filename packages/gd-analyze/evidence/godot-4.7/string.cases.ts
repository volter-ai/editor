import * as S from '../../capabilities/catalog/project-source/src/lib/godot-compat/string';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { caseCollector, gs } from './literals';

const c = caseCollector('String');
// Constructors: none, from a String, from a StringName, from a NodePath (their text).
c.add('construct-empty', c.constructor, 'String()', () => S.construct());
c.add('construct-string', c.constructor, 'String("left")', () => S.construct('left'));
c.add('construct-string-name', c.constructor, 'String(&"move_right")', () => S.construct('move_right'));
c.add('construct-node-path', c.constructor, 'String(^"../GridMap")', () => S.construct('../GridMap'));
const TEXTS = ['', 'a,b,c', ',a,,b,', 'no delimiter', 'aaa', '  padded \t\n', 'x::y::z', 'é,ü,😀,ß', '😀😀', ',,'];
const SPLITTERS = ['', ',', '::', 'a', 'zz', '😀'];

for (const text of TEXTS) {
  const g = gs(text);
  c.add(`split-default-${g}`, c.member('split'), `${g}.split()`, () => S.split(text));
  for (const splitter of SPLITTERS) {
    for (const allow of [true, false]) {
      for (const maxsplit of [0, 1, 2, -1]) {
        c.add(
          `split-${g}-${gs(splitter)}-${String(allow)}-${String(maxsplit)}`,
          c.member('split'),
          `${g}.split(${gs(splitter)}, ${String(allow)}, ${String(maxsplit)})`,
          () => S.split(text, splitter, allow, maxsplit),
        );
      }
    }
  }
  for (const [left, right] of [
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ] as const) {
    c.add(`strip_edges-${g}-${String(left)}-${String(right)}`, c.member('strip_edges'), `${g}.strip_edges(${String(left)}, ${String(right)})`, () =>
      S.strip_edges(text, left, right),
    );
  }
  c.add(`strip_edges-default-${g}`, c.member('strip_edges'), `${g}.strip_edges()`, () => S.strip_edges(text));
}
for (const text of ['\u0001\u0002 x \u001f ', ' x ', '　y']) {
  c.add(`strip_edges-controls-${gs(text)}`, c.member('strip_edges'), `${gs(text)}.strip_edges()`, () => S.strip_edges(text));
}
for (const [left, right] of [
  ['', ''],
  ['a', 'b'],
  ['é', '😀'],
  ['abc', 'abc'],
  ['abc', 'abd'],
  ['😀', '😀'],
] as const) {
  c.add(`op_add-${gs(left)}-${gs(right)}`, c.operator('OP_ADD', 'String'), `${gs(left)} + ${gs(right)}`, () => S.op_add(left, right));
  c.add(`op_add-name-${gs(left)}-${gs(right)}`, c.operator('OP_ADD', 'StringName'), `${gs(left)} + &${gs(right)}`, () =>
    S.op_add(left, right),
  );
  c.add(`op_equal-${gs(left)}-${gs(right)}`, c.operator('OP_EQUAL', 'String'), `${gs(left)} == ${gs(right)}`, () =>
    S.op_equal(left, right),
  );
  c.add(`op_equal-name-${gs(left)}-${gs(right)}`, c.operator('OP_EQUAL', 'StringName'), `${gs(left)} == &${gs(right)}`, () =>
    S.op_equal(left, right),
  );
}

const STRING_EVIDENCE: GodotEvidenceCaseFile = {
  godotClass: 'String',
  compatModule: 'lib/godot-compat/string',
  cases: c.cases,
};

export default STRING_EVIDENCE;
