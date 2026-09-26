import { packedStringArray, type PackedStringArray } from './packed-array';
import { godotDictionary, type GodotDictionary } from './variant';

export interface GodotClassDbArgumentMetadata {
  readonly name: string;
  readonly type: string;
  readonly hasDefault?: boolean;
}

export interface GodotClassDbMethodMetadata {
  readonly name: string;
  readonly returnType: string;
  readonly virtual: boolean;
  readonly arguments: readonly GodotClassDbArgumentMetadata[];
}

export interface GodotClassDbPropertyMetadata {
  readonly name: string;
  readonly type: string;
  readonly getter?: string;
  readonly setter?: string;
  readonly defaultValue?: unknown;
}

export interface GodotClassDbSignalMetadata {
  readonly name: string;
  readonly arguments: readonly GodotClassDbArgumentMetadata[];
}

export interface GodotClassDbEnumMetadata {
  readonly name: string;
  readonly values: Readonly<Record<string, number>>;
}

export interface GodotClassDbClassMetadata {
  readonly name: string;
  readonly parent: string;
  readonly instantiable: boolean;
  readonly methods: readonly string[];
  readonly methodMetadata?: readonly GodotClassDbMethodMetadata[];
  readonly properties?: readonly GodotClassDbPropertyMetadata[];
  readonly signals?: readonly GodotClassDbSignalMetadata[];
  readonly enums?: readonly GodotClassDbEnumMetadata[];
  readonly constants: Readonly<Record<string, number>>;
  readonly abstract?: boolean;
  readonly exposed?: boolean;
  readonly apiType?: number;
  readonly category?: string;
}

export interface GodotClassDbMetadata {
  readonly major: 3 | 4;
  readonly classes: readonly GodotClassDbClassMetadata[];
}

export interface GodotClassDb {
  readonly major: 3 | 4;
  readonly classNames: readonly string[];
  readonly classes: ReadonlyMap<string, GodotClassDbClassMetadata>;
}

/** Build the one immutable runtime query table from the selected pinned API dump. */
export function createGodotClassDb(metadata: GodotClassDbMetadata): GodotClassDb {
  const classes = new Map(metadata.classes.map((entry) => [entry.name, entry]));
  return Object.freeze({
    major: metadata.major,
    classNames: Object.freeze([...classes.keys()].sort()),
    classes,
  });
}

const classDbs = new WeakMap<object, GodotClassDb>();
const classFactories = new WeakMap<object, Map<string, () => unknown>>();

/** Retain the generated project's ClassDB beside its retained SceneTree identity. */
export function bindGodotClassDb(tree: object, classDb: GodotClassDb): void {
  classDbs.set(tree, classDb);
}

/** Bind a translated/native constructor to one ClassDB entry without coupling reflection to dispatch. */
export function bindGodotClassDbFactory(tree: object, className: string, factory: () => unknown): void {
  const db = dbOf(tree);
  const name = nameOf(className, 'bind_factory');
  if (!db.classes.has(name)) throw new Error(`ClassDB cannot bind a factory for unknown class ${name}.`);
  if (typeof factory !== 'function') throw new TypeError('ClassDB factory must be callable.');
  let factories = classFactories.get(tree);
  if (factories === undefined) {
    factories = new Map();
    classFactories.set(tree, factories);
  }
  factories.set(name, factory);
}

export function unbindGodotClassDbFactory(tree: object, className: string): void {
  dbOf(tree);
  classFactories.get(tree)?.delete(nameOf(className, 'unbind_factory'));
}

function dbOf(tree: object): GodotClassDb {
  const db = classDbs.get(tree);
  if (db === undefined) throw new Error('godot-compat: ClassDB metadata was not bound to this SceneTree.');
  return db;
}

function nameOf(value: unknown, member: string): string {
  if (typeof value !== 'string') throw new TypeError(`ClassDB.${member} requires a StringName.`);
  return value;
}

function ancestry(
  db: GodotClassDb,
  className: string,
  noInheritance: unknown,
): readonly GodotClassDbClassMetadata[] {
  const first = db.classes.get(className);
  if (first === undefined) return [];
  const result = [first];
  if (Boolean(noInheritance)) return result;
  const seen = new Set([first.name]);
  let current = first;
  while (current.parent !== '') {
    const parent = db.classes.get(current.parent);
    if (parent === undefined || seen.has(parent.name)) break;
    seen.add(parent.name);
    result.push(parent);
    current = parent;
  }
  return result;
}

export function godotClassDbClassExists(tree: object, className: unknown): boolean {
  return dbOf(tree).classes.has(nameOf(className, 'class_exists'));
}

export function godotClassDbCanInstantiate(tree: object, className: unknown): boolean {
  const db = dbOf(tree);
  const name = nameOf(className, db.major === 3 ? 'can_instance' : 'can_instantiate');
  const metadata = db.classes.get(name);
  return metadata?.instantiable === true && metadata.abstract !== true;
}

export function godotClassDbInstantiate(tree: object, className: unknown): unknown {
  const db = dbOf(tree);
  const member = db.major === 3 ? 'instance' : 'instantiate';
  const name = nameOf(className, member);
  const metadata = db.classes.get(name);
  if (metadata === undefined || !metadata.instantiable || metadata.abstract === true) return null;
  const factory = classFactories.get(tree)?.get(name);
  if (factory === undefined) return null;
  return factory();
}

export function godotClassDbGetClassList(tree: object): PackedStringArray {
  return packedStringArray(dbOf(tree).classNames);
}

export function godotClassDbGetInheritersFromClass(tree: object, className: unknown): PackedStringArray {
  const db = dbOf(tree);
  const parent = nameOf(className, 'get_inheriters_from_class');
  return packedStringArray(db.classNames.filter((candidate) =>
    ancestry(db, candidate, false).slice(1).some((entry) => entry.name === parent)));
}

export function godotClassDbGetParentClass(tree: object, className: unknown): string {
  return dbOf(tree).classes.get(nameOf(className, 'get_parent_class'))?.parent ?? '';
}

export function godotClassDbIsParentClass(tree: object, className: unknown, inherits: unknown): boolean {
  const db = dbOf(tree);
  const candidate = nameOf(className, 'is_parent_class');
  const parent = nameOf(inherits, 'is_parent_class');
  return ancestry(db, candidate, false).some((entry) => entry.name === parent);
}

export function godotClassDbClassGetApiType(tree: object, className: unknown): number {
  const db = dbOf(tree);
  return db.classes.get(nameOf(className, 'class_get_api_type'))?.apiType ?? 0;
}

export function godotClassDbIsClassAbstract(tree: object, className: unknown): boolean {
  return dbOf(tree).classes.get(nameOf(className, 'is_class_abstract'))?.abstract === true;
}

export function godotClassDbIsClassExposed(tree: object, className: unknown): boolean {
  const metadata = dbOf(tree).classes.get(nameOf(className, 'is_class_exposed'));
  return metadata !== undefined && metadata.exposed !== false;
}

export function godotClassDbClassGetCategory(tree: object, className: unknown): string {
  return dbOf(tree).classes.get(nameOf(className, 'class_get_category'))?.category ?? '';
}

function variantType(type: string): number {
  const normalized = type.replace(/^typedarray::/, 'Array').replace(/^typeddictionary::.*/, 'Dictionary');
  switch (normalized) {
    case 'void': case 'Nil': return 0;
    case 'bool': return 1;
    case 'int': case 'enum': case 'bitfield': return 2;
    case 'float': return 3;
    case 'String': case 'StringName': case 'NodePath': return normalized === 'String' ? 4 : normalized === 'StringName' ? 21 : 22;
    case 'Vector2': return 5;
    case 'Vector2i': return 6;
    case 'Rect2': return 7;
    case 'Rect2i': return 8;
    case 'Vector3': return 9;
    case 'Vector3i': return 10;
    case 'Transform2D': return 11;
    case 'Vector4': return 12;
    case 'Vector4i': return 13;
    case 'Plane': return 14;
    case 'Quaternion': return 15;
    case 'AABB': return 16;
    case 'Basis': return 17;
    case 'Transform3D': return 18;
    case 'Projection': return 19;
    case 'Color': return 20;
    case 'RID': return 23;
    case 'Callable': return 25;
    case 'Signal': return 26;
    case 'Dictionary': return 27;
    case 'Array': return 28;
    case 'PackedByteArray': return 29;
    case 'PackedInt32Array': return 30;
    case 'PackedInt64Array': return 31;
    case 'PackedFloat32Array': return 32;
    case 'PackedFloat64Array': return 33;
    case 'PackedStringArray': return 34;
    case 'PackedVector2Array': return 35;
    case 'PackedVector3Array': return 36;
    case 'PackedColorArray': return 37;
    case 'PackedVector4Array': return 38;
    default: return normalized.startsWith('enum::') || normalized.startsWith('bitfield::') ? 2 : 24;
  }
}

function propertyDictionary(property: GodotClassDbPropertyMetadata): GodotDictionary {
  return godotDictionary([
    ['name', property.name], ['class_name', ''], ['type', variantType(property.type)],
    ['hint', 0], ['hint_string', ''], ['usage', 6],
  ]);
}

function argumentDictionary(argument: GodotClassDbArgumentMetadata): GodotDictionary {
  return godotDictionary([
    ['name', argument.name], ['class_name', ''], ['type', variantType(argument.type)],
    ['hint', 0], ['hint_string', ''], ['usage', 6],
  ]);
}

function methodDictionary(method: GodotClassDbMethodMetadata): GodotDictionary {
  return godotDictionary([
    ['name', method.name],
    ['args', method.arguments.map(argumentDictionary)],
    ['default_args', method.arguments.filter((argument) => argument.hasDefault).map(() => null)],
    ['flags', method.virtual ? 32 : 1],
    ['id', 0],
    ['return', argumentDictionary({ name: '', type: method.returnType })],
  ]);
}

function signalDictionary(signal: GodotClassDbSignalMetadata): GodotDictionary {
  return godotDictionary([
    ['name', signal.name], ['args', signal.arguments.map(argumentDictionary)], ['default_args', []], ['flags', 1],
  ]);
}

export function godotClassDbClassHasSignal(tree: object, className: unknown, signalName: unknown): boolean {
  const signal = nameOf(signalName, 'class_has_signal');
  return ancestry(dbOf(tree), nameOf(className, 'class_has_signal'), false)
    .some((entry) => entry.signals?.some((candidate) => candidate.name === signal) === true);
}

export function godotClassDbClassGetSignal(tree: object, className: unknown, signalName: unknown): GodotDictionary {
  const signal = nameOf(signalName, 'class_get_signal');
  for (const entry of ancestry(dbOf(tree), nameOf(className, 'class_get_signal'), false)) {
    const match = entry.signals?.find((candidate) => candidate.name === signal);
    if (match !== undefined) return signalDictionary(match);
  }
  return godotDictionary();
}

export function godotClassDbClassGetSignalList(tree: object, className: unknown, noInheritance = false): GodotDictionary[] {
  return ancestry(dbOf(tree), nameOf(className, 'class_get_signal_list'), noInheritance)
    .flatMap((entry) => (entry.signals ?? []).map(signalDictionary));
}

export function godotClassDbClassGetPropertyList(tree: object, className: unknown, noInheritance = false): GodotDictionary[] {
  return ancestry(dbOf(tree), nameOf(className, 'class_get_property_list'), noInheritance)
    .flatMap((entry) => (entry.properties ?? []).map(propertyDictionary));
}

export function godotClassDbClassGetPropertyGetter(tree: object, className: unknown, propertyName: unknown): string {
  const property = nameOf(propertyName, 'class_get_property_getter');
  for (const entry of ancestry(dbOf(tree), nameOf(className, 'class_get_property_getter'), false)) {
    const match = entry.properties?.find((candidate) => candidate.name === property);
    if (match !== undefined) return match.getter ?? '';
  }
  return '';
}

export function godotClassDbClassGetPropertySetter(tree: object, className: unknown, propertyName: unknown): string {
  const property = nameOf(propertyName, 'class_get_property_setter');
  for (const entry of ancestry(dbOf(tree), nameOf(className, 'class_get_property_setter'), false)) {
    const match = entry.properties?.find((candidate) => candidate.name === property);
    if (match !== undefined) return match.setter ?? '';
  }
  return '';
}

export function godotClassDbClassGetPropertyDefaultValue(tree: object, className: unknown, propertyName: unknown): unknown {
  const property = nameOf(propertyName, 'class_get_property_default_value');
  for (const entry of ancestry(dbOf(tree), nameOf(className, 'class_get_property_default_value'), false)) {
    const match = entry.properties?.find((candidate) => candidate.name === property);
    if (match !== undefined) return match.defaultValue ?? null;
  }
  return null;
}

export function godotClassDbClassHasProperty(tree: object, className: unknown, propertyName: unknown, noInheritance = false): boolean {
  const property = nameOf(propertyName, 'class_has_property');
  return ancestry(dbOf(tree), nameOf(className, 'class_has_property'), noInheritance)
    .some((entry) => entry.properties?.some((candidate) => candidate.name === property) === true);
}

export function godotClassDbClassGetPropertyType(tree: object, className: unknown, propertyName: unknown, noInheritance = false): number {
  const property = nameOf(propertyName, 'class_get_property_type');
  for (const entry of ancestry(dbOf(tree), nameOf(className, 'class_get_property_type'), noInheritance)) {
    const match = entry.properties?.find((candidate) => candidate.name === property);
    if (match !== undefined) return variantType(match.type);
  }
  return 0;
}

export function godotClassDbClassGetMethodArgumentCount(tree: object, className: unknown, methodName: unknown, noInheritance = false): number {
  const method = nameOf(methodName, 'class_get_method_argument_count');
  for (const entry of ancestry(dbOf(tree), nameOf(className, 'class_get_method_argument_count'), noInheritance)) {
    const match = entry.methodMetadata?.find((candidate) => candidate.name === method);
    if (match !== undefined) return match.arguments.length;
  }
  return -1;
}

export function godotClassDbClassGetMethodList(tree: object, className: unknown, noInheritance = false): GodotDictionary[] {
  return ancestry(dbOf(tree), nameOf(className, 'class_get_method_list'), noInheritance)
    .flatMap((entry) => (entry.methodMetadata ?? []).map(methodDictionary));
}

export function godotClassDbClassGetMethod(tree: object, className: unknown, methodName: unknown, noInheritance = false): GodotDictionary {
  const method = nameOf(methodName, 'class_get_method');
  for (const entry of ancestry(dbOf(tree), nameOf(className, 'class_get_method'), noInheritance)) {
    const match = entry.methodMetadata?.find((candidate) => candidate.name === method);
    if (match !== undefined) return methodDictionary(match);
  }
  return godotDictionary();
}

export function godotClassDbClassIsMethodVirtual(tree: object, className: unknown, methodName: unknown, noInheritance = false): boolean {
  const method = nameOf(methodName, 'class_is_method_virtual');
  for (const entry of ancestry(dbOf(tree), nameOf(className, 'class_is_method_virtual'), noInheritance)) {
    const match = entry.methodMetadata?.find((candidate) => candidate.name === method);
    if (match !== undefined) return match.virtual;
  }
  return false;
}

export function godotClassDbClassHasMethod(
  tree: object,
  className: unknown,
  methodName: unknown,
  noInheritance: unknown = false,
): boolean {
  const method = nameOf(methodName, 'class_has_method');
  return ancestry(dbOf(tree), nameOf(className, 'class_has_method'), noInheritance)
    .some((entry) => entry.methods.includes(method));
}

export function godotClassDbClassGetIntegerConstant(
  tree: object,
  className: unknown,
  constantName: unknown,
): number {
  const constant = nameOf(constantName, 'class_get_integer_constant');
  for (const entry of ancestry(dbOf(tree), nameOf(className, 'class_get_integer_constant'), false)) {
    if (Object.prototype.hasOwnProperty.call(entry.constants, constant)) return entry.constants[constant] ?? 0;
  }
  return 0;
}

export function godotClassDbClassGetIntegerConstantList(
  tree: object,
  className: unknown,
  noInheritance: unknown = false,
): PackedStringArray {
  const names = new Set<string>();
  for (const entry of ancestry(dbOf(tree), nameOf(className, 'class_get_integer_constant_list'), noInheritance)) {
    for (const name of Object.keys(entry.constants)) names.add(name);
  }
  return packedStringArray(names);
}

export function godotClassDbClassHasIntegerConstant(tree: object, className: unknown, constantName: unknown): boolean {
  const constant = nameOf(constantName, 'class_has_integer_constant');
  return ancestry(dbOf(tree), nameOf(className, 'class_has_integer_constant'), false)
    .some((entry) => Object.prototype.hasOwnProperty.call(entry.constants, constant));
}

export function godotClassDbClassHasEnum(tree: object, className: unknown, enumName: unknown, noInheritance = false): boolean {
  const wanted = nameOf(enumName, 'class_has_enum');
  return ancestry(dbOf(tree), nameOf(className, 'class_has_enum'), noInheritance)
    .some((entry) => entry.enums?.some((candidate) => candidate.name === wanted) === true);
}

export function godotClassDbClassGetEnumList(tree: object, className: unknown, noInheritance = false): PackedStringArray {
  const names = new Set<string>();
  for (const entry of ancestry(dbOf(tree), nameOf(className, 'class_get_enum_list'), noInheritance)) {
    for (const enumeration of entry.enums ?? []) names.add(enumeration.name);
  }
  return packedStringArray(names);
}

export function godotClassDbClassGetEnumConstants(tree: object, className: unknown, enumName: unknown, noInheritance = false): PackedStringArray {
  const wanted = nameOf(enumName, 'class_get_enum_constants');
  for (const entry of ancestry(dbOf(tree), nameOf(className, 'class_get_enum_constants'), noInheritance)) {
    const match = entry.enums?.find((candidate) => candidate.name === wanted);
    if (match !== undefined) return packedStringArray(Object.keys(match.values));
  }
  return packedStringArray();
}

export function godotClassDbClassGetIntegerConstantEnum(tree: object, className: unknown, constantName: unknown, noInheritance = false): string {
  const wanted = nameOf(constantName, 'class_get_integer_constant_enum');
  for (const entry of ancestry(dbOf(tree), nameOf(className, 'class_get_integer_constant_enum'), noInheritance)) {
    const match = entry.enums?.find((enumeration) => Object.prototype.hasOwnProperty.call(enumeration.values, wanted));
    if (match !== undefined) return match.name;
  }
  return '';
}

export function godotClassDbClassGetEnumIntegerConstant(
  tree: object,
  className: unknown,
  enumName: unknown,
  constantName: unknown,
  noInheritance = false,
): number {
  const wantedEnum = nameOf(enumName, 'class_get_enum_integer_constant');
  const wantedConstant = nameOf(constantName, 'class_get_enum_integer_constant');
  for (const entry of ancestry(dbOf(tree), nameOf(className, 'class_get_enum_integer_constant'), noInheritance)) {
    const enumeration = entry.enums?.find((candidate) => candidate.name === wantedEnum);
    if (enumeration !== undefined && Object.prototype.hasOwnProperty.call(enumeration.values, wantedConstant)) {
      return enumeration.values[wantedConstant] ?? 0;
    }
  }
  return 0;
}

export function godotClassDbClassGetEnumIntegerConstantList(
  tree: object,
  className: unknown,
  enumName: unknown,
  noInheritance = false,
): Readonly<Record<string, number>> {
  const wanted = nameOf(enumName, 'class_get_enum_integer_constant_list');
  for (const entry of ancestry(dbOf(tree), nameOf(className, 'class_get_enum_integer_constant_list'), noInheritance)) {
    const enumeration = entry.enums?.find((candidate) => candidate.name === wanted);
    if (enumeration !== undefined) return Object.freeze({ ...enumeration.values });
  }
  return Object.freeze({});
}

export function godotClassDbIsClassEnumBitfield(tree: object, className: unknown, enumName: unknown, noInheritance = false): boolean {
  godotClassDbClassHasEnum(tree, className, enumName, noInheritance);
  return false;
}

export function godotClassDbIsClassEnabled(tree: object, className: unknown): boolean {
  return godotClassDbClassExists(tree, className);
}
