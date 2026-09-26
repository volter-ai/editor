/** GDScript Variant constructor lowering, isolated from ClassDB runtime bindings. */

import { TranslateError } from "./data/model";

/** One overload of a Variant constructor, keyed by the argument count that selects it. */
export interface ConstructorForm {
  readonly imports: readonly string[];
  readonly arity: number;
  readonly emit: (args: readonly string[]) => string;
}

function packedArrayConstructorForms(compatName: string): readonly ConstructorForm[] {
  return [
    { imports: [compatName], arity: 0, emit: () => `${compatName}()` },
    { imports: [compatName], arity: 1, emit: (args) => `${compatName}(${args[0]})` },
  ];
}

/**
 * A Variant type's constructor OVERLOADS, by arity.
 *
 * `Vector2`/`Rect2` have one form; `Vector3` also carries Godot 4's value-copy form; `Basis` and
 * `Transform` are VARIADIC — Godot's
 * `Basis(x, y, z)` (three column vectors, `player.gd:80`) and `Basis(axis, angle)` (an axis-angle
 * rotation, `enemy.gd:62`) are two different constructors under one name, and `Transform(basis,
 * origin)` (`player.gd:82`) and the identity `Transform()` (`enemy.gd:63`) likewise. Each form is
 * dispatched by argument COUNT and spells the matching `basis.ts`/`variant-3d.ts` constructor, so an
 * unmeasured arity refuses by name rather than being coerced into the wrong overload.
 */
export const VARIANT_CONSTRUCTORS: Readonly<Record<string, readonly ConstructorForm[]>> = {
  int: [
    { imports: [], arity: 0, emit: () => '0' },
    { imports: [], arity: 1, emit: (a) => `Math.trunc(Number(${a[0]}))` },
  ],
  float: [
    { imports: [], arity: 0, emit: () => '0' },
    { imports: [], arity: 1, emit: (a) => `Number(${a[0]})` },
  ],
  bool: [
    { imports: [], arity: 0, emit: () => 'false' },
    { imports: [], arity: 1, emit: (a) => `Boolean(${a[0]})` },
  ],
  RID: [
    { imports: ['godotRidNew'], arity: 0, emit: () => 'godotRidNew()' },
    { imports: ['godotRidNew'], arity: 1, emit: (a) => `godotRidNew(${a[0]})` },
  ],
  Array: [
    { imports: ['godotArrayNew'], arity: 0, emit: () => 'godotArrayNew()' },
    { imports: ['godotArrayNew'], arity: 1, emit: (a) => `godotArrayNew(${a[0]})` },
    { imports: ['godotArrayNew'], arity: 4, emit: (a) => `godotArrayNew(${a.join(', ')})` },
  ],
  Vector4: [
    { imports: ['godotVector4New'], arity: 0, emit: () => 'godotVector4New()' },
    { imports: ['godotVector4New'], arity: 1, emit: (a) => `godotVector4New(${a[0]})` },
    { imports: ['godotVector4New'], arity: 4, emit: (a) => `godotVector4New(${a.join(', ')})` },
  ],
  Vector4i: [
    { imports: ['godotVector4iNew'], arity: 0, emit: () => 'godotVector4iNew()' },
    { imports: ['godotVector4iNew'], arity: 1, emit: (a) => `godotVector4iNew(${a[0]})` },
    { imports: ['godotVector4iNew'], arity: 4, emit: (a) => `godotVector4iNew(${a.join(', ')})` },
  ],
  Projection: [
    { imports: ['godotProjectionNew'], arity: 0, emit: () => 'godotProjectionNew()' },
    { imports: ['godotProjectionNew'], arity: 1, emit: (a) => `godotProjectionNew(${a[0]})` },
    { imports: ['godotProjectionNew'], arity: 4, emit: (a) => `godotProjectionNew(${a.join(', ')})` },
  ],
  StringName: [
    { imports: ['godotStringNameNew'], arity: 0, emit: () => 'godotStringNameNew()' },
    { imports: ['godotStringNameNew'], arity: 1, emit: (a) => `godotStringNameNew(${a[0]})` },
  ],
  String: [
    { imports: ['godotStringNew'], arity: 0, emit: () => 'godotStringNew()' },
    { imports: ['godotStringNew'], arity: 1, emit: (a) => `godotStringNew(${a[0]})` },
  ],
  PackedByteArray: packedArrayConstructorForms('packedByteArray'),
  PoolByteArray: packedArrayConstructorForms('packedByteArray'),
  PackedInt32Array: packedArrayConstructorForms('packedInt32Array'),
  PoolIntArray: packedArrayConstructorForms('packedInt32Array'),
  PackedInt64Array: packedArrayConstructorForms('packedInt64Array'),
  PackedFloat32Array: packedArrayConstructorForms('packedFloat32Array'),
  PoolRealArray: packedArrayConstructorForms('packedFloat32Array'),
  PackedFloat64Array: packedArrayConstructorForms('packedFloat64Array'),
  PackedStringArray: packedArrayConstructorForms('packedStringArray'),
  PoolStringArray: packedArrayConstructorForms('packedStringArray'),
  PackedVector2Array: packedArrayConstructorForms('packedVector2Array'),
  PoolVector2Array: packedArrayConstructorForms('packedVector2Array'),
  PackedVector3Array: packedArrayConstructorForms('packedVector3Array'),
  PoolVector3Array: packedArrayConstructorForms('packedVector3Array'),
  PackedVector4Array: packedArrayConstructorForms('packedVector4Array'),
  PackedColorArray: packedArrayConstructorForms('packedColorArray'),
  PoolColorArray: packedArrayConstructorForms('packedColorArray'),
  AABB: [
    { imports: ['godotAabb'], arity: 0, emit: () => 'godotAabb()' },
    { imports: ['copyAabb'], arity: 1, emit: (a) => `copyAabb(${a[0]})` },
    { imports: ['godotAabb'], arity: 2, emit: (a) => `godotAabb(${a[0]}, ${a[1]})` },
  ],
  Callable: [
    { imports: ['nullGodotCallable'], arity: 0, emit: () => 'nullGodotCallable()' },
    { imports: [], arity: 1, emit: (a) => a[0] ?? 'nullGodotCallable()' },
    {
      imports: ['godotMethodCallable'],
      arity: 2,
      emit: (a) => `godotMethodCallable(${a[0]}, ${a[1]})`,
    },
  ],
  NodePath: [
    { imports: ['godotNodePathNew'], arity: 0, emit: () => 'godotNodePathNew()' },
    { imports: ['godotNodePathNew'], arity: 1, emit: (a) => `godotNodePathNew(${a[0]})` },
  ],
  Dictionary: [
    { imports: ['godotDictionaryNew'], arity: 0, emit: () => 'godotDictionaryNew()' },
    { imports: ['godotDictionaryNew'], arity: 1, emit: (a) => `godotDictionaryNew(${a[0]})` },
    {
      imports: ['godotDictionaryNew'],
      arity: 7,
      emit: (a) => `godotDictionaryNew(${a.join(', ')})`,
    },
  ],
  Signal: [
    { imports: ['godotSignalNew'], arity: 0, emit: () => 'godotSignalNew()' },
    { imports: ['godotSignalNew'], arity: 1, emit: (a) => `godotSignalNew(${a[0]})` },
    { imports: ['godotSignalNew'], arity: 2, emit: (a) => `godotSignalNew(${a.join(', ')})` },
  ],
  Color: [
    { imports: ['constructColor'], arity: 0, emit: () => 'constructColor()' },
    { imports: ['constructColor'], arity: 1, emit: (a) => `constructColor(${a[0]})` },
    { imports: ['constructColor'], arity: 2, emit: (a) => `constructColor(${a.join(', ')})` },
    { imports: ['constructColor'], arity: 3, emit: (a) => `constructColor(${a.join(', ')})` },
    { imports: ['constructColor'], arity: 4, emit: (a) => `constructColor(${a.join(', ')})` },
  ],
  Vector2: [
    { imports: ['godotVector2New'], arity: 0, emit: () => 'godotVector2New()' },
    { imports: ['godotVector2New'], arity: 1, emit: (a) => `godotVector2New(${a[0]})` },
    { imports: ['godotVector2New'], arity: 2, emit: (a) => `godotVector2New(${a.join(', ')})` },
  ],
  Vector2i: [0, 1, 2].map((arity) => ({
    imports: ['godotVector2iNew'],
    arity,
    emit: (a) => `godotVector2iNew(${a.join(', ')})`,
  })),
  Rect2: [0, 1, 2, 4].map((arity) => ({
    imports: ['godotRect2New'],
    arity,
    emit: (a) => `godotRect2New(${a.join(', ')})`,
  })),
  Rect2i: [0, 1, 2, 4].map((arity) => ({
    imports: ['godotRect2iNew'],
    arity,
    emit: (a) => `godotRect2iNew(${a.join(', ')})`,
  })),
  Transform2D: [0, 1, 2, 3, 4].map((arity) => ({
    imports: ['godotTransform2DNew'],
    arity,
    emit: (a) => `godotTransform2DNew(${a.join(', ')})`,
  })),
  Vector3: [
    // `Vector3()` — Godot default-constructs to the zero vector (`player.gd:22`, `:23`,
    // `var movement_dir = Vector3()`). The same `vec3` every 3-arg call spells, at the origin; no
    // new backend, and it mirrors `Transform()`'s zero-arg identity form below.
    { imports: ['vec3'], arity: 0, emit: () => 'vec3(0, 0, 0)' },
    // Godot 4's `Vector3(from)` copies either a Vector3 or Vector3i value. Keep it a real copy:
    // emitting the argument unchanged would alias an object where Godot produced a new Variant.
    { imports: ['copy3'], arity: 1, emit: (a) => `copy3(${a[0]})` },
    { imports: ['vec3'], arity: 3, emit: (a) => `vec3(${a.join(', ')})` },
  ],
  Vector3i: [
    { imports: ['godotVector3iNew'], arity: 0, emit: () => 'godotVector3iNew()' },
    { imports: ['godotVector3iNew'], arity: 1, emit: (a) => `godotVector3iNew(${a[0]})` },
    { imports: ['godotVector3iNew'], arity: 3, emit: (a) => `godotVector3iNew(${a.join(', ')})` },
  ],
  Basis: [
    { imports: ['godotBasisNew'], arity: 0, emit: () => 'godotBasisNew()' },
    {
      imports: ['godotBasisNew'],
      arity: 1,
      emit: (a) => `godotBasisNew(${a[0]})`,
    },
    {
      imports: ['basisFromAxisAngle'],
      arity: 2,
      emit: (a) => `basisFromAxisAngle(${a[0]}, ${a[1]})`,
    },
    { imports: ['basisFromColumns'], arity: 3, emit: (a) => `basisFromColumns(${a.join(', ')})` },
  ],
  Quat: [
    { imports: ['godotQuaternionNew'], arity: 0, emit: () => 'godotQuaternionNew()' },
    { imports: ['godotQuaternionNew'], arity: 1, emit: (a) => `godotQuaternionNew(${a[0]})` },
    {
      imports: ['godotQuaternionNew'],
      arity: 2,
      emit: (a) => `godotQuaternionNew(${a[0]}, ${a[1]})`,
    },
    { imports: ['godotQuaternionNew'], arity: 4, emit: (a) => `godotQuaternionNew(${a.join(', ')})` },
  ],
  Quaternion: [
    { imports: ['godotQuaternionNew'], arity: 0, emit: () => 'godotQuaternionNew()' },
    { imports: ['godotQuaternionNew'], arity: 1, emit: (a) => `godotQuaternionNew(${a[0]})` },
    {
      imports: ['godotQuaternionNew'],
      arity: 2,
      emit: (a) => `godotQuaternionNew(${a.join(', ')})`,
    },
    {
      imports: ['godotQuaternionNew'],
      arity: 4,
      emit: (a) => `godotQuaternionNew(${a.join(', ')})`,
    },
  ],
  Transform: [
    // `Transform()` is Godot's IDENTITY — basis columns (1,0,0)/(0,1,0)/(0,0,1), origin at zero —
    // built from the same `transform3`/`vec3` every other transform row uses; no new backend.
    { imports: ['godotTransform3DNew'], arity: 0, emit: () => 'godotTransform3DNew()' },
    { imports: ['godotTransform3DNew'], arity: 1, emit: (a) => `godotTransform3DNew(${a[0]})` },
    {
      imports: ['godotTransform3DNew'],
      arity: 2,
      emit: (a) => `godotTransform3DNew(${a.join(', ')})`,
    },
    {
      imports: ['godotTransform3DNew'],
      arity: 4,
      emit: (a) => `godotTransform3DNew(${a.join(', ')})`,
    },
  ],
  // Godot 4's spelling of `Transform`. dialect.ts already renames the class; the constructor
  // path keys the dump's own builtin name (`builder.gd:33` is `Transform3D()`).
  Transform3D: [
    { imports: ['godotTransform3DNew'], arity: 0, emit: () => 'godotTransform3DNew()' },
    { imports: ['godotTransform3DNew'], arity: 1, emit: (a) => `godotTransform3DNew(${a[0]})` },
    {
      imports: ['godotTransform3DNew'],
      arity: 2,
      emit: (a) => `godotTransform3DNew(${a.join(', ')})`,
    },
    {
      imports: ['godotTransform3DNew'],
      arity: 4,
      emit: (a) => `godotTransform3DNew(${a.join(', ')})`,
    },
  ],
  // `Plane(normal, point)` — 4.7 dump constructor 4. builder.gd:20 is
  // `Plane(Vector3.UP, Vector3.ZERO)`. Constructor 0 is `PLANE_ZERO` via BUILTIN_ZERO_VALUES.
  Plane: [
    { imports: ['godotPlaneNew'], arity: 0, emit: () => 'godotPlaneNew()' },
    { imports: ['godotPlaneNew'], arity: 1, emit: (a) => `godotPlaneNew(${a[0]})` },
    { imports: ['godotPlaneNew'], arity: 2, emit: (a) => `godotPlaneNew(${a.join(', ')})` },
    { imports: ['godotPlaneNew'], arity: 3, emit: (a) => `godotPlaneNew(${a.join(', ')})` },
    { imports: ['godotPlaneNew'], arity: 4, emit: (a) => `godotPlaneNew(${a.join(', ')})` },
  ],
};

/** The gate for a Variant constructor. */
export function requireVariantConstructor(
  typeName: string,
  args: readonly string[],
  at: string,
): { text: string; imports: readonly string[] } {
  const forms = VARIANT_CONSTRUCTORS[typeName];
  if (forms === undefined) {
    throw new TranslateError(
      at,
      `refusing to emit the Variant constructor \`${typeName}(…)\`: godot-compat ships no ` +
        'constructor for that type. `variant.ts`/`variant-3d.ts`/`basis.ts` are where one would go, ' +
        'and they deliberately carry only what a measured fixture reached for.',
    );
  }
  const form = forms.find((one) => one.arity === args.length);
  if (form === undefined) {
    const arities = forms.map((one) => one.arity).join(' or ');
    throw new TranslateError(
      at,
      `\`${typeName}(…)\` was called with ${args.length} argument(s); godot-compat's ` +
        `constructor takes ${arities}.`,
    );
  }
  return { text: form.emit(args), imports: form.imports };
}
