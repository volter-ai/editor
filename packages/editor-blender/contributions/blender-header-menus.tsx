/**
 * THE MODEL DOCUMENT'S HEADER IS BLENDER'S 3D VIEWPORT HEADER, in Object Mode
 * (WORK.md §THE BLENDER RELEASE, B6; ARCHITECTURE-CORE §Blender north star
 * goal 3 as amended — the person "can make MACRO adjustments at the screen …
 * each a bpy call through the doors that exist").
 *
 * `VIEW3D_MT_editor_menus` (`scripts/startup/bl_ui/space_view3d.py:1143-1210`)
 * draws four menu words in Object Mode, in this order: **View**
 * (`:1153`), **Select** (`:1166`, `VIEW3D_MT_select_object`), **Add**
 * (`:1169`, `VIEW3D_MT_add`) and **Object** (`:1210`, `VIEW3D_MT_object`).
 * Three of them are here.
 *
 * VIEW IS NOT DRAWN, and that is a placement decision rather than an omission.
 * Its rows that this editor has are the CAMERA VIEW rows — Front / Right / Top
 * / Perspective 3/4, and the Perspective–Orthographic pair — and they are
 * already a menu in THIS SAME HEADER STRIP: the host draws
 * `Object3DDocumentToolbar` at the strip's trailing edge for every document
 * with a 3D session, which is exactly where Blender's viewport header carries
 * them too (`DocumentHeaderStrip`'s own note). A View menu here would be the
 * same control twice in one row, which is the defect the rule about a control
 * having ONE home exists to prevent. Every other row of Blender's View menu —
 * the sidebar and tool-shelf toggles, local view, the view-point and
 * view-axis submenus, Frame Selected, Viewport Render — is either a control
 * this unit does not act on or one that already has its own home in the strip.
 *
 * WHAT IS DRAWN IS WHAT ACTS. A row Blender draws that this unit does not act
 * on is simply not here — never a row that opens a dialog we do not have, and
 * never one that no-ops. Where a row exists in Blender and is REFUSED here it
 * is drawn disabled with the refusal as its reason: Set Origin ▸ Origin to 3D
 * Cursor (there is no 3D cursor yet) and the four Add rows that want a FILE
 * (Image ▸ Reference…/Background…/Mesh Plane…, Volume ▸ Import OpenVDB… —
 * `BlenderCreatableKind.refusal` carries each sentence). Add is the whole of
 * `VIEW3D_MT_add` now, so "not here" means Blender's menu-search row and
 * nothing else.
 *
 * EVERY ROW IS BLENDER RUNNING ITS OWN OPERATOR, through the doors B6 built:
 * `StructureProvider` for Add / Duplicate / Delete, and
 * `runBlenderObjectOperator` for Apply / Clear / Set Origin. Nothing here
 * reimplements a transform apply or an origin move.
 */

import type { ToolNotice } from '@volter/editor-sdk/contributions';
import {
  AnchoredMenu,
  EditorToolbar,
  MenuItem,
  MenuSeparator,
  MenuSubmenu,
  MenuTrigger,
} from '@volter/editor-sdk/widgets';
import { type ReactNode, type RefObject, useRef, useState, useSyncExternalStore } from 'react';
import {
  type BlenderCreatableKind,
  type BlenderOutlinerHandle,
  blenderCreatableKinds,
  blenderOutlinerHandle,
  runBlenderObjectOperator,
} from './blender-outliner-authoring';
import { blenderOutlinerVersion, subscribeBlenderOutliner } from './blender-outliner-model';

type MenuId = 'select' | 'add' | 'object';

/**
 * BLENDER'S OWN ROWS for the three transform submenus of `VIEW3D_MT_object`,
 * each citing the line it is transcribed from. The rows Blender draws in those
 * submenus that this unit does not act on — Apply's five delta rows, its
 * Visual Transform / Visual Geometry to Mesh / Parent Inverse block, Clear's
 * Origin row, Set Origin's two centre-of-mass rows — are not here, for the
 * reason the header's own note gives.
 */
const APPLY_ROWS: readonly { readonly label: string; readonly call: string }[] = [
  // `VIEW3D_MT_object_apply`, `space_view3d.py:3206-3219`: one
  // `object.transform_apply` per row with the three booleans set.
  { label: 'Location', call: 'location=True, rotation=False, scale=False' },
  { label: 'Rotation', call: 'location=False, rotation=True, scale=False' },
  { label: 'Scale', call: 'location=False, rotation=False, scale=True' },
  { label: 'All Transforms', call: 'location=True, rotation=True, scale=True' },
];

const CLEAR_ROWS: readonly { readonly label: string; readonly call: string }[] = [
  // `VIEW3D_MT_object_clear`, `space_view3d.py:2938-2940`. `clear_delta` is
  // False on all three, which is the row's own property in that menu.
  { label: 'Location', call: 'bpy.ops.object.location_clear(clear_delta=False)' },
  { label: 'Rotation', call: 'bpy.ops.object.rotation_clear(clear_delta=False)' },
  { label: 'Scale', call: 'bpy.ops.object.scale_clear(clear_delta=False)' },
];

const ORIGIN_ROWS: readonly {
  readonly label: string;
  readonly type: string;
  readonly refusal?: string;
}[] = [
  // `VIEW3D_MT_object`, `space_view3d.py:2817` — one
  // `operator_menu_enum("object.origin_set", "type")`, so the labels are the
  // `type` enum's own UI names.
  { label: 'Geometry to Origin', type: 'GEOMETRY_ORIGIN' },
  { label: 'Origin to Geometry', type: 'ORIGIN_GEOMETRY' },
  {
    label: 'Origin to 3D Cursor',
    type: 'ORIGIN_CURSOR',
    refusal:
      'There is no 3D cursor in this editor yet, so there is no point to move the origin to. ' +
      'Blender places it with Shift+Right-click; that gesture is not built here.',
  },
];

/**
 * `VIEW3D_MT_add`'S OWN ROWS, in its own order, with its own separators
 * (`space_view3d.py:2699-2764`, read at the engine's pin) — EIGHTEEN
 * top-level rows, each carrying the line it is transcribed from.
 *
 * Eighteen and not seventeen: `:2707` is Point Cloud
 * (`object.pointcloud_random_add`), a flat row between Text and Volume that a
 * count taken from Blender's manual misses. The pinned source is the
 * reference, so it is drawn.
 *
 * A SUBMENU NAMES A GROUP OF {@link CREATABLE_KINDS}, which is where each
 * row's label, call and refusal live; a flat row names one kind. The one
 * dynamic submenu is Collection Instance, whose rows are the file's own
 * collections (`liveCollectionKinds`).
 *
 * WHAT BLENDER DRAWS THAT IS NOT HERE, and why — the same rule the header's
 * note states: `Search…` (`:2689`) draws only under `EXEC_REGION_WIN` and
 * opens the menu-search dialog this editor has no door for. Everything else
 * `VIEW3D_MT_add` draws is here, including the rows that refuse (they are
 * drawn disabled with the engine's own reason rather than omitted, because a
 * person looking for Reference… should find it and be told why it cannot run).
 */
type AddRow =
  /** `layout.separator()`, at this line — which is also the row's key. */
  | { readonly separatorAt: string }
  /** A row `VIEW3D_MT_add` draws directly, by its kind id. */
  | { readonly kind: string; readonly at: string }
  /** A submenu: the label Blender gives it, and the `CREATABLE_KINDS` group
   *  whose rows fill it (the same string). */
  | { readonly submenu: string; readonly at: string };

const ADD_MENU: readonly AddRow[] = [
  { submenu: 'Mesh', at: '2699' },
  { submenu: 'Curve', at: '2702' },
  { submenu: 'Surface', at: '2704' },
  { submenu: 'Metaball', at: '2705' },
  { kind: 'text', at: '2706' },
  { kind: 'point-cloud', at: '2707' },
  { submenu: 'Volume', at: '2708' },
  { submenu: 'Grease Pencil', at: '2709' },
  { separatorAt: '2711' },
  // `:2713` asks `VIEW3D_MT_armature_add.is_extended()`; no add-on extends it
  // in this engine, so Blender's own `else` branch — the flat row — is drawn.
  { kind: 'armature', at: '2716' },
  { submenu: 'Lattice', at: '2718' },
  { separatorAt: '2720' },
  { submenu: 'Empty', at: '2722' },
  { submenu: 'Image', at: '2723' },
  { separatorAt: '2725' },
  { submenu: 'Light', at: '2727' },
  { submenu: 'Light Probe', at: '2728' },
  { separatorAt: '2730' },
  // `:2732`'s `is_extended()` is false the same way, so `VIEW3D_MT_camera_add`
  // draws its single row INTO this menu (`:2735`).
  { kind: 'camera', at: '2735' },
  { separatorAt: '2737' },
  { kind: 'speaker', at: '2739' },
  { separatorAt: '2741' },
  { submenu: 'Force Field', at: '2743' },
  { separatorAt: '2745' },
  { submenu: 'Collection Instance', at: '2759' },
];

/** BLENDER'S OWN TEXT for a Collection Instance row with no collection to
 *  instance (`space_view3d.py:2755`), drawn on a disabled row exactly as
 *  Blender draws it (`col.enabled = has_collections`, `:2749`). */
const NO_COLLECTIONS = 'No Collections to Instance';

/** One menu word in the bar, with its own anchor and its own panel. */
function MenuWord({
  id,
  open,
  setOpen,
  anchorRef,
  children,
}: {
  id: MenuId;
  open: MenuId | null;
  setOpen: (next: MenuId | null) => void;
  anchorRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  return (
    <div ref={anchorRef} style={{ position: 'relative' }}>
      <MenuTrigger
        data-testid={`blender-menu-${id}`}
        aria-expanded={open === id}
        onClick={() => setOpen(open === id ? null : id)}
        // BLENDER'S OWN BAR BEHAVIOUR: with one menu open, moving across the
        // bar opens the next. The same rule `ApplicationMenus` transcribes for
        // the title bar's words.
        onPointerEnter={() => {
          if (open) setOpen(id);
        }}
        style={{ textTransform: 'capitalize' }}
      >
        {id}
      </MenuTrigger>
      {open === id && (
        // PORTALED, not `position: absolute` — the document header strip is
        // 26 px tall and clips, the same fact `ApplicationMenus` records about
        // the workbench's own title bar.
        <AnchoredMenu
          anchorRef={anchorRef}
          dismissBoundaryRef={anchorRef}
          align="start"
          gap={0}
          clamp
          aria-label={id}
          onDismiss={() => setOpen(null)}
        >
          {children}
        </AnchoredMenu>
      )}
    </div>
  );
}

/**
 * WHAT A ROW DID, SAID OUT LOUD. Every row here is a bpy call whose success and
 * whose REFUSAL are both invisible on screen — an added object appears, but a
 * refused `transform_apply` on a linked mesh, a Blender traceback, or an
 * operator the headless build has no context for all look exactly like a menu
 * that closed. So each row's `WriteAck` is read and reported through the host's
 * own notice door (`ToolContributionProps.notify`).
 *
 * MEASURED 2026-09-21, which is why this exists rather than being tidy: Add ▸
 * Mesh ▸ UV Sphere created the sphere and never selected it, and the ONLY
 * evidence was `bpy.data.objects` read from a second door — the menu itself
 * reported nothing either way. An ack that says `persisted: false` now carries
 * Blender's own sentence to the screen.
 */
function reportAck(
  notify: ((notice: ToolNotice) => () => void) | undefined,
  label: string,
  outcome: unknown,
): void {
  void (async () => {
    const ack = (await outcome) as { destination?: string; persisted?: boolean } | undefined;
    if (ack === undefined || typeof ack.destination !== 'string') return;
    if (ack.persisted === true) return;
    // THE ENGINE'S OWN SENTENCE, verbatim — a refusal's `destination` IS the
    // reason (`StructureProvider`'s refusals and `runBlenderObjectOperator`).
    notify?.({ tone: 'error', title: `${label} was refused`, detail: ack.destination });
  })();
}

export function BlenderObjectModeHeader({
  documentId,
  notify,
}: {
  documentId?: string | undefined;
  notify?: ((notice: ToolNotice) => () => void) | undefined;
}) {
  // The tree is what says which objects exist and which are selected, and both
  // menus read it, so the bar re-renders on the Outliner's own version.
  useSyncExternalStore(subscribeBlenderOutliner, blenderOutlinerVersion, blenderOutlinerVersion);
  const [open, setOpen] = useState<MenuId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLDivElement>(null);
  const objectRef = useRef<HTMLDivElement>(null);
  const handle = blenderOutlinerHandle(documentId);
  // NOTHING RATHER THAN A DEAD BAR: with no Outliner published for this
  // document there is no subject for any of these rows, and a menu of rows
  // that cannot act is the inert control this file's header rules out.
  if (handle === null) return null;

  const run = (
    label: string,
    action: (outliner: BlenderOutlinerHandle) => unknown,
  ): (() => void) => {
    return () => {
      setOpen(null);
      reportAck(notify, label, action(handle));
    };
  };
  const selected = handle.selectedObjectNames();
  const all = handle.allObjectNames();
  const nothingSelected = selected.length === 0 ? 'Nothing is selected.' : undefined;

  // THE ADD MENU'S ROWS. The kinds are read fresh on every render because one
  // submenu's rows are the file's own collections, which change as the person
  // works (`liveCollectionKinds`) — and this bar already re-renders on the
  // Outliner's version, which is where that tree comes from.
  const kinds = blenderCreatableKinds();
  /** One row: Blender's label, its kind's call, and — where the kind refuses —
   *  drawn DISABLED with that sentence as its reason, the shape Set Origin ▸
   *  Origin to 3D Cursor set. */
  const addItem = (kind: BlenderCreatableKind): ReactNode => (
    <MenuItem
      key={kind.kind}
      data-testid={`blender-add-${kind.kind}`}
      disabled={kind.refusal !== undefined}
      title={kind.refusal}
      onSelect={run(`Add ${kind.label}`, (outliner) => outliner.structure.create(kind.kind).ack)}
    >
      {kind.label}
    </MenuItem>
  );
  const addGroup = (group: string): ReactNode[] =>
    kinds
      .filter((kind) => kind.group === group)
      .flatMap((kind) =>
        kind.separatorBefore === true
          ? [<MenuSeparator key={`${kind.kind}-separator`} />, addItem(kind)]
          : [addItem(kind)],
      );
  const addRowNode = (row: AddRow): ReactNode => {
    if ('separatorAt' in row) return <MenuSeparator key={`separator-${row.separatorAt}`} />;
    if ('kind' in row) {
      const kind = kinds.find((one) => one.kind === row.kind);
      return kind === undefined ? null : addItem(kind);
    }
    const rows = addGroup(row.submenu);
    // THE FILE HAS NO COLLECTION TO INSTANCE, which is Blender's own disabled
    // row rather than an empty submenu (`:2749-2757`). No other group can be
    // empty — the rest are the static table's.
    if (rows.length === 0)
      return (
        <MenuItem key={row.submenu} data-testid="blender-add-collection-instance" disabled>
          {NO_COLLECTIONS}
        </MenuItem>
      );
    return (
      <MenuSubmenu
        key={row.submenu}
        label={row.submenu}
        data-testid={`blender-add-${row.submenu.toLowerCase().replaceAll(' ', '-')}`}
      >
        {rows}
      </MenuSubmenu>
    );
  };

  return (
    <EditorToolbar
      compact
      label="Blender Object Mode menus"
      data-testid="blender-object-mode-menus"
      ref={rootRef}
    >
      {/* SELECT — `VIEW3D_MT_select_object`, `space_view3d.py:1713-1715`. The
          three rows are `object.select_all` with action SELECT / DESELECT /
          INVERT, and they act on THE PANEL'S selection rather than running that
          operator: the engine's own selection is a datablock state the document
          would save, which is exactly why the tree door takes our selection as
          a parameter instead of writing it (`session.py::rna_outliner`'s own
          note). Blender's remaining rows — the three interactive select tools,
          Select Active Camera, Mirror, Random, More/Less, and the four
          by-property submenus — are not drawn. */}
      <MenuWord id="select" open={open} setOpen={setOpen} anchorRef={selectRef}>
        <MenuItem
          data-testid="blender-select-all"
          onSelect={run('Select All', (outliner) => outliner.selectObjects(all))}
        >
          All
        </MenuItem>
        <MenuItem
          data-testid="blender-select-none"
          onSelect={run('Select None', (outliner) => outliner.selectObjects([]))}
        >
          None
        </MenuItem>
        <MenuItem
          data-testid="blender-select-invert"
          onSelect={run('Select Invert', (outliner) =>
            outliner.selectObjects(all.filter((name) => !selected.includes(name))),
          )}
        >
          Invert
        </MenuItem>
      </MenuWord>

      {/* ADD — `VIEW3D_MT_add`, `space_view3d.py:2679-2764`, EVERY ROW IT
          DRAWS, in its order, with its separators and its submenus. The shape
          is `ADD_MENU` above; what each row DOES is `CREATABLE_KINDS`. */}
      <MenuWord id="add" open={open} setOpen={setOpen} anchorRef={addRef}>
        {ADD_MENU.map((row) => addRowNode(row))}
      </MenuWord>

      {/* OBJECT — `VIEW3D_MT_object`, `space_view3d.py:2806-2878`, IN BLENDER'S
          OWN ROW ORDER with the rows this unit does not act on absent: Set
          Origin (`:2817`), Clear (`:2819`), Apply (`:2820`), then Duplicate
          Objects (`:2824`) and Delete (`:2874`). Blender's Transform, Mirror,
          Snap, Duplicate Linked, Join, the clipboard pair, Asset, Collection,
          Library Override, Relations, Parent, Modifiers, Constraints, Track,
          Make Links, the three shading rows, Animation, Rigid Body, Quick
          Effects, Convert, Show/Hide, Clean Up and Delete Global are not
          drawn. */}
      <MenuWord id="object" open={open} setOpen={setOpen} anchorRef={objectRef}>
        <MenuSubmenu label="Set Origin" data-testid="blender-object-origin">
          {ORIGIN_ROWS.map((row) => (
            <MenuItem
              key={row.type}
              data-testid={`blender-origin-${row.type}`}
              disabled={row.refusal !== undefined || selected.length === 0}
              title={row.refusal ?? nothingSelected}
              onSelect={run(`Set Origin ▸ ${row.label}`, (outliner) =>
                runBlenderObjectOperator(
                  outliner.selectedObjectNames(),
                  `bpy.ops.object.origin_set(type='${row.type}')`,
                ),
              )}
            >
              {row.label}
            </MenuItem>
          ))}
        </MenuSubmenu>
        <MenuSubmenu label="Clear" data-testid="blender-object-clear">
          {CLEAR_ROWS.map((row) => (
            <MenuItem
              key={row.label}
              data-testid={`blender-clear-${row.label.toLowerCase()}`}
              disabled={selected.length === 0}
              title={nothingSelected}
              onSelect={run(`Clear ▸ ${row.label}`, (outliner) =>
                runBlenderObjectOperator(outliner.selectedObjectNames(), row.call),
              )}
            >
              {row.label}
            </MenuItem>
          ))}
        </MenuSubmenu>
        <MenuSubmenu label="Apply" data-testid="blender-object-apply">
          {APPLY_ROWS.map((row) => (
            <MenuItem
              key={row.label}
              data-testid={`blender-apply-${row.label.toLowerCase().replace(/ /g, '-')}`}
              disabled={selected.length === 0}
              title={nothingSelected}
              onSelect={run(`Apply ▸ ${row.label}`, (outliner) =>
                runBlenderObjectOperator(
                  outliner.selectedObjectNames(),
                  `bpy.ops.object.transform_apply(${row.call})`,
                ),
              )}
            >
              {row.label}
            </MenuItem>
          ))}
        </MenuSubmenu>
        <MenuSeparator />
        <MenuItem
          data-testid="blender-object-duplicate"
          disabled={selected.length === 0}
          title={nothingSelected}
          onSelect={run('Duplicate Objects', async (outliner) => {
            const ids = outliner.selectedObjectNames()
              .map(name => outliner.rowIdForObject(name))
              .filter((id): id is string => id !== null);
            return outliner.structure.duplicateMany?.(ids);
          })}
        >
          Duplicate Objects
        </MenuItem>
        <MenuItem
          data-testid="blender-object-delete"
          disabled={selected.length === 0}
          title={nothingSelected}
          onSelect={run('Delete', (outliner) => {
            const ids = outliner
              .selectedObjectNames()
              .map((name) => outliner.rowIdForObject(name))
              .filter((id): id is string => id !== null);
            return outliner.structure.removeMany?.(ids);
          })}
        >
          Delete
        </MenuItem>
      </MenuWord>
    </EditorToolbar>
  );
}
