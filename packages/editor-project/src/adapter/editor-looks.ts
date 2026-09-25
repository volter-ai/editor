/**
 * THE LOOK POINTS — a workspace layout, a keymap and a style bundle as DATA a
 * package contributes (WORKBENCH.md §Contribution points: "Layouts, keymaps
 * and styles are DATA points: they need no code to load, which is what makes
 * a 'styled build' a manifest choice rather than a code change").
 *
 * A contribution module declares its point and exports ONE object:
 *
 *   `model.layout.ts`    export const point = 'workspace.layout';  export const layout: WorkspaceLayoutContribution
 *   `blender.keymap.ts`  export const point = 'workspace.keymap';  export const keymap: KeymapContribution
 *   `blender.style.ts`   export const point = 'workspace.style';   export const style: StyleContribution
 *
 * The editor registers what a project's declared packages contribute beside
 * its own built-ins — Look, Animate and Design as workspaces, the vgai keymap,
 * the Classic/Glass/Maya/Substance bundles — and never asks which package is
 * open: a build without the Blender look has no Model workspace.
 */
import type { WorkspaceArrangement } from './workspace-arrangement';

/**
 * Every keyboard action the editor's chrome binds. A keymap binds these and
 * nothing else; a game never reads this table (play-mode input isolation is a
 * different mechanism).
 */
export type EditorKeyActionId =
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.copy'
  | 'edit.cut'
  | 'edit.paste'
  | 'edit.duplicate'
  | 'edit.group'
  | 'edit.wrap'
  | 'edit.unwrap'
  | 'edit.selectAll'
  | 'edit.deselectAll'
  | 'edit.save'
  | 'edit.delete'
  | 'edit.enterScope'
  | 'edit.exitScopeOrDeselect'
  | 'edit.nudgeUp'
  | 'edit.nudgeUpCoarse'
  | 'edit.nudgeDown'
  | 'edit.nudgeDownCoarse'
  | 'edit.nudgeLeft'
  | 'edit.nudgeLeftCoarse'
  | 'edit.nudgeRight'
  | 'edit.nudgeRightCoarse'
  | 'view.resetPan'
  | 'view.commandPalette'
  | 'view.toggleConsole'
  | 'view.focusMode'
  | 'workspace.cycleNext'
  | 'workspace.cyclePrevious'
  /** Arm the tool that draws NO transform gizmo — Blender's Select Box, whose
   *  3D View keymap puts it on `W` (`blender_default.py:1950-1955`,
   *  `op_tool_cycle("builtin.select_box", …)`). This editor's own keymap binds
   *  it to nothing: W/E/R/T are its four transform tools. */
  | 'transform.select'
  | 'transform.combined'
  | 'transform.translate'
  | 'transform.rotate'
  | 'transform.scale'
  | 'viewport.toggleSnap'
  | 'viewport.frameSelection'
  | 'viewport.cyclePivot'
  | 'viewport.vertexSnapHold'
  | 'viewport.snapToFloor'
  | 'view.top'
  | 'view.front'
  | 'view.right'
  | 'view.perspective';

/**
 * One chord. `key` is matched case-insensitively against `KeyboardEvent.key`;
 * `code` (when set) is matched against `KeyboardEvent.code` instead, for
 * chords whose typed character varies by layout or modifier (Option+letter on
 * macOS types a symbol). `mod` is ⌘ on macOS and Ctrl elsewhere.
 */
export interface KeyChord {
  readonly key: string;
  readonly code?: string;
  readonly mod?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
}

/** The chords a keymap binds for the actions it names. An action a keymap
 *  omits keeps the editor's own binding; an EMPTY list unbinds it. */
export type KeymapBindings = Partial<Record<EditorKeyActionId, readonly KeyChord[]>>;

export interface KeymapContribution {
  /** The `keymap` settings value that selects it. */
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly bindings: KeymapBindings;
}

export type WorkspaceLayoutRegions = NonNullable<WorkspaceArrangement['regions']>;

export interface WorkspaceLayoutContribution {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** What the workspace needs the project to DECLARE before it applies:
   *  `'mounts'` (at least one root that plays) or a document kind the
   *  project's table lists. Omitted: every project. */
  readonly requires?: 'mounts' | { readonly documentKind: string };
  /** Which chrome regions the workspace shows; absent means every region. */
  readonly regions?: WorkspaceLayoutRegions;
  /** The workspace's EDITOR AREAS beside the centre document — a second
   *  editor group holding a `workspace.document` contribution, the shape
   *  Blender's own screens have (`WorkspaceAreaContribution`). Absent: the
   *  centre document alone. */
  readonly areas?: WorkspaceArrangement['areas'];
}

/**
 * An OPAQUE material a style bundle carries: Classic's physics (opaque
 * surfaces, conventional bars and panels) under its own corner radii and
 * shadows. Chroma stays the palette's; Glass is the editor's own and is not
 * contributable.
 */
export interface MaterialContribution {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** Corner radii, smallest to largest, and the pill. */
  readonly shape: {
    readonly small: string;
    readonly medium: string;
    readonly large: string;
    readonly full: string;
  };
  /** `box-shadow` values (`none` allowed) for raised widgets, menus, dialogs. */
  readonly elevation: {
    readonly small: string;
    readonly medium: string;
    readonly large: string;
  };
  /** How tight the chrome sits: control heights, the type scale and the
   *  chrome rows, in px. Every field is optional; absent ones keep the
   *  editor's own. */
  readonly density?: DensityContribution;
}

export interface DensityContribution {
  readonly control?: {
    readonly compact?: number;
    readonly default?: number;
    readonly comfortable?: number;
  };
  readonly font?: {
    readonly xs?: number;
    readonly sm?: number;
    readonly base?: number;
    readonly md?: number;
    readonly lg?: number;
    readonly xl?: number;
    readonly '2xl'?: number;
    readonly heading?: number;
  };
  /** Glyph sizes, independent of the type scale: Blender's chrome glyphs are
   *  14 px whatever the text around them measures. */
  readonly icon?: {
    readonly xs?: number;
    readonly sm?: number;
    readonly md?: number;
    readonly lg?: number;
    readonly xl?: number;
    readonly '2xl'?: number;
  };
  readonly chrome?: {
    readonly commandBar?: number;
    readonly panelHeader?: number;
    readonly localToolbar?: number;
    readonly treeRow?: number;
    /** How far one level of a tree steps right. Absent keeps the editor's own
     *  14; Blender's Outliner steps by its ROW HEIGHT — a square grid, 20 —
     *  with the chevron owning one cell and the type glyph the next. */
    readonly treeIndent?: number;
    readonly statusBar?: number;
    /** The tool rail: a tool's box, its width, the gap between groups. */
    readonly toolSize?: number;
    readonly toolWidth?: number;
    readonly toolGap?: number;
    /** How wide the seam between two docked AREAS is cut, in px. Absent
     *  keeps the editor's own hairline; Blender's groove measures 3.5. The
     *  colour is the palette's `color.boundary.area`. */
    readonly areaSeam?: number;
    /** THE EMBOSS beside that groove, as a percentage of WHITE mixed into the
     *  area's OWN fill — so it is one number and every area computes its own
     *  colour from it. Absent (or 0) paints nothing, which is what every skin
     *  but Blender does; Blender's measures 8.2. See `theme.ts`'s
     *  `areaEmbossValue` for the five fills it was solved against. */
    readonly areaEmboss?: number;
  };
  /**
   * WHAT A LOOK STATES ABOUT THE 3D STAGE, as opposed to about the chrome
   * around it. Absent members keep the editor's own.
   *
   * It sits under `density` because that is the group a MATERIAL already
   * carries and the stage's values travel with it — and one of them,
   * {@link shelfTool}, is not a length, which the group's "all in px"
   * elsewhere does not cover. That is a deliberate reading rather than an
   * oversight: what decides a value's home here is WHO STATES IT and WHO
   * READS IT (the look states both of these, the stage reads both, and both
   * arrive at the stage through the same emitted token), not whether it
   * happens to be a number.
   */
  readonly viewport?: {
    /**
     * THE TRANSFORM GIZMO'S SCREEN SIZE, in px per gizmo unit — Blender's
     * `U.gizmo_size` (`DNA_userdef_types.h:1095`, default 75; Preferences ▸
     * Viewport ▸ Gizmos ▸ Size, `rna_userdef.cc:5415-5419`).
     *
     * A gizmo is a CONSTANT SCREEN SIZE, never a fraction of the object or of
     * the viewport: `wm_gizmo.cc:450-474` computes
     * `scale_final = scale_basis · UI_SCALE_FAC · U.gizmo_size ·
     * ED_view3d_pixel_size_no_ui_scale(rv3d, origin)`, and that last term is
     * world units per device pixel while `UI_SCALE_FAC` is device pixels per
     * UI pixel — so one gizmo unit is exactly `U.gizmo_size` CSS px at any
     * display scale.
     *
     * Absent keeps the editor's own gizmo, which is a fraction of the
     * VIEWPORT (three's `TransformControls` at `size` 1). What the number
     * means on our side — three's handles are authored on a unit half
     * Blender's — is `editor-viewport.ts`'s to know, and it says so there.
     */
    readonly gizmoSize?: number;
    /**
     * WHICH TOOL THE STAGE'S SHELF ARMS AT BOOT — the editor's own combined
     * transform gizmo (`transform`, the default a look that names nothing
     * keeps), or none (`select`).
     *
     * Blender's is `select`: its tool shelf opens on Select Box
     * (`space_toolsystem_toolbar.py`, `_defs_view3d_generic.select_box` is the
     * first entry of the Object Mode `_tools_default`), and a selected object
     * carries NO transform gizmo until Move, Rotate, Scale or Transform is the
     * active tool — photographed at the engine's pin, `gizmo-select-box.png`
     * (Select Box lit, the default cube selected and outlined, nothing at its
     * origin but the 3D cursor) against `gizmo-move.png` (Move lit).
     *
     * A BOOT DEFAULT, never a standing switch: every tool stays one click away
     * in the shelf, and a person who arms one keeps it
     * (`WorkspaceDocumentSurface`'s `armShelfBootTool`).
     */
    readonly shelfTool?: 'select' | 'transform';
    /**
     * WHICH AXIS IS UP IN THE WORLD THIS STAGE PRESENTS — and therefore what
     * three's own X/Y/Z MEAN to the person looking at them.
     *
     * `'y'` (absent) is three's own frame: the stage's axes are the source's
     * axes, and X/Y/Z are drawn and named as three has them.
     *
     * `'z'` says the document's world is Z-UP and the stage presents it
     * through the exact signed permutation `(x, y, z) → (x, z, −y)` — one
     * spelling, `BlenderRuntimeView`'s root matrix, and the reason it is an
     * exact permutation rather than a float quarter turn is stated there. So
     * three's Y is the source's Z and three's Z is the source's NEGATIVE Y,
     * which is what the transform gizmo's colours, the arms it draws, the
     * plane squares and the navigation gizmo's six labels must say. Nothing
     * here changes a MATRIX: the write is still `P⁻¹ · matrixWorld` and the
     * engine still decomposes it. This is about what the person is told the
     * handle they are grabbing IS.
     *
     * MEASURED 2026-09-21 (WALK 5 rows 3c/5b): with nothing stating this, the
     * world-up arm was GREEN and its drag wrote Blender's `location.z`, the
     * up-pointing scale handle wrote `scale.z` under a blue cap the person
     * reads as three's Z, and the navigation gizmo put Y on top of a Z-up
     * world. Every channel was already right; every LABEL was wrong.
     */
    readonly upAxis?: 'y' | 'z';
    /**
     * WHAT A BOX SELECT IN THIS STAGE MEANS — `'contain'` (absent) selects
     * what fits INSIDE the rectangle, `'touch'` selects everything the
     * rectangle crosses.
     *
     * Both are real editors' answers and neither is a default the other can
     * carry. Blender's Select Box is `'touch'`: its object-mode box select
     * reads the object-id buffer under the rectangle, so any drawn part of an
     * object inside the box selects it. The editor's own is `'contain'`, and
     * it is there for a measured reason — with `'touch'`, a ground plane and
     * a sky dome cross every rectangle a person draws in the middle of a
     * scene, and a human pass gave up on marquee over exactly that
     * ("I still select more than what is needed", runhuman pass 25).
     *
     * A look that presents another program's viewport states that program's
     * answer; a look that states nothing keeps the editor's.
     */
    readonly boxSelect?: 'contain' | 'touch';
    /**
     * THE FLOOR GRID'S LINES, in device pixels: the minor lines' width, the major lines' width,
     * and how far the major lines' colour is carried past the minor's from the backdrop (1 draws
     * both levels alike). A look that states none keeps the editor's own floor, one hairline
     * level — the grid the kit drew before its floor was fitted to Blender. Blender's are 1.5,
     * 2.25 and 39/21, measured across one scanline of `modeling-object-none.png`: the 1 m line
     * 4 px at half rise plateauing at 83, the 10 m line 6 px plateauing at 101
     * (`docs/VIEWPORT-STAGE.md`: widths are the look's, like colours).
     */
    readonly gridLineWidth?: number;
    readonly gridMajorWidth?: number;
    readonly gridMajorContrast?: number;
    /**
     * HOW THE SELECTION BOX MARK IS DRAWN (the view's `overlays.selection.box`): `corners`, the
     * editor's own brackets, or `edges`, the full box (Godot's selection box); and its stroke in
     * CSS px (the editor's own is 3; Godot's box is a hairline).
     */
    readonly selectionBox?: 'corners' | 'edges';
    readonly selectionBoxWidth?: number;
  };
}

/**
 * A glyph's CATEGORY — the colour channel a set may carry per glyph, painted
 * as `var(--vgai-category-<tone>, currentColor)` so a palette that names no
 * `color.category` group paints the glyph exactly as a monochrome one.
 *
 * The vocabulary is Blender's Properties-tab rail read as data: that rail
 * groups by HUE, and at 14 px the hue is what tells one tab from another
 * (`properties-object.png` — the shapes are near-indistinguishable). Each
 * member is a MEASURED ink; see `EditorTheme.color.category` for the values
 * and their source coordinates.
 */
export type IconCategoryTone =
  | 'object'
  | 'modifier'
  | 'material'
  | 'tool'
  | 'operator'
  | 'data'
  // Blender's SCENE group and its COLLECTION, added 2026-09-19 (WORK.md
  // §Blender in the tab is Blender, "Inspection parity", I2 decision 3). They
  // are not a reading of the rail: every Blender icon declares its group in
  // `UI_icons.hh` through a `DEF_ICON_<GROUP>` macro, and
  // `interface_icons.cc:126-132` maps those onto the theme members
  // `interface/resources.cc:1059-1078` reads — `DEF_ICON_SCENE` →
  // `TH_ICON_SCENE` → `.tui.icon_scene` #cccccc
  // (`userdef_default_theme.c:272`), `DEF_ICON_COLLECTION` →
  // `.tui.icon_collection` #ffffff (`:273`). The Render, Output, View Layer
  // and Scene tabs are `DEF_ICON_SCENE`; the Collection tab is
  // `DEF_ICON_COLLECTION(GROUP)` (`UI_icons.hh:248`).
  | 'scene'
  | 'collection';

/**
 * An ICON SET a style bundle carries: glyphs keyed by the Font Awesome icon
 * name each editor site names (`plus`, `xmark`, `trash`, `gear`, …), each one
 * `path` painted with `currentColor` in its `viewBox` (default `0 0 16 16`).
 * A set may be partial — a glyph it lacks paints the editor's own.
 *
 * `tone` and `tonedPath` are the COLOUR channel, and they are two shapes of
 * one idea because Blender draws two shapes of it:
 *
 *  - `tone` alone tints the WHOLE glyph — the Properties rail's category
 *    tabs and the outliner's type glyphs, where the mark IS the category.
 *  - `tone` with `tonedPath` splits the glyph in two: `path` stays neutral
 *    (`currentColor`) and `tonedPath` takes the category ink. That is
 *    exactly how an operator mark reads in `modeling-edit-none.png` — the
 *    cube stays white and only the OPERATED element is tinted — and a
 *    single per-glyph tone cannot express it.
 *
 * Either way an explicit `tone` prop at the SITE wins, so a de-emphasized
 * (`dim`/`muted`) glyph stays de-emphasized.
 */
export interface IconSetContribution {
  readonly id: string;
  readonly title: string;
  readonly glyphs: Readonly<
    Record<
      string,
      {
        readonly viewBox?: string;
        readonly path: string;
        readonly tone?: IconCategoryTone;
        readonly tonedPath?: string;
      }
    >
  >;
}

export interface StyleContribution {
  readonly id: string;
  readonly title: string;
  /** A palette id the editor knows — a built-in, or the `palette` document
   *  this contribution carries. */
  readonly paletteId: string;
  /** A material id the editor knows — `classic`, `glass`, or the `material`
   *  this contribution carries. */
  readonly materialId: string;
  readonly material?: MaterialContribution;
  /** The icon set this bundle applies — the `icons` it carries, or one the
   *  editor knows. Absent: the editor's own glyphs. */
  readonly iconSetId?: string;
  readonly icons?: IconSetContribution;
  /** Region defaults beneath each workspace's own. */
  readonly regions?: WorkspaceLayoutRegions;
  /** A v3 palette DOCUMENT (the same shape a person imports), registered into
   *  the editor's theme library with this bundle. */
  readonly palette?: unknown;
}
