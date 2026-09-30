import {MeshoptSimplifier} from 'meshoptimizer/simplifier';

export interface MotionMeshRequest {
  id: number;
  positions: Float32Array;
  indices: Uint32Array;
  attributes: Float32Array;
  stride: number;
  weights: number[];
  absoluteError: number;
  protectedComponents: number[];
  locks: Uint8Array;
}
export interface MotionMeshResponse {id: number; indices?: Uint32Array; error?: number; refusal?: string}

// One copied mesh at a time. The worker never owns or detaches a resident
// Blender column, and never writes positions or attributes back to the model.
self.onmessage = async (event: MessageEvent<MotionMeshRequest>) => {
  const {id, positions, indices, attributes, stride, weights, absoluteError, protectedComponents, locks} = event.data;
  try {
    await MeshoptSimplifier.ready;
    // Permit collapses across normal splits, while explicitly protecting UV
    // and other shader-attribute discontinuities. This follows meshoptimizer
    // 1.2's attribute-aware permissive recipe; no position/attribute is edited.
    const positionsRemap = MeshoptSimplifier.generatePositionRemap(positions, 3);
    for (let i = 0; i < positionsRemap.length; i++) {
      const other = positionsRemap[i]!;
      if (other !== i && protectedComponents.some(c => attributes[i * stride + c] !== attributes[other * stride + c])) {
        locks[i]! |= 2; locks[other]! |= 2; // meshopt_SimplifyVertex_Protect
      }
    }
    const target = Math.min(indices.length, Math.max(384, Math.floor(indices.length * 0.08 / 3) * 3));
    const [reduced, error] = MeshoptSimplifier.simplifyWithAttributes(
      indices, positions, 3, attributes, stride, weights, locks, target, absoluteError,
      // Explicit locks preserve material/chunk borders. The appearance error
      // includes normals; unsuccessful reductions retain complete originals.
      ['ErrorAbsolute', 'Permissive'],
    );
    const response: MotionMeshResponse = {
      id, indices: reduced, error,
    };
    self.postMessage(response, {transfer: [reduced.buffer]});
  } catch (error) {
    self.postMessage({id, refusal: error instanceof Error ? error.message : String(error)} satisfies MotionMeshResponse);
  }
};
