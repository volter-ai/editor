/**
 * The binding table, derived from compat itself (docs/GODOT.md §The lane's law, ruling 2): every
 * compat export whose doc names a Godot member (`@godot Class.member`, not `(protocol)`) binds
 * that member. What kind of member it is comes from the pinned API dump, and which right operands
 * an operator takes from the export's own signature. Compat implementing a member is what makes it
 * bound; there is no other record.
 */
import { GODOT_UNDUMPED_MEMBERS } from '../data/lowering-shapes';
import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GDSCRIPT_4_BUILTIN_FUNCTIONS } from '../../analyze/api-dump';
import { godotOperandTypes } from '../data/operand-types';
import { INTERNAL_PROPERTY_SETTERS } from '../data/scene-setters';
import type { GodotBindingEntry, GodotOfficialSymbolIdentity, GodotTargetBindingUse } from './bindings';
import type { GodotDatatypeRuleEntry } from './lowering-rules';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const COMPAT_DIR = path.join(PACKAGE_ROOT, 'capabilities/catalog/project-source/src/lib/godot-compat');

interface ApiMethod {
  readonly name: string;
  readonly hash?: number;
  readonly is_static?: boolean;
}
interface ApiDump {
  readonly utility_functions: readonly { readonly name: string; readonly hash: number }[];
  readonly singletons: readonly { readonly name: string; readonly type: string }[];
  readonly builtin_classes: readonly {
    readonly name: string;
    readonly indexing_return_type?: string;
    readonly methods?: readonly ApiMethod[];
    readonly members?: readonly { readonly name: string }[];
    readonly constants?: readonly { readonly name: string }[];
    readonly operators?: readonly { readonly name: string; readonly right_type?: string }[];
  }[];
  readonly classes: readonly {
    readonly name: string;
    readonly methods?: readonly ApiMethod[];
    readonly signals?: readonly { readonly name: string }[];
    readonly properties?: readonly { readonly setter?: string; readonly getter?: string }[];
  }[];
}

interface CompatExport {
  readonly module: string;
  readonly exportName: string;
  readonly owner: string;
  readonly member: string;
  /** Each signature's second parameter type, as written (operators). */
  readonly rightTypes: readonly string[];
  readonly isConst: boolean;
}

/** Every bound export of every compat module. */
function compatExports(): CompatExport[] {
  const found: CompatExport[] = [];
  for (const file of readdirSync(COMPAT_DIR).filter((name) => /\.tsx?$/u.test(name)).sort()) {
    const text = readFileSync(path.join(COMPAT_DIR, file), 'utf8');
    const module = `lib/godot-compat/${file.replace(/\.tsx?$/u, '')}`;
    const pattern = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*export\s+(?:async\s+)?(function|const)\s+([A-Za-z_$][\w$]*)/g;
    for (const match of text.matchAll(pattern)) {
      const doc = match[1] as string;
      const tag = /@godot\s+(\S+)(\s+\(protocol\))?/u.exec(doc);
      if (tag === null || tag[2] !== undefined) continue;
      const godot = tag[1] as string;
      const dot = godot.indexOf('.');
      if (dot <= 0) continue;
      const exportName = match[3] as string;
      // The second parameter of every signature the export declares (an overload set repeats it).
      const signatures = [...text.matchAll(new RegExp(`export\\s+function\\s+${exportName}\\s*\\(([^)]*)\\)`, 'gu'))];
      const rightTypes = signatures.flatMap((signature) => {
        const params = (signature[1] as string).split(/,(?![^<]*>)/u);
        const right = params[1]?.split(':')[1]?.trim();
        return right === undefined ? [] : right.split('|').map((part) => part.trim());
      });
      found.push({ module, exportName, owner: godot.slice(0, dot), member: godot.slice(dot + 1), rightTypes, isConst: match[2] === 'const' });
    }
  }
  return found;
}


const hashSignature = (hash: number | undefined) => (hash === undefined || hash === 0 ? 'unhashed' : `hash:${String(hash)}`);

/**
 * The binding entries for every bound compat export, and the exports whose tag names no member of
 * the pinned API dump (reported, never bound).
 */
export function godotCompatBindings(
  sourceRevision: string,
  apiDump: ApiDump,
): { readonly entries: readonly GodotBindingEntry[]; readonly unmatched: readonly string[] } {
  const builtins = new Map(apiDump.builtin_classes.map((entry) => [entry.name, entry] as const));
  const classes = new Map(apiDump.classes.map((entry) => [entry.name, entry] as const));
  const singletons = new Set(apiDump.singletons.map((entry) => entry.name));
  const utilities = new Map(apiDump.utility_functions.map((entry) => [entry.name, entry.hash] as const));
  const entries: GodotBindingEntry[] = [];
  const unmatched: string[] = [];
  for (const entry of compatExports()) {
    const { owner, member } = entry;
    const bind = (kind: GodotOfficialSymbolIdentity['kind'], signature: string, use: GodotTargetBindingUse) =>
      entries.push({
        source: { sourceRevision, kind, owner, member, signature },
        target: {
          kind: 'compat-binding',
          capabilityId: 'godot-compat',
          module: entry.module,
          exportName: entry.exportName,
          // A lexical name: `@GlobalScope` contributes `GlobalScope`.
          localName: `${owner.replace(/[^$\w]/gu, '')}_${entry.exportName}`,
          use,
        },
      });
    const builtin = builtins.get(owner);
    const native = classes.get(owner);
    if (owner === '@GlobalScope' && utilities.has(member)) {
      bind('global', hashSignature(utilities.get(member)), { kind: 'call', sourceReceiver: 'absent' });
    } else if (owner === '@GDScript' && GDSCRIPT_4_BUILTIN_FUNCTIONS.includes(member)) {
      // GDScript's own utilities are not in the dump, so they carry no hash: one signature each.
      bind('global', 'unhashed', { kind: 'call', sourceReceiver: 'absent' });
    } else if (builtin !== undefined) {
      const method = builtin.methods?.find((candidate) => candidate.name === member);
      if (member === owner) bind('builtin-constructor', 'unhashed', { kind: 'call', sourceReceiver: 'absent' });
      else if (member.startsWith('OP_')) {
        const offered = new Set((builtin.operators ?? []).filter((operator) => operator.name === operatorName(member)).map((operator) => operator.right_type ?? ''));
        if (entry.rightTypes.length === 0 && offered.has('')) bind('builtin-operator', 'unary', { kind: 'call', sourceReceiver: 'absent' });
        // An `unknown` right operand takes whatever the operator is offered with (`String %`).
        for (const right of new Set(entry.rightTypes.flatMap((type) => (type === 'unknown' ? [...offered] : godotOperandTypes(type))))) {
          if (offered.has(right)) bind('builtin-operator', `right:${right}`, { kind: 'call', sourceReceiver: 'absent' });
        }
      } else if (entry.isConst && builtin.constants?.some((constant) => constant.name === member)) {
        bind('builtin-constant', 'constant', { kind: 'value' });
      } else if (method !== undefined) {
        if (method.is_static === true) bind('builtin-static', hashSignature(method.hash), { kind: 'call', sourceReceiver: 'absent' });
        else bind('builtin-member', hashSignature(method.hash), { kind: 'call', sourceReceiver: 'first-argument' });
      } else if (builtin.members?.some((field) => field.name === member) && entry.exportName === `with_${member}`) {
        bind('builtin-member-set', 'set', { kind: 'call', sourceReceiver: 'first-argument' });
      } else if (member === 'set_indexed' && builtin.indexing_return_type !== undefined && entry.exportName === 'with_indexed') {
        // `Variant::set_indexed` on a built-in the dump gives an indexed element type.
        bind('builtin-indexed-set', 'set', { kind: 'call', sourceReceiver: 'first-argument' });
      } else unmatched.push(`${owner}.${member} (${entry.module} ${entry.exportName})`);
    } else if (GODOT_UNDUMPED_MEMBERS.has(`${owner}.${member}`)) {
      // A member the dump does not list (`Object.free`, `lowering-shapes.ts`): one signature.
      bind('native-member', 'unhashed', { kind: 'call', sourceReceiver: 'first-argument' });
    } else if (native !== undefined) {
      const method = native.methods?.find((candidate) => candidate.name === member);
      // A property's accessor, including the internal ones the dump leaves out (`Curve._set_data`).
      const accessor =
        native.properties?.some((property) => property.setter === member || property.getter === member) === true ||
        Object.values(INTERNAL_PROPERTY_SETTERS[owner] ?? {}).includes(member);
      if (member === owner && entry.exportName === 'construct') {
        bind('native-class', 'GDScriptNativeClass', { kind: 'call', sourceReceiver: 'absent' });
      } else if (native.signals?.some((signal) => signal.name === member)) {
        bind('native-signal', 'signal', { kind: 'call', sourceReceiver: 'first-argument' });
      } else if (method !== undefined || accessor) {
        const receiverless = singletons.has(owner) || method?.is_static === true;
        bind('native-member', hashSignature(method?.hash), { kind: 'call', sourceReceiver: receiverless ? 'absent' : 'first-argument' });
      } else unmatched.push(`${owner}.${member} (${entry.module} ${entry.exportName})`);
    } else unmatched.push(`${owner}.${member} (${entry.module} ${entry.exportName})`);
  }
  return { entries, unmatched };
}

/** `OP_ADD` names Godot's `+`: the dump spells operators by their symbol. */
function operatorName(member: string): string {
  const symbols: Readonly<Record<string, string>> = {
    OP_EQUAL: '==', OP_NOT_EQUAL: '!=', OP_LESS: '<', OP_LESS_EQUAL: '<=', OP_GREATER: '>', OP_GREATER_EQUAL: '>=',
    OP_ADD: '+', OP_SUBTRACT: '-', OP_MULTIPLY: '*', OP_DIVIDE: '/', OP_NEGATE: 'unary-', OP_POSITIVE: 'unary+',
    OP_MODULE: '%', OP_POWER: '**', OP_SHIFT_LEFT: '<<', OP_SHIFT_RIGHT: '>>', OP_BIT_AND: '&', OP_BIT_OR: '|',
    OP_BIT_XOR: '^', OP_BIT_NEGATE: '~', OP_AND: 'and', OP_OR: 'or', OP_XOR: 'xor', OP_NOT: 'not', OP_IN: 'in',
  };
  return symbols[member] ?? member;
}

/**
 * The datatype rules compat's built-in value types give: a module whose header names a built-in
 * class (`@godot-class Vector3`) and which exports an interface of that name is that type's target.
 */
export function godotCompatDatatypes(sourceRevision: string, apiDump: ApiDump): readonly GodotDatatypeRuleEntry[] {
  const builtins = new Set(apiDump.builtin_classes.map((entry) => entry.name));
  const found: GodotDatatypeRuleEntry[] = [];
  for (const file of readdirSync(COMPAT_DIR).filter((name) => /\.tsx?$/u.test(name)).sort()) {
    const text = readFileSync(path.join(COMPAT_DIR, file), 'utf8');
    const className = /@godot-class\s+(\S+)/u.exec(text)?.[1];
    if (className === undefined || !builtins.has(className)) continue;
    if (!new RegExp(`^export\\s+interface\\s+${className}\\b`, 'mu').test(text)) continue;
    found.push({
      sourceRevision,
      sourceDatatype: `BUILTIN:${className}`,
      targetType: { kind: 'type-reference', name: className, arguments: [] },
      typeImport: { module: `lib/godot-compat/${file.replace(/\.tsx?$/u, '')}`, exportName: className },
    });
  }
  return found;
}
