/**
 * read/mesh-library.ts — a Godot 3 `MeshLibrary` `.tres`'s numbered items.
 *
 * A `MeshLibrary` is the palette a `GridMap` paints with, and it is stored as a FLAT namespace of
 * slash-separated property keys rather than as a list:
 *
 *     [resource]
 *     item/7/name = "Floor"
 *     item/7/mesh = ExtResource( 3 )
 *     item/7/mesh_transform = Transform( 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0 )
 *     item/7/shapes = [ SubResource( 64 ), Transform( 1, 0, … ) ]
 *     item/7/navmesh_transform = Transform( … )
 *     item/7/preview = SubResource( 63 )
 *
 * (`MeshLibrary::_set`/`_get`, `scene/resources/mesh_library.cpp` @ 3.6-stable: the keys are built
 * as `"item/" + itostr(id) + "/" + what`.) Item ids are sparse by construction — a library can
 * hold 0, 3 and 40 — so nothing here assumes a contiguous range, and `stage/tiles.tres`'s
 * `item/0` ("CeilingCorner") is in the library and used by no cell in the level.
 *
 * ## `shapes` is a FLAT alternating array
 *
 * `item/N/shapes` is `[ shape, transform, shape, transform, … ]` — `MeshLibrary::_set_item_shapes`
 * reads it two at a time and fails an odd length, and so does this. The transform is the shape's
 * placement in the ITEM's own space, which `GridMap::_octant_update` (grid_map.cpp:541–551) then
 * composes on the LEFT with the cell placement: `xform * shapes[i].local_transform`.
 *
 * ## What is deliberately not read
 *
 * `preview` is a `SubResource` holding an editor thumbnail (`stage/tiles.tres` carries 18 embedded
 * `Image`s totalling ~1.2 MB of the file's 1.3 MB); it is editor furniture with no runtime reader.
 * `navmesh`/`navmesh_transform` belong to Godot's navigation server, which this lane has no
 * counterpart for; a library that authors an actual `navmesh` is reported to the caller rather
 * than silently dropped, which is why {@link MeshLibraryItem} carries `hasNavmesh`.
 */

import type { ResourceDocument } from './godot-types';
import type { GodotValue } from './godot-value';

/** A 3x3 basis plus an origin, in the same COLUMN-vector shape `translate/scene3d.ts` uses. */
export interface LibraryTransform {
  readonly basis: readonly [
    { readonly x: number; readonly y: number; readonly z: number },
    { readonly x: number; readonly y: number; readonly z: number },
    { readonly x: number; readonly y: number; readonly z: number },
  ];
  readonly origin: { readonly x: number; readonly y: number; readonly z: number };
}

/** One numbered item of a `MeshLibrary`. */
export interface MeshLibraryItem {
  readonly id: number;
  /** `item/N/name`. Godot defaults it to `""`. */
  readonly name: string;
  /** `item/N/mesh` as written — a `SubResource( n )` of the library, or an `ExtResource( n )`
   *  naming a standalone mesh `.tres`. Absent for an item that carries only a shape. */
  readonly mesh?: GodotValue;
  /** `item/N/mesh_transform`, when the library writes one. */
  readonly meshTransform?: LibraryTransform;
  /** `item/N/mesh_cast_shadow`: 0 = off, 1 = on. The richer double-sided and shadows-only
   *  modes remain distinct so the renderer can refuse rather than flatten them to a boolean. */
  readonly meshCastShadow: 0 | 1 | 2 | 3;
  /** `item/N/shapes`, unflattened. */
  readonly shapes: readonly { readonly shape: GodotValue; readonly transform: LibraryTransform }[];
  /** True when the item authors a real `navmesh` (not merely the `navmesh_transform` Godot writes
   *  for every item). */
  readonly hasNavmesh: boolean;
}

export class MeshLibraryReadError extends Error {
  /** The refusal WITHOUT the `at:` prefix — what a caller that already cites the location re-throws
   *  it as (`translate/emit/scene-module-3d.ts` turns a `.tscn` shape read into a `TranslateError`).
   *  Named to match `TranslateError.detail`, which exists for the same reason. */
  readonly detail: string;
  constructor(
    readonly at: string,
    message: string,
  ) {
    super(`${at}: ${message}`);
    this.name = 'MeshLibraryReadError';
    this.detail = message;
  }
}

const IDENTITY: LibraryTransform = {
  basis: [
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 1 },
  ],
  origin: { x: 0, y: 0, z: 0 },
};

/** True when a transform is exactly Godot's identity — the value every item in the platformer's
 *  library carries, and the only one this lane has measured a placement for. */
export function isIdentityTransform(transform: LibraryTransform): boolean {
  const axes = [transform.basis[0], transform.basis[1], transform.basis[2]];
  const identity = [IDENTITY.basis[0], IDENTITY.basis[1], IDENTITY.basis[2]];
  return (
    axes.every((axis, i) => {
      const want = identity[i] as { x: number; y: number; z: number };
      return axis.x === want.x && axis.y === want.y && axis.z === want.z;
    }) &&
    transform.origin.x === 0 &&
    transform.origin.y === 0 &&
    transform.origin.z === 0
  );
}

/** Godot's `Transform( xx, xy, xz, yx, …, ox, oy, oz )`: twelve numbers, the basis in ROW-major
 *  order followed by the origin. Read out into COLUMNS — see `translate/scene3d.ts`'s
 *  `transformOf`, which states the same trade for a `.tscn` node's transform. */
function transformOf(value: GodotValue, at: string): LibraryTransform {
  if (value.kind !== 'ctor' || (value.name !== 'Transform' && value.name !== 'Transform3D')) {
    throw new MeshLibraryReadError(at, 'expected a `Transform( … )` / `Transform3D( … )`');
  }
  const n = value.args.map((arg) => {
    if (arg.kind !== 'number') {
      throw new MeshLibraryReadError(at, 'a `Transform( … )` holding a non-number');
    }
    return arg.value;
  });
  if (n.length !== 12) {
    throw new MeshLibraryReadError(at, `a \`Transform( … )\` of ${n.length} numbers, not 12`);
  }
  const at3 = (i: number): number => n[i] as number;
  return {
    basis: [
      { x: at3(0), y: at3(3), z: at3(6) },
      { x: at3(1), y: at3(4), z: at3(7) },
      { x: at3(2), y: at3(5), z: at3(8) },
    ],
    origin: { x: at3(9), y: at3(10), z: at3(11) },
  };
}

/** The property suffixes Godot 3.6 writes under `item/N/`. One this reader does not know is an
 *  error, not a silent drop: `MeshLibrary` gained keys between versions and a dropped one is a
 *  tile that renders or collides differently for a reason nothing reports. */
const KNOWN_SUFFIXES: ReadonlySet<string> = new Set([
  'name',
  'mesh',
  'mesh_transform',
  'mesh_cast_shadow',
  'shapes',
  'navmesh',
  'navmesh_transform',
  'navigation_mesh',
  'navigation_mesh_transform',
  'navigation_layers',
  'preview',
]);

/**
 * Every item a `MeshLibrary` document declares, by ascending id.
 *
 * The document is the whole `.tres`; `resource_name` and any other top-level `Resource` property
 * is ignored here because it is not part of the item namespace.
 */
export function readMeshLibraryItems(document: ResourceDocument): readonly MeshLibraryItem[] {
  if (document.type !== 'MeshLibrary') {
    throw new MeshLibraryReadError(
      document.resPath,
      `a \`[gd_resource type="${document.type}"]\`, not a MeshLibrary`,
    );
  }
  const byId = new Map<number, Record<string, GodotValue>>();
  for (const [key, value] of Object.entries(document.properties)) {
    const match = /^item\/(\d+)\/(.+)$/.exec(key);
    if (match === null) continue;
    const id = Number(match[1]);
    const suffix = match[2] as string;
    if (!KNOWN_SUFFIXES.has(suffix)) {
      throw new MeshLibraryReadError(
        document.resPath,
        `\`${key}\` is a MeshLibrary item property this reader has no row for. A property it ` +
          'dropped would be a tile that draws or collides differently with nothing reporting it.',
      );
    }
    const held = byId.get(id) ?? {};
    held[suffix] = value;
    byId.set(id, held);
  }

  return [...byId.entries()]
    .sort(([a], [b]) => a - b)
    .map(([id, properties]): MeshLibraryItem => {
      const at = `${document.resPath}#item/${id}`;
      const name = properties['name'];
      const meshTransform = properties['mesh_transform'];
      const meshCastShadow = properties['mesh_cast_shadow'];
      const shapes = properties['shapes'];
      const unflattened: { shape: GodotValue; transform: LibraryTransform }[] = [];
      if (shapes !== undefined) {
        const items = shapes.kind === 'array' ? shapes.items : undefined;
        if (items === undefined) {
          throw new MeshLibraryReadError(at, '`shapes` is not an array');
        }
        if (items.length % 2 !== 0) {
          throw new MeshLibraryReadError(
            at,
            `\`shapes\` has ${items.length} entries. Godot reads it as (shape, transform) pairs ` +
              '(`MeshLibrary::_set_item_shapes`) and an odd length means the pairing is off by one.',
          );
        }
        for (let i = 0; i < items.length; i += 2) {
          unflattened.push({
            shape: items[i] as GodotValue,
            transform: transformOf(items[i + 1] as GodotValue, `${at}/shapes[${i + 1}]`),
          });
        }
      }
      const item: MeshLibraryItem = {
        id,
        name: name?.kind === 'string' ? name.value : '',
        ...(properties['mesh'] === undefined ? {} : { mesh: properties['mesh'] }),
        ...(meshTransform === undefined
          ? {}
          : { meshTransform: transformOf(meshTransform, `${at}/mesh_transform`) }),
        meshCastShadow: (() => {
          if (meshCastShadow === undefined) return 1;
          if (
            meshCastShadow.kind !== 'number' ||
            !Number.isInteger(meshCastShadow.value) ||
            meshCastShadow.value < 0 ||
            meshCastShadow.value > 3
          ) {
            throw new MeshLibraryReadError(
              `${at}/mesh_cast_shadow`,
              'expected the Godot shadow mode integer 0 (off), 1 (on), 2 (double-sided), or 3 (shadows only)',
            );
          }
          return meshCastShadow.value as 0 | 1 | 2 | 3;
        })(),
        shapes: unflattened,
        hasNavmesh:
          (properties['navmesh'] !== undefined && properties['navmesh']?.kind !== 'null') ||
          (properties['navigation_mesh'] !== undefined &&
            properties['navigation_mesh']?.kind !== 'null'),
      };
      return item;
    });
}

/**
 * The Variant array type a `ConcavePolygonShape`'s `data` is written as, in each dialect Godot
 * spells it — the same shape (and the same reason) as `read/grid-map.ts`'s `CELLS_ARRAY_TYPES`.
 *
 * Godot 4 renamed the packed-array family and NOTHING else about this payload, and the two pinned
 * dumps say so exactly: 3.6.2 declares `ConcavePolygonShape.data` as a `PoolVector3Array` with
 * getter/setter `get_faces`/`set_faces`; 4.7 declares `ConcavePolygonShape3D.data` as a
 * `PackedVector3Array` with the SAME getter/setter pair. Same accessor, same meaning, renamed
 * container — which is why `translate/data/dialect.ts` canonicalises the class as a pure rename and this
 * reader takes both spellings rather than either being normalised away. A document that writes
 * something else is still refused loudly, naming what it wrote.
 */
const FACES_ARRAY_TYPES: ReadonlySet<string> = new Set([
  'PoolVector3Array', // Godot 3
  'PackedVector3Array', // Godot 4
]);

/**
 * A `ConcavePolygonShape`'s `data` — a `PoolVector3Array` (Godot 4: `PackedVector3Array`) of
 * TRIANGLE SOUP: three consecutive vertices per triangle, no index buffer.
 *
 * That is Godot's own storage — the property's accessor pair is `set_faces`/`get_faces` in BOTH
 * pinned dumps (`ConcavePolygonShape::_set`/`set_faces`,
 * `scene/resources/concave_polygon_shape.cpp`), i.e. the array IS a face list, three vertices per
 * face — and it is also exactly what Rapier's trimesh takes once the vertices are indexed 0,1,2,3,…
 * — so nothing here re-welds vertices. Welding would change which triangles share an edge, which is
 * a different collider.
 *
 * TWO callers, one decode: a `MeshLibrary` item's collision shape (a `GridMap`'s cells) and a plain
 * `CollisionShape`/`CollisionShape3D`'s own `shape` sub-resource
 * (`translate/emit/scene-module-3d.ts`'s `parseColliderShape`). A second decode would be a second chance
 * to disagree about what the numbers mean.
 */
export function readConcavePolygonFaces(
  properties: Readonly<Record<string, GodotValue>>,
  at: string,
): Float32Array {
  const data = properties['data'];
  if (data?.kind !== 'ctor' || !FACES_ARRAY_TYPES.has(data.name)) {
    throw new MeshLibraryReadError(
      at,
      'a ConcavePolygonShape whose `data` is not a `PoolVector3Array`/`PackedVector3Array` (it is ' +
        `\`${data?.kind === 'ctor' ? data.name : (data?.kind ?? 'absent')}\`). Its triangle soup ` +
        'IS the collider; a shape emitted without it is one the port has to guess at.',
    );
  }
  const values = data.args.map((arg) => {
    if (arg.kind !== 'number') {
      throw new MeshLibraryReadError(at, 'a ConcavePolygonShape `data` holding a non-number');
    }
    return arg.value;
  });
  if (values.length % 9 !== 0) {
    throw new MeshLibraryReadError(
      at,
      `a ConcavePolygonShape of ${values.length} floats, which is not a whole number of ` +
        'triangles (nine floats each). Godot stores three vertices per face with no index buffer.',
    );
  }
  return Float32Array.from(values, (value) => Math.fround(value));
}
