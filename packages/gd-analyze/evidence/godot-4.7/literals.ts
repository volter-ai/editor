/** Shared by case files: GDScript literals with exactly a JS value's meaning, and a case builder. */
import type {
  GodotEvidenceCase,
  GodotEvidenceComparator,
  GodotEvidenceSymbol,
} from '../../src/evidence/case';

/** A GDScript float literal with exactly this double's value. */
export function gd(value: number): string {
  if (Number.isNaN(value)) return 'NAN';
  if (value === Infinity) return 'INF';
  if (value === -Infinity) return '-INF';
  if (Object.is(value, -0)) return '-0.0';
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.0`;
}

/** A GDScript String literal for this JS string. */
export function gs(value: string): string {
  return JSON.stringify(value);
}

/** Collects cases in order and hands out the symbols of one Godot owner. */
export function caseCollector(owner: string) {
  const cases: GodotEvidenceCase[] = [];
  return {
    cases,
    add(
      id: string,
      symbol: GodotEvidenceSymbol,
      gdscript: string,
      target: () => unknown,
      comparator: GodotEvidenceComparator = 'exact',
    ): void {
      cases.push({ id, symbol, gdscript, target, comparator });
    },
    member: (member: string): GodotEvidenceSymbol => ({ kind: 'builtin-member', owner, member }),
    memberSet: (member: string): GodotEvidenceSymbol => ({ kind: 'builtin-member-set', owner, member }),
    constant: (member: string): GodotEvidenceSymbol => ({ kind: 'builtin-constant', owner, member }),
    constructor: { kind: 'builtin-constructor', owner, member: owner } as GodotEvidenceSymbol,
    operator: (member: string, right?: string): GodotEvidenceSymbol => ({
      kind: 'builtin-operator',
      owner,
      member,
      ...(right === undefined ? {} : { right }),
    }),
    utility: (member: string): GodotEvidenceSymbol => ({ kind: 'utility-function', owner, member }),
  };
}
