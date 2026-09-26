/**
 * `armature-bones` — the EDIT-BONE vocabulary, and the one place its geometry
 * and its naming rules live. The bpy-shaped ARMATURE/POSE/ACTION sessions this
 * substrate carried were deleted 2026-09-19 (ARCHITECTURE-CORE §Blender north
 * star, “The mesh kit retires”): rigging and animation are Blender’s own now,
 * through the `blender` MCP server. What is left here is the
 * `BoneDef` <-> `EditBone` conversion and the measured bone-matrix rule
 * `skeleton.ts` builds on; `index.ts` publishes it.
 *
 * WHY AN EDIT BONE AND NOT A `BoneDef`. `skeleton.ts`'s `BoneDef` is the
 * kit's rig CURRENCY — `[name, parentIndex, localTranslation,
 * localQuaternion]`, exactly what `buildHumanoidSkeleton` /
 * `createArmatureGroup` / the mesh kit's `ARMATURE` deform consume. It is a
 * fine thing to hand around and a hopeless thing to EDIT: Blender's whole
 * armature grammar is phrased in head/tail/roll (extrude leaves from a tail,
 * subdivide splits a head→tail segment, `calculate_roll` sets the roll, and
 * `use_connect` is a statement about a head sitting on a parent's tail).
 * Parent-relative quaternions can express every one of those results and
 * none of those gestures.
 *
 * So the session's document is a tree of {@link EditBone} — Blender's own
 * `armature.edit_bones` shape — and {@link toBoneDefs} is the ONE conversion
 * that turns a finished armature back into the currency. Nothing downstream
 * changes; a session's output drops into `buildHumanoidSkeleton(defs)`
 * unmodified.
 *
 * COORDINATES: this file is in the BoneDef table's own space, which is
 * Blender's. `skeleton.ts`'s table is authored Z-up (see its header and
 * `createArmatureGroup`'s `ARMATURE_ROTATION_X`), so an armature session
 * transliterated from a bpy session keeps its axis letters — the mesh
 * dialect's standing "axes are three's" delta (`blender-ops.ts` header) does
 * NOT apply here, because the rig substrate is already Z-up. Units are
 * whatever the caller uses; `createArmatureGroup` applies the table's own
 * `ARMATURE_SCALE`, so bones authored in metres land 100× small unless you
 * scale them.
 *
 * THE BONE MATRIX (`vec_roll_to_mat3`, measured — never transcribed). A
 * bone's rest orientation is fully determined by its direction and roll:
 * the local +Y axis runs head→tail, and `roll` rotates the frame about that
 * axis. The roll-0 reference frame is the MINIMAL-ARC rotation taking +Y to
 * the bone direction; the antipodal case (direction exactly −Y) is a π turn
 * about +Z. Both were read out of bpy 5.2 rather than assumed:
 * `bone.matrix` over a 36-case direction × roll sweep matches
 * {@link boneMatrix} to 1.4e-7 (bpy stores float32).
 *
 * STANDING DELTA — the float32 band. Blender computes that frame in float32,
 * this kit in float64. For a direction within ~1.4e-4 rad of the −Y armature
 * axis, bpy's `1 + n.y` underflows to zero and it takes the antipodal
 * branch where this kit still has a well-defined minimal arc. Measured
 * consequence: identical bone DIRECTION, a roll-reference frame that differs
 * by up to a π turn about the bone axis (matrix entries up to 1.28). Outside
 * that band the two agree exactly. Set `roll` explicitly on a bone that
 * points backwards along −Y if you care.
 */

import * as THREE from 'three';
import type { BoneDef } from './skeleton';

/** Blender's `armature.edit_bones[i]` — the session's own document node.
 *
 *  MUTABLE on purpose: this is the thing the ops write, and a session that
 *  had to rebuild the tree per op would lose the identity every parent
 *  pointer is expressed in. */
export interface EditBone {
  /** Unique within the armature. Bone names are the whole binding contract
   *  downstream — a vertex group binds to the bone of the SAME name
   *  (`armatureDeform`), and clip tracks address bones by name. */
  name: string;
  /** Joint the bone starts at, in armature space. */
  readonly head: THREE.Vector3;
  /** Joint the bone ends at. `head === tail` is a zero-length bone, which
   *  `bpy.ops.armature.extrude` produces on purpose (see its op). */
  readonly tail: THREE.Vector3;
  /** Rotation of the bone frame about its own head→tail axis, radians. */
  roll: number;
  /** Parent bone's NAME, or `null` for a root. */
  parent: string | null;
  /** Blender's `use_connect`: this bone's head IS its parent's tail, and
   *  moving the parent's tail drags it. Only meaningful with a parent. */
  connected: boolean;
}

/** The kit's armature document: edit bones in insertion order, by name. */
export type ArmatureDocument = Map<string, EditBone>;

/** Make an edit bone. Vectors are COPIED — a caller's `THREE.Vector3` never
 *  becomes live document state by accident. */
export function makeEditBone(
  name: string,
  head: THREE.Vector3 | readonly [number, number, number],
  tail: THREE.Vector3 | readonly [number, number, number],
  options: { roll?: number; parent?: string | null; connected?: boolean } = {},
): EditBone {
  const toVec = (v: THREE.Vector3 | readonly [number, number, number]): THREE.Vector3 =>
    v instanceof THREE.Vector3 ? v.clone() : new THREE.Vector3(v[0], v[1], v[2]);
  return {
    name,
    head: toVec(head),
    tail: toVec(tail),
    roll: options.roll ?? 0,
    parent: options.parent ?? null,
    connected: options.connected ?? false,
  };
}

/** Below this, `1 + n.y` is treated as an exact antipode. Deliberately far
 *  tighter than three's own `setFromUnitVectors` epsilon (1e-4): that one
 *  would take the flip branch for every bone within ~0.8° of −Y, where
 *  Blender still computes the minimal arc, and the whole point of this
 *  function is to agree with Blender. */
const ANTIPODE_EPSILON = 1e-12;

/**
 * The bone's rest ROTATION in armature space, from its direction and roll —
 * Blender's `vec_roll_to_mat3`, measured (see the header).
 *
 * The returned matrix's second COLUMN is the normalized head→tail direction;
 * the first and third are the frame `roll` rotates. A zero-length bone has
 * no direction and throws, because every caller that would consume the
 * result (a `BoneDef` quaternion, an `autoside` sign, a roll calculation)
 * would otherwise silently get identity.
 */
export function boneMatrix(bone: EditBone): THREE.Matrix4 {
  const direction = new THREE.Vector3().subVectors(bone.tail, bone.head);
  const length = direction.length();
  if (length === 0) {
    throw new Error(
      `armature: bone '${bone.name}' is zero-length (head === tail), so it has no rest ` +
        'orientation. `extrude` leaves a bone exactly there on purpose — move its tail ' +
        '(ctx.ops.armature.extrude_move, or set `tail` directly) before reading a matrix ' +
        'or emitting bone defs.',
    );
  }
  const n = direction.divideScalar(length);
  const basis = new THREE.Matrix4();
  if (1 + n.y > ANTIPODE_EPSILON) {
    const k = 1 / (1 + n.y);
    // Rodrigues for the minimal arc +Y → n, expanded: v = cross(+Y, n) is
    // (n.z, 0, -n.x), which collapses the general form to these six terms.
    basis.set(
      1 - k * n.x * n.x,
      n.x,
      -k * n.x * n.z,
      0,
      -n.x,
      n.y,
      -n.z,
      0,
      -k * n.x * n.z,
      n.z,
      1 - k * n.z * n.z,
      0,
      0,
      0,
      0,
      1,
    );
  } else {
    // Exactly −Y: a π turn about +Z, which is what bpy returns (measured).
    basis.set(-1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  }
  return bone.roll === 0 ? basis : basis.multiply(new THREE.Matrix4().makeRotationY(bone.roll));
}

/** The bone's full rest transform in armature space — Blender's
 *  `bone.matrix_local`: {@link boneMatrix} with the head as translation.
 *  Verified against bpy's own `matrix_local` on a mixed connected/offset
 *  chain to 1.5e-7. */
export function boneMatrixLocal(bone: EditBone): THREE.Matrix4 {
  return boneMatrix(bone).setPosition(bone.head);
}

/**
 * The roll a bone would need for its rest frame to be `matrix` — the inverse
 * of {@link boneMatrix}, and what `armature_apply` and `switch_direction`
 * use to re-derive a roll after moving a bone's ends.
 *
 * `matrix`'s second column must already be the bone's direction (both ops
 * satisfy that by construction); only its first/third columns are read.
 */
export function rollForMatrix(bone: EditBone, matrix: THREE.Matrix4): number {
  const reference = boneMatrix({ ...bone, roll: 0 });
  const axis = new THREE.Vector3().setFromMatrixColumn(reference, 1);
  const from = new THREE.Vector3().setFromMatrixColumn(reference, 2);
  const to = new THREE.Vector3().setFromMatrixColumn(matrix, 2);
  const sin = new THREE.Vector3().crossVectors(from, to).dot(axis);
  return Math.atan2(sin, from.dot(to));
}

/**
 * Bone order for a `BoneDef` table: the document's own INSERTION order,
 * minimally reordered so every parent precedes its children —
 * `buildHumanoidSkeleton`'s stated requirement and `BoneDef.parentIndex`'s
 * meaning.
 *
 * A STABLE topological sort, not a depth-first walk, and the difference is
 * load-bearing: row order defines skinIndex, and the shipped rig deliberately
 * APPENDS its three face joints after the toe chain rather than interleaving
 * them under the head (see `skeleton.ts`'s comment on exactly that). A DFS
 * would relocate them and silently re-point every weight; this leaves any
 * table that is already valid — the shipped one included — untouched, and
 * only moves a bone the ops parented backwards.
 *
 * DELTA: bpy's own `edit_bones` collection order after `subdivide`/`extrude`
 * is its internal bookkeeping (a 2-cut subdivide leaves `Base`, `Base.002`,
 * `Base.001`). Nothing depends on that order in Blender; here it would decide
 * skin indices, so the kit stays deterministic instead of reproducing it.
 */
export function boneOrder(document: ArmatureDocument): EditBone[] {
  const remaining = [...document.values()];
  const emitted = new Set<string>();
  const ordered: EditBone[] = [];
  while (remaining.length > 0) {
    const index = remaining.findIndex((bone) => bone.parent === null || emitted.has(bone.parent));
    if (index < 0) {
      throw new Error(
        `armature: ${remaining.length} bone(s) are unreachable from any root — the parent ` +
          `graph has a cycle or a dangling parent (${remaining
            .slice(0, 5)
            .map((bone) => `'${bone.name}' → '${String(bone.parent)}'`)
            .join(', ')}). Break it with ctx.ops.armature.parent_clear.`,
      );
    }
    const [bone] = remaining.splice(index, 1) as [EditBone];
    emitted.add(bone.name);
    ordered.push(bone);
  }
  return ordered;
}

/**
 * The finished armature as the kit's rig currency — `BoneDef` rows in
 * {@link boneOrder}, ready for `buildHumanoidSkeleton`.
 *
 * Each row's transform is the bone's rest matrix expressed in its PARENT's
 * rest frame (`parent.matrix_local⁻¹ · bone.matrix_local`), which is the
 * same decomposition glTF's node hierarchy uses and the same one
 * `MIXAMO_SKELETON_DEF` was extracted with. A connected child therefore gets
 * a translation of exactly `[0, parentLength, 0]` — verified against bpy on
 * a mixed chain — which is why the shipped table is full of `[0, 23.16, 0]`
 * rows.
 */
export function toBoneDefs(document: ArmatureDocument): BoneDef[] {
  const ordered = boneOrder(document);
  const index = new Map(ordered.map((bone, i) => [bone.name, i]));
  const world = new Map<string, THREE.Matrix4>();
  const defs: BoneDef[] = [];
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  for (const bone of ordered) {
    const matrix = boneMatrixLocal(bone);
    world.set(bone.name, matrix);
    const parentMatrix = bone.parent === null ? undefined : world.get(bone.parent);
    const local =
      parentMatrix === undefined
        ? matrix.clone()
        : new THREE.Matrix4().copy(parentMatrix).invert().multiply(matrix);
    local.decompose(position, quaternion, scale);
    defs.push([
      bone.name,
      bone.parent === null ? -1 : (index.get(bone.parent) as number),
      [position.x, position.y, position.z],
      [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
    ]);
  }
  return defs;
}

// -------------------------------------------------------------- bone names

/** Blender's `.NNN` disambiguator, split off a name. `hand.l.002` →
 *  `['hand.l', '.002']`; a name with no numeric tail keeps an empty tail. */
function splitNumberSuffix(name: string): readonly [string, string] {
  const match = /^(.*)(\.\d{3,})$/.exec(name);
  return match ? [match[1] as string, match[2] as string] : [name, ''];
}

/**
 * A name that is free in `taken`, by Blender's own `.NNN` rule — the
 * uniquifier behind `bone_primitive_add`, `extrude` and `subdivide`
 * (measured: a second `Bone` becomes `Bone.001`; a 3-cut subdivide of
 * `Base` yields `Base.001`, `Base.002`, `Base.003`).
 */
export function uniqueBoneName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const [base] = splitNumberSuffix(name);
  for (let n = 1; n < 100000; n++) {
    const candidate = `${base}.${String(n).padStart(3, '0')}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`armature: cannot find a free name for '${name}'`);
}

/** The side separators Blender recognizes around a side token. */
const SEPARATORS = new Set(['.', '-', '_']);

/** `left`/`right` written the way the matched text was — the case rule
 *  measured from bpy: `LEFT_hand` → `RIGHT_hand`, `Bone.Left` →
 *  `Bone.Right`, `arm.left` → `arm.right`. */
function matchCase(source: string, replacement: string): string {
  if (source === source.toUpperCase()) return replacement.toUpperCase();
  if (source[0] === (source[0] as string).toUpperCase()) {
    return (replacement[0] as string).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

const OTHER_LETTER: Readonly<Record<string, string>> = { L: 'R', R: 'L', l: 'r', r: 'l' };

/**
 * `bpy.ops.armature.flip_names` for ONE name — the .L/.R swap, in every
 * spelling bpy recognizes. MEASURED, as a 23-name table run through bpy 5.2
 * (see `docs/BLENDER-PARITY.md` §9's oracle): single-letter suffix
 * (`Bone.L`, `Bone_R`, `Bone-l`), single-letter prefix (`L_arm`), and the
 * whole word at either end in any case (`LeftArm`, `Left_Arm`, `arm.left`,
 * `bone.LEFT`).
 *
 * A name with no side token comes back UNCHANGED — including its `.NNN`
 * tail, even when `stripNumbers` is set (`Bone.001` → `Bone.001`, measured).
 * That is the rule that makes `flip_names` safe to run over a whole
 * armature.
 */
export function flipSideName(name: string, stripNumbers = false): string {
  const [base, numbers] = splitNumberSuffix(name);
  const flipped = flipSideBase(base);
  if (flipped === null) return name;
  return stripNumbers ? flipped : flipped + numbers;
}

/** The side swap on a name with its `.NNN` tail already removed, or `null`
 *  when the name carries no side token. */
function flipSideBase(base: string): string | null {
  // 1. single-letter SUFFIX: `Bone.L`, `Bone_r`, `Bone-R`.
  if (base.length > 2) {
    const last = base[base.length - 1] as string;
    const separator = base[base.length - 2] as string;
    if (SEPARATORS.has(separator) && OTHER_LETTER[last] !== undefined) {
      return base.slice(0, -1) + (OTHER_LETTER[last] as string);
    }
  }
  // 2. single-letter PREFIX: `L_arm`.
  if (base.length > 2) {
    const first = base[0] as string;
    if (OTHER_LETTER[first] !== undefined && SEPARATORS.has(base[1] as string)) {
      return (OTHER_LETTER[first] as string) + base.slice(1);
    }
  }
  // 3. the WORD, at either end. Prefix first: `LeftArm`, `LEFT_hand`.
  for (const [word, other] of [
    ['left', 'right'],
    ['right', 'left'],
  ] as const) {
    const head = base.slice(0, word.length);
    if (head.toLowerCase() === word) return matchCase(head, other) + base.slice(word.length);
  }
  for (const [word, other] of [
    ['left', 'right'],
    ['right', 'left'],
  ] as const) {
    const tail = base.slice(-word.length);
    if (base.length > word.length && tail.toLowerCase() === word) {
      return base.slice(0, -word.length) + matchCase(tail, other);
    }
  }
  return null;
}

/** `autoside_names`' three axes, each with the token it appends on the
 *  positive and negative side — measured from bpy: X is `L`/`R`, Y is
 *  `Bk`/`Fr` (Blender's front is −Y), Z is `Top`/`Bot`. */
export const AUTOSIDE_TOKENS: Readonly<Record<string, readonly [string, string]>> = {
  XAXIS: ['L', 'R'],
  YAXIS: ['Bk', 'Fr'],
  ZAXIS: ['Top', 'Bot'],
};

/** Every token `autoside_names` STRIPS before appending — all six, on every
 *  axis (measured: an X-axis run renames `a.Fr` to `a.L`, and a Z-axis run
 *  renames `e.L` to `e.Top`). Only DOT-separated, only this exact casing:
 *  bpy leaves `Bone_L` and `Bone.l` alone, appending to them. */
const AUTOSIDE_STRIPPED = new Set(['L', 'R', 'Fr', 'Bk', 'Top', 'Bot']);

/** Drop every trailing `.<side token>`, repeatedly — the measured rule that
 *  turns `Bone.L.R` into `Bone` but leaves `arm.L.001` whole (its last
 *  component is a number, so the walk stops there). */
function stripSideTokens(name: string): string {
  let current = name;
  for (;;) {
    const dot = current.lastIndexOf('.');
    if (dot <= 0) return current;
    if (!AUTOSIDE_STRIPPED.has(current.slice(dot + 1))) return current;
    current = current.slice(0, dot);
  }
}

/**
 * `bpy.ops.armature.autoside_names` for ONE bone — the name it should carry
 * given which side of `axis` it sits on. Returns the name UNCHANGED when the
 * bone is on the centerline.
 *
 * MEASURED semantics, both of which a plausible guess gets wrong:
 * - the side is read off the HEAD, falling back to the tail only when the
 *   head's coordinate is exactly 0 (a bone from head −1 to tail +2 is `.R`,
 *   not `.L` — the midpoint would have said otherwise);
 * - the threshold is exact zero, not an epsilon (a head at 1e-7 gets `.L`).
 *
 * The caller uniquifies: bpy collides these into `.001` suffixes through the
 * armature's own name table, which only the session knows.
 */
export function autosideName(bone: EditBone, axis: string): string {
  const tokens = AUTOSIDE_TOKENS[axis];
  if (!tokens) {
    throw new Error(
      `armature.autoside_names: unknown axis '${axis}' — expected ${Object.keys(AUTOSIDE_TOKENS)
        .map((key) => `'${key}'`)
        .join(', ')}`,
    );
  }
  const component = axis === 'XAXIS' ? 'x' : axis === 'YAXIS' ? 'y' : 'z';
  const head = bone.head[component];
  const value = head !== 0 ? head : bone.tail[component];
  if (value === 0) return bone.name;
  return `${stripSideTokens(bone.name)}.${(value > 0 ? tokens[0] : tokens[1]) as string}`;
}

// ------------------------------------------------- the three-side spelling

/**
 * THE NAME BOUNDARY: an armature-document bone name as the THREE side must
 * spell it — every `.` becomes `_`.
 *
 * WHY IT EXISTS, measured on three r180 rather than assumed. `.` is the one
 * character in Blender's bone-name grammar that three's
 * `PropertyBinding.sanitizeNodeName` DELETES, and the deletion is silent and
 * one-way:
 *
 * | spelling | `sanitizeNodeName` | after a GLB round trip |
 * |---|---|---|
 * | `Arm.L`  | `ArmL`  | the GLB's node is written `Arm.L`, `GLTFLoader` renames it `ArmL`, and the clip's track comes back `ArmL.quaternion` |
 * | `Arm_L`  | `Arm_L` | unchanged, both node and track |
 *
 * The file itself still plays, because the loader renames the tracks to
 * match — so nothing warns. What breaks is every address that crosses the
 * boundary in only one direction: `getObjectByName('Arm.L')` on a loaded
 * model, a retarget map keyed off the armature document, a second clip
 * authored from that document, Blender's own re-import. And once the two
 * sides disagree by one character the failure IS total and IS quiet:
 * measured here, exporting a clip whose track names the rig's other spelling
 * writes **zero** animation channels behind one
 * `console.warn('THREE.GLTFExporter: Could not export animation track "%s".')`.
 *
 * (`PropertyBinding.parseTrackName` itself is FINE with dots — it reads
 * `Arm.L.quaternion` as node `Arm.L`, property `quaternion`. The dot-split
 * story is not the mechanism; the sanitizer is.)
 *
 * So the kit keeps Blender's names where the bpy grammar needs them — the
 * ARMATURE DOCUMENT, `EditBone.name`, `autosideName`, `flipSideName`,
 * `toBoneDefs()` rows — and
 * translates only where a name becomes a `THREE.Bone`'s: see
 * `buildHumanoidSkeleton`, which also keeps the document spelling resolvable
 * through `rig.byName`, so both `byName.get('Arm.L')` and
 * `byName.get('Arm_L')` reach the same bone.
 *
 * The side-aware ops need no translation table: `flipSideName` and
 * `uniqueBoneName` already read `.`, `-` and `_` as separators (bpy's own
 * rule), so `Arm_L` flips to `Arm_R` exactly as `Arm.L` flips to `Arm.R`.
 * `autosideName` is the one that deliberately does NOT — it emits bpy's
 * dot-separated token because it is an armature-document op, and bpy leaves
 * `Bone_L` alone too (measured, above).
 */
export function threeBoneName(name: string): string {
  return name.replace(/\./g, '_');
}
