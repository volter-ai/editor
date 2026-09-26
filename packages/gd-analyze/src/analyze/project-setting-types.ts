/**
 * The type of `ProjectSettings.get_setting("<literal key>")`, fixed by project facts.
 *
 * Godot's analyzer types the call as Variant; the value it returns at run time is the project's
 * setting, which a project fixes before any script runs: the value `project.godot` declares for the
 * key, else the default Godot registers for it (`GLOBAL_DEF`, read from the official binary into
 * `vendor/project-settings/godot-4.7.json`). This rule (`project-setting-type`) types the call as
 * that value's Variant type, and an operator over such calls as the result type the API dump states
 * for that overload (`Variant::get_operator_return_type`). A key that is not a literal, or has no
 * declared value and no registered default, stays Variant.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { GodotBoundNode, GodotBoundScript } from '../godot-frontend/bound-program';
import type { GodotValue } from '../read/godot-value';
import { parseGodotTextFile } from '../read/text-format';
import type { GodotApiDump } from './api-dump';

export interface BoundGodotTypedValue {
  readonly nodeId: number;
  /** The Variant type name (`float`, `Vector3`). */
  readonly builtinType: string;
  /** For a `get_setting` call itself: the setting and the value project facts fix for it. */
  readonly setting?: { readonly key: string; readonly value: GodotValue };
  readonly evidenceClaimIds: readonly string[];
}

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..');
let registered: ReadonlyMap<string, string> | undefined;

let registeredValues: ReadonlyMap<string, string> | undefined;

/**
 * A registered setting's default value, parsed from the text `var_to_str` wrote for it (the syntax
 * `project.godot` uses), or undefined for an unregistered key.
 */
export function registeredSettingValue(key: string): GodotValue | undefined {
  if (registeredValues === undefined) {
    const file = JSON.parse(
      readFileSync(path.join(PACKAGE_ROOT, 'vendor/project-settings/godot-4.7.json'), 'utf8'),
    ) as { readonly values: Readonly<Record<string, string>> };
    registeredValues = new Map(Object.entries(file.values));
  }
  const text = registeredValues.get(key);
  return text === undefined ? undefined : parseSettingValueText(text);
}

/** A setting value written in `project.godot`'s text syntax, read as the project reader reads it. */
export function parseSettingValueText(text: string): GodotValue | undefined {
  return parseGodotTextFile(`[setting]\nvalue = ${text}\n`, 'res://project.godot').sections[0]?.properties['value'];
}

/** The value project facts fix for a setting: the declared one, else the registered default. */
export function projectSettingValue(
  projectSettings: ReadonlyMap<string, GodotValue>,
  key: string,
): GodotValue | undefined {
  return projectSettings.get(key) ?? registeredSettingValue(key);
}

/** Godot 4.7's registered settings and the Variant type of each registered default. */
export function registeredSettingTypes(): ReadonlyMap<string, string> {
  if (registered === undefined) {
    const file = JSON.parse(
      readFileSync(path.join(PACKAGE_ROOT, 'vendor/project-settings/godot-4.7.json'), 'utf8'),
    ) as { readonly types: Readonly<Record<string, string>> };
    registered = new Map(Object.entries(file.types));
  }
  return registered;
}

/** The Variant type a serialized value has, when the text says it exactly. */
export function variantTypeOfValue(value: GodotValue): string | undefined {
  switch (value.kind) {
    case 'bool':
      return 'bool';
    case 'string':
      return 'String';
    case 'number':
      return value.variantType;
    case 'ctor':
      return value.name;
    case 'array':
      return 'Array';
    default:
      return undefined;
  }
}

/** `Variant::Operator` values the bound program records, spelled as the API dump spells them. */
export const OPERATOR_SPELLING: Readonly<Record<number, string>> = {
  0: '==',
  1: '!=',
  2: '<',
  3: '<=',
  4: '>',
  5: '>=',
  6: '+',
  7: '-',
  8: '*',
  9: '/',
  10: 'unary-',
  11: 'unary+',
  12: '%',
};

export function typeProjectSettingValues(inputs: {
  readonly program: GodotBoundScript;
  /** The settings `project.godot` authors; every other key takes its registered default. */
  readonly projectSettings: ReadonlyMap<string, GodotValue>;
  readonly apiDump: GodotApiDump;
  /** The rule's live claim; asked only when a value is typed, so an unused rule is not recorded. */
  readonly claim: () => string | undefined;
}): readonly BoundGodotTypedValue[] {
  const nodes = inputs.program.nodes;
  const builtins = new Map((inputs.apiDump.builtinClasses ?? []).map((entry) => [entry.name, entry] as const));
  const typed = new Map<number, string>();
  const settings = new Map<number, { readonly key: string; readonly value: GodotValue }>();
  const settingType = (node: GodotBoundNode): string | undefined => {
    if (node.kind !== 'CALL' || node.functionName !== 'get_setting') return undefined;
    const target = node.compilerTarget;
    if (target.owner !== 'ProjectSettings' || target.member !== 'get_setting') return undefined;
    if (node.arguments.length !== 1) return undefined;
    const argument = nodes[node.arguments[0] as number];
    if (argument?.kind !== 'LITERAL') return undefined;
    const key = argument.reduced ? argument.reducedValue : argument.value;
    if (key.kind !== 'string' && key.kind !== 'string-name') return undefined;
    const declared = inputs.projectSettings.get(key.value);
    const type = declared === undefined ? registeredSettingTypes().get(key.value) : variantTypeOfValue(declared);
    const value = projectSettingValue(inputs.projectSettings, key.value);
    if (type !== undefined && value !== undefined) settings.set(node.id, { key: key.value, value });
    return type;
  };
  const typeOf = (id: number): string | undefined => {
    const known = typed.get(id);
    if (known !== undefined) return known;
    const node = nodes[id];
    if (node === undefined) return undefined;
    if (node.datatype.kind === 'BUILTIN' && !node.datatype.metaType) return node.datatype.builtinType;
    let result: string | undefined;
    if (node.kind === 'CALL') result = settingType(node);
    else if (node.kind === 'BINARY_OPERATOR' && node.datatype.kind === 'VARIANT') {
      const left = typeOf(node.leftOperand);
      const right = typeOf(node.rightOperand);
      const spelling = OPERATOR_SPELLING[node.variantOperatorId];
      if (left !== undefined && right !== undefined && spelling !== undefined) {
        result = builtins
          .get(left)
          ?.operatorSignatures?.find((entry) => entry.name === spelling && entry.rightType === right)
          ?.returnType;
      }
    }
    if (result !== undefined) typed.set(id, result);
    return result;
  };
  for (const node of nodes) {
    if (node.kind === 'CALL' || node.kind === 'BINARY_OPERATOR') typeOf(node.id);
  }
  if (typed.size === 0) return [];
  const claim = inputs.claim();
  if (claim === undefined) return [];
  return [...typed.entries()]
    .sort(([left], [right]) => left - right)
    .map(([nodeId, builtinType]) => {
      const setting = settings.get(nodeId);
      return { nodeId, builtinType, ...(setting === undefined ? {} : { setting }), evidenceClaimIds: [claim] };
    });
}
