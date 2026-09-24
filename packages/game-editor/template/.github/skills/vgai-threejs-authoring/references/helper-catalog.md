# Native Three.js helper and dependency catalog

Use this reference to decide whether a task needs Blender, direct Three.js, a
small project helper, or a specialist geometry library.

**MODELING IS BLENDER'S.** A model is a `.blend`, authored in the real Blender
running headless in the editor tab, and a game loads the GLB it exports. Reach
for `vgai-3d-models` (bpy through the Blender MCP).

**Add a capability before you look for its source.** Everything under
`src/lib/` below is a CAPABILITY, not scaffold contents — a fresh project has
no `src/lib/` directory at all. Run `npx volter-game-editor add <id>` to copy the source in as
ordinary project files you own and edit; bare `npx volter-game-editor add` lists every
capability and marks what is already present.


## Direct Three.js

Use directly for `Object3D` hierarchy and transforms; standard geometries,
`Shape`, extrusion, lathing, tubes, and curves; materials, textures, lights,
shadows, cameras, loaders, raycasting, and animation; and official addons such
as `RoundedBoxGeometry` and `BufferGeometryUtils`. Do not wrap ordinary
property access.

## Rigging and validation helpers

Keep helpers thin: create named native joints; sample exact-time poses and
end-effector bounds; report unique names, finite transforms, angular range,
and contact travel; expose `SkeletonHelper` only as a diagnostic; and convert
accepted reusable motion into ordinary `AnimationClip`s.

Do not wrap `AnimationMixer`, `AnimationClip`, `KeyframeTrack`, or normal bone
transforms. Rigid machinery attaches parts directly to joints; deforming
meshes require real normalized skin attributes — weight them in Blender and
let the glTF exporter write `JOINTS_0`/`WEIGHTS_0` (see
`vgai-humanoid-characters` for the traps, including the one where automatic
weighting reports FINISHED having weighted nothing).

Optional secondary motion lives in the installable `motion` capability.
Its spring-chain helpers assemble native
Three.js bones and `@pixiv/three-vrm-springbone` objects; its cloth helpers
assemble ordinary Three.js render geometry and raw `jolt-physics` soft bodies.
Install those libraries in the project and keep character-specific topology,
colliders, and tuning local.

## Geometry libraries

- `three-mesh-bvh` for accelerated raycasting, closest-point queries, surface
  placement and large-mesh spatial tests; `three-bvh-csg` for booleans on
  watertight meshes when raw `BufferGeometry` interop matters — validate
  structurally and visually. Both are ordinary libraries you call directly.
- Evaluate Manifold for robust solids, converting results back to
  `BufferGeometry`.
- Use Replicad or OpenCascade only when CAD workplanes, precise fillets,
  shells, or face selection justify their cost.
- Use glTF Transform outside the runtime bundle for welding, pruning,
  simplification, instancing, compression, and texture processing.

Learn functional composition from JSCAD, workplanes/selectors from CadQuery,
and presentation helpers from Drei. Modifier coverage is Blender's own. Do not
adopt an alternate persistent scene model to imitate them.

## Proven prototype surface

The preserved `agent-only-three` walking-castle experiment tested profile
lathing, beveled extrusion, arched frames, deterministic canvas textures, CSG,
curve pipes, per-material anime profiles, pixel-width silhouette ink,
distance-faded creases, rigid bone chains, exact-time gait validation, stepped
pose timing, hard shadows, environment lighting, limited AO/bloom, a subtle
color composite, and SMAA. Treat these as proven craft techniques and
candidate copyable helpers, not automatic VGAI runtime APIs.

Its accepted typed source lived in `src/lib/stylized/` and `src/lib/castle/`;
only `stylized` remains (`npx volter-game-editor add stylized`, and none of it is in a fresh
scaffold) — the `castle` and `mesh` halves are deleted, at
`archive/mesh-kit-capabilities-2026-09-19`. Edit only the helpers implicated by
the project's real work. The portable GLB ink
helpers emit ordinary expanded meshes and `LineSegments`; the source-quality
ink uses project shader hooks and should remain source-only unless an explicit
import recipe recreates it.
