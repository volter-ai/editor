/**
 * analyze/api-dump.ts — ONE model of Godot's class surface, and the TWO on-disk shapes that
 * normalize into it.
 *
 * The lane vendors two pinned artifacts, because Godot publishes two (see
 * `vendor/extension-api/UPSTREAM.md`):
 *
 * - **Godot 3** publishes `api.json`, the GDNative class dump — a flat JSON **array** of class
 *   records. `godot-3.6.2-api.json`.
 * - **Godot 4** publishes `extension_api.json`, the GDExtension ABI description — a JSON
 *   **object** (`{ header, builtin_classes, classes, singletons, utility_functions, … }`).
 *   `godot-4.7-extension_api.json`.
 *
 * Everything above this module — `api-registry.ts`'s indexes, `api-surface.ts`'s walker,
 * `project-index.ts`, `translate/` — is written ONCE against {@link GodotApiDump}. The single
 * version branch in this package's analysis path is {@link parseGodotApiDump}'s dispatch, which is
 * the same shape `read/godot-project.ts` uses to pick a GDScript front end (`settings.engine.major`)
 * and `translate/rendering.ts` uses to pick a renderer. A permissive parser that accepted either
 * shape into one code path is exactly how a Godot 4 file gets read as a Godot 3 one and every
 * dump-membership answer comes out wrong in both directions; so a MISMATCH is refused by name.
 *
 * ## What normalization does, and the one place it adds rather than renames
 *
 * Most of the 4.x delta is spelling: `inherits` for `base_class`, `is_instantiable` for
 * `instanciable`, a top-level `singletons` array instead of a per-class `singleton` flag, arrays of
 * `{name, value}` where 3.x wrote objects, `return_value.type` where 3.x wrote `return_type`.
 * Those are renames and this module renames them.
 *
 * ONE difference is not a rename and it is measured, not assumed: **Godot 3's `constants` object
 * already contains every enum's value names** (`Node.PAUSE_MODE_STOP` is in both `constants` and
 * `enums`; 10 of 10 of `Node`'s enum values are in its `constants`), and **Godot 4's does not**
 * (0 of 26 of `Node`'s). A script writes `Node.PROCESS_MODE_ALWAYS` the same way in either
 * dialect, so the 4.x normalizer FOLDS each enum's value names into `constants` — which is not
 * inventing anything, it is writing down in one place what the 4.x dump states in two, so that
 * `isKnownMemberName`, `soleDeclarer` and `resolveDeclaringMember` answer identically across
 * dialects instead of silently missing every Godot 4 enum constant.
 *
 * ## Type SPELLINGS are carried verbatim, deliberately
 *
 * Godot 4 spells composite types `enum::Error`, `bitfield::PropertyUsageFlags`,
 * `typedarray::Node`, `typeddictionary::String;Variant`, and its native-structure pointers
 * `AudioFrame*` / `const void*`. None of them is rewritten here. A spelling that names no class is
 * a member whose result type does not resolve, which is the honest-miss direction this package
 * already takes for Godot 3's own `enum.Node::PauseMode` spellings — and inventing a mapping for
 * one dialect that the other does not have is the divergence two front ends over one AST were
 * built to avoid. What a miss costs is a degraded result type, never a fabricated row.
 *
 * ## The Variant surface: 3.x cannot enumerate it, 4.x can
 *
 * `api.json` models Object-derived CLASSES only, so `api-registry.ts` derives the Variant type
 * NAMES as the difference between types the dump references and types it declares.
 * `extension_api.json` DECLARES them (`builtin_classes`: 38 entries, `Vector3`, `Color`, `Array`,
 * `PackedVector3Array`, …), which is strictly better evidence — so a 4.x dump carries
 * {@link GodotApiDump.declaredBuiltinTypeNames} and the derivation is skipped. The difference
 * derivation would be actively WRONG on a 4.x file: it also picks up `const uint8_t*` and eleven
 * other C pointer spellings out of `native_structures`, which name nothing a script can touch.
 *
 * Godot 4's Variant members are normalized from `builtin_classes` and consumed by the source-down
 * completion ledger. Godot 3 still has no equivalent block; its missing source-derived Variant
 * member inventory remains an explicit denominator-open row until generated from the pinned
 * `core/variant` and GDScript source.
 */

/** The engine major a dump describes. Two artifacts, two shapes, one model. */
export type GodotMajor = 3 | 4;

/** One method record. Only the fields this package reads are typed; both dumps have more. */
export interface GodotApiMethod {
  readonly name: string;
  /** Godot 4 omits `return_value` for a void method; the normalizer writes `'void'`, which is
   *  what Godot 3 spells. */
  readonly return_type: string;
  readonly is_virtual: boolean;
  /** Godot 4's method-bind hash, the identity the official compiler records for a selected call. */
  readonly hash?: number;
  readonly arguments: readonly {
    readonly name: string;
    readonly type: string;
    /** Presence, rather than the parsed value, is the exact minimum-arity fact consumers need. */
    readonly hasDefault?: boolean;
  }[];
}

export interface GodotApiProperty {
  readonly name: string;
  readonly type: string;
  /** Godot 3's api.json keeps the ClassDB accessor names on every property. */
  readonly getter?: string;
  readonly setter?: string;
  /** An indexed property's index (`ADD_PROPERTYI`): its accessors take it before the value. */
  readonly index?: number;
}

export interface GodotApiSignal {
  readonly name: string;
  readonly arguments: readonly { readonly name: string; readonly type: string }[];
}

export interface GodotApiEnum {
  readonly name: string;
  readonly values: Readonly<Record<string, number>>;
}

export interface GodotApiClass {
  readonly name: string;
  /** Editor-only classes cannot exist in an exported game and are explicit checklist exclusions. */
  readonly apiType: 'core' | 'editor';
  /** `''` for the root (`Object`), which Godot 4 spells by omitting `inherits` entirely. */
  readonly base_class: string;
  readonly singleton: boolean;
  readonly singleton_name: string;
  /** Whether `ClassName.new()` is legal — the dump's own flag, which is what licenses a
   *  `construct` touch row. */
  readonly instanciable: boolean;
  readonly constants: Readonly<Record<string, number>>;
  readonly properties: readonly GodotApiProperty[];
  readonly signals: readonly GodotApiSignal[];
  readonly methods: readonly GodotApiMethod[];
  readonly enums: readonly GodotApiEnum[];
}

/** Godot 4's published Variant/builtin surface. Godot 3's api.json has no equivalent block. */
export interface GodotApiBuiltinClass {
  readonly name: string;
  readonly members: readonly GodotApiProperty[];
  /** Built-in constants carry their Variant type in Godot 4's extension API. This is load-bearing:
   *  `Vector2.ZERO` is a Vector2 value, not the integer shape of Object-class constants. */
  readonly constants: readonly GodotApiProperty[];
  readonly methods: readonly GodotApiMethod[];
  readonly enums: readonly GodotApiEnum[];
  readonly hasConstructor: boolean;
  /** Godot 4 publishes every Variant constructor overload. Retaining the argument contracts keeps
   * source evaluation from licensing a conversion merely because the type has some constructor. */
  readonly constructors?: readonly {
    readonly arguments: readonly {
      readonly name: string;
      readonly type: string;
      readonly hasDefault?: boolean;
    }[];
  }[];
  /** Operator spellings; overload signatures remain in the pinned dump and are not normalized. */
  readonly operators: readonly string[];
  /** What `value[index]` yields (`Basis` → `Vector3`), where the type is indexable. */
  readonly indexingReturnType?: string;
  /** Every operator overload: its spelling, right operand type (absent: unary) and result type. */
  readonly operatorSignatures?: readonly {
    readonly name: string;
    readonly rightType?: string;
    readonly returnType: string;
  }[];
}

/**
 * A whole pinned dump, normalized. Carries the engine major it describes, because a dump with no
 * version is a dump whose answers cannot be attributed — `Node3D` is a real class in one and a
 * misspelling in the other.
 */
export interface GodotApiDump {
  readonly major: GodotMajor;
  readonly classes: readonly GodotApiClass[];
  /** Present for Godot 4, whose extension API publishes Variant members; absent for Godot 3. */
  readonly builtinClasses?: readonly GodotApiBuiltinClass[];
  /**
   * Every function a script may call with no receiver. Godot 4 CARRIES most of this
   * (`utility_functions`); Godot 3 does not carry any of it. See {@link GODOT_3_GLOBAL_FUNCTIONS}
   * and {@link GDSCRIPT_4_BUILTIN_FUNCTIONS} for exactly which half is which, and for the failure
   * direction of a miss.
   */
  readonly globalFunctions: ReadonlySet<string>;
  /** Declared utility-function return types where the pinned dump publishes them (Godot 4). */
  readonly globalFunctionReturnTypes?: ReadonlyMap<string, string>;
  /** Bare constants in GDScript's global scope. */
  readonly globalConstants: readonly string[];
  /** Numeric values for the bare constants. Kept beside the names so emission never re-parses or
   *  remembers a version-specific enum table. */
  readonly globalConstantValues: Readonly<Record<string, number>>;
  /** Named global enums. Godot 3's dump flattens their values and publishes no enum records. */
  readonly globalEnums: readonly GodotApiEnum[];
  /** Godot 4's `builtin_classes` names — the Variant types, DECLARED. Absent on a Godot 3 dump,
   *  which declares none and where `api-registry.ts` derives them instead. */
  readonly declaredBuiltinTypeNames?: ReadonlySet<string>;
  /**
   * Godot's KEYBOARD keycode enum, keyed by the NUMBER and valued by Godot's own constant name
   * (`4194319` -> `KEY_LEFT` at the 4.7 pin, `16777231` -> `KEY_LEFT` at the 3.6 one).
   *
   * It is read rather than remembered for the same reason `globalFunctions` is, and it is the ONE
   * table that makes `translate/data/input-map.ts` a single table across both dialects: the two engines
   * agree on every constant NAME and disagree on almost every VALUE, because Godot 4 moved the
   * special-key block from `0x1000000` to `0x400000`. A second numeric table beside the first is
   * the fork `translate/data/dialect.ts`'s header refuses, so the emitter's table is keyed by the name
   * and the numbers come from whichever dump the project's own declared engine major selects.
   */
  readonly keyCodes: ReadonlyMap<number, string>;
}

export class GodotApiDumpError extends Error {
  constructor(message: string) {
    super(`godot api dump: ${message}`);
    this.name = 'GodotApiDumpError';
  }
}

/**
 * `@GDScript`'s global functions in **Godot 3** — the built-in function namespace `api.json` does
 * NOT contain (it models Object-derived classes only). This is therefore a hand-enumerated set,
 * and it is enumerated rather than pattern-matched so that a global it misses surfaces as an
 * unresolved touch instead of being silently classified as game data.
 */
const GODOT_3_GLOBAL_FUNCTIONS: ReadonlySet<string> = new Set([
  'abs',
  'acos',
  'asin',
  'assert',
  'atan',
  'atan2',
  'bytes2var',
  'cartesian2polar',
  'ceil',
  'char',
  'clamp',
  'convert',
  'cos',
  'cosh',
  'db2linear',
  'decimals',
  'dectime',
  'deg2rad',
  'dict2inst',
  'ease',
  'exp',
  'floor',
  'fmod',
  'fposmod',
  'funcref',
  'get_stack',
  'hash',
  'inst2dict',
  'instance_from_id',
  'inverse_lerp',
  'is_equal_approx',
  'is_inf',
  'is_instance_valid',
  'is_nan',
  'is_zero_approx',
  'len',
  'lerp',
  'lerp_angle',
  'linear2db',
  'load',
  'log',
  'max',
  'min',
  'move_toward',
  'nearest_po2',
  'ord',
  'parse_json',
  'polar2cartesian',
  'posmod',
  'pow',
  'preload',
  'print',
  'print_debug',
  'print_stack',
  'printerr',
  'printraw',
  'prints',
  'printt',
  'push_error',
  'push_warning',
  'rad2deg',
  'rand_range',
  'rand_seed',
  'randf',
  'randi',
  'randomize',
  'range',
  'range_lerp',
  'round',
  'seed',
  'sign',
  'sin',
  'sinh',
  'smoothstep',
  'sqrt',
  'step_decimals',
  'stepify',
  'str',
  'str2var',
  'tan',
  'tanh',
  'to_json',
  'type_exists',
  'typeof',
  'validate_json',
  'var2bytes',
  'var2str',
  'weakref',
  'wrapf',
  'wrapi',
]);

/**
 * The Godot **4** globals that `extension_api.json` does not carry, and the ONLY hand list this
 * module keeps for the 4.x lane.
 *
 * Godot 4 split the namespace in two. `@GlobalScope`'s utility functions — 114 of them at the
 * 4.7 pin — ARE in the dump as `utility_functions`, so they are READ rather than remembered, which
 * is the whole reason a hand-kept second copy of `GODOT_3_GLOBAL_FUNCTIONS` does not exist here.
 * `@GDScript`'s own sixteen are not in it: they are compiler intrinsics, not engine functions
 * (`preload` resolves at parse time, `assert` compiles away in a release build, `range` and `len`
 * are GDScript's own).
 *
 * Provenance is the SAME pinned binary the dump came from, not memory: this is
 * `modules/gdscript/doc_classes/@GDScript.xml`'s `<methods>` from
 * `Godot_v4.7-stable --headless --doctool`, which is generated from the identical ClassDB the
 * `--dump-extension-api` run walked. Failure direction is the documented one: a global missing
 * from this set surfaces as an unresolved touch, never as silently-dropped game data.
 */
const GDSCRIPT_4_BUILTIN_FUNCTIONS: readonly string[] = [
  'Color8',
  'assert',
  'char',
  'convert',
  'dict_to_inst',
  'get_stack',
  'inst_to_dict',
  'is_instance_of',
  'len',
  'load',
  'ord',
  'preload',
  'print_debug',
  'print_stack',
  'range',
  'type_exists',
];

/** Godot 4 declares the null Variant as a builtin class; no script can touch a value of it, and
 *  letting `Nil` resolve as a type namespace would be the one fabricated row in an otherwise
 *  declared set. */
const GODOT_4_NON_TYPE_BUILTIN = 'Nil';

/**
 * Godot 3's `GlobalConstants.constants` holds the `KEY_*` names FLAT, next to nine that are not
 * keycodes at all: the modifier MASKS. Godot's own `core/os/keyboard.h` declares those in a
 * separate `KeyModifierMask` enum — which is exactly how the 4.x dump reports them
 * (`global_enums`' `KeyModifierMask`, beside `Key`) — but `api.json` flattened the two into one
 * object and lost the split, so recovering it here is a hand list.
 *
 * It has to be recovered rather than tolerated: `KEY_MASK_CMD` and `KEY_MASK_META` are the SAME
 * number (Godot aliases Cmd onto Meta off macOS), so a number->name map built over the unfiltered
 * set is ambiguous, and {@link keyCodesOf} refuses ambiguity by design.
 */
const GODOT_3_KEY_MASK_NAMES: ReadonlySet<string> = new Set([
  'KEY_CODE_MASK',
  'KEY_MODIFIER_MASK',
  'KEY_MASK_SHIFT',
  'KEY_MASK_ALT',
  'KEY_MASK_META',
  'KEY_MASK_CTRL',
  'KEY_MASK_CMD',
  'KEY_MASK_KPAD',
  'KEY_MASK_GROUP_SWITCH',
]);

/**
 * A `name -> value` keycode set, inverted for lookup by number.
 *
 * REFUSES a value two names share. The inversion is what `translate/data/input-map.ts` reads, and a
 * silently-dropped collision there would translate one key's binding into another key's.
 */
function keyCodesOf(
  named: Readonly<Record<string, number>>,
  at: string,
): ReadonlyMap<number, string> {
  const byNumber = new Map<number, string>();
  for (const [name, value] of Object.entries(named)) {
    const existing = byNumber.get(value);
    if (existing !== undefined) {
      throw new GodotApiDumpError(
        `${at}: ${existing} and ${name} are both ${value}, so a keycode cannot be named from the ` +
          'number alone',
      );
    }
    byNumber.set(value, name);
  }
  return byNumber;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Shape-check a parsed **Godot 3** `api.json`. Deliberately hand-written rather than Zod: this
 * package has no runtime dependency today, the checked surface is nine fields on one record type,
 * and adding a dependency (plus its `package-lock.json` churn) to assert `typeof x === 'string'`
 * nine times is a worse trade than the twenty lines below. Throws on the first structural
 * problem — it never returns a partially-trusted dump.
 */
function parseGodot3ApiDump(raw: unknown): GodotApiDump {
  if (!Array.isArray(raw)) {
    throw new GodotApiDumpError(
      'expected a flat ARRAY of class records (Godot 3 api.json), got a JSON object. An object ' +
        'here is a Godot 4 extension_api.json — load it with major 4, or see ' +
        'vendor/extension-api/UPSTREAM.md',
    );
  }
  raw.forEach((entry, index) => {
    const cls = entry as Partial<GodotApiClass>;
    if (typeof cls.name !== 'string' || cls.name === '') {
      throw new GodotApiDumpError(`class #${index} has no name`);
    }
    if (typeof cls.base_class !== 'string') {
      throw new GodotApiDumpError(`class ${cls.name} has no base_class`);
    }
    for (const field of ['properties', 'signals', 'methods', 'enums'] as const) {
      if (!Array.isArray(cls[field])) {
        throw new GodotApiDumpError(`class ${cls.name} has no ${field} array`);
      }
    }
    if (typeof cls.constants !== 'object' || cls.constants === null) {
      throw new GodotApiDumpError(`class ${cls.name} has no constants object`);
    }
  });
  const classes: readonly GodotApiClass[] = raw.map((entry) => {
    const cls = entry as Record<string, unknown> & Omit<GodotApiClass, 'apiType'>;
    if (cls['api_type'] !== 'core' && cls['api_type'] !== 'tools') {
      throw new GodotApiDumpError(
        `class ${cls.name} has unknown api_type ${String(cls['api_type'])}`,
      );
    }
    return { ...cls, apiType: cls['api_type'] === 'tools' ? 'editor' : 'core' };
  });
  const globalConstants = classes.find((cls) => cls.name === 'GlobalConstants')?.constants;
  if (globalConstants === undefined) {
    throw new GodotApiDumpError('api.json declares no GlobalConstants class');
  }
  return {
    major: 3,
    classes,
    globalFunctions: GODOT_3_GLOBAL_FUNCTIONS,
    globalConstants: Object.keys(globalConstants),
    globalConstantValues: globalConstants,
    globalEnums: [],
    keyCodes: keyCodesOf(
      Object.fromEntries(
        Object.entries(globalConstants).filter(
          ([name]) => name.startsWith('KEY_') && !GODOT_3_KEY_MASK_NAMES.has(name),
        ),
      ),
      'api.json GlobalConstants',
    ),
  };
}

function requireArray(host: Record<string, unknown>, key: string, at: string): unknown[] {
  const value = host[key];
  if (!Array.isArray(value)) throw new GodotApiDumpError(`${at} has no ${key} array`);
  return value;
}

/** `[{name, value}, …]` → `{name: value}`, the shape Godot 3 writes natively. */
function namedValues(entries: unknown[], at: string, what: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry['name'] !== 'string' || entry['name'] === '') {
      throw new GodotApiDumpError(`${at} has a nameless ${what}`);
    }
    const value = entry['value'];
    if (typeof value !== 'number') {
      throw new GodotApiDumpError(`${at}.${entry['name']} (${what}) has no numeric value`);
    }
    out[entry['name']] = value;
  }
  return out;
}

function argumentsOf(
  host: Record<string, unknown>,
  at: string,
): { name: string; type: string; hasDefault: boolean }[] {
  const raw = host['arguments'];
  // Godot 4 OMITS `arguments` for a nullary method or signal, where Godot 3 writes `[]`.
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new GodotApiDumpError(`${at} has a non-array arguments`);
  return raw.map((entry, index) => {
    if (
      !isRecord(entry) ||
      typeof entry['name'] !== 'string' ||
      typeof entry['type'] !== 'string'
    ) {
      throw new GodotApiDumpError(`${at} argument #${index} has no name/type`);
    }
    return {
      name: entry['name'],
      type: entry['type'],
      hasDefault: Object.hasOwn(entry, 'default_value'),
    };
  });
}

/** Every member list Godot 4 omits when it is empty. Reading them through one helper is what keeps
 *  "absent" and "empty" the same fact, which is the whole difference from the 3.x shape. */
function optionalList(host: Record<string, unknown>, key: string, at: string): unknown[] {
  const value = host[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new GodotApiDumpError(`${at} has a non-array ${key}`);
  return value;
}

function globalEnumsOf(raw: Record<string, unknown>): GodotApiEnum[] {
  return requireArray(raw, 'global_enums', 'extension_api.json').map(
    (entry, index): GodotApiEnum => {
      if (!isRecord(entry) || typeof entry['name'] !== 'string' || entry['name'] === '') {
        throw new GodotApiDumpError(`global enum #${index} has no name`);
      }
      const at = `global_enums.${entry['name']}`;
      return {
        name: entry['name'],
        values: namedValues(requireArray(entry, 'values', at), at, 'enum value'),
      };
    },
  );
}

function godot4Root(raw: unknown): Record<string, unknown> {
  if (Array.isArray(raw)) {
    throw new GodotApiDumpError(
      'expected the OBJECT Godot 4 publishes ({ header, classes, builtin_classes, … } — ' +
        'extension_api.json), got a flat array. An array here is a Godot 3 api.json — load it ' +
        'with major 3, or see vendor/extension-api/UPSTREAM.md',
    );
  }
  if (!isRecord(raw)) throw new GodotApiDumpError('extension_api.json did not parse to an object');
  const header = raw['header'];
  if (!isRecord(header)) throw new GodotApiDumpError('extension_api.json has no header object');
  const versionMajor = header['version_major'];
  if (versionMajor !== 4) {
    throw new GodotApiDumpError(
      `extension_api.json declares version_major ${String(versionMajor)}, not 4 — the pinned ` +
        'file is not the artifact this loader was asked for (vendor/extension-api/UPSTREAM.md)',
    );
  }
  return raw;
}

function godot4SingletonNames(raw: Record<string, unknown>): ReadonlySet<string> {
  const names = new Set<string>();
  for (const entry of requireArray(raw, 'singletons', 'extension_api.json')) {
    if (!isRecord(entry) || typeof entry['type'] !== 'string' || entry['type'] === '') {
      throw new GodotApiDumpError('a singleton record has no type');
    }
    names.add(entry['type']);
  }
  return names;
}

function normalizeGodot4Class(
  raw: unknown,
  index: number,
  singletonNames: ReadonlySet<string>,
): GodotApiClass {
  if (!isRecord(raw)) throw new GodotApiDumpError(`class #${index} is not an object`);
  const name = raw['name'];
  if (typeof name !== 'string' || name === '') {
    throw new GodotApiDumpError(`class #${index} has no name`);
  }
  const at = `class ${name}`;
  const inherits = raw['inherits'];
  if (inherits !== undefined && typeof inherits !== 'string') {
    throw new GodotApiDumpError(`${at} has a non-string inherits`);
  }
  const apiType = raw['api_type'];
  if (apiType !== 'core' && apiType !== 'editor') {
    throw new GodotApiDumpError(`${at} has unknown api_type ${String(apiType)}`);
  }

  const enums = optionalList(raw, 'enums', at).map((entry) => {
    if (!isRecord(entry) || typeof entry['name'] !== 'string') {
      throw new GodotApiDumpError(`${at} has a nameless enum`);
    }
    const enumName = entry['name'];
    return {
      name: enumName,
      values: namedValues(requireArray(entry, 'values', `${at}.${enumName}`), at, 'enum value'),
    };
  });

  // See this module's header: the enum VALUE names are folded in because Godot 3's own dump has
  // them here, and a script spells `Node.PROCESS_MODE_ALWAYS` identically in either dialect.
  const constants: Record<string, number> = namedValues(
    optionalList(raw, 'constants', at),
    at,
    'constant',
  );
  for (const declared of enums) Object.assign(constants, declared.values);

  return {
    name,
    apiType,
    base_class: inherits ?? '',
    singleton: singletonNames.has(name),
    // Godot 4 exposes a singleton under its own class name — there is no `_OS`/`OS` crossing to
    // make, and this pin has no underscore-prefixed class at all. The field is still written so
    // `scriptVisibleNameOf` needs no dialect branch.
    singleton_name: singletonNames.has(name) ? name : '',
    instanciable: raw['is_instantiable'] === true,
    constants,
    properties: optionalList(raw, 'properties', at).map((entry, i) => {
      if (
        !isRecord(entry) ||
        typeof entry['name'] !== 'string' ||
        typeof entry['type'] !== 'string'
      ) {
        throw new GodotApiDumpError(`${at} property #${i} has no name/type`);
      }
      // The accessors ClassDB declares for the property; a script's `node.position` binds
      // through them.
      const getter = entry['getter'];
      const setter = entry['setter'];
      const index = entry['index'];
      return {
        name: entry['name'],
        type: entry['type'],
        ...(typeof getter === 'string' && getter !== '' ? { getter } : {}),
        ...(typeof setter === 'string' && setter !== '' ? { setter } : {}),
        ...(typeof index === 'number' ? { index } : {}),
      };
    }),
    signals: optionalList(raw, 'signals', at).map((entry, i) => {
      if (!isRecord(entry) || typeof entry['name'] !== 'string') {
        throw new GodotApiDumpError(`${at} signal #${i} has no name`);
      }
      return { name: entry['name'], arguments: argumentsOf(entry, `${at}.${entry['name']}`) };
    }),
    methods: optionalList(raw, 'methods', at).map((entry, i) => {
      if (!isRecord(entry) || typeof entry['name'] !== 'string') {
        throw new GodotApiDumpError(`${at} method #${i} has no name`);
      }
      const returnValue = entry['return_value'];
      if (returnValue !== undefined && !isRecord(returnValue)) {
        throw new GodotApiDumpError(`${at}.${entry['name']} has a non-object return_value`);
      }
      const returnType = returnValue === undefined ? 'void' : returnValue['type'];
      if (typeof returnType !== 'string') {
        throw new GodotApiDumpError(`${at}.${entry['name']} has no return_value.type`);
      }
      return {
        name: entry['name'],
        return_type: returnType,
        is_virtual: entry['is_virtual'] === true,
        ...(typeof entry['hash'] === 'number' ? { hash: entry['hash'] } : {}),
        arguments: argumentsOf(entry, `${at}.${entry['name']}`),
      };
    }),
    enums,
  };
}

/**
 * Shape-check and normalize a parsed **Godot 4** `extension_api.json`. Same contract as the 3.x
 * parser: throws on the first structural problem, never returns a partially-trusted dump.
 */
function parseGodot4ApiDump(raw: unknown): GodotApiDump {
  const dump = godot4Root(raw);
  // `type` is the CLASS; `name` is what a script writes. They are identical at this pin, and the
  // class record is keyed by `type`, so `type` is what the flag is set from.
  const singletonNames = godot4SingletonNames(dump);

  const declaredBuiltinTypeNames = new Set<string>();
  const builtinClasses: GodotApiBuiltinClass[] = [];
  for (const entry of requireArray(dump, 'builtin_classes', 'extension_api.json')) {
    if (!isRecord(entry) || typeof entry['name'] !== 'string' || entry['name'] === '') {
      throw new GodotApiDumpError('a builtin_classes record has no name');
    }
    if (entry['name'] === GODOT_4_NON_TYPE_BUILTIN) continue;
    const name = entry['name'];
    const at = `builtin class ${name}`;
    declaredBuiltinTypeNames.add(name);
    const enums = optionalList(entry, 'enums', at).map((declared) => {
      if (!isRecord(declared) || typeof declared['name'] !== 'string') {
        throw new GodotApiDumpError(`${at} has a nameless enum`);
      }
      return {
        name: declared['name'],
        values: namedValues(
          requireArray(declared, 'values', `${at}.${declared['name']}`),
          at,
          'enum value',
        ),
      };
    });
    const constructors = optionalList(entry, 'constructors', at).map((constructor, index) => {
      if (!isRecord(constructor)) {
        throw new GodotApiDumpError(`${at} constructor #${index} is not an object`);
      }
      return { arguments: argumentsOf(constructor, `${at} constructor #${index}`) };
    });
    builtinClasses.push({
      name,
      members: optionalList(entry, 'members', at).map((member, index) => {
        if (
          !isRecord(member) ||
          typeof member['name'] !== 'string' ||
          typeof member['type'] !== 'string'
        ) {
          throw new GodotApiDumpError(`${at} member #${index} has no name/type`);
        }
        return { name: member['name'], type: member['type'] };
      }),
      constants: optionalList(entry, 'constants', at).map((constant, index) => {
        if (
          !isRecord(constant) ||
          typeof constant['name'] !== 'string' ||
          typeof constant['type'] !== 'string'
        ) {
          throw new GodotApiDumpError(`${at} constant #${index} has no name/type`);
        }
        return { name: constant['name'], type: constant['type'] };
      }),
      methods: optionalList(entry, 'methods', at).map((method, index) => {
        if (!isRecord(method) || typeof method['name'] !== 'string') {
          throw new GodotApiDumpError(`${at} method #${index} has no name`);
        }
        const returnType = method['return_type'];
        if (returnType !== undefined && typeof returnType !== 'string') {
          throw new GodotApiDumpError(`${at}.${method['name']} has a non-string return_type`);
        }
        return {
          name: method['name'],
          return_type: returnType ?? 'void',
          is_virtual: false,
          ...(typeof method['hash'] === 'number' ? { hash: method['hash'] } : {}),
          arguments: argumentsOf(method, `${at}.${method['name']}`),
        };
      }),
      enums,
      hasConstructor: constructors.length > 0,
      constructors,
      ...(typeof entry['indexing_return_type'] === 'string'
        ? { indexingReturnType: entry['indexing_return_type'] }
        : {}),
      operatorSignatures: optionalList(entry, 'operators', at).flatMap((operator) =>
        isRecord(operator) &&
        typeof operator['name'] === 'string' &&
        typeof operator['return_type'] === 'string'
          ? [
              {
                name: operator['name'],
                ...(typeof operator['right_type'] === 'string'
                  ? { rightType: operator['right_type'] }
                  : {}),
                returnType: operator['return_type'],
              },
            ]
          : [],
      ),
      operators: [
        ...new Set(
          optionalList(entry, 'operators', at).map((operator, index) => {
            if (!isRecord(operator) || typeof operator['name'] !== 'string') {
              throw new GodotApiDumpError(`${at} operator #${index} has no name`);
            }
            return operator['name'];
          }),
        ),
      ],
    });
  }

  const globalFunctions = new Set<string>(GDSCRIPT_4_BUILTIN_FUNCTIONS);
  const globalFunctionReturnTypes = new Map<string, string>();
  for (const entry of requireArray(dump, 'utility_functions', 'extension_api.json')) {
    if (!isRecord(entry) || typeof entry['name'] !== 'string' || entry['name'] === '') {
      throw new GodotApiDumpError('a utility_functions record has no name');
    }
    globalFunctions.add(entry['name']);
    const returnType = entry['return_type'];
    if (returnType !== undefined && typeof returnType !== 'string') {
      throw new GodotApiDumpError(`utility_functions.${entry['name']} has a non-string return_type`);
    }
    if (typeof returnType === 'string') globalFunctionReturnTypes.set(entry['name'], returnType);
  }

  const classes = requireArray(dump, 'classes', 'extension_api.json').map((entry, index) =>
    normalizeGodot4Class(entry, index, singletonNames),
  );

  const globalEnums = globalEnumsOf(dump);
  // Godot 4 declares the keycodes as a GLOBAL enum rather than on a pseudo-class, and declares the
  // modifier masks as a separate one — so the 3.x hand list has no counterpart here: the split is
  // in the file.
  const keyEnum = globalEnums.find((entry) => entry.name === 'Key');
  if (keyEnum === undefined) {
    throw new GodotApiDumpError('extension_api.json declares no global `Key` enum');
  }
  const keyCodes = keyCodesOf(keyEnum.values, 'extension_api.json global_enums.Key');
  const globalConstants = namedValues(
    requireArray(dump, 'global_constants', 'extension_api.json'),
    'extension_api.json',
    'global constant',
  );
  return {
    major: 4,
    classes,
    builtinClasses,
    globalFunctions,
    globalFunctionReturnTypes,
    globalConstants: Object.keys(globalConstants),
    globalConstantValues: globalConstants,
    globalEnums,
    declaredBuiltinTypeNames,
    keyCodes,
  };
}

/**
 * Parse a dump that is EXPECTED to describe `major`. The version is required rather than sniffed:
 * a sniffing loader silently accepts the wrong artifact for a project, and the whole point of
 * pinning two files is that the reader knows which one it asked for. A file of the other shape is
 * refused by name, pointing at `vendor/extension-api/UPSTREAM.md`.
 */
export function parseGodotApiDump(raw: unknown, major: GodotMajor): GodotApiDump {
  return major === 4 ? parseGodot4ApiDump(raw) : parseGodot3ApiDump(raw);
}
