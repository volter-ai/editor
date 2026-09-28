/**
 * The `value as Class` casts the analysis proves always hold: the value's refined type (a scene
 * node's own native class, `refined-types.ts`) is the class or one of its descendants, so the cast is the
 * value itself, a null value included (`OPCODE_CAST_TO_NATIVE` passes null through). Lowering
 * writes such a cast as the value, stated as the class's type, with no test of its class at run
 * time. A type test (`is`) is not one: on null it is false.
 */

import type { GodotApiDump } from './api-dump';
import type { GodotBoundScript } from '../godot-frontend/bound-program';

export function provenCasts(program: GodotBoundScript, apiDump: GodotApiDump): readonly number[] {
  const classes = new Map(apiDump.classes.map((entry) => [entry.name, entry] as const));
  const inherits = (name: string, ancestor: string): boolean => {
    for (let current = classes.get(name); current !== undefined; ) {
      if (current.name === ancestor) return true;
      current = current.base_class === '' ? undefined : classes.get(current.base_class);
    }
    return false;
  };
  return program.nodes.flatMap((node) => {
    if (node.kind !== 'CAST' || node.datatype.kind !== 'NATIVE' || node.datatype.nativeType === '') return [];
    const operand = program.nodes[node.operand];
    const known = operand?.datatype;
    // A script's instance cast to its node's class is the node, another object than the instance.
    if (known === undefined || known.metaType || known.kind !== 'NATIVE' || known.nativeType === '') return [];
    return inherits(known.nativeType, node.datatype.nativeType) ? [node.id] : [];
  });
}
