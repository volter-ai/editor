/**
 * An authored property as its setter's call. Godot applies a scene's authored properties by
 * `Object::set`, which calls the property's ClassDB setter (`SceneState::instantiate`,
 * packed_scene.cpp:400); the translated scene calls the same setter's compat binding on the mounted
 * entity, or on a constructed resource. The binding and its live claim come from the code
 * authority, as a script's call to that setter would.
 */
import type { GodotApiDump } from '../../analyze/api-dump';
import type { GodotValue } from '../../read/godot-value';
import type { GodotCodeTranslationAuthority } from '../code/authority';
import { GodotCodeTranslationAuthorityResolver } from '../code/authority';
import { godotOfficialSymbolKey } from '../code/bindings';
import { GODOT_FORWARDED_SETTERS } from '../code/lower-official-bound';

/** A setter's compat binding: `exportName` from `module`, imported as `localName`. */
export interface SceneSetterBinding {
  readonly module: string;
  readonly exportName: string;
  readonly localName: string;
  /** An indexed property's index, passed before the value (`ADD_PROPERTYI`); a metadata entry's name. */
  readonly index?: number | string;
  readonly evidenceClaimId: string;
}

/** The setter an authored property of a node or resource of `className` calls, or why none. */
export type SceneSetterLookup = (className: string, property: string) => SceneSetterBinding | string;

/**
 * `MeshInstance3D::_set` (`scene/3d/mesh_instance_3d.cpp:59`): `surface_material_override/N` is
 * `set_surface_override_material(N, value)`, a property the class declares per surface.
 */
/**
 * Internal properties the API dump leaves out (`PROPERTY_USAGE_INTERNAL`) that a scene stores, and
 * their internal setters, bound in ClassDB: `Curve._data` (`scene/resources/curve.cpp:646`).
 */
export const INTERNAL_PROPERTY_SETTERS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // `curve.cpp:644`, `:646`.
  Curve: { _limits: '_set_limits', _data: '_set_data' },
};

const SURFACE_OVERRIDE = /^surface_material_override\/(\d+)$/;

/**
 * `Skeleton3D::_set` (`scene/3d/skeleton_3d.cpp:81`): `bones/N/position|rotation|scale` is
 * `set_bone_pose_<what>(N, value)`, a property the skeleton declares per bone.
 */
const BONE_POSE = /^bones\/(\d+)\/(position|rotation|scale)$/;

/**
 * `AudioStreamRandomizer`'s pool entries (`PropertyListHelper` with prefix `stream_`,
 * `servers/audio/audio_stream.cpp:781`): `stream_N/stream` is `set_stream(N, value)`,
 * `stream_N/weight` is `set_stream_probability_weight(N, value)`.
 */
const RANDOMIZER_ENTRY = /^stream_(\d+)\/(stream|weight)$/;

/**
 * `Object::_set` (`core/object/object.cpp:279`): `metadata/NAME` is `set_meta(NAME, value)`, the
 * object's metadata entry of that name.
 */
const METADATA = /^metadata\/(.+)$/;

export function sceneSetterLookup(
  codeAuthority: GodotCodeTranslationAuthority,
  apiDump: GodotApiDump,
): SceneSetterLookup {
  const resolver = new GodotCodeTranslationAuthorityResolver(codeAuthority);
  const classes = new Map(apiDump.classes.map((entry) => [entry.name, entry] as const));
  const method = (className: string, name: string) => {
    for (let current = classes.get(className); current !== undefined; ) {
      const found = current.methods.find((entry) => entry.name === name);
      if (found !== undefined) return { owner: current.name, hash: found.hash ?? 0 };
      current = current.base_class === '' ? undefined : classes.get(current.base_class);
    }
    return undefined;
  };
  const ancestryOf = (className: string): string[] => {
    const result: string[] = [];
    for (let current = classes.get(className); current !== undefined; ) {
      result.push(current.name);
      current = current.base_class === '' ? undefined : classes.get(current.base_class);
    }
    return result;
  };
  return (className, property) => {
    const ancestry = ancestryOf(className);
    let owner: string | undefined;
    let setter: string | undefined;
    let index: number | string | undefined;
    const surface = SURFACE_OVERRIDE.exec(property);
    const bone = BONE_POSE.exec(property);
    const metadata = METADATA.exec(property);
    if (metadata !== null) {
      owner = 'Object';
      setter = 'set_meta';
      index = metadata[1] as string;
    } else if (surface !== null && ancestry.includes('MeshInstance3D')) {
      owner = 'MeshInstance3D';
      setter = 'set_surface_override_material';
      index = Number(surface[1]);
    } else if (bone !== null && ancestry.includes('Skeleton3D')) {
      owner = 'Skeleton3D';
      setter = `set_bone_pose_${bone[2] as string}`;
      index = Number(bone[1]);
    } else if (RANDOMIZER_ENTRY.test(property) && ancestry.includes('AudioStreamRandomizer')) {
      const entry = RANDOMIZER_ENTRY.exec(property) as RegExpExecArray;
      owner = 'AudioStreamRandomizer';
      setter = entry[2] === 'stream' ? 'set_stream' : 'set_stream_probability_weight';
      index = Number(entry[1]);
    } else {
      for (const className of ancestry) {
        const found = classes.get(className)?.properties.find((entry) => entry.name === property);
        if (found === undefined) continue;
        owner = className;
        setter = found.setter;
        index = found.index;
        break;
      }
    }
    // A property whose internal setter the dump leaves out of the class's methods and which only
    // forwards to a public method: `Control::_set_global_position` is `set_global_position(p_point)`
    // (scene/gui/control.cpp:1492).
    if (owner !== undefined && (setter === undefined || method(owner, setter) === undefined)) {
      const forwarded = GODOT_FORWARDED_SETTERS[`${owner}.${property}`];
      if (forwarded !== undefined) setter = forwarded;
    }
    if (owner === undefined) {
      const internal = ancestry.find((name) => INTERNAL_PROPERTY_SETTERS[name]?.[property] !== undefined);
      if (internal !== undefined) {
        owner = internal;
        setter = INTERNAL_PROPERTY_SETTERS[internal]?.[property];
      }
    }
    if (owner === undefined) return `${className} declares no property ${property}`;
    if (setter === undefined) return `${owner}.${property} has no setter`;
    // A property's internal setter (`_set_layout_mode`) is bound in ClassDB but not in the dump's
    // methods: it has no hash.
    const selected = method(owner, setter) ?? (setter.startsWith('_') ? { owner, hash: 0 } : undefined);
    if (selected === undefined) return `${owner} has no method ${setter}`;
    const symbol = {
      sourceRevision: resolver.sourceRevision,
      kind: 'native-member' as const,
      owner: selected.owner,
      member: setter,
      signature: selected.hash === 0 ? 'unhashed' : `hash:${String(selected.hash)}`,
    };
    const target = resolver.bindings.resolve(symbol);
    if (target.kind === 'refusal-binding') return target.reason;
    if (target.kind !== 'compat-binding' || target.use.kind !== 'call' || target.use.sourceReceiver !== 'first-argument') {
      return `${selected.owner}.${setter} is not a compat call on its receiver`;
    }
    try {
      resolver.evidence.claim(target.evidenceClaimId, 'binding', godotOfficialSymbolKey(symbol));
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    return {
      module: target.module,
      exportName: target.exportName,
      localName: target.localName,
      ...(index === undefined ? {} : { index }),
      evidenceClaimId: target.evidenceClaimId,
    };
  };
}

/** An authored value as the composition passes it to a setter. */
export type TargetSceneValue =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'bool'; readonly value: boolean }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'null' }
  | { readonly kind: 'Vector2' | 'Vector3' | 'Color' | 'Quaternion'; readonly components: readonly number[] }
  /** A `PackedVector3Array`, as the Vector3 array compat's setters take: x, y, z per element. */
  | { readonly kind: 'PackedVector3Array'; readonly components: readonly number[] }
  /** A `PackedInt32Array` (a GridMap's `data.cells`), the ints as written. */
  | { readonly kind: 'PackedInt32Array'; readonly components: readonly number[] }
  /** A `PackedFloat32Array`, or a `PackedColorArray` as r, g, b, a per element. */
  | { readonly kind: 'PackedFloat32Array' | 'PackedColorArray'; readonly components: readonly number[] }
  /** An `AABB`: its position's then its size's components. */
  | { readonly kind: 'AABB'; readonly components: readonly number[] }
  /**
   * An untyped `Array` of numbers and vectors (a Curve's `_data` and `_limits`), flat: a vector's
   * components in its place.
   */
  | { readonly kind: 'Array'; readonly components: readonly number[] }
  /** A resource this document declares or references: `SubResource`/`ExtResource` by id. */
  | { readonly kind: 'resource'; readonly reference: 'sub' | 'ext'; readonly id: string };

/** An authored value as a target value, or undefined for a value this composition does not pass. */
export function targetSceneValue(value: GodotValue): TargetSceneValue | undefined {
  switch (value.kind) {
    case 'number':
      return { kind: 'number', value: value.value };
    case 'bool':
      return { kind: 'bool', value: value.value };
    case 'string':
      return { kind: 'string', value: value.value };
    case 'null':
      return { kind: 'null' };
    case 'ctor': {
      if (value.name === 'SubResource' || value.name === 'ExtResource') {
        const [id] = value.args;
        // A binary document names a resource by its index (`resource_format_binary.cpp:426`).
        return id?.kind === 'string' || id?.kind === 'number'
          ? { kind: 'resource', reference: value.name === 'SubResource' ? 'sub' : 'ext', id: String(id.value) }
          : undefined;
      }
      if (value.name === 'PackedFloat32Array' || value.name === 'PackedColorArray') {
        const components = value.args.map((arg) => (arg.kind === 'number' ? arg.value : undefined));
        if ((value.name === 'PackedColorArray' && components.length % 4 !== 0) || !components.every((entry): entry is number => entry !== undefined)) return undefined;
        return { kind: value.name, components };
      }
      if (value.name === 'PackedVector3Array') {
        const components = value.args.map((arg) => (arg.kind === 'number' ? arg.value : undefined));
        if (components.length % 3 !== 0 || !components.every((entry): entry is number => entry !== undefined)) return undefined;
        return { kind: 'PackedVector3Array', components };
      }
      const arity = { Vector2: [2], Vector3: [3], Color: [3, 4], Quaternion: [4], AABB: [6] }[value.name as 'Vector2' | 'Vector3' | 'Color' | 'Quaternion' | 'AABB'];
      if (arity === undefined || !arity.includes(value.args.length)) return undefined;
      const components = value.args.map((arg) => (arg.kind === 'number' ? arg.value : undefined));
      if (!components.every((entry): entry is number => entry !== undefined)) return undefined;
      return { kind: value.name as 'Vector2' | 'Vector3' | 'Color' | 'Quaternion' | 'AABB', components };
    }
    case 'array': {
      if (value.elementType !== undefined) return undefined;
      const components: number[] = [];
      for (const item of value.items) {
        const flat = item.kind === 'number' ? [item.value] : item.kind === 'ctor' && (item.name === 'Vector2' || item.name === 'Vector3') ? item.args.map((arg) => (arg.kind === 'number' ? arg.value : undefined)) : [undefined];
        if (!flat.every((entry): entry is number => entry !== undefined)) return undefined;
        components.push(...flat);
      }
      return { kind: 'Array', components };
    }
    default:
      return undefined;
  }
}
