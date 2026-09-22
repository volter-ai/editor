/**
 * THE ARMATURE OVERLAY — Blender's bones, drawn in three.js over the engine's
 * own data (ARCHITECTURE-CORE §Blender north star, "Inspection parity, not
 * editing parity" and "The reference is Blender's SOURCE as well as its
 * frames"; WORK.md §Blender in the tab is Blender, "Inspection parity", I4).
 *
 * Blender's overlay ENGINE is never run, ported or recorded: what crosses is
 * the data its draw functions read — per bone a pose matrix, a length, a
 * parent, its hide/select/active flags — and this file is our own drawing of
 * the same shapes with Blender's own vertex tables and Blender's own theme
 * colours. Every metric below cites the file and constant it came from, at the
 * engine's pin (Blender 5.2.0, `fbe6228777e7`).
 *
 * WHAT IS DRAWN, and what is not. `display_type` OCTAHEDRAL and STICK are
 * drawn (`bone_draw_octa` / `bone_draw_line`, `overlay_armature.cc:1415-1500`).
 * BBONE, ENVELOPE and WIRE fall back to the octahedron and say so through a
 * frame warning — Blender's B-Bone needs the per-segment matrices
 * (`draw_bone_update_disp_matrix_bbone`, `:1186`) and its envelope needs the
 * head/tail radii, neither of which the door carries yet. A standing named
 * warning, never a silent degrade.
 *
 * EDIT MODE IS NOT DRAWN EITHER, for a reason worth stating: in edit mode
 * Blender draws the EDIT bones (`ED_armature_ebone_to_mat4`), which are a
 * different set of matrices from `pose.bones`, and drawing the pose there
 * would be a confident picture of the wrong thing. The door reports the mode;
 * an armature in EDIT mode draws its pose with the object-mode colours and the
 * frame carries the warning.
 */
import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { z } from 'zod';

const scalar = z.number().finite();

/** ONE BONE, as `session.py`'s `_armature_bones` answers it. */
export const boneSchema = z
  .object({
    name: z.string(),
    parent: z.string().nullable(),
    connected: z.boolean(),
    hide: z.boolean(),
    length: scalar,
    /** `PoseBone.matrix` — `pchan->pose_mat`, in the armature OBJECT's space,
     *  row-major as four rows. `draw_bone_update_disp_matrix_default`
     *  (`overlay_armature.cc:990-1020`) is this matrix rescaled by `length`. */
    matrix: z.array(z.tuple([scalar, scalar, scalar, scalar])).length(4),
    select: z.boolean(),
    active: z.boolean(),
    lockedWeight: z.boolean(),
  })
  .strict();

export const armatureSchema = z
  .object({
    object: z.string(),
    /** `bArmature.drawtype`, `rna_armature.cc:2146-2168`. */
    displayType: z.enum(['OCTAHEDRAL', 'STICK', 'BBONE', 'ENVELOPE', 'WIRE']),
    /** `Object.dtx & OB_DRAW_IN_FRONT` (`rna_object.cc:3646-3648`). */
    showInFront: z.boolean(),
    mode: z.string(),
    bones: z.array(boneSchema),
  })
  .strict();

export type BlenderArmature = z.infer<typeof armatureSchema>;
type Bone = z.infer<typeof boneSchema>;

/**
 * BLENDER'S OWN THEME BYTES, from `release/datafiles/userdef/
 * userdef_default_theme.c`'s `.space_view3d` block. They are written here as
 * the sRGB hex the theme table holds, because that is the pixel Blender's
 * overlay pass puts on screen: `ui::theme::get_color_4fv` divides the stored
 * bytes by 255 with no transfer function and the overlay framebuffer is
 * display-referred, so the on-screen value IS the byte.
 */
export const BONE_THEME = {
  /** `.bone_solid`, `:404`. The octahedron's fill. */
  solid: 0xb2b2b2,
  /** `.bone_pose`, `:405` — a SELECTED pose bone's wire. */
  pose: 0x50c8ff,
  /** `.bone_pose_active`, `:406` — active AND selected. */
  poseActive: 0x8cffff,
  /**
   * `bone_pose_active_unsel` — active, not selected. NOT a theme key: it is
   * `get_color_blend_shade_4fv(TH_WIRE, TH_BONE_POSE, 0.15, 0)`
   * (`overlay_instance.cc:324-325`), i.e. 15% of `.bone_pose` over `.wire`
   * (#000000), which is 0x50·0.15=0x0c, 0xc8·0.15=0x1e, 0xff·0.15=0x26.
   */
  poseActiveUnsel: 0x0c1e26,
  /** `.wire`, `:377` — an UNSELECTED pose bone's wire. */
  wire: 0x000000,
  /** `.vertex`, `:386` — `get_bone_wire_color`'s `ARM_DRAW_MODE_OBJECT` branch
   *  (`overlay_armature.cc:933`) takes `theme.colors.vert` for every bone of an
   *  armature that is not the one being posed. */
  vertex: 0x000000,
  /** `.bone_locked_weight`, `:407`. The alpha is the BLEND FACTOR
   *  (`bone_locked_color_shade`, `:850-856`: `interp_v3_v3v3(color, color,
   *  locked, locked[3])`), not a draw alpha — 0x80/255. */
  lockedWeight: 0xff0000,
  lockedWeightFactor: 0x80 / 255,
} as const;

/**
 * `bone_hint_color_shade` (`overlay_armature.cc:2143-2150` in this pin's
 * numbering, the function right under `get_bone_wire_color`): the shape's
 * shaded side is the colour SQUARED and scaled by 0.1 — "increase contrast",
 * then "decrease value to add more shading to the shape".
 */
function hintColor(color: THREE.Color): THREE.Color {
  return new THREE.Color(color.r * color.r * 0.1, color.g * color.g * 0.1, color.b * color.b * 0.1);
}

/**
 * BLENDER'S OCTAHEDRON, vertex for vertex (`overlay_shape.cc:96-131`).
 *
 * Bone space: the bone runs from the origin along +Y and is one unit long, so
 * the waist ring sits at y = 0.1 with a 0.1 half-width in x and z. The display
 * matrix scales the whole thing by the bone's length, which is why these are
 * the numbers and not a proportion of anything.
 */
const OCTAHEDRAL_VERTS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [0.1, 0.1, 0.1],
  [0.1, 0.1, -0.1],
  [-0.1, 0.1, -0.1],
  [-0.1, 0.1, 0.1],
  [0, 1, 0],
];

/** `bone_octahedral_solid_tris`, `overlay_shape.cc:120-131`. */
const OCTAHEDRAL_TRIS: readonly (readonly [number, number, number])[] = [
  [2, 1, 0],
  [3, 2, 0],
  [4, 3, 0],
  [1, 4, 0],
  [5, 1, 2],
  [5, 2, 3],
  [5, 3, 4],
  [5, 4, 1],
];

/** `bone_octahedral_solid_normals`, `overlay_shape.cc:159-169`, one per tri. */
const SQRT1_2 = Math.SQRT1_2;
const OCTAHEDRAL_NORMALS: readonly (readonly [number, number, number])[] = [
  [SQRT1_2, -SQRT1_2, 0],
  [0, -SQRT1_2, -SQRT1_2],
  [-SQRT1_2, -SQRT1_2, 0],
  [0, -SQRT1_2, SQRT1_2],
  [0.99388373, 0.11043154, 0],
  [0, 0.11043154, -0.99388373],
  [-0.99388373, 0.11043154, 0],
  [0, 0.11043154, 0.99388373],
];

/** `bone_octahedral_wire_lines`, `overlay_shape.cc:105-118` — the shape's own
 *  twelve edges. Blender's default pass draws only the SILHOUETTE subset of
 *  them, recomputed per view in a geometry shader
 *  (`overlay_armature_shape_outline_vert.glsl`); the whole edge list is what
 *  its own table holds and what it draws in wire/X-ray, and it is what this
 *  presenter draws, stated rather than approximated silently. */
const OCTAHEDRAL_LINES: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 5],
  [5, 3],
  [3, 0],
  [0, 4],
  [4, 5],
  [5, 2],
  [2, 0],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 1],
];

/** `#define rad 0.05f` — `overlay_armature_sphere_solid_vert.glsl:15`, in the
 *  bone's own display space, so the drawn radius is 0.05 × the bone's length. */
const BONE_POINT_RADIUS = 0.05;

/** `get_bone_wire_thickness` (`overlay_armature.cc:884-894`): 2 for a selected
 *  or active bone, 1 otherwise. Blender carries it in the wire colour's alpha
 *  channel; here it is the line width in CSS pixels, which is what it means. */
function wireThickness(bone: Bone): number {
  return bone.select || bone.active ? 2 : 1;
}

/** `stick_size = theme.sizes.pixel * 5.0f`
 *  (`overlay_armature_stick_vert.glsl:71`) over a strip whose half-width is 1
 *  (`overlay_shape.cc:368-375`): a 10 CSS px bar at UI scale 1. */
const STICK_WIDTH = 10;

/**
 * The CORE of that bar, in the bone's own colour.
 *
 * Blender's stick fragment is a gradient, not two bands:
 * `fac = smoothstep(1.0, 0.2, color_fac)` then `mix(inner, wire, fac)`
 * (`overlay_armature_stick_frag.glsl:13-14`), where `color_fac` runs 1 at the
 * centre line to 0 at either edge. The blend passes 50% at `color_fac` 0.6,
 * i.e. 0.4 of the half-width — so the band that is more bone than wire is
 * 0.4 × 10 = 4 px. `LineMaterial` draws a flat width, so the bar is two
 * lines, 10 px of wire colour with a 4 px core, and that 4 is this
 * measurement rather than a choice.
 */
const STICK_CORE_WIDTH = 4;

/**
 * THE SOLID BONE'S SHADING, ported formula for formula from
 * `overlay_armature_shape_solid_vert.glsl:28-36`. A three.js material because
 * the value is VIEW-dependent (the normal is taken to view space), so it
 * cannot be baked into a vertex colour on the way in.
 *
 * `light` is deliberately un-normalised there and is left so here; `s` is the
 * shader's own 0.2 smooth-lighting floor; the mix is by `fac * fac`.
 */
const BONE_SOLID_VERTEX = /* glsl */ `
  attribute vec3 aSolid;
  attribute vec3 aHint;
  varying vec3 vColor;
  void main() {
    vec3 n = normalize(normalMatrix * normal);
    float d = dot(n, vec3(0.1, 0.1, 0.8));
    float fac = clamp(d * 0.8 + 0.2, 0.0, 1.0);
    vColor = mix(aHint, aSolid, fac * fac);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
/**
 * THE OUTPUT TRANSFORM HAS TO BE ASKED FOR, and forgetting it is what the walk
 * caught: a `ShaderMaterial` writes `gl_FragColor` RAW. three's own materials
 * end with `#include <colorspace_fragment>`, which is what converts the linear
 * working value to the renderer's `outputColorSpace`; without it the theme's
 * `bone_solid` (#b2b2b2, linear 0.44) reached the framebuffer as 0.44 and the
 * bones photographed at byte 112 against Blender's 178 — visibly dark grey
 * where Blender's are light. Tone mapping is deliberately NOT included: an
 * overlay is drawn after the view transform in Blender and is not a
 * scene-referred value.
 *
 * ONLY THE `_fragment` HALF: three PREPENDS `colorspace_pars_fragment` to every
 * `ShaderMaterial` already, so including it here declared `LinearTransferOETF`,
 * `sRGBTransferEOTF` and `sRGBTransferOETF` twice and the whole program refused
 * to compile ("function already has a body", measured live in `vgai console`).
 */
const BONE_SOLID_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(vColor, 1.0);
    #include <colorspace_fragment>
  }
`;

function color(hex: number): THREE.Color {
  // The theme byte IS the screen pixel (see BONE_THEME), so it is read as
  // sRGB and three's colour management produces that pixel back.
  return new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
}

/**
 * `get_bone_wire_color` (`overlay_armature.cc:906-940`) with no custom bone
 * colour set (`ARM_COL_CUSTOM` clear, which is every armature this document
 * has shown), plus `bone_locked_color_shade` for the weight-paint lock.
 */
function boneWireColor(armature: BlenderArmature, bone: Bone): THREE.Color {
  const pose = armature.mode === 'POSE';
  let value: THREE.Color;
  if (!pose) {
    // ARM_DRAW_MODE_OBJECT: `copy_v3_v3(disp_color, theme.colors.vert)`.
    value = color(BONE_THEME.vertex);
  } else if (bone.active && bone.select) value = color(BONE_THEME.poseActive);
  else if (bone.active) value = color(BONE_THEME.poseActiveUnsel);
  else if (bone.select) value = color(BONE_THEME.pose);
  else value = color(BONE_THEME.wire);
  if (pose && bone.lockedWeight)
    value.lerp(color(BONE_THEME.lockedWeight), BONE_THEME.lockedWeightFactor);
  return value;
}

/** `get_bone_solid_color` (`:860-875`): `theme.colors.bone_solid`, shaded
 *  toward the locked colour in pose mode when the bone's group is locked. */
function boneSolidColor(armature: BlenderArmature, bone: Bone): THREE.Color {
  const value = color(BONE_THEME.solid);
  if (armature.mode === 'POSE' && bone.lockedWeight)
    value.lerp(color(BONE_THEME.lockedWeight), BONE_THEME.lockedWeightFactor);
  return value;
}

const tempMatrix = new THREE.Matrix4();
const tempVector = new THREE.Vector3();
const tempNormal = new THREE.Matrix3();

/** The bone's DISPLAY matrix in the document's own space: the armature
 *  object's world matrix times the pose matrix, then the uniform rescale by
 *  the bone's length that `draw_bone_update_disp_matrix_default` applies. */
function displayMatrix(objectMatrix: THREE.Matrix4, bone: Bone): THREE.Matrix4 {
  const pose = new THREE.Matrix4().set(...(bone.matrix.flat() as Parameters<THREE.Matrix4['set']>));
  return pose.premultiply(objectMatrix).scale(new THREE.Vector3().setScalar(bone.length));
}

/**
 * THE OVERLAY, rebuilt whenever the frame's armatures change.
 *
 * It is rebuilt rather than reconciled because a pose moves every bone at once
 * — there is no "some bones changed" case — and the whole drawing of a
 * 200-bone rig is a few thousand vertices. Resources are owned here and freed
 * on the next build, which is the same contract `BlenderRuntimeView` holds for
 * its geometries.
 */
export class ArmatureOverlay {
  readonly group = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];
  private signature = '';

  constructor() {
    this.group.name = 'BlenderArmatureOverlay';
  }

  /**
   * Draw these armatures. `objectMatrix` answers the armature OBJECT's world
   * matrix in BLENDER's frame — the frame's own `objects[].matrix`, never the
   * presented three object's, because the presenter reparents objects and
   * premultiplies by the parent's inverse while a bone's pose matrix is in the
   * armature's own space.
   *
   * Returns the warnings this drawing could not honour, by name.
   */
  apply(
    armatures: Record<string, BlenderArmature>,
    objectMatrix: (name: string) => THREE.Matrix4 | null,
  ): readonly string[] {
    const warnings: string[] = [];
    const signature = JSON.stringify(armatures);
    if (signature === this.signature) return warnings;
    this.signature = signature;
    this.clear();
    for (const armature of Object.values(armatures)) {
      const matrix = objectMatrix(armature.object);
      if (matrix === null) continue;
      if (armature.displayType !== 'OCTAHEDRAL' && armature.displayType !== 'STICK')
        warnings.push(
          `armature ${armature.object}: Blender's ${armature.displayType} bone display needs data ` +
            'this door does not carry (B-Bone segment matrices, envelope radii), so its bones are ' +
            'drawn octahedral',
        );
      if (armature.mode === 'EDIT')
        warnings.push(
          `armature ${armature.object}: in Edit Mode Blender draws the EDIT bones, and this ` +
            'overlay draws the pose — the shapes are the rest pose, not the edited one',
        );
      const bones = armature.bones.filter((bone) => !bone.hide);
      if (bones.length === 0) continue;
      const node =
        armature.displayType === 'STICK'
          ? this.buildStick(armature, bones, matrix)
          : this.buildOctahedral(armature, bones, matrix);
      // THE IN-FRONT LAYER: Blender puts an armature whose `show_in_front` is
      // set into the overlay pass whose depth buffer is cleared first
      // (`Instance::object_is_in_front`, `overlay_instance.cc:1110-1115`), so
      // it draws over everything. Here that is no depth test and a render
      // order past the model's.
      if (armature.showInFront)
        node.traverse((child) => {
          const material = (child as THREE.Mesh).material as THREE.Material | undefined;
          if (material && 'depthTest' in material) material.depthTest = false;
          child.renderOrder = 10;
        });
      this.group.add(node);
    }
    return warnings;
  }

  private buildOctahedral(
    armature: BlenderArmature,
    bones: readonly Bone[],
    objectMatrix: THREE.Matrix4,
  ): THREE.Object3D {
    const node = new THREE.Group();
    node.name = `${armature.object}:bones`;
    const positions: number[] = [];
    const normals: number[] = [];
    const solids: number[] = [];
    const hints: number[] = [];
    const lineStarts: number[] = [];
    const lineColors: number[] = [];
    // Blender draws every bone's wire at its own thickness; `LineMaterial` is
    // one width per material, so the bones are gathered into the two widths
    // `get_bone_wire_thickness` can answer.
    const thickLines: number[] = [];
    const thickColors: number[] = [];
    const points: THREE.Matrix4[] = [];
    const pointColors: THREE.Color[] = [];
    for (const bone of bones) {
      const matrix = displayMatrix(objectMatrix, bone);
      const solid = boneSolidColor(armature, bone);
      const hint = hintColor(solid);
      const wire = boneWireColor(armature, bone);
      tempNormal.setFromMatrix4(matrix).invert().transpose();
      for (let tri = 0; tri < OCTAHEDRAL_TRIS.length; tri++) {
        const normal = tempVector
          .set(...(OCTAHEDRAL_NORMALS[tri] as [number, number, number]))
          .applyMatrix3(tempNormal)
          .normalize()
          .clone();
        for (const index of OCTAHEDRAL_TRIS[tri]!) {
          const vertex = new THREE.Vector3(
            ...(OCTAHEDRAL_VERTS[index] as [number, number, number]),
          ).applyMatrix4(matrix);
          positions.push(vertex.x, vertex.y, vertex.z);
          normals.push(normal.x, normal.y, normal.z);
          solids.push(solid.r, solid.g, solid.b);
          hints.push(hint.r, hint.g, hint.b);
        }
      }
      const into = wireThickness(bone) === 2 ? thickLines : lineStarts;
      const intoColors = wireThickness(bone) === 2 ? thickColors : lineColors;
      for (const [a, b] of OCTAHEDRAL_LINES) {
        const from = new THREE.Vector3(
          ...(OCTAHEDRAL_VERTS[a] as [number, number, number]),
        ).applyMatrix4(matrix);
        const to = new THREE.Vector3(
          ...(OCTAHEDRAL_VERTS[b] as [number, number, number]),
        ).applyMatrix4(matrix);
        into.push(from.x, from.y, from.z, to.x, to.y, to.z);
        intoColors.push(wire.r, wire.g, wire.b, wire.r, wire.g, wire.b);
      }
      // `draw_points` (`overlay_armature.cc:1337-1373`): the ROOT sphere only
      // for a bone that is not connected to its parent, the TIP sphere always.
      if (!(bone.parent !== null && bone.connected)) {
        points.push(matrix.clone());
        pointColors.push(solid);
      }
      points.push(matrix.clone().multiply(tempMatrix.makeTranslation(0, 1, 0)));
      pointColors.push(solid);
    }
    node.add(this.solidMesh(positions, normals, solids, hints));
    if (lineStarts.length) node.add(this.lines(lineStarts, lineColors, 1));
    if (thickLines.length) node.add(this.lines(thickLines, thickColors, 2));
    for (let i = 0; i < points.length; i++) node.add(this.point(points[i]!, pointColors[i]!));
    return node;
  }

  private buildStick(
    armature: BlenderArmature,
    bones: readonly Bone[],
    objectMatrix: THREE.Matrix4,
  ): THREE.Object3D {
    const node = new THREE.Group();
    node.name = `${armature.object}:bones`;
    const bar: number[] = [];
    const barColors: number[] = [];
    const core: number[] = [];
    const coreColors: number[] = [];
    for (const bone of bones) {
      const matrix = displayMatrix(objectMatrix, bone);
      // `drw_shgroup_bone_stick` (`overlay_armature.cc:243-263`): head is the
      // display matrix's location, tail is head + its Y axis — which, after
      // the length rescale, is exactly the bone's tail.
      const head = new THREE.Vector3().setFromMatrixPosition(matrix);
      const tail = new THREE.Vector3(0, 1, 0).applyMatrix4(matrix);
      const wire = boneWireColor(armature, bone);
      const solid = boneSolidColor(armature, bone);
      bar.push(head.x, head.y, head.z, tail.x, tail.y, tail.z);
      barColors.push(wire.r, wire.g, wire.b, wire.r, wire.g, wire.b);
      core.push(head.x, head.y, head.z, tail.x, tail.y, tail.z);
      coreColors.push(solid.r, solid.g, solid.b, solid.r, solid.g, solid.b);
    }
    node.add(this.lines(bar, barColors, STICK_WIDTH));
    node.add(this.lines(core, coreColors, STICK_CORE_WIDTH));
    return node;
  }

  private solidMesh(
    positions: number[],
    normals: number[],
    solids: number[],
    hints: number[],
  ): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('aSolid', new THREE.Float32BufferAttribute(solids, 3));
    geometry.setAttribute('aHint', new THREE.Float32BufferAttribute(hints, 3));
    const material = new THREE.ShaderMaterial({
      vertexShader: BONE_SOLID_VERTEX,
      fragmentShader: BONE_SOLID_FRAGMENT,
      // `overlay_armature_shape_solid_frag.glsl` discards the back face by
      // hand; three's own culling is the same answer for a non-inverted
      // matrix, which every armature here has.
      side: THREE.FrontSide,
    });
    this.disposables.push(geometry, material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    return mesh;
  }

  private lines(positions: number[], colors: number[], width: number): THREE.Object3D {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    geometry.setColors(colors);
    const material = new LineMaterial({ linewidth: width, vertexColors: true });
    this.disposables.push(geometry, material);
    const lines = new LineSegments2(geometry, material);
    lines.frustumCulled = false;
    return lines;
  }

  private point(matrix: THREE.Matrix4, fill: THREE.Color): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(BONE_POINT_RADIUS, 12, 8);
    const material = new THREE.MeshBasicMaterial({ color: fill });
    this.disposables.push(geometry, material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.applyMatrix4(matrix);
    mesh.frustumCulled = false;
    return mesh;
  }

  private clear(): void {
    for (const child of [...this.group.children]) this.group.remove(child);
    for (const value of this.disposables) value.dispose();
    this.disposables.length = 0;
  }

  dispose(): void {
    this.clear();
    this.signature = '';
  }
}
