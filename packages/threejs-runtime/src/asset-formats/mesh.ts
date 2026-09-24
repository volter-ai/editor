import { z } from 'zod';

const MeshDescriptorBase = z
  .object({
    type: z
      .enum(['box', 'sphere', 'plane', 'cylinder', 'capsule', 'gltf', 'splat'])
      .describe(
        'Renderable type: a built-in mesh primitive, "gltf" for an external 3D model, or "splat" for a native Gaussian-splat asset',
      ),
    args: z
      .array(z.number())
      .optional()
      .describe(
        'Geometry constructor args — box: [w,h,d], sphere: [radius], cylinder: [rTop,rBot,h], capsule: [radius,length], plane: [w,h,widthSegments,heightSegments]',
      ),
    src: z
      .string()
      .optional()
      .describe(
        'Path to the external render asset. Required for "gltf" (GLTF/GLB) and "splat" (SPZ)',
      ),
    node: z
      .string()
      .optional()
      .describe(
        'Name (or path) of a single node inside the referenced glTF (resolved via ' +
          "getObjectByName) to instantiate as this entity's geometry, instead of the whole " +
          'file. The geometry stays SHARED from the cached glTF — nothing is copied out. ' +
          'Only meaningful with type: "gltf". CONSTRAINT: a skinned/animated node cannot be ' +
          'lifted out of its armature — if the named node is a SkinnedMesh (or contains one), ' +
          'resolving it throws (degrade loudly, not silently).',
      ),
    lod: z
      .array(
        z.object({
          distance: z
            .number()
            .describe(
              'Camera distance in world units at/beyond which this level shows (THREE.LOD ' +
                'threshold). Use 0 for the closest/highest-detail level.',
            ),
          node: z
            .string()
            .describe(
              'Name of a node inside the referenced glTF (mesh.src) to show at this distance — ' +
                'resolved via getObjectByName, geometry shared (F4-style). A skinned node throws ' +
                '(atomic-subtree rule).',
            ),
        }),
      )
      .optional()
      .describe(
        'Per-entity Level-of-Detail: distance-keyed glTF sub-nodes swapped by camera distance ' +
          '(THREE.LOD). gltf-only. Gated by the environment.rendering.lod master toggle — when ' +
          'off, only the closest level renders. Cannot combine with node.',
      ),
  })
  .strict();

export const MeshDescriptorSchema = MeshDescriptorBase.refine(
  (m) => (m.type !== 'gltf' && m.type !== 'splat') || m.src != null,
  {
    message: "External render asset requires 'src' field",
  },
)
  .refine((m) => m.node == null || m.type === 'gltf', {
    message:
      "Mesh 'node' is only meaningful with type: 'gltf' (names a sub-node of the referenced glTF)",
  })
  .refine((m) => m.lod == null || m.type === 'gltf', {
    message: "Mesh 'lod' is only meaningful with type: 'gltf'",
  })
  .refine((m) => !(m.lod && m.node), {
    message: "Mesh 'lod' cannot combine with 'node' — LOD is the multi-level form of a node ref",
  })
  .describe('Mesh geometry definition');

export type MeshDescriptor = z.infer<typeof MeshDescriptorSchema>;
