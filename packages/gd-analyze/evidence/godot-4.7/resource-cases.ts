/** Shared by resource case files: a native-member case whose body builds a resource and returns reads of it. */
import type { GodotEvidenceCase } from '../../src/evidence/case';
import { gd } from './literals';

export type Triple = readonly [number, number, number];
export const gv = ([x, y, z]: Triple): string => `Vector3(${gd(x)}, ${gd(y)}, ${gd(z)})`;
export const gva = (points: readonly Triple[]): string => `PackedVector3Array([${points.map(gv).join(', ')}])`;

export function resourceCases(owner: string) {
  const cases: GodotEvidenceCase[] = [];
  return {
    cases,
    add(id: string, member: string, gdscript: readonly string[], target: () => unknown): void {
      cases.push({ id, symbol: { kind: 'native-member', owner, member }, gdscript: gdscript.length === 1 ? (gdscript[0] as string).replace(/^return /u, '') : gdscript.join('\n'), target, comparator: 'exact' });
    },
  };
}
