import {MeshoptSimplifier} from 'meshoptimizer/simplifier';

export interface MotionMeshRequest {
  id: number;
  positions: Float32Array;
  indices: Uint32Array;
  attributes: Float32Array;
  stride: number;
  weights: number[];
}
export interface MotionMeshResponse {id: number; indices?: Uint32Array; error?: number; refusal?: string}

// One copied mesh at a time. The worker never owns or detaches a resident
// Blender column, and never writes positions or attributes back to the model.
self.onmessage = async (event: MessageEvent<MotionMeshRequest>) => {
  const {id, positions, indices, attributes, stride, weights} = event.data;
  try {
    await MeshoptSimplifier.ready;
    const target = Math.max(384, Math.floor(indices.length * 0.08 / 3) * 3);
    const [reduced, error] = MeshoptSimplifier.simplifyWithAttributes(
      indices, positions, 3, attributes, stride, weights, null, target, 0.002,
      // Preserve open boundaries and attribute seams. If that prevents a
      // useful reduction, keep the original; never sample/drop triangles.
      ['LockBorder'],
    );
    const response: MotionMeshResponse = {
      id, indices: reduced, error: error * MeshoptSimplifier.getScale(positions, 3),
    };
    self.postMessage(response, {transfer: [reduced.buffer]});
  } catch (error) {
    self.postMessage({id, refusal: error instanceof Error ? error.message : String(error)} satisfies MotionMeshResponse);
  }
};
