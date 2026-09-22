/**
 * THE WEIGHT OVERLAY — the active vertex group's weights, coloured with
 * Blender's own ramp (ARCHITECTURE-CORE §Blender north star, "Inspection
 * parity, not editing parity" and "The reference is Blender's SOURCE as well
 * as its frames"; WORK.md §Blender in the tab is Blender, "Inspection parity",
 * I4).
 *
 * IT IS INSPECTION, NOT PAINT MODE. Blender shows these colours by entering
 * Weight Paint; here it is a viewport overlay toggle beside Bones, because the
 * Model document has no brushes to enter a paint mode for and looking at the
 * weights is the whole point.
 *
 * WHICH RAMP, and the correction it cost. The brief for this unit named
 * `BKE_defvert_weight_to_rgb` / `weight_to_rgb`
 * (`blenkernel/intern/deform.cc:1559-1590`) — the blue → cyan → green →
 * yellow → red piecewise ramp. MEASURED at the engine's pin, that function is
 * NOT what paints a vertex group: its only callers in the whole tree are
 * `blenkernel/intern/particle.cc:3602,3624-3625`, the HAIR KEY weight colour.
 * The weight-paint viewport samples a 256-texel 1D table built in
 * `draw/engines/overlay/overlay_instance.cc:186-221`, and that table is an HSV
 * sweep with a gamma correction — a different curve with the same endpoints,
 * which is why the two look alike until you compare mid-tones. This file is
 * the table Blender actually samples; the piecewise ramp is named here so the
 * next reader does not "fix" it back.
 */
import * as THREE from 'three';
import { z } from 'zod';

/** What `session.py`'s `_weights` answers. `weightsBase64` / `alertBase64` are
 *  absent on a REFERENCE (`unchanged`), which is the same contract the meshes
 *  have (`blender-runtime-frame.ts`): the array is the size of a vertex column
 *  and every mutation presents. */
export const weightsSchema = z
  .object({
    object: z.string(),
    group: z.string(),
    groupIndex: z.number().int().nonnegative(),
    count: z.number().int().nonnegative(),
    /** sha1 of the packed weight + alert bytes. The reference key, and the
     *  presenter's staleness signal — never the mesh's revision, which does
     *  NOT move when only deform weights change (`session.py::_weights` states
     *  the measurement). */
    digest: z.string(),
    /** `scene.tool_settings.vertex_group_user` (`rna_scene.cc:3428-3434`). */
    alertMode: z.enum(['NONE', 'ACTIVE', 'ALL']),
    unchanged: z.literal(true).optional(),
    /** Float32, one per vertex, clamped to [0,1]. */
    weightsBase64: z.string().optional(),
    /** Uint8, one per vertex: 1 where Blender paints the unreferenced colour. */
    alertBase64: z.string().optional(),
  })
  .strict();

export type BlenderWeights = z.infer<typeof weightsSchema>;

/**
 * BLENDER'S WEIGHT RAMP, the formula from `overlay_instance.cc:186-203`.
 *
 *   hsv = { (2/3)·(1 − weight), 1, (0.5 + 0.5·weight)^γ },  γ = 1.5
 *   rgb = hsv_to_rgb(hsv)
 *   rgb = rgb^(1/γ)
 *
 * The comment there states the intent: "Use gamma correction to even out the
 * color bands: increasing widens yellow/cyan vs red/green/blue. Gamma 1.0
 * produces the original 2.79 color ramp."
 *
 * The STOPS the hue sweep passes through, at γ = 1.5 and rounded to a byte —
 * the values this function returns, which is what a frame can be read against:
 *
 *   0.00  hue 240°  #000080  blue      (V = 0.5^1.5 = 0.3536 → ^(1/1.5) = 0.500)
 *   0.25  hue 180°  #009f9f  cyan      (V = 0.625^1.5        → 0.625)
 *   0.50  hue 120°  #00bf00  green     (V = 0.75^1.5         → 0.750)
 *   0.75  hue  60°  #dfdf00  yellow    (V = 0.875^1.5        → 0.875)
 *   1.00  hue   0°  #ff0000  red       (V = 1                → 1.000)
 *
 * The channel value at each stop is `((0.5 + 0.5·w)^1.5)^(1/1.5)`, which is
 * just `0.5 + 0.5·w` — the gamma cancels on a fully saturated channel and only
 * bends the MIXED ones between the stops, which is exactly the "even out the
 * color bands" the comment claims. So the five stops above are 0.5, 0.625,
 * 0.75, 0.875, 1.0 of full, and any reading of a frame can be checked against
 * those five bytes: 0x80, 0x9f, 0xbf, 0xdf, 0xff.
 *
 * THE TABLE IS AN sRGB TEXTURE in Blender (`ensure_1d(TextureFormat::
 * SRGBA_8_8_8_8, 256, …)`, `:219-220`), so the sampler linearises it on read
 * and the values above are the sRGB bytes. The colours built here are handed
 * to three the same way — read as sRGB, so the pixel matches.
 */
export function weightColor(weight: number): THREE.Color {
  const gamma = 1.5;
  const clamped = weight < 0 ? 0 : weight > 1 ? 1 : weight;
  const value = (0.5 + 0.5 * clamped) ** gamma;
  // HSV, not HSL: `hsv_to_rgb_v` with saturation 1 is the hue's own unit ramp
  // scaled by V, which three's `setHSL` cannot express — so the sweep is done
  // here and only the colour space is three's.
  const [r, g, b] = hueToRgb((2 / 3) * (1 - clamped));
  const color = new THREE.Color();
  color.setRGB(
    (r * value) ** (1 / gamma),
    (g * value) ** (1 / gamma),
    (b * value) ** (1 / gamma),
    THREE.SRGBColorSpace,
  );
  return color;
}

/** `hsv_to_rgb` with saturation 1 and value 1 — the six-sector hue ramp
 *  (`BLI_math_color.c`'s own sector table, reduced to the s=v=1 case Blender's
 *  weight table is the only caller of). */
function hueToRgb(hue: number): [number, number, number] {
  const h = ((hue % 1) + 1) % 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  switch (i % 6) {
    case 0:
      return [1, f, 0];
    case 1:
      return [1 - f, 1, 0];
    case 2:
      return [0, 1, f];
    case 3:
      return [0, 1 - f, 1];
    case 4:
      return [f, 0, 1];
    default:
      return [1, 0, 1 - f];
  }
}

/**
 * `TH_VERTEX_UNREFERENCED`, the colour a zero-weight vertex is painted
 * (`overlay_paint_weight_frag.glsl:98-100`, `mix(weight_color,
 * color_unreferenced, alert * alert)` at alert 1).
 *
 * MEASURED: `vertex_unreferenced` appears NOWHERE in
 * `release/datafiles/userdef/userdef_default_theme.c` — the only mention of
 * the member in the whole checkout is its RNA declaration
 * (`rna_userdef.cc:3104`). The default theme therefore leaves the struct's
 * zero standing, which is BLACK, and black is what Blender draws for an
 * unweighted vertex. Stated rather than eyedropped.
 */
export const VERTEX_UNREFERENCED = 0x000000;

function bytesFrom(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * THE OVERLAY: the painted object's own geometry, drawn again in the weight
 * colours.
 *
 * A SECOND MESH rather than a material swap on the presented one, and the
 * reason is ownership: the presented mesh belongs to `BlenderRuntimeView`,
 * which replaces its geometry and material whenever the engine says so, and a
 * toggle that reached in and swapped the material would be fighting it every
 * frame. The overlay holds its own mesh over the same geometry, one polygon
 * offset in front, and the Helpers toggle turns it on and off the way it turns
 * every other helper on and off.
 */
export class WeightOverlay {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private material: THREE.MeshBasicMaterial | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  /** The last array that crossed, kept because a present ships a REFERENCE for
   *  everything it has already sent. Keyed by `<object>:<group>`. */
  private held: { key: string; weights: Float32Array; alerts: Uint8Array } | null = null;
  private signature = '';

  constructor() {
    this.group.name = 'BlenderWeightOverlay';
  }

  /**
   * Draw the weights over `source`, the presented mesh of the painted object.
   * `null` weights (no active vertex group, no active mesh) clears it.
   *
   * `objectMatrix` is the object's matrix in BLENDER's frame — the frame's own
   * `objects[].matrix`, exactly as the armature overlay takes it, and NOT the
   * presented mesh's `matrixWorld`. Measured live 2026-09-19: `matrixWorld`
   * already carries the model root's Z-up permutation, and this group carries
   * it too, so the drawing landed with the permutation applied TWICE — the
   * Body's colours lay flat on the floor beside the standing cylinder.
   *
   * Returns the warning this drawing could not honour, or null.
   */
  apply(
    weights: BlenderWeights | null,
    source: THREE.Mesh | null,
    objectMatrix: THREE.Matrix4 | null,
  ): string | null {
    if (weights === null || source === null || !source.isMesh || objectMatrix === null) {
      // THE DRAWING GOES, THE ARRAY STAYS. Dropping `held` here is what the
      // walk caught (2026-09-19): `_weights` answers null whenever the active
      // object is not a mesh — entering POSE MODE on the rig is enough — while
      // the session's `_known` still records the array as sent, so the next
      // frame that names the Body again ships a REFERENCE to bytes this side
      // had just thrown away, and the colours never came back. The array is
      // still the truth about that object's group; only the drawing is stale.
      // It is the same rule the meshes follow: a presenter holds its geometry
      // until the SESSION replaces it, never until a frame stops mentioning it.
      this.clear();
      this.signature = '';
      return null;
    }
    const key = `${weights.object}:${weights.group}`;
    if (weights.unchanged === true) {
      if (this.held?.key !== key) {
        // The session's record is ahead of this overlay — the document was
        // rebuilt under a still-running session. Named, and answered by the
        // next present: the weight array is re-sent whenever the mesh moves.
        this.clear();
        return (
          `weights: the session sent a reference to ${key} that this overlay does not hold; ` +
          'the colours reappear on the next change to the mesh or the group'
        );
      }
    } else {
      if (weights.weightsBase64 === undefined || weights.alertBase64 === undefined) {
        this.clear();
        return `weights: ${key} carried neither an array nor a reference`;
      }
      const raw = bytesFrom(weights.weightsBase64);
      this.held = {
        key,
        weights: new Float32Array(raw.buffer, raw.byteOffset, weights.count),
        alerts: bytesFrom(weights.alertBase64),
      };
    }
    const held = this.held;
    if (held === null) return null;
    // WHAT MAKES THE DRAWING STALE: the array, the group, and the GEOMETRY the
    // colours are laid over (the presenter replaces it when the mesh moves).
    const signature = `${key}:${weights.digest}:${source.geometry.uuid}:${weights.alertMode}:${objectMatrix.elements.join(',')}`;
    if (signature === this.signature && this.mesh !== null) return null;
    this.signature = signature;
    this.clear();
    const geometry = source.geometry.clone();
    const position = geometry.getAttribute('position');
    // THE PRESENTED GEOMETRY IS DRAWN-OUT: the draw splits one Blender vertex
    // into as many drawn ones as its corners need (a UV seam, a sharp edge, a
    // flat face), so a per-vertex fact off the engine cannot be laid over it by
    // index. `blenderVertex` is the draw's own map, written by the one function
    // that creates a drawn vertex (`blender-runtime-geometry.ts`, `emit`).
    // Without it the overlay refuses by name rather than colouring by a guess.
    const sourceIndex = geometry.getAttribute('blenderVertex');
    if (sourceIndex === undefined) {
      geometry.dispose();
      return (
        'weights: the presented geometry carries no per-vertex Blender index ' +
        '(`blenderVertex`), so the weights cannot be laid over it'
      );
    }
    const colors = new Float32Array(position.count * 3);
    const unreferenced = new THREE.Color().setHex(VERTEX_UNREFERENCED, THREE.SRGBColorSpace);
    for (let i = 0; i < position.count; i++) {
      const vertex = sourceIndex.getX(i);
      const alert = weights.alertMode !== 'NONE' && held.alerts[vertex] === 1;
      const color = alert ? unreferenced : weightColor(held.weights[vertex] ?? 0);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // Read and dropped: a `Uint32Array` attribute nothing's shader declares is
    // dead weight on the upload, and the colours it produced are the drawing.
    geometry.deleteAttribute('blenderVertex');
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      // Blender's weight pass replaces the surface's shading with the ramp and
      // multiplies only by `color_fac`, which is 1 unless Fake Shading is on
      // (`overlay_paint_weight_vert.glsl:20-28`). An unlit material IS that.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${weights.object}:weights`;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(objectMatrix);
    mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    this.geometry = geometry;
    this.material = material;
    this.mesh = mesh;
    this.group.add(mesh);
    return null;
  }

  private clear(): void {
    if (this.mesh) this.group.remove(this.mesh);
    this.geometry?.dispose();
    this.material?.dispose();
    this.mesh = null;
    this.geometry = null;
    this.material = null;
  }

  dispose(): void {
    this.clear();
    this.held = null;
    this.signature = '';
  }
}
