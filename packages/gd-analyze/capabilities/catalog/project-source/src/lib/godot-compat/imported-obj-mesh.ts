/** Godot's `wavefront_obj` import result over Three's native OBJLoader graph. */
import { BufferAttribute, type BufferGeometry, type Material, Mesh, type Object3D } from 'three';
import * as MikkTSpace from 'three/addons/libs/mikktspace.module.js';
import { computeMikkTSpaceTangents } from 'three/addons/utils/BufferGeometryUtils.js';
import { retainGodotMeshResource } from './mesh-instance';
import { registerGodotObjectIdentity } from './object';

interface GodotObjMeshImportSpecBase {
  readonly engineMajor: 3 | 4;
  readonly generateTangents: boolean;
  readonly scaleMesh: readonly [number, number, number];
  readonly offsetMesh: readonly [number, number, number];
  readonly flatShading: boolean;
}

export type GodotObjMeshImportSpec = GodotObjMeshImportSpecBase &
  (
    | {
        readonly engineMajor: 3;
        readonly optimizeMesh: boolean;
        readonly forceDisableMeshCompression?: never;
      }
    | {
        readonly engineMajor: 4;
        readonly optimizeMesh?: never;
        readonly forceDisableMeshCompression: boolean;
      }
  );

function disposeLoaderMaterial(material: Material | readonly Material[]): void {
  if (Array.isArray(material)) {
    for (const one of material) one.dispose();
    return;
  }
  (material as Material).dispose();
}

function loaderMaterialFlatShading(material: Material): boolean {
  if (!('flatShading' in material) || typeof material.flatShading !== 'boolean') {
    throw new TypeError(
      'godot-compat: OBJLoader material does not expose native flat-shading state.',
    );
  }
  return material.flatShading;
}

/**
 * Convert the one-mesh OBJLoader result into the shared BufferGeometry identity Godot exposes as
 * an imported ArrayMesh. OBJ syntax/material restrictions are proved before emission; this
 * binding owns only the importer transforms Godot applies to the admitted geometry.
 */
export async function importGodotObjMesh(
  root: Object3D,
  spec: GodotObjMeshImportSpec,
): Promise<BufferGeometry> {
  const meshes: Mesh[] = [];
  root.traverse((child) => {
    if (child instanceof Mesh) meshes.push(child);
  });
  if (meshes.length !== 1) {
    throw new Error(
      `godot-compat: wavefront_obj expected one Mesh surface, received ${meshes.length}.`,
    );
  }
  const source = meshes[0]!;
  const sourceMaterials = Array.isArray(source.material) ? source.material : [source.material];
  if (
    sourceMaterials.some((material) => loaderMaterialFlatShading(material) !== spec.flatShading)
  ) {
    throw new Error(
      'godot-compat: OBJLoader smoothing mode disagrees with retained wavefront_obj provenance.',
    );
  }
  const geometry = source.geometry.clone();
  const position = geometry.getAttribute('position');
  if (!(position instanceof BufferAttribute)) {
    throw new Error('godot-compat: wavefront_obj has no native position attribute.');
  }
  for (let index = 0; index < position.count; index += 1) {
    position.setXYZ(
      index,
      position.getX(index) * spec.scaleMesh[0] + spec.offsetMesh[0],
      position.getY(index) * spec.scaleMesh[1] + spec.offsetMesh[1],
      position.getZ(index) * spec.scaleMesh[2] + spec.offsetMesh[2],
    );
  }
  position.needsUpdate = true;

  // resource_importer_obj.cpp flips authored OBJ V before SurfaceTool tangent generation. Godot
  // textures upload unflipped, so retaining that geometry-space flip is the exact shared seam.
  const uv = geometry.getAttribute('uv');
  if (!(uv instanceof BufferAttribute)) {
    throw new Error('godot-compat: retained wavefront_obj subset requires UV coordinates.');
  }
  for (let index = 0; index < uv.count; index += 1) uv.setY(index, 1 - uv.getY(index));
  uv.needsUpdate = true;

  // Both pinned importers reverse the first two vertices of every triangulated face before
  // SurfaceTool indexing (Godot 3 resource_importer_obj.cpp:293-338; Godot 4:330-387). Three's
  // OBJLoader retains authored winding as a non-indexed stream. Swap the complete vertex tuples
  // before tangent generation, matching the order in which Godot feeds SurfaceTool.
  if (geometry.getIndex() !== null || position.count % 3 !== 0) {
    throw new Error('godot-compat: wavefront_obj expected a non-indexed triangle stream.');
  }
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (
      !(attribute instanceof BufferAttribute) ||
      (attribute.itemSize !== 2 && attribute.itemSize !== 3)
    ) {
      throw new Error(
        `godot-compat: wavefront_obj attribute ${name} has unsupported native layout.`,
      );
    }
    for (let vertex = 0; vertex < attribute.count; vertex += 3) {
      const firstX = attribute.getX(vertex);
      const firstY = attribute.getY(vertex);
      if (attribute.itemSize === 2) {
        attribute.setXY(vertex, attribute.getX(vertex + 1), attribute.getY(vertex + 1));
        attribute.setXY(vertex + 1, firstX, firstY);
      } else {
        const firstZ = attribute.getZ(vertex);
        attribute.setXYZ(
          vertex,
          attribute.getX(vertex + 1),
          attribute.getY(vertex + 1),
          attribute.getZ(vertex + 1),
        );
        attribute.setXYZ(vertex + 1, firstX, firstY, firstZ);
      }
    }
    attribute.needsUpdate = true;
  }

  if (spec.generateTangents) {
    await MikkTSpace.ready;
    computeMikkTSpaceTangents(geometry, MikkTSpace);
  }

  // Godot 3's `optimize_mesh` affects imported index storage, not the logical surface. Godot 4.7
  // no longer registers that option. Its compression switch likewise changes storage precision,
  // so both declarations are retained without fabricating a second mesh representation in Three.
  if (spec.engineMajor === 3) void spec.optimizeMesh;
  else void spec.forceDisableMeshCompression;
  disposeLoaderMaterial(source.material);
  const retained = retainGodotMeshResource(geometry);
  // `wavefront_obj`'s declared resource type is Mesh, but the imported instance Godot serializes
  // and hands to MeshInstance3D is specifically ArrayMesh.
  registerGodotObjectIdentity(retained, 'ArrayMesh');
  return retained;
}

export function getGodotImportedObjMeshGeometry(
  meshes: ReadonlyMap<string, BufferGeometry>,
  resPath: string,
): BufferGeometry {
  const geometry = meshes.get(resPath);
  if (geometry === undefined) {
    throw new Error(
      `godot-compat: imported OBJ Mesh ${JSON.stringify(resPath)} was not preloaded.`,
    );
  }
  return geometry;
}
