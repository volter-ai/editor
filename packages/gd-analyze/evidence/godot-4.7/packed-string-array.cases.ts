import * as P from '../../capabilities/catalog/project-source/src/lib/godot-compat/packed-string-array';
import * as S from '../../capabilities/catalog/project-source/src/lib/godot-compat/string';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { caseCollector, gs } from './literals';

const c = caseCollector('PackedStringArray');
c.add('construct-empty', c.constructor, 'PackedStringArray()', () => P.construct());
c.add('size-empty', c.member('size'), 'PackedStringArray().size()', () => P.size(P.construct()));
for (const text of ['', 'a', 'a,b', ',,', 'x,😀,z,']) {
  c.add(`construct-copy-${gs(text)}`, c.constructor, `PackedStringArray(${gs(text)}.split(","))`, () =>
    P.construct(S.split(text, ',')),
  );
  c.add(`size-${gs(text)}`, c.member('size'), `${gs(text)}.split(",").size()`, () => P.size(S.split(text, ',')));
  c.add(`size-no-empty-${gs(text)}`, c.member('size'), `${gs(text)}.split(",", false).size()`, () =>
    P.size(S.split(text, ',', false)),
  );
}

const PACKED_STRING_ARRAY_EVIDENCE: GodotEvidenceCaseFile = {
  godotClass: 'PackedStringArray',
  compatModule: 'lib/godot-compat/packed-string-array',
  cases: c.cases,
};

export default PACKED_STRING_ARRAY_EVIDENCE;
