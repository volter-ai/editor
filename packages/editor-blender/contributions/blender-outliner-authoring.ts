/**
 * THE OUTLINER IS BLENDER'S DATABLOCK TREE, DRAWN BY OUR HIERARCHY PANEL
 * (ARCHITECTURE-CORE §Blender north star, "Inspection parity, not editing
 * parity"; WORK.md §Blender in the tab is Blender, "Inspection parity", I3).
 *
 * The Model document's rows used to be the PRESENTER's three.js graph — "Model
 * › ModelLighting, Cube, Probe", a reading of Blender's data by the thing that
 * draws the photograph. What Blender's own Outliner shows is the VIEW LAYER:
 * Scene Collection, its collections, their objects, and under each object the
 * datablocks it carries. That tree is the engine's, `rna_outliner` answers it,
 * and this is the `HierarchyProvider` that hands it to `GameHierarchy`.
 *
 * IT REPLACES NOTHING ELSE. `ToolObject3DAuthoringProps.authoring` hands the
 * document the host's DEFAULT adapter for delegation, and everything that is
 * genuinely about the three.js presentation still goes to it: the transform
 * the gizmo reads, the object a raycast hit, the selection the viewport
 * outlines. What this overrides is the TREE and what a row means — because
 * only the engine knows there is a Subdivision modifier on that cube.
 *
 * THE TWO ID SPACES, and the one place they meet. A row's id is Blender's own
 * address (`bpy.data.objects["Cube"].modifiers["Subdivision"]`); the default
 * adapter's ids are the presenter's three ids. They meet at `object3D`: a row
 * that names an OBJECT resolves through the presented frame's own table
 * (`BlenderRuntimeView.objectForBlenderName`, a lookup by the frame's id and
 * never by `object.name`), and every delegation below goes through that one
 * function. A row with no object — a collection, a vertex group, a bone —
 * simply has none, which is the honest answer and the one the shell already
 * treats as "no object here".
 *
 * AND THE SPACES MEET BOTH WAYS, which is the half that was missing.
 * `selection.set` PUBLISHES the presentation's ids into the shell store (so
 * the viewport's own selection machinery keeps working), and the viewport
 * then asks THIS adapter about those ids: `editor-viewport.ts` computes its
 * gizmo subject from `store.selectedEntityId` and runs it through
 * `hierarchy.node` / `transforms.editability` / `_objectForAuthoringId`. So
 * every id arriving from outside is normalized by {@link rowIdFor} — a row id
 * passes through, a presentation id is resolved to its object and mapped back
 * to the row that names it.
 *
 * SELECTING A DATABLOCK SELECTS ITS OBJECT, which is Blender's own behaviour
 * rather than a convenience: `outliner_select.cc`'s activation walks back to
 * the owning object (`outliner_search_back_te(te, ID_OB)`, `:863`) and sets
 * the index on IT, which is why clicking a shape key in Blender moves the
 * Properties editor to that object. The door carries the owning object per row
 * (`BlenderOutlinerRow.object`) and that is what this selects.
 *
 * AND IT WRITES NOW — the "inspection parity, not editing parity" the first
 * line cites is the order the UI was BUILT in, and the editing half of it is
 * on the release's critical path as of the owner's 2026-09-21 amendment to
 * ARCHITECTURE-CORE §Blender north star goal 3 ("the key to the edit is just
 * macro adjustments"). Three providers here write, each one bpy call through a
 * door that already existed: {@link transforms} (`rna-set` of `matrix_world`,
 * B5), the `name` half of {@link inspector} (`rna-set` of `Object.name`), and
 * {@link structure} (`bpy.ops.*` through the script door — add, delete,
 * duplicate). Every one of them is Blender running its own code; none of them
 * reimplements an operator.
 */

import type { BlenderOutlinerRow } from '@volter/blender-engine/browser/rna';
import type { ToolObject3DDocumentAuthoringFactory } from '@volter/editor-sdk/contributions';
import { editorHost } from '@volter/editor-sdk/host';
import type {
  AuthoringAdapter,
  AuthoringCapabilities,
  AuthoringProvenance,
  EditorNode,
  HierarchyProvider,
  InspectorProvider,
  PropertyDescriptor,
  SelectionProvider,
  StructuralIdWrite,
  StructureProvider,
  Transform,
  TransformProvider,
  WriteAck,
} from '@volter/editor-project/adapter';
import type * as THREE from 'three';
import { threeObject } from '@volter/editor-threejs/adapter/three-contract';
import { blenderExecute, blenderRnaSet, beginBlenderGesture, endBlenderGesture } from '../host/blender-runtime-host';
import {
  blenderEngineSelection,
  blenderOutlinerState,
  blenderOutlinerVersion,
  blenderPresentedView,
  onBlenderFrame,
  refreshBlenderOutliner,
  showBlenderOutliner,
  subscribeBlenderOutliner,
  writeBlenderOutlinerColumn,
} from './blender-outliner-model';

/**
 * A ROW'S GLYPH IS BLENDER'S OWN MARK, named through the adapter's `kind`.
 *
 * `tree_element_get_icon` (`outliner_draw.cc:2619-2945`) picks an `ICON_*` per
 * row; the door reports that name; this spells it as the icon-set glyph name
 * `@volter/editor-blender`'s set draws (`blender-icons.source.mjs`, where the outliner
 * marks are traced from `release/datafiles/icons_svg/<name>.svg`). A set that
 * does not carry the name falls through to Font Awesome's own, which is what
 * `hierarchy-kind-icon.ts`'s `blender-` rule guarantees.
 */
export function blenderOutlinerKind(icon: string): string {
  return `blender-${icon.toLowerCase().replace(/_/g, '-')}`;
}

/**
 * IS THIS ROW A BLENDER OBJECT? — the one predicate every writer in this file
 * gates on, because an object is the only datablock this unit adds, deletes,
 * duplicates or renames. `rna_outliner`'s object rows are the ones that carry
 * `struct: 'Object'` and their own name in `object` (`session.py`'s
 * `_outliner_object`); a collection, a modifier, a vertex group and a bone all
 * answer no.
 */
function isObjectRow(row: BlenderOutlinerRow | undefined): row is BlenderOutlinerRow & {
  object: string;
} {
  return row?.type === 'TSE_SOME_ID' && row.struct === 'Object' && row.object !== undefined;
}

/** What the shell calls this row's TYPE on the inspector's identity row.
 *  Blender's Outliner prints no type text at all (`blender.style.ts`'s
 *  `hierarchyTypeSuffix: 'hidden'` measured that on `outliner.png`), so this
 *  is only ever read where a type is genuinely asked for. */
function typeLabel(row: BlenderOutlinerRow): string | undefined {
  if (row.struct) return row.struct;
  // A base row is a LABEL in Blender ("Modifiers", "Vertex Groups", "Pose"),
  // and `TSE_MODIFIER_BASE` is not a noun a person says. Nothing here.
  return undefined;
}

function nodeFor(row: BlenderOutlinerRow, parentId: string | null): EditorNode {
  return {
    id: row.id,
    label: row.name,
    // EVERY BLENDER ROW IS `entity`, INCLUDING THE COLLECTIONS. `folder` reads
    // as structural to the shell (`GameHierarchy.tsx`'s `STRUCTURAL_ROLES`),
    // and a structural row is drawn NO restriction columns — while Blender
    // draws a collection the same eye and camera it draws an object
    // (`outliner_draw.cc:1620-1700`). The role is what the shell branches on;
    // the KIND is what says what this is.
    role: 'entity',
    kind: blenderOutlinerKind(row.icon),
    ...(typeLabel(row) ? { typeLabel: typeLabel(row) as string } : {}),
    parentId,
    childIds: row.children.map((child) => child.id),
    // BLENDER'S OWN DEFAULT OPEN STATE, not the shell's shape heuristic: a
    // fresh tree-store element is CLOSED (`outliner_tree.cc:139`) and only the
    // Scene Collection and the layer collections clear that flag
    // (`tree_display_view_layer.cc:130,167`).
    defaultExpanded: row.expanded,
  };
}

const CAPABILITIES: AuthoringCapabilities = {
  // The transform writes through `rna-set`, the same way the restriction
  // columns write through `outliner_set` — see {@link transforms} below.
  transform: true,
  inspectorFields: false,
  // The restriction columns write through `outliner_set`, and that write
  // reaches the engine and the `.blend` the session saves.
  persist: true,
};

/**
 * THE ADAPTER, PLUS THE TWO MEMBERS THE PROPERTIES RAIL LOOKS FOR.
 *
 * `documentId` and `documentRootObject` are not on `AuthoringAdapter` — which
 * is exactly why `blender-properties-model.ts`'s `isObject3DAuthoring` checks
 * for them structurally — so they have to be declared somewhere for this
 * literal to typecheck. Here, once, rather than at each getter: the literal
 * used to carry a conditional spread, and a spread is what was silently
 * suppressing TypeScript's excess-property check on them.
 */
interface BlenderOutlinerAdapter extends AuthoringAdapter {
  readonly documentId: string | undefined;
  readonly documentRootObject: THREE.Object3D | null | undefined;
}

/**
 * THE MODEL DOCUMENT'S OUTLINER, AS THE HEADER MENUS REACH IT.
 *
 * Blender's 3D viewport header draws Select, Add and Object
 * (`VIEW3D_MT_editor_menus`, `space_view3d.py:1153-1210`), and every row in
 * them acts on the SAME subject the Outliner does. The header is a different
 * React tree from the hierarchy panel and gets no adapter in its props, so the
 * adapter publishes this handle and the menus drive it — rather than the menus
 * growing a second selection and a second set of operators beside the
 * provider's.
 */
export interface BlenderOutlinerHandle {
  readonly documentId: string | undefined;
  /** The Blender object NAMES the panel's selection covers — the header's
   *  subject for every Object-menu row, and for Select ▸ Invert. */
  selectedObjectNames(): readonly string[];
  /** Every object in the View Layer tree, in the tree's own order — Select ▸
   *  All, and the complement Invert takes. */
  allObjectNames(): readonly string[];
  /** Publish a selection by object NAME (the header's own currency). */
  selectObjects(names: readonly string[]): void;
  /** The ROW id an object name addresses — what {@link StructureProvider}
   *  takes. The header speaks in names because that is Blender's currency and
   *  the engine's; the provider speaks in rows, and this is where they meet.
   *  Never spelled as a literal address by a caller: a row id carries
   *  `_rna_address`' own identifier escaping and `_outliner_unique`'s
   *  disambiguating suffix, neither of which a caller can reconstruct. */
  rowIdForObject(name: string): string | null;
  readonly structure: StructureProvider;
  subscribe(listener: () => void): () => void;
}

/**
 * THE LIVE OUTLINERS, by the document each is the Outliner of.
 *
 * A Set rather than a Map because the adapter's `documentId` is a GETTER off
 * the default adapter (see {@link BlenderOutlinerAdapter}) and is not
 * necessarily resolved when the factory runs, so there is no key to register
 * under at that moment.
 */
const liveOutliners = new Set<BlenderOutlinerHandle>();

/**
 * The Outliner handle for a document, for the header that draws over it.
 *
 * The fallback when no handle names that document is the SINGLE live one, and
 * it is sound rather than lax: the Blender engine is one session bound to one
 * `.blend` at a time (`blender-runtime-host.ts`'s `bindModelDocument`), so a
 * second Model document with its own Outliner over the same engine is not a
 * state this package can be in. With two, a document that cannot name itself
 * answers null rather than guessing.
 */
export function blenderOutlinerHandle(documentId?: string): BlenderOutlinerHandle | null {
  for (const handle of liveOutliners) if (handle.documentId === documentId) return handle;
  return liveOutliners.size === 1 ? [...liveOutliners][0]! : null;
}

/** The transform of a subject this adapter does not own. `TransformProvider.get`
 *  has no absent answer, and the caller has already been told through
 *  `editability` that there is nothing to move here. A fresh object per call —
 *  the arrays are the caller's to keep. */
const NO_TRANSFORM = (): Transform => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
});

/**
 * A presented object's pose, back in BLENDER's space and in the shape the RNA
 * door's WRITE half takes.
 *
 * The presented root carries the signed axis permutation P that takes
 * Blender's Z-up into three's Y-up — written as an exact matrix in
 * `blender-runtime-view.ts`'s constructor precisely so it inverts exactly —
 * and every presented object hangs under it. So `P⁻¹ · object.matrixWorld` is
 * the matrix Blender calls `matrix_world`. The root's own WORLD matrix is what
 * is inverted, not the literal, so any transform the stage puts above it is
 * divided out too.
 *
 * THE TWO HALVES OF `matrix_world` USE OPPOSITE ORDERS, and that is measured
 * rather than reasoned (2026-09-21, live, through `blender-rna-set` on the
 * default cube):
 *
 *   sent `[[1,0,0,0.5],[0,1,0,0],[0,0,1,0],[0,0,0,1]]` → `location` stayed
 *     `[0,0,0]` and the next depsgraph evaluation put `matrix_world` back to
 *     identity — Blender read the translation as the projective row, found
 *     none to decompose, and recomputed the matrix from loc/rot/scale;
 *   sent `[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0.5,0,0,1]]` → `location` reads
 *     `[0.5,0,0]` and `matrix_world` reads back `[1,0,0,0.5, …]`.
 *
 * So the WRITE goes into Blender's C `float[4][4]` in C order — entry `i` is
 * the i-th COLUMN of the `mathutils.Matrix` a Python read returns — while the
 * READ (`session.py`'s `_rna_value`, and the frame's
 * `[[float(v) for v in row] for row in obj.matrix_world]`) is that Matrix's
 * ROWS. The frame's reader is right to be row-major
 * (`blender-runtime-view.ts` feeds it to `Matrix4.set`, which is row-major);
 * this writer is its transpose.
 *
 * Which makes the code the simplest form of all: `THREE.Matrix4.elements` is
 * ALREADY column-major, so the four groups of four are the four entries
 * Blender wants, in order.
 */
function blenderWorldMatrixRows(object: THREE.Object3D, root: THREE.Object3D): number[][] {
  // The ancestors too: a presented object owns its matrix
  // (`matrixAutoUpdate = false`), so nothing recomposes it for us.
  object.updateWorldMatrix(true, false);
  const e = root.matrixWorld.clone().invert().multiply(object.matrixWorld).elements;
  return [
    [e[0]!, e[1]!, e[2]!, e[3]!],
    [e[4]!, e[5]!, e[6]!, e[7]!],
    [e[8]!, e[9]!, e[10]!, e[11]!],
    [e[12]!, e[13]!, e[14]!, e[15]!],
  ];
}

/**
 * BLENDER'S ADD MENU, AS KINDS — every row `VIEW3D_MT_add` draws in Object
 * Mode, each with Blender's OWN label and the `bpy.ops` call its row runs
 * (`scripts/startup/bl_ui/space_view3d.py` at the engine's pin, cited per
 * row). The menu's SHAPE — Blender's order, its separators and which rows are
 * submenus — is `blender-header-menus.tsx`'s `ADD_MENU`, which names these
 * kinds; this table is what each one DOES.
 *
 * EVERY ONE IS BLENDER RUNNING ITS OWN OPERATOR. There is no second
 * implementation of a primitive's defaults, its vertex count or its shading
 * here; the kind names the operator and the engine does the rest.
 *
 * A NEW OBJECT LANDS AT THE 3D CURSOR, as in Blender: no row states a
 * `location`, and an unset one is `scene->cursor.location`
 * (`editors/object/object_add.cc`, `location_from_view`). The cursor is drawn
 * and placed on the Model document (`blender-runtime-cursor.ts`).
 *
 * A ROW THAT NEEDS A FILE IS DRAWN DISABLED WITH THE REASON, never as a
 * gesture that cannot complete (the shape B6 set for Set Origin ▸ Origin to 3D
 * Cursor). Blender's Image ▸ Reference/Background/Mesh Plane and Volume ▸
 * Import OpenVDB open a FILE BROWSER; this editor has no door to open one
 * through — `EditorHost.files` (`@volter/editor-sdk/host`) reads and writes
 * project-relative paths and has no "pick a file" member at all — so those
 * rows carry {@link BlenderCreatableKind.refusal} instead. Measured at the
 * engine on 2026-09-21: `object.empty_image_add` answers "poll() failed,
 * context is incorrect / Please select at least one image", and
 * `image.import_as_mesh_planes` and `object.volume_import` both return
 * `CANCELLED` having created nothing — so the alternative was a row that
 * looked like it worked.
 *
 * Blender's OWN conditional rows are read as conditions, not copied: `Search…`
 * (`:2689`) draws only under `EXEC_REGION_WIN` and opens a menu-search dialog
 * this editor does not have; Armature and Camera draw as SUBMENUS only when an
 * add-on has extended them (`is_extended()`, `:2713`/`:2732`) and this engine
 * loads none, so both are the flat row Blender falls through to; Curve's
 * `Random` row (`:2471`) stands on `preferences.experimental.use_new_curves_tools`
 * and this build reports `bpy.app.build_options.experimental_features` False.
 */
export interface BlenderCreatableKind {
  /** The `kind` string the shell round-trips into {@link StructureProvider.create}. */
  readonly kind: string;
  /** Blender's own row text. */
  readonly label: string;
  /** Which of `VIEW3D_MT_add`'s submenus the row sits in — Blender's own
   *  submenu label — for a menu that draws the structure (the document's
   *  header); the flat creation palette ignores it, Blender's labels being
   *  distinct across this set. `null` is a row `VIEW3D_MT_add` draws directly. */
  readonly group: string | null;
  /** The call, complete. */
  readonly call: string;
  /** This editor cannot run the row, and this is the sentence saying why — the
   *  row is drawn DISABLED with it as its reason and the operator is never
   *  called. */
  readonly refusal?: string;
  /** Blender draws a `layout.separator()` above this row inside its submenu
   *  (Mesh `:2437`, Curve `:2458` and `:2464`, Grease Pencil `:2636`). */
  readonly separatorBefore?: boolean;
}

/** The refusal every FILE row carries, naming the door that does not exist so
 *  the reader knows what would close it rather than that "it doesn't work". */
function needsAFilePicker(what: string, blenderSaid: string): string {
  return (
    `${what} needs a file, and this editor has no door to ask for one: the host's file ` +
    `door (\`EditorHost.files\`, \`@volter/editor-sdk/host\`) reads and writes ` +
    `project-relative paths and has no file-picker member, so there is nothing to open ` +
    `the workbench's own dialog through. Blender's row opens a file browser; run without ` +
    `one, the engine answers "${blenderSaid}".`
  );
}

export const CREATABLE_KINDS: readonly BlenderCreatableKind[] = [
  // `VIEW3D_MT_mesh_add`, `space_view3d.py:2428-2441`.
  { kind: 'mesh.plane', label: 'Plane', group: 'Mesh', call: 'mesh.primitive_plane_add' },
  { kind: 'mesh.cube', label: 'Cube', group: 'Mesh', call: 'mesh.primitive_cube_add' },
  { kind: 'mesh.circle', label: 'Circle', group: 'Mesh', call: 'mesh.primitive_circle_add' },
  {
    kind: 'mesh.uv-sphere',
    label: 'UV Sphere',
    group: 'Mesh',
    call: 'mesh.primitive_uv_sphere_add',
  },
  {
    kind: 'mesh.ico-sphere',
    label: 'Ico Sphere',
    group: 'Mesh',
    call: 'mesh.primitive_ico_sphere_add',
  },
  { kind: 'mesh.cylinder', label: 'Cylinder', group: 'Mesh', call: 'mesh.primitive_cylinder_add' },
  { kind: 'mesh.cone', label: 'Cone', group: 'Mesh', call: 'mesh.primitive_cone_add' },
  { kind: 'mesh.torus', label: 'Torus', group: 'Mesh', call: 'mesh.primitive_torus_add' },
  // `layout.separator()`, `:2437`.
  {
    kind: 'mesh.grid',
    label: 'Grid',
    group: 'Mesh',
    call: 'mesh.primitive_grid_add',
    separatorBefore: true,
  },
  { kind: 'mesh.monkey', label: 'Monkey', group: 'Mesh', call: 'mesh.primitive_monkey_add' },
  // `VIEW3D_MT_curve_add`, `space_view3d.py:2455-2467`.
  {
    kind: 'curve.bezier',
    label: 'Bézier',
    group: 'Curve',
    call: 'curve.primitive_bezier_curve_add',
  },
  {
    kind: 'curve.bezier-circle',
    label: 'Circle',
    group: 'Curve',
    call: 'curve.primitive_bezier_circle_add',
  },
  {
    // `layout.separator()`, `:2458`.
    kind: 'curve.nurbs-curve',
    label: 'Nurbs Curve',
    group: 'Curve',
    call: 'curve.primitive_nurbs_curve_add',
    separatorBefore: true,
  },
  {
    kind: 'curve.nurbs-circle',
    label: 'Nurbs Circle',
    group: 'Curve',
    call: 'curve.primitive_nurbs_circle_add',
  },
  { kind: 'curve.path', label: 'Path', group: 'Curve', call: 'curve.primitive_nurbs_path_add' },
  {
    // `layout.separator()`, `:2464`.
    kind: 'curve.empty-hair',
    label: 'Empty Hair',
    group: 'Curve',
    call: 'object.curves_empty_hair_add',
    separatorBefore: true,
  },
  // `object.quick_fur` (`object_quick_effects.cc`) declares no generic add
  // options, so no `location`. Both hair rows are `poll`ed on an active MESH —
  // Blender greys them out there and the engine refuses them by name here
  // ("No active mesh object"), which the row reports through `reportAck`.
  {
    kind: 'curve.fur',
    label: 'Fur',
    group: 'Curve',
    call: 'object.quick_fur',
  },
  // `VIEW3D_MT_surface_add`, `space_view3d.py:2484-2492`.
  {
    kind: 'surface.nurbs-curve',
    label: 'Nurbs Curve',
    group: 'Surface',
    call: 'surface.primitive_nurbs_surface_curve_add',
  },
  {
    kind: 'surface.nurbs-circle',
    label: 'Nurbs Circle',
    group: 'Surface',
    call: 'surface.primitive_nurbs_surface_circle_add',
  },
  {
    kind: 'surface.nurbs-surface',
    label: 'Nurbs Surface',
    group: 'Surface',
    call: 'surface.primitive_nurbs_surface_surface_add',
  },
  {
    kind: 'surface.nurbs-cylinder',
    label: 'Nurbs Cylinder',
    group: 'Surface',
    call: 'surface.primitive_nurbs_surface_cylinder_add',
  },
  {
    kind: 'surface.nurbs-sphere',
    label: 'Nurbs Sphere',
    group: 'Surface',
    call: 'surface.primitive_nurbs_surface_sphere_add',
  },
  {
    kind: 'surface.nurbs-torus',
    label: 'Nurbs Torus',
    group: 'Surface',
    call: 'surface.primitive_nurbs_surface_torus_add',
  },
  // `VIEW3D_MT_metaball_add`, `space_view3d.py:2529` — one
  // `operator_enum("object.metaball_add", "type")`, so the five labels are
  // `rna_enum_metaelem_type_items`' own UI names (`rna_object.cc:196-203`).
  {
    kind: 'metaball.ball',
    label: 'Ball',
    group: 'Metaball',
    call: "object.metaball_add, type='BALL'",
  },
  {
    kind: 'metaball.capsule',
    label: 'Capsule',
    group: 'Metaball',
    call: "object.metaball_add, type='CAPSULE'",
  },
  {
    kind: 'metaball.plane',
    label: 'Plane',
    group: 'Metaball',
    call: "object.metaball_add, type='PLANE'",
  },
  {
    kind: 'metaball.ellipsoid',
    label: 'Ellipsoid',
    group: 'Metaball',
    call: "object.metaball_add, type='ELLIPSOID'",
  },
  {
    kind: 'metaball.cube',
    label: 'Cube',
    group: 'Metaball',
    call: "object.metaball_add, type='CUBE'",
  },
  // `VIEW3D_MT_add`, `space_view3d.py:2706` and `:2707` — two flat rows.
  { kind: 'text', label: 'Text', group: null, call: 'object.text_add' },
  { kind: 'point-cloud', label: 'Point Cloud', group: null, call: 'object.pointcloud_random_add' },
  // `VIEW3D_MT_volume_add`, `space_view3d.py:2618-2622`. The import row needs a
  // file AND this build has no OpenVDB, so its refusal names both.
  {
    kind: 'volume.import',
    label: 'Import OpenVDB...',
    group: 'Volume',
    call: 'object.volume_import',
    refusal:
      `${needsAFilePicker('Importing an OpenVDB volume', 'CANCELLED, with nothing created')} ` +
      'This build also has no OpenVDB at all (`bpy.app.build_options.openvdb` is False), ' +
      'so a file would not be read even with a picker.',
  },
  { kind: 'volume.empty', label: 'Empty', group: 'Volume', call: 'object.volume_add' },
  // `VIEW3D_MT_grease_pencil_add`, `space_view3d.py:2633-2643` — six
  // `object.grease_pencil_add` rows, each with its own `type`.
  {
    kind: 'grease-pencil.blank',
    label: 'Blank',
    group: 'Grease Pencil',
    call: "object.grease_pencil_add, type='EMPTY'",
  },
  {
    kind: 'grease-pencil.stroke',
    label: 'Stroke',
    group: 'Grease Pencil',
    call: "object.grease_pencil_add, type='STROKE'",
  },
  {
    kind: 'grease-pencil.monkey',
    label: 'Monkey',
    group: 'Grease Pencil',
    call: "object.grease_pencil_add, type='MONKEY'",
  },
  {
    // `layout.separator()`, `:2636`.
    kind: 'grease-pencil.lineart-scene',
    label: 'Scene Line Art',
    group: 'Grease Pencil',
    call: "object.grease_pencil_add, type='LINEART_SCENE'",
    separatorBefore: true,
  },
  {
    kind: 'grease-pencil.lineart-collection',
    label: 'Collection Line Art',
    group: 'Grease Pencil',
    call: "object.grease_pencil_add, type='LINEART_COLLECTION'",
  },
  {
    kind: 'grease-pencil.lineart-object',
    label: 'Object Line Art',
    group: 'Grease Pencil',
    call: "object.grease_pencil_add, type='LINEART_OBJECT'",
  },
  // `VIEW3D_MT_add`, `space_view3d.py:2716` — the flat row Blender falls
  // through to when no add-on has extended `VIEW3D_MT_armature_add`.
  { kind: 'armature', label: 'Armature', group: null, call: 'object.armature_add' },
  // `VIEW3D_MT_lattice_add`, `space_view3d.py:2656-2657`. The first row is the
  // GENERIC add operator with a type, not a `lattice_add` of its own. Its kind
  // is `lattice.lattice` and not `lattice` because the header stamps a row's
  // test id from its kind and a submenu's from its group label — measured
  // 2026-09-21: a bare `lattice` made `blender-add-lattice` name BOTH the
  // submenu trigger and the row inside it, and the row's own click re-opened
  // the submenu and added nothing.
  {
    kind: 'lattice.lattice',
    label: 'Lattice',
    group: 'Lattice',
    call: "object.add, type='LATTICE'",
  },
  {
    kind: 'lattice.deform-selected',
    label: 'Lattice Deform Selected',
    group: 'Lattice',
    call: 'object.lattice_add_to_selected',
  },
  // `VIEW3D_MT_empty_add`, `space_view3d.py:2670-2676` — seven display types.
  // Blender's eighth empty, Image, is a row of the IMAGE submenu (`:2778`).
  {
    kind: 'empty.plain-axes',
    label: 'Plain Axes',
    group: 'Empty',
    call: "object.empty_add, type='PLAIN_AXES'",
  },
  {
    kind: 'empty.arrows',
    label: 'Arrows',
    group: 'Empty',
    call: "object.empty_add, type='ARROWS'",
  },
  {
    kind: 'empty.single-arrow',
    label: 'Single Arrow',
    group: 'Empty',
    call: "object.empty_add, type='SINGLE_ARROW'",
  },
  {
    kind: 'empty.circle',
    label: 'Circle',
    group: 'Empty',
    call: "object.empty_add, type='CIRCLE'",
  },
  { kind: 'empty.cube', label: 'Cube', group: 'Empty', call: "object.empty_add, type='CUBE'" },
  {
    kind: 'empty.sphere',
    label: 'Sphere',
    group: 'Empty',
    call: "object.empty_add, type='SPHERE'",
  },
  { kind: 'empty.cone', label: 'Cone', group: 'Empty', call: "object.empty_add, type='CONE'" },
  // `VIEW3D_MT_image_add`, `space_view3d.py:2775-2778`. Three of the four open
  // a file browser in Blender and are refused here by name; the fourth is an
  // ordinary empty and adds.
  {
    kind: 'image.reference',
    label: 'Reference...',
    group: 'Image',
    call: 'object.empty_image_add, background=False',
    refusal: needsAFilePicker(
      'A reference image',
      'poll() failed, context is incorrect / Please select at least one image',
    ),
  },
  {
    kind: 'image.background',
    label: 'Background...',
    group: 'Image',
    call: 'object.empty_image_add, background=True',
    refusal: needsAFilePicker(
      'A background image',
      'poll() failed, context is incorrect / Please select at least one image',
    ),
  },
  {
    kind: 'image.mesh-plane',
    label: 'Mesh Plane...',
    group: 'Image',
    call: 'image.import_as_mesh_planes',
    refusal: needsAFilePicker('An image as a mesh plane', 'CANCELLED, with nothing created'),
  },
  {
    kind: 'image.empty-image',
    label: 'Empty Image',
    group: 'Image',
    call: "object.empty_add, type='IMAGE'",
  },
  // `VIEW3D_MT_light_add`, `space_view3d.py:2574-2583` — one
  // `operator_enum("object.light_add", "type")`, so the four labels are the
  // `Light.type` enum's own UI names.
  { kind: 'light.point', label: 'Point', group: 'Light', call: "object.light_add, type='POINT'" },
  { kind: 'light.sun', label: 'Sun', group: 'Light', call: "object.light_add, type='SUN'" },
  { kind: 'light.spot', label: 'Spot', group: 'Light', call: "object.light_add, type='SPOT'" },
  { kind: 'light.area', label: 'Area', group: 'Light', call: "object.light_add, type='AREA'" },
  // `VIEW3D_MT_lightprobe_add`, `space_view3d.py:2596` — one
  // `operator_enum("object.lightprobe_add", "type")`, so the three labels are
  // `rna_enum_lightprobes_type_items`' own (`rna_object.cc:206-211`).
  {
    kind: 'light-probe.sphere',
    label: 'Sphere',
    group: 'Light Probe',
    call: "object.lightprobe_add, type='SPHERE'",
  },
  {
    kind: 'light-probe.plane',
    label: 'Plane',
    group: 'Light Probe',
    call: "object.lightprobe_add, type='PLANE'",
  },
  {
    kind: 'light-probe.volume',
    label: 'Volume',
    group: 'Light Probe',
    call: "object.lightprobe_add, type='VOLUME'",
  },
  // `VIEW3D_MT_camera_add`, `space_view3d.py:2607`, drawn INTO `VIEW3D_MT_add`
  // at `:2735` because no add-on extended it.
  { kind: 'camera', label: 'Camera', group: null, call: 'object.camera_add' },
  // `VIEW3D_MT_add`, `space_view3d.py:2739`.
  { kind: 'speaker', label: 'Speaker', group: null, call: 'object.speaker_add' },
  // `VIEW3D_MT_add`, `space_view3d.py:2743` — one
  // `operator_menu_enum("object.effector_add", "type")`, so the thirteen labels
  // and their ORDER are the operator's own `field_type_items`
  // (`editors/object/object_add.cc:171-185`) — which is not the FieldSettings
  // enum beside it in RNA: that one is alphabetical and carries a None.
  {
    kind: 'force-field.force',
    label: 'Force',
    group: 'Force Field',
    call: "object.effector_add, type='FORCE'",
  },
  {
    kind: 'force-field.wind',
    label: 'Wind',
    group: 'Force Field',
    call: "object.effector_add, type='WIND'",
  },
  {
    kind: 'force-field.vortex',
    label: 'Vortex',
    group: 'Force Field',
    call: "object.effector_add, type='VORTEX'",
  },
  {
    kind: 'force-field.magnetic',
    label: 'Magnetic',
    group: 'Force Field',
    call: "object.effector_add, type='MAGNET'",
  },
  {
    kind: 'force-field.harmonic',
    label: 'Harmonic',
    group: 'Force Field',
    call: "object.effector_add, type='HARMONIC'",
  },
  {
    kind: 'force-field.charge',
    label: 'Charge',
    group: 'Force Field',
    call: "object.effector_add, type='CHARGE'",
  },
  {
    kind: 'force-field.lennard-jones',
    label: 'Lennard-Jones',
    group: 'Force Field',
    call: "object.effector_add, type='LENNARDJ'",
  },
  {
    kind: 'force-field.texture',
    label: 'Texture',
    group: 'Force Field',
    call: "object.effector_add, type='TEXTURE'",
  },
  {
    kind: 'force-field.curve-guide',
    label: 'Curve Guide',
    group: 'Force Field',
    call: "object.effector_add, type='GUIDE'",
  },
  {
    kind: 'force-field.boid',
    label: 'Boid',
    group: 'Force Field',
    call: "object.effector_add, type='BOID'",
  },
  {
    kind: 'force-field.turbulence',
    label: 'Turbulence',
    group: 'Force Field',
    call: "object.effector_add, type='TURBULENCE'",
  },
  {
    kind: 'force-field.drag',
    label: 'Drag',
    group: 'Force Field',
    call: "object.effector_add, type='DRAG'",
  },
  {
    kind: 'force-field.fluid-flow',
    label: 'Fluid Flow',
    group: 'Force Field',
    call: "object.effector_add, type='FLUID'",
  },
];

/**
 * COLLECTION INSTANCE IS A ROW PER COLLECTION, so its kinds are not in the
 * table above: Blender's row is `operator_menu_enum("object.
 * collection_instance_add", "collection")` (`space_view3d.py:2759-2764`), whose
 * items are `bpy.data.collections` — the file's own, which change as the person
 * works. A kind is this prefix plus the collection's name, and
 * {@link liveCollectionKinds} is what enumerates them.
 */
const COLLECTION_INSTANCE_PREFIX = 'collection-instance:';

/**
 * The collections the Outliner is holding, as Add rows.
 *
 * READ FROM THE TREE, not from a second engine call: a layer-collection row
 * carries the collection DATABLOCK it shows (`BlenderOutlinerRow.data`), and
 * `bpy.data.collections[…]` is exactly the set Blender's own
 * `bool(bpy.data.collections)` tests — the scene's master collection addresses
 * as `…scenes[…].collection` and is correctly not one of them.
 */
function liveCollectionKinds(): readonly BlenderCreatableKind[] {
  const seen = new Map<string, BlenderCreatableKind>();
  for (const row of blenderOutlinerState().byId.values()) {
    if (row.type !== 'TSE_LAYER_COLLECTION') continue;
    const address = row.data;
    if (address === undefined || !address.startsWith('bpy.data.collections[')) continue;
    if (seen.has(row.name)) continue;
    seen.set(row.name, {
      kind: `${COLLECTION_INSTANCE_PREFIX}${row.name}`,
      label: row.name,
      group: 'Collection Instance',
      call: `object.collection_instance_add, collection=${py(row.name)}`,
    });
  }
  return [...seen.values()];
}

/** Every kind this document can be asked for right now — the static table plus
 *  the file's own collections. */
export function blenderCreatableKinds(): readonly BlenderCreatableKind[] {
  return [...CREATABLE_KINDS, ...liveCollectionKinds()];
}

/** The complete `bpy.ops` expression a kind runs. */
function addCall(kind: BlenderCreatableKind): string {
  const [call, ...args] = kind.call.split(', ');
  return `bpy.ops.${call}(${args.join(', ')})`;
}

/** A Python string literal for one Blender name. JSON's own escaping is a
 *  subset of Python's for every character a datablock name can hold, which is
 *  why the transform writer above addresses `bpy.data.objects[…]` the same
 *  way. */
function py(name: string): string {
  return JSON.stringify(name);
}

/**
 * RUN ONE OPERATOR AND SAY WHICH OBJECTS IT MADE.
 *
 * WHY THE ANSWER IS A SET DIFFERENCE and not `bpy.context.active_object.name`:
 * the question a structural verb has to answer is "which datablock did this
 * operator create", and the active object is a different question whose answer
 * depends on what the operator left in the view layer — which is exactly the
 * part a headless context is least trustworthy about. Diffing `bpy.data.objects`
 * across the call answers the first question directly, and it answers it for an
 * operator that makes SEVERAL objects (a multi-object duplicate) without a
 * second mechanism.
 *
 * The script runs through the one script door (`blenderExecute`), which
 * presents afterwards, so the picture and the tree that follow are the
 * engine's own reading.
 */
async function runBlenderOperator(
  body: string,
  label = 'Blender Python',
): Promise<{ readonly made: readonly string[]; readonly error: string | null }> {
  const code = [
    'before = {o.name for o in bpy.data.objects}',
    body,
    'made = [o.name for o in bpy.data.objects if o.name not in before]',
    'print("\\n".join(made))',
  ].join('\n');
  const answer = await blenderExecute(code, true, label);
  // THE ENGINE'S REFUSAL, VERBATIM. `session.py::execute` answers with the
  // traceback in `error` rather than raising, and a paraphrase here is how a
  // refusal becomes a shrug.
  if (answer.error !== null) return { made: [], error: answer.error };
  const made = answer.result
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return { made, error: null };
}

/**
 * THE SELECTION IS BLENDER'S, AND THIS IS THE WRITE (WORK.md §THE BLENDER
 * RELEASE, B11; ARCHITECTURE-CORE §Blender north star goal 1 — *"through the
 * Blender MCP interface an agent cannot tell it is using anything other than
 * real Blender"*).
 *
 * Every selection gesture on the Model document ends here: a viewport click, a
 * box, an Outliner row, Select ▸ All/None/Invert, and the selection an
 * operator leaves behind. ONE script per gesture, because a selection is one
 * act — `select_set` per object in the view layer and one assignment to
 * `view_layer.objects.active` — and because the script door PRESENTS when it
 * returns, so the frame that comes back already carries the new `selected` and
 * `active` for {@link blenderEngineSelection} to read.
 *
 * WHY IT IS A WRITE AT ALL, when `rna_outliner` deliberately takes the
 * caller's selection instead of making one: reading a tree must not mutate the
 * document, and that rule stands. This is not a read — it is the gesture
 * itself. Before it, WALK 5 measured a click that picked the cube in this
 * editor while `bpy.context.active_object` still answered `Point`, and the
 * Shader Editor and UV Editing — which key on Blender's ACTIVE object and
 * nothing else — drew a cube's material as "No material" and its unwrap as
 * blank. There is no second selection to reconcile now: the engine holds it.
 *
 * THE LOOP IS OVER `view_layer.objects`, not `bpy.data.objects`: an object
 * outside the view layer has no selection flag to set and `select_set` refuses
 * it by name. `bpy.data.objects.get` for the active is the same care — a name
 * the tree still holds but the engine has deleted answers None rather than
 * raising, and None is what Blender's own "no active object" is.
 */
async function writeBlenderSelection(
  names: readonly string[],
  active: string | null,
): Promise<void> {
  const body = [
    `_sel = {${names.map(py).join(', ')}}`,
    '_vl = bpy.context.view_layer',
    'for _o in _vl.objects:',
    '    _o.select_set(_o.name in _sel)',
    active === null
      ? '_vl.objects.active = None'
      : `_vl.objects.active = bpy.data.objects.get(${py(active)})`,
  ].join('\n');
  const answer = await blenderExecute(body, false);
  // THE ENGINE'S REFUSAL, VERBATIM — never a shrug. A selection that did not
  // land is the difference between the Properties rail showing this object and
  // showing the last one, so it is said out loud on the editor's console.
  if (answer.error !== null)
    editorHost().console.error(
      `Blender refused the selection write: ${answer.error}`,
      'blender-outliner',
    );
}

/**
 * ONE OPERATOR ON A NAMED SET OF OBJECTS — what the 3D viewport header's Object
 * menu runs (`blender-header-menus.tsx`: Apply, Clear, Set Origin), and the
 * same shape {@link StructureProvider}'s own delete and duplicate use.
 *
 * THE CONTEXT OVERRIDE IS THE WHOLE POINT. Every one of these operators reads
 * `context.selected_objects` (and `selected_editable_objects`); the engine runs
 * headless with no 3D view, and its selection is not the panel's, so the
 * subject is STATED per call rather than written into the engine first — a
 * write the document would then save, and the one `rna_outliner` already
 * refuses to make for the same reason.
 *
 * `call` is the bare `bpy.ops.…(…)` expression, so a caller reads exactly what
 * Blender will run and the ack can quote it.
 */
export async function runBlenderObjectOperator(
  names: readonly string[],
  call: string,
): Promise<WriteAck> {
  if (names.length === 0)
    return {
      destination: 'Nothing is selected, so there was nothing to run it on.',
      persisted: false,
    };
  const body = [
    `targets = [bpy.data.objects[n] for n in [${names.map(py).join(', ')}]]`,
    'with bpy.context.temp_override(selected_objects=targets, ' +
      'selected_editable_objects=targets, active_object=targets[0], object=targets[0]):',
    `    ${call}`,
  ].join('\n');
  const { error } = await runBlenderOperator(body);
  if (error !== null) return { destination: error, persisted: false };
  await refreshBlenderOutliner(names);
  return { destination: `Blender — ${call}; the session saves the .blend`, persisted: true };
}

const PROVENANCE: AuthoringProvenance = {
  source: 'document',
  label: 'blender',
  detail:
    "These rows are Blender's own View Layer tree, read from the engine through RNA. " +
    'Editing the model is a bpy call; the eye and render columns write the engine directly.',
};

/** The eye is not what excluded a collection, and a row whose eye refuses must
 *  say which column did. The checkbox is beside it now (I3 follow-up (b)), so
 *  this names it rather than apologising for its absence. */
const EXCLUDED_REASON =
  'This collection is excluded from the view layer (LayerCollection.exclude), so its viewport ' +
  'visibility is not what is hiding it. Clear the Exclude checkbox on this row first.';

export const createBlenderOutlinerAuthoring: ToolObject3DDocumentAuthoringFactory = ({
  defaultAdapter,
}) => {
  const listeners = new Set<() => void>();
  /**
   * THE ENGINE'S SELECTION, CACHED IN ROW IDS — never a second selection.
   *
   * The state is the frame's (`blenderEngineSelection`); this is the shape the
   * panels read it in, and {@link syncFromEngine} overwrites it from every
   * frame and every tree read. A gesture fills it optimistically so the
   * outline moves with the pointer rather than a round trip later, and the
   * frame the gesture's own write presents then replaces it with the engine's
   * answer — which is the same answer, unless Blender refused, in which case
   * what the person sees is what Blender did.
   */
  let selected: readonly string[] = [];
  /** The engine answer {@link selected} was last derived from, tree version
   *  included: a name only becomes a row id once the tree holding that row has
   *  been read, so the same engine selection must be re-derived when the tree
   *  moves under it. */
  let lastEngineKey: string | null = null;
  /** The world matrix each live gesture started from — see `beginEdit`. */
  const gestureStart = new Map<THREE.Object3D, THREE.Matrix4>();
  // Retain the subject until endEdit, even if a concurrent native edit removes
  // it from the presented frame. The history group must still be closed.
  const gestureObjects = new Map<string, THREE.Object3D>();

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const rows = (): ReadonlyMap<string, BlenderOutlinerRow> => blenderOutlinerState().byId;

  /** The object a ROW belongs to, as a three object — the place the two id
   *  spaces meet (see the header). */
  const objectForRow = (id: string): THREE.Object3D | null => {
    const row = rows().get(id);
    const view = blenderPresentedView();
    if (row === undefined || view === null) return null;
    if (row.type === 'TSE_VIEW_COLLECTION_BASE') return view.root;
    return row.object === undefined ? null : view.objectForBlenderName(row.object);
  };

  /** The row for a presented OBJECT: its address is the object's own, so this
   *  is a map lookup rather than a walk. */
  const rowIdForObject = (object: THREE.Object3D): string | null => {
    const view = blenderPresentedView();
    if (view === null) return null;
    for (const row of rows().values())
      if (isObjectRow(row) && view.objectForBlenderName(row.object) === object) return row.id;
    return null;
  };

  /** The row that names a Blender OBJECT, by NAME — the third direction of the
   *  header's two id spaces, and the one a freshly created or renamed object
   *  needs: it exists in the engine (and in the tree) before it exists as a
   *  presented three object. */
  const rowIdForName = (name: string): string | null => {
    for (const row of rows().values()) if (isObjectRow(row) && row.object === name) return row.id;
    return null;
  };

  /**
   * THE SAME MEETING POINT, RUN BACKWARDS — normalize an id that arrived from
   * outside into one of OUR rows (see the header's "both ways").
   *
   * A row id passes straight through. Anything else is the PRESENTATION's id,
   * because that is what `selection.set` below publishes into the shell store
   * — and the gizmo block reads `store.selectedEntityId`, so the viewport asks
   * this adapter about ids it minted itself. Measured 2026-09-21 on a cold
   * model scaffold: without this, `adapterOnlyToolOwner` (which gates on
   * `hierarchy.node(id) !== null`) answered null for every selection, so the
   * 3D tool context never claimed the surface and the gizmo stayed detached
   * even with `capabilities.transform` true.
   */
  const rowIdFor = (id: string): string | null => {
    if (rows().has(id)) return id;
    const object = threeObject(defaultAdapter.hierarchy, id);
    return object === null ? null : rowIdForObject(object);
  };

  /** The presented object an id names, in EITHER space. */
  const objectFor = (id: string): THREE.Object3D | null => {
    const rowId = rowIdFor(id);
    return rowId === null ? null : objectForRow(rowId);
  };

  /** An id in the DEFAULT adapter's space, for the reads it owns. */
  const presentationIdFor = (id: string): string | null => {
    const object = objectFor(id);
    return object === null ? null : (defaultAdapter.hierarchy.idForObject3D?.(object) ?? null);
  };

  const hierarchy: HierarchyProvider = {
    roots: () => {
      // THE READ IS DRIVEN FROM HERE, for I1's reason: the panel is the only
      // thing that always runs, and `showBlenderOutliner` is idempotent and
      // schedules its work outside the render pass.
      showBlenderOutliner(selectedObjects());
      const state = blenderOutlinerState();
      return (state.tree?.rows ?? []).map((row) => nodeFor(row, null));
    },
    node: (id) => {
      const state = blenderOutlinerState();
      // NORMALIZED, because the viewport asks with the ids this adapter
      // published into the store — see {@link rowIdFor}. The node it answers
      // with is the ROW's, id included: there is one tree here, and a second
      // identity for the same subject is what the header's two spaces exist
      // to keep out.
      const rowId = state.byId.has(id) ? id : rowIdFor(id);
      const row = rowId === null ? undefined : state.byId.get(rowId);
      return row === undefined ? null : nodeFor(row, state.parentOf.get(row.id) ?? null);
    },
    object3D: (id) => objectFor(id),
    idForObject3D: (object: THREE.Object3D) => rowIdForObject(object),
  };

  /** The Blender object NAMES our selection covers — what the door wants. */
  function selectedObjects(): readonly string[] {
    const table = rows();
    const names = new Set<string>();
    for (const id of selected) {
      const name = table.get(id)?.object;
      if (name !== undefined) names.add(name);
    }
    return [...names];
  }

  /** Keep the PRESENTATION in step: the viewport's selection outline and the
   *  gizmo bind to the default adapter's own ids, so a Blender row's object is
   *  pushed through its `idForObject3D`. The one place that push happens — a
   *  gesture and a frame both end here. */
  const publishPresentation = (): void => {
    const mapped: string[] = [];
    for (const id of selected) {
      const object = objectFor(id);
      const mappedId = object === null ? null : defaultAdapter.hierarchy.idForObject3D?.(object);
      if (mappedId) mapped.push(mappedId);
    }
    defaultAdapter.selection?.set(mapped, { intent: 'exact' });
    notify();
  };

  /**
   * THE READ: the engine's selection, turned into the rows the panels draw.
   *
   * Called on every frame and on every tree read, and it does nothing when
   * neither the engine's answer nor the tree has moved — so a gesture's own
   * optimistic cache survives until the frame its write presented arrives, and
   * is then replaced by what Blender actually did.
   *
   * THE ACTIVE OBJECT GOES LAST, because that is what the shell means by one:
   * `EditorShellStore.selectedEntityId` — the subject the Properties rail and
   * the gizmo take — is the LAST member of the selected set, and Blender's
   * active object is the same idea under its own name. An active object that
   * is not selected still lands in the list: it is the subject the Properties
   * editor is showing, and a rail pointing at a row nobody can see is the
   * disagreement this whole unit exists to end.
   */
  const syncFromEngine = (): void => {
    const engine = blenderEngineSelection();
    const key = `${blenderOutlinerVersion()} ${engine.active ?? ''} ${[...engine.selected]
      .sort()
      .join('')}`;
    if (key === lastEngineKey) return;
    lastEngineKey = key;
    const names = engine.selected.filter((name) => name !== engine.active);
    if (engine.active !== null) names.push(engine.active);
    const next = names.map(rowIdForName).filter((id): id is string => id !== null);
    if (next.length === selected.length && next.every((id, at) => id === selected[at])) return;
    selected = next;
    publishPresentation();
  };

  const selection: SelectionProvider = {
    get: () => [...selected],
    set: (ids) => {
      // NORMALIZED, because ids arrive in BOTH SPACES (the header's "both
      // ways"). A hierarchy click and this adapter's own verbs speak ROW ids;
      // the viewport's MARQUEE speaks the presentation's, because it picks
      // three objects and hands back whatever the default adapter calls them.
      //
      // MEASURED 2026-09-21: a box select across the scene left `selection`
      // holding nine `source-object:…` ids, so every row in the Outliner read
      // as unselected, the Properties rail had no Blender subject, and the
      // gizmo's own `rowIdFor` was the only thing in the file still working.
      // `rowIdFor` is the one function that answers for either space, and this
      // is the other end of the same seam `hierarchy.node` already normalizes.
      // An id that resolves to no row is DROPPED rather than stored: a row id
      // is this provider's whole currency and a foreign one is not a selection.
      selected = ids.map(rowIdFor).filter((id): id is string => id !== null);
      publishPresentation();
      // AND IT WRITES BLENDER'S (see {@link writeBlenderSelection}). The
      // subject is the OWNING OBJECT of each selected row, which is Blender's
      // own Outliner behaviour — clicking a modifier or a shape key activates
      // the object that carries it (`outliner_select.cc`'s
      // `outliner_search_back_te(te, ID_OB)`), and `BlenderOutlinerRow.object`
      // is that owner.
      //
      // A ROW THAT OWNS NO OBJECT IS REFUSED BY NAME rather than silently
      // dropped: a collection is a selection in Blender's Outliner but not in
      // its object selection, and a person who clicked one and saw the
      // Properties rail keep the last object deserves the sentence.
      const table = rows();
      const names: string[] = [];
      const ownerless: string[] = [];
      for (const id of selected) {
        const row = table.get(id);
        const name = row?.object;
        if (name === undefined) ownerless.push(row?.name ?? id);
        else if (!names.includes(name)) names.push(name);
      }
      if (ownerless.length > 0)
        editorHost().console.warn(
          `${ownerless.join(', ')} ${ownerless.length === 1 ? 'is' : 'are'} not an object, so ` +
            "Blender's object selection does not carry " +
            `${ownerless.length === 1 ? 'it' : 'them'}. Selecting a collection sets the ACTIVE ` +
            'COLLECTION in Blender, which is its own gesture and not in this editor yet.',
          'blender-outliner',
        );
      // The ACTIVE is the LAST row the gesture named, which is the shell's own
      // reading of `selectedEntityId` and Blender's of an active object.
      void writeBlenderSelection(names, names.length === 0 ? null : names[names.length - 1]!);
    },
  };

  const restrictOf = (id: string) => rows().get(id)?.restrict;

  const inspector: InspectorProvider = {
    properties: (id): PropertyDescriptor[] => {
      const restrict = restrictOf(id);
      if (restrict === undefined) return [];
      const row = rows().get(id);
      const properties: PropertyDescriptor[] = [
        // WRITABLE ON AN OBJECT ROW since 2026-09-21 — Blender renames a
        // datablock on a double-click or F2 in its own Outliner, and the
        // "this Outliner inspects" refusal this replaced stopped being true
        // when the gizmo started writing. {@link InspectorProvider.editability}
        // is where the per-row answer is, and it is what a COLLECTION row
        // still refuses.
        { path: 'name', label: 'Name', type: 'string', readonly: !isObjectRow(row) },
      ];
      // The RESERVED paths the hierarchy's restriction columns read
      // (`AuthoringAdapter`'s "Reserved inspector paths convention"). Declared
      // only where Blender draws that column on that row type.
      if (restrict.hide !== undefined)
        properties.push({ path: 'visible', label: 'Show in Viewport', type: 'boolean' });
      if (restrict.render !== undefined)
        properties.push({ path: 'renderVisible', label: 'Show in Renders', type: 'boolean' });
      // THE EXCLUDE CHECKBOX, on the rows Blender draws it on — layer
      // collections, and only under the View Layer display
      // (`outliner_draw.cc:1634-1653`, guarded by `SO_RESTRICT_ENABLE`, which
      // is in the default set at `space_outliner.cc:399`). The door already
      // answered `exclude` for those rows; what was missing was the column.
      if (restrict.exclude !== undefined)
        properties.push({ path: 'exclude', label: 'Exclude from View Layer', type: 'boolean' });
      return properties;
    },
    get: (id, path) => {
      const row = rows().get(id);
      if (row === undefined) return undefined;
      if (path === 'name') return row.name;
      if (path === 'visible')
        return row.restrict?.hide === undefined ? undefined : !row.restrict.hide;
      if (path === 'renderVisible')
        return row.restrict?.render === undefined ? undefined : !row.restrict.render;
      // REPORTED IN BLENDER'S OWN SENSE: `true` is EXCLUDED, the way
      // `LayerCollection.exclude` reads, so the panel's checkbox is checked
      // when the value is false. The eye and the camera are inverted above
      // because those paths are named for what is SHOWN.
      if (path === 'exclude') return row.restrict?.exclude;
      return undefined;
    },
    editability: (id, path) => {
      const row = rows().get(id);
      if (row === undefined) return { writable: false };
      if (path === 'name') {
        // BLENDER RENAMES IN ITS OWN OUTLINER — a double-click on the name, or
        // F2 (`outliner_item_rename`, `outliner_tools.cc`) — and the refusal
        // that used to stand here ("this Outliner inspects") stopped being
        // true the moment the transform gizmo started writing `matrix_world`.
        // It is withdrawn for OBJECT rows, and only those: a collection, a
        // modifier, a vertex group and a bone each rename through a different
        // datablock's own `name`, and this unit does not reach them (WORK.md
        // §THE BLENDER RELEASE, B6 — "Collections stay read-only for this
        // unit, by name").
        if (isObjectRow(row)) return { writable: true };
        return {
          writable: false,
          reason:
            `Renaming a ${row.struct ?? row.type} is not in this Outliner yet — only an object ` +
            'row renames here. Rename it with bpy.',
        };
      }
      if (row.notInCollection)
        return {
          writable: false,
          // `outliner_draw.cc:1282-1286` — Blender draws this row no columns.
          reason:
            'This row is a child drawn under its parent although it is not in that collection, ' +
            "and Blender's Outliner draws it no restriction columns.",
        };
      if (path === 'visible' && row.restrict?.exclude === true)
        return { writable: false, reason: EXCLUDED_REASON };
      return { writable: true };
    },
    set: async (id, path, value) => {
      const row = rows().get(id);
      if (row === undefined) return;
      if (path === 'name') {
        // ONE `rna-set` OF `Object.name`, the same door the Object tab's own
        // Name field writes through. Blender's `ID.name` setter is what
        // enforces uniqueness — a second "Cube" becomes "Cube.001" — so the
        // name that comes back can differ from the one typed, which is why
        // the tree is re-read afterwards rather than assumed.
        if (!isObjectRow(row)) return;
        const name = String(value);
        if (name === row.name || name.length === 0) return;
        await blenderRnaSet(`bpy.data.objects[${py(row.object)}]`, 'name', name);
        // EVERY ROW ID THIS NAME OWNED IS NOW STALE — a row's id IS its RNA
        // address (`bpy.data.objects["Cube"]`), so a rename changes it. Re-read
        // and re-publish the selection, or the panels go on addressing a
        // datablock `bpy.data.objects` no longer has.
        await refreshBlenderOutliner([name]);
        const renamed = rowIdForName(name);
        if (renamed !== null) selection.set([renamed]);
        return;
      }
      if (path === 'exclude') {
        await writeBlenderOutlinerColumn(row.path, 'exclude', value === true);
        return;
      }
      const column = path === 'visible' ? 'hide' : path === 'renderVisible' ? 'render' : null;
      if (column === null) return;
      await writeBlenderOutlinerColumn(row.path, column, value === false);
    },
  };

  /**
   * THE GIZMO IS ONE MORE bpy WRITER (owner, 2026-09-21: *"I don't see the
   * gizmo in the blender app. Why not?"*).
   *
   * The precedent is the Object tab's Transform panel, transcribed by METHOD:
   * a field there writes through `blender-properties-model.ts`'s
   * `writeBlenderRnaProperty` → `blenderRnaSet` → `session.py::rna_set`, and
   * the write PRESENTS, so the picture that comes back is the engine's own
   * reading rather than ours. This provider is that same door driven by a
   * drag: `apply` moves the PRESENTED object so the picture follows the
   * pointer, and `endEdit` makes exactly ONE write when the gesture closes.
   *
   * WHAT IS WRITTEN IS `matrix_world`, not `location`/`rotation_euler`/`scale`.
   * Blender's own setter (`rna_Object_matrix_world_update` →
   * `BKE_object_apply_mat4`) decomposes a world matrix through the parent,
   * `matrix_parent_inverse`, the delta transforms and the object's
   * `rotation_mode`. That is Blender's math and it stays Blender's; we hand it
   * the matrix.
   *
   * THE ORIENTATION IS GATED BY THE ROUND TRIP, not by a claim. `blenderRnaSet`
   * bumps the RNA version and the write presents, so the frame that follows
   * re-sets this object's matrix from the engine — if the rows/columns or the
   * axis permutation were wrong, the object would JUMP the moment it came
   * back. No jump is the proof.
   *
   * LOCKS ARE NOT READ, and that is stated rather than silently skipped:
   * `lock_location`/`lock_rotation`/`lock_scale` constrain Blender's own
   * interactive transform operators, not a matrix assignment, and the Outliner
   * rows this adapter draws do not carry them.
   *
   * There is deliberately no `remove`: a Blender object has no absent
   * transform channel to drop, so the protocol's removal door refuses by name
   * instead of falling back to a value write.
   */
  const transforms: TransformProvider = {
    get: (id) => {
      // THE DEFAULT ADAPTER'S OWN READER, on the mapped id. A presented object
      // owns its matrix (`matrixAutoUpdate = false`), so the vector fields are
      // not the truth and `three-projection-core.ts`'s `readLocalTransform`
      // decomposes instead — inventing a second reader here is how the two
      // would drift.
      const mapped = presentationIdFor(id);
      return (
        (mapped === null ? undefined : defaultAdapter.transforms?.get(mapped)) ?? NO_TRANSFORM()
      );
    },
    /** WHAT THIS DOES NOT ASK: the object's `lock_location`/`lock_rotation`/
     *  `lock_scale`. Those constrain Blender's own interactive operators, not a
     *  matrix assignment, and an Outliner row does not carry them — so a locked
     *  channel still moves here. See the header. */
    editability: (id) => {
      const rowId = rowIdFor(id);
      const row = rowId === null ? undefined : rows().get(rowId);
      if (isObjectRow(row) && objectForRow(row.id) !== null) {
        return { writable: true };
      }
      return {
        writable: false,
        reason: `Only an object has a transform; this row is a ${row?.struct ?? row?.type ?? 'row'}.`,
      };
    },
    /** Nothing in the engine is driving this object between frames, so there
     *  is no controller to pause. What this DOES take is the pose the gesture
     *  started from, so a click on a gizmo handle that never moved closes
     *  without writing — `dragging-changed` fires on pointerdown, and a write
     *  that changes nothing still presents and still dirties the `.blend`.
     *  Keyed by the OBJECT rather than the id, because the viewport addresses
     *  one gesture in both id spaces (see the header). */
    beginEdit: (id) => {
      const object = objectFor(id);
      if (object !== null && !gestureStart.has(object)) {
        gestureStart.set(object, object.matrixWorld.clone());
        gestureObjects.set(id, object);
        beginBlenderGesture();
      }
    },
    apply: (id, transform) => {
      const object = objectFor(id);
      if (object === null) return;
      object.position.fromArray(transform.position);
      object.quaternion.fromArray(transform.rotation);
      object.scale.fromArray(transform.scale);
      // WITHOUT THIS THE PICTURE DOES NOT FOLLOW THE POINTER. A presented
      // object owns its matrix (`blender-runtime-view.ts`: `matrixAutoUpdate =
      // false`, the matrix set from the frame and then decomposed into the
      // vector fields), so three never recomposes it — the three writes above
      // would move nothing on screen, and the gizmo, which reads
      // `matrixWorld`, would sit still with them.
      object.updateMatrix();
      object.updateMatrixWorld(true);
    },
    endEdit: async (id): Promise<WriteAck | undefined> => {
      const object = gestureObjects.get(id) ?? objectFor(id);
      gestureObjects.delete(id);
      const view = blenderPresentedView();
      if (object === null) return undefined;
      const started = gestureStart.get(object);
      gestureStart.delete(object);
      try {
        if (view === null) return undefined;
        object.updateWorldMatrix(true, false);
        if (started?.equals(object.matrixWorld) === true) return undefined;
        const name = view.blenderObjectName(object);
        if (name === null) return undefined;
        // The engine's own address, quoted the way `_rna_resolve` parses it.
        const path = `bpy.data.objects[${JSON.stringify(name)}]`;
        try {
          await blenderRnaSet(path, 'matrix_world', blenderWorldMatrixRows(object, view.root));
          return {
            destination: `Blender — ${path}.matrix_world; the session saves the .blend`,
            persisted: true,
          };
        } catch (error) {
          // The engine's refusal, verbatim — never paraphrased and never acked.
          return {
            destination: error instanceof Error ? error.message : String(error),
            persisted: false,
          };
        }
      } finally {
        if (started) await endBlenderGesture();
      }
    },
  };

  /** The Blender object NAME an id addresses, or null for a row that is not an
   *  object (a collection, a modifier, a vertex group). The structural verbs
   *  below all refuse a non-object row, and this is the one place they ask. */
  const objectNameFor = (id: string): string | null => {
    const rowId = rowIdFor(id);
    const row = rowId === null ? undefined : rows().get(rowId);
    return isObjectRow(row) ? row.object : null;
  };

  /** What a refusal answers with: the sentence, and nothing persisted. */
  const refuse = (reason: string): WriteAck => ({ destination: reason, persisted: false });

  /**
   * THE TREE AFTER AN OPERATOR, AND THE SELECTION BLENDER WOULD LEAVE.
   *
   * An `*_add` or a `duplicate` leaves its new object selected and active in
   * Blender, so this re-reads the tree for the new names (awaited, because the
   * row does not exist until it lands — `refreshBlenderOutliner`) and then
   * publishes the selection through this adapter's own `selection.set`, which
   * is what keeps the Outliner, the Properties rail and the viewport's gizmo
   * looking at one subject.
   */
  const selectAfterOperator = async (made: readonly string[]): Promise<string> => {
    await refreshBlenderOutliner(made);
    const ids = made.map(rowIdForName).filter((id): id is string => id !== null);
    if (ids.length > 0) selection.set(ids);
    return ids[0] ?? '';
  };

  /**
   * ADD, DELETE, DUPLICATE — BLENDER'S OWN OPERATORS, NAMED HERE AND RUN THERE
   * (WORK.md §THE BLENDER RELEASE, B6; ARCHITECTURE-CORE §Blender north star
   * goal 3 as amended: "can make MACRO adjustments at the screen — move,
   * rotate, scale a part, add or remove one, rename it … each a bpy call
   * through the doors that exist").
   *
   * Every verb is one `bpy.ops` call through the script door
   * (`blenderExecute`), which presents afterwards, so what comes back is the
   * engine's reading and never ours. The operators carry semantics we would
   * otherwise have to reimplement and get subtly wrong — `object.delete`
   * unparents a deleted object's children the way Blender does, which
   * `bpy.data.objects.remove` does not; `object.duplicate` copies the object's
   * data, its modifiers, its material slots and its parent relationship under
   * the user's own duplication preferences — so naming the operator IS the
   * implementation.
   *
   * THE CONTEXT OVERRIDE IS WHAT MAKES A ROW THE SUBJECT. `object.delete` and
   * `object.duplicate` read `context.selected_objects`; the engine runs
   * headless with no view3d and its selection is not the panel's, so each verb
   * states its subject with `bpy.context.temp_override(...)` rather than
   * writing the engine's selection first — a write the document would then
   * save.
   *
   * The script door checkpoints Blender's native undo stack and records its
   * callback in Code-OSS. These operators are undone by restoring Blender's
   * state, never by constructing an inverse operator or replaying the script.
   */
  const structure: StructureProvider = {
    /**
     * BLENDER'S ADD MENU, FOR EVERY PARENT — `parentId` is deliberately not
     * read. Blender's Add adds to the ACTIVE COLLECTION, never under whatever
     * was selected when the menu opened, so answering a different list per row
     * would advertise a placement this does not make. Parenting is
     * `object.parent_set`, its own gesture, and `reparent` below refuses by
     * name for the same reason.
     */
    creatableKinds: () => blenderCreatableKinds().map(({ kind, label }) => ({ kind, label })),
    create: (kind): StructuralIdWrite => {
      const entry = blenderCreatableKinds().find((one) => one.kind === kind);
      // A SYNCHRONOUS ID IS NOT AVAILABLE HERE, and `StructuralIdWrite` has a
      // member for saying so: the object does not exist until Blender has run
      // the operator, so the id is `''` and the ack is the real answer. The
      // new row is SELECTED when it lands, which is what a caller that wanted
      // the id was going to do with it.
      if (entry === undefined)
        return {
          id: '',
          ack: refuse(
            `${kind} is not a row of Blender's Add menu that this editor adds. Its rows are: ` +
              `${blenderCreatableKinds()
                .map((one) => one.label)
                .join(', ')}.`,
          ),
        };
      // A ROW THIS EDITOR CANNOT RUN NEVER RUNS. The menu draws it disabled
      // with this same sentence, so this arm is what answers a caller reaching
      // the kind through the door instead of the menu.
      if (entry.refusal !== undefined) return { id: '', ack: refuse(entry.refusal) };
      const call = addCall(entry);
      return {
        id: '',
        ack: (async (): Promise<WriteAck> => {
          const { made, error } = await runBlenderOperator(call);
          if (error !== null) return refuse(error);
          // AN OPERATOR THAT MADE NOTHING IS A REFUSAL, not a quiet success.
          // Blender's file-browser operators answer `{'CANCELLED'}` — a status
          // the script door reports no error for — with `bpy.data.objects`
          // unchanged, which is exactly the silent degrade `_absent_capability`
          // exists to stop (`session.py`'s own note). The set difference this
          // door already computes is what catches it.
          if (made.length === 0)
            return refuse(
              `Blender ran ${call} and created nothing. The operator reported no error, so it ` +
                'cancelled — most often because it wanted a file browser or a context this ' +
                'headless engine has no window for.',
            );
          await selectAfterOperator(made);
          return {
            destination: `Blender — ${call}; the session saves the .blend`,
            persisted: true,
          };
        })(),
      };
    },
    remove: (id) => structure.removeMany?.([id]) ?? undefined,
    /**
     * BLENDER'S OWN DELETE, for one row or a whole selection. `object.delete`
     * is the operator the X key runs (`blender_default.py:4552`, with
     * `use_global` False), and running it once for the whole set is also what
     * makes this ONE gesture rather than N.
     */
    removeMany: async (ids): Promise<WriteAck> => {
      const names: string[] = [];
      for (const id of ids) {
        const name = objectNameFor(id);
        if (name === null) {
          const row = rowIdFor(id) === null ? undefined : rows().get(rowIdFor(id)!);
          return refuse(
            `Only an object can be deleted here; this row is a ${row?.struct ?? row?.type ?? 'row'}. ` +
              'Deleting a collection, a modifier or a vertex group is that datablock’s own bpy call.',
          );
        }
        names.push(name);
      }
      if (names.length === 0) return refuse('Nothing selected to delete.');
      const targets = `[bpy.data.objects[n] for n in [${names.map(py).join(', ')}]]`;
      const body = [
        `targets = ${targets}`,
        'with bpy.context.temp_override(selected_objects=targets, active_object=targets[0]):',
        '    result = bpy.ops.object.delete(use_global=False)',
        'if "FINISHED" not in result: raise RuntimeError("Blender cancelled deleting the selected objects")',
      ].join('\n');
      const { error } = await runBlenderOperator(body, 'Delete Objects');
      if (error !== null) return refuse(error);
      // The deleted rows are gone; re-read with NO selection so nothing points
      // at a name `bpy.data.objects` no longer has.
      selection.set([]);
      await refreshBlenderOutliner([]);
      return {
        destination:
          'Blender — bpy.ops.object.delete(use_global=False); the session saves the .blend',
        persisted: true,
      };
    },
    /**
     * BLENDER'S OWN DUPLICATE — Shift+D's operator (`blender_default.py:4563`,
     * `object.duplicate_move`, whose duplicate half is this). `linked=False` is
     * the full copy the menu's "Duplicate Objects" row makes; Blender's Linked
     * Duplicates is a separate row and not this unit's.
     */
    duplicate: (id): StructuralIdWrite => {
      const name = objectNameFor(id);
      // THE SOURCE ID IS THE ANSWER WHEN THERE IS NO COPY, because `duplicate`
      // has no refusal channel of its own and `''` there would be read as one
      // (`StructuralIdWrite`'s own note). The ack carries the refusal.
      if (name === null)
        return {
          id,
          ack: refuse(
            'Only an object can be duplicated here. Duplicating a collection is ' +
              '`bpy.ops.object.collection_instance_add`, its own gesture.',
          ),
        };
      const body = [
        `source = bpy.data.objects[${py(name)}]`,
        'with bpy.context.temp_override(selected_objects=[source], active_object=source):',
        '    result = bpy.ops.object.duplicate(linked=False)',
        'if "FINISHED" not in result: raise RuntimeError("Blender cancelled duplicating the selected object")',
      ].join('\n');
      return {
        id,
        ack: (async (): Promise<WriteAck> => {
          const { made, error } = await runBlenderOperator(body, 'Duplicate Object');
          if (error !== null) return refuse(error);
          await selectAfterOperator(made);
          return {
            destination: `Blender — bpy.ops.object.duplicate(linked=False) on ${name}; the session saves the .blend`,
            persisted: true,
          };
        })(),
      };
    },
    duplicateMany: async (ids): Promise<WriteAck> => {
      const names = [...new Set(ids.map(objectNameFor))];
      if (names.length === 0 || names.some(name => name === null))
        return refuse('Select objects to duplicate; collections and data rows cannot be duplicated here.');
      const body = [
        `sources = [bpy.data.objects[name] for name in ${JSON.stringify(names)}]`,
        'with bpy.context.temp_override(selected_objects=sources, active_object=sources[0]):',
        '    result = bpy.ops.object.duplicate(linked=False)',
        'if "FINISHED" not in result: raise RuntimeError("Blender cancelled duplicating the selected objects")',
      ].join('\n');
      const { made, error } = await runBlenderOperator(body, 'Duplicate Objects');
      if (error !== null) return refuse(error);
      await selectAfterOperator(made);
      return {
        destination: 'Blender — duplicate selected objects as one native operation; the session saves the .blend',
        persisted: true,
      };
    },
    /** REFUSED BY NAME. Parenting in Blender is `object.parent_set`, and it is
     *  a gesture of its own with a type to choose (Object, Object Keep
     *  Transform, Armature Deform, …) and a `matrix_parent_inverse` to settle.
     *  A drag in a tree cannot mean one of those without saying which, so this
     *  unit does not guess (WORK.md §THE BLENDER RELEASE, B6 — parenting is
     *  not in it). */
    reparent: () =>
      refuse(
        "Reparenting is Blender's `bpy.ops.object.parent_set`, which needs a parent TYPE " +
          '(Object, Object Keep Transform, Armature Deform, …) that a drag does not say. ' +
          'Set the parent on the object’s Relations panel, or with bpy.',
      ),
  };

  const adapter: BlenderOutlinerAdapter = {
    // THE DOCUMENT'S OWN IDENTITY CARRIES OVER, and forgetting it is what the
    // walk caught first: this package's Properties sections resolve their
    // subject by asking the ACTIVE adapter for `documentId`, `hierarchy.object3D`
    // and `documentRootObject` (`blender-properties-model.ts`,
    // `isObject3DAuthoring`) — a structural check, because a contributed
    // package holds no host type. An adapter that overrides the tree and drops
    // those two members is a DIFFERENT adapter to that check, and the whole
    // Properties rail silently stopped matching: selecting the Rig drew the
    // host's bare identity row instead of Blender's tabs (measured 2026-09-19).
    // They are getters rather than copies because the default adapter answers
    // both from live state.
    get documentId() {
      return (defaultAdapter as { documentId?: string }).documentId;
    },
    get documentRootObject() {
      return (defaultAdapter as { documentRootObject?: THREE.Object3D | null }).documentRootObject;
    },
    capabilities: CAPABILITIES,
    provenance: PROVENANCE,
    hierarchy,
    selection,
    inspector,
    transforms,
    structure,
    subscribe: (listener) => {
      listeners.add(listener);
      const stopTree = subscribeBlenderOutliner(listener);
      const stopDefault = defaultAdapter.subscribe?.(listener) ?? (() => {});
      return () => {
        listeners.delete(listener);
        stopTree();
        stopDefault();
      };
    },
  };

  // THE HEADER'S DOOR ONTO THIS OUTLINER (see {@link BlenderOutlinerHandle}).
  // It exposes what the 3D viewport header's menus need and nothing else: the
  // subject, the tree's objects, a way to publish a selection, and the same
  // `structure` the hierarchy panel drives.
  const handle: BlenderOutlinerHandle = {
    get documentId() {
      return adapter.documentId;
    },
    selectedObjectNames: () => selectedObjects(),
    allObjectNames: () => {
      const names: string[] = [];
      for (const row of rows().values()) if (isObjectRow(row)) names.push(row.object);
      return names;
    },
    selectObjects: (names) => {
      const ids = names.map(rowIdForName).filter((id): id is string => id !== null);
      selection.set(ids);
    },
    rowIdForObject: (name) => rowIdForName(name),
    structure,
    subscribe: (listener) => {
      listeners.add(listener);
      const stopTree = subscribeBlenderOutliner(listener);
      return () => {
        listeners.delete(listener);
        stopTree();
      };
    },
  };
  liveOutliners.add(handle);

  // THE ENGINE'S SELECTION ARRIVES ON ITS OWN, and this is what listens for
  // it: a frame (every present carries `selected`/`active`) and a tree read
  // (which is what turns a NAME into a row id). Both are needed — a present
  // with no structural change ships a new selection against the same tree,
  // and an agent's `bpy.ops.mesh.primitive_monkey_add()` ships a new
  // selection against a tree that does not hold its row until the read lands.
  // Taken here rather than inside `adapter.subscribe` because the cache must
  // follow the engine whether or not a panel is currently mounted over it.
  const stopEngineFrames = onBlenderFrame(syncFromEngine);
  const stopEngineTree = subscribeBlenderOutliner(syncFromEngine);
  syncFromEngine();

  return {
    adapter,
    dispose: () => {
      stopEngineFrames();
      stopEngineTree();
      liveOutliners.delete(handle);
      listeners.clear();
    },
  };
};
