/**
 * THE RUNTIME FRAME'S COLUMN CONTRACT — the typed arrays a `runtime_present`
 * ships and `drawArraysFromColumns` draws from.
 *
 * WHERE IT CAME FROM, and why it lives here now. The columns are Blender's
 * own export arena (`@volter/blender-engine`'s `browser/session-frame.mts`, `columnsToTypedArrays`):
 * `{offset, length, dtype, count, stride}` descriptors into one transferable
 * buffer, decoded on this side into the arrays below. The presenter was typed
 * against the retired mesh kit's `mesh-store.ts` because that store happened to
 * hold the same layout — Blender's — and the two were in one package. They
 * are not the same contract: the kit's store is MODELING STATE it mutates
 * (selection, hide flags, creases, an allocator per attribute type), while
 * this is the READ-ONLY shape of one presented frame. This file is the second
 * half only, so `@volter/editor-blender` names no modeling package (WORK.md §Blender in
 * the tab is Blender, "The mesh kit retires", M1).
 *
 * Layout (Blender's own): positions `co` (3 per vertex); faces as CSR —
 * `faceStart` (nf+1) into `corner` (one vertex index per loop), a loop's edge
 * in `cornerEdge`; every mesh edge as a pair in `edge` (2 per edge) in stored
 * order with a per-edge `sharp` flag; per-face `material` and `smooth`; every
 * generic attribute as one typed column per layer, in `mesh.attributes` order,
 * with the active and render UV names.
 */

export type Domain = 'POINT' | 'EDGE' | 'FACE' | 'CORNER';

export type AttributeType =
  | 'FLOAT'
  | 'INT'
  | 'INT8'
  | 'BOOLEAN'
  | 'FLOAT2'
  | 'FLOAT_VECTOR'
  | 'FLOAT_COLOR'
  | 'BYTE_COLOR'
  | 'INT16_2D'
  | 'INT32_2D'
  | 'QUATERNION'
  | 'FLOAT4X4'
  | 'FLOAT4'
  | 'STRING';

export type AttributeData =
  | Float32Array
  | Int32Array
  | Int8Array
  | Int16Array
  | Uint8Array
  | string[];

/** One generic attribute layer: `size` components per element, stored flat. */
export interface AttributeColumn {
  name: string;
  type: AttributeType;
  domain: Domain;
  data: AttributeData;
}

/** Components per element. The presenter reads a column, never allocates one,
 *  so this table carries the stride and nothing else. */
export const ATTRIBUTE_LAYOUT: Record<AttributeType, { size: number }> = {
  FLOAT: { size: 1 },
  INT: { size: 1 },
  INT8: { size: 1 },
  BOOLEAN: { size: 1 },
  FLOAT2: { size: 2 },
  FLOAT_VECTOR: { size: 3 },
  FLOAT_COLOR: { size: 4 },
  BYTE_COLOR: { size: 4 },
  INT16_2D: { size: 2 },
  INT32_2D: { size: 2 },
  QUATERNION: { size: 4 },
  FLOAT4X4: { size: 16 },
  FLOAT4: { size: 4 },
  STRING: { size: 1 },
};

/** Exactly what the draw reads off a presented mesh. */
export interface MeshColumns {
  /** 3 * nv */
  co: Float64Array;
  /** Blender-evaluated normals, 3 per corner, independent of UV splits. */
  cornerNormal?: Float32Array | undefined;
  /** nf + 1 */
  faceStart: Uint32Array;
  /** faceStart[nf] entries: vertex index per loop */
  corner: Uint32Array;
  /** same length: edge index per loop (-1 unknown) */
  cornerEdge: Int32Array;
  /** 2 * ne */
  edge: Uint32Array;
  /** ne */
  edgeSharp: Uint8Array;
  /** nf */
  material: Uint32Array;
  /** nf */
  smooth: Uint8Array;
  /** Generic attribute layers in `mesh.attributes` order. */
  attributes: AttributeColumn[];
  activeUv: string | null;
  renderUv: string | null;
}
