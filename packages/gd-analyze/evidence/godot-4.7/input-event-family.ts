/** Cases reading one member of an InputEvent record built on both sides from the same fields. */
import type { InputEventRecord } from '../../capabilities/catalog/project-source/src/lib/godot-compat/input-event';
import type { GodotEvidenceCase } from '../../src/evidence/case';
import { gdEvent } from './input-timeline';

export function eventCase(
  id: string,
  owner: string,
  member: string,
  event: InputEventRecord,
  read: (event: InputEventRecord) => unknown,
): GodotEvidenceCase {
  return {
    id,
    symbol: { kind: 'native-member', owner, member },
    gdscript: [...gdEvent('e', event, (name) => name), `return e.${member}()`].join('\n'),
    target: () => read(event),
    comparator: 'exact',
  };
}
