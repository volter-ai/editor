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

/** A setter's compat binding: `exportName` from `module`, imported as `localName`. */
export interface SceneSetterBinding {
  readonly module: string;
  readonly exportName: string;
  readonly localName: string;
  /** An indexed property's index, passed before the value (`ADD_PROPERTYI`). */
  readonly index?: number;
  readonly evidenceClaimId: string;
}

/** The setter an authored property of a node or resource of `className` calls, or why none. */
export type SceneSetterLookup = (className: string, property: string) => SceneSetterBinding | string;

/**
 * `MeshInstance3D::_set` (`scene/3d/mesh_instance_3d.cpp:59`): `surface_material_override/N` is
 * `set_surface_override_material(N, value)`, a property the class declares per surface.
 */
const SURFACE_OVERRIDE = /^surface_material_override\/(\d+)$/;

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
    let index: number | undefined;
    const surface = SURFACE_OVERRIDE.exec(property);
    if (surface !== null && ancestry.includes('MeshInstance3D')) {
      owner = 'MeshInstance3D';
      setter = 'set_surface_override_material';
      index = Number(surface[1]);
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
  | { readonly kind: 'Vector2' | 'Vector3' | 'Color'; readonly components: readonly number[] }
  /** A `PackedVector3Array`, as the Vector3 array compat's setters take: x, y, z per element. */
  | { readonly kind: 'PackedVector3Array'; readonly components: readonly number[] }
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
        return id?.kind === 'string' ? { kind: 'resource', reference: value.name === 'SubResource' ? 'sub' : 'ext', id: id.value } : undefined;
      }
      if (value.name === 'PackedVector3Array') {
        const components = value.args.map((arg) => (arg.kind === 'number' ? arg.value : undefined));
        if (components.length % 3 !== 0 || !components.every((entry): entry is number => entry !== undefined)) return undefined;
        return { kind: 'PackedVector3Array', components };
      }
      const arity = { Vector2: [2], Vector3: [3], Color: [3, 4] }[value.name as 'Vector2' | 'Vector3' | 'Color'];
      if (arity === undefined || !arity.includes(value.args.length)) return undefined;
      const components = value.args.map((arg) => (arg.kind === 'number' ? arg.value : undefined));
      if (!components.every((entry): entry is number => entry !== undefined)) return undefined;
      return { kind: value.name as 'Vector2' | 'Vector3' | 'Color', components };
    }
    default:
      return undefined;
  }
}
