import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faArrowPointer,
  faArrowsRotate,
  faArrowsToDot,
  faArrowUpFromBracket,
  faBookOpen,
  faBorderAll,
  faBorderTopLeft,
  faCamera,
  faChartSimple,
  faCheck,
  faCircleExclamation,
  faCircleHalfStroke,
  faCircleInfo,
  faCode,
  faCompress,
  faCrosshairs,
  faCube,
  faCubesStacked,
  faDiagramProject,
  faExpand,
  faEye,
  faEyeSlash,
  faFile,
  faFileCode,
  faFileExport,
  faFolder,
  faFolderOpen,
  faFolderTree,
  faForwardStep,
  faGripLines,
  faHammer,
  faHand,
  faImage,
  faLightbulb,
  faList,
  faLock,
  faLockOpen,
  faMagnet,
  faMagnifyingGlass,
  faMagnifyingGlassMinus,
  faMagnifyingGlassPlus,
  faMaximize,
  faMusic,
  faPause,
  faPlay,
  faPlus,
  faPuzzlePiece,
  faRotate,
  faRotateLeft,
  faRotateRight,
  faScissors,
  faSliders,
  faStop,
  faTable,
  faTableCells,
  faTrash,
  faTriangleExclamation,
  faUpDownLeftRight,
  faUpRightAndDownLeftFromCenter,
  faUsers,
  faVideo,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';

/**
 * A definition under a name of OURS, carrying a Font Awesome drawing until an
 * icon set supplies its own (see `editorIcons.modeling`). The name is the only
 * thing that changes: `icon` — the width/height/path tuple every renderer
 * actually paints — is the source definition's, so nothing moves on screen
 * until a set keys the new name.
 */
function meshGlyph(iconName: string, source: IconDefinition): IconDefinition {
  return { ...source, iconName: iconName as IconDefinition['iconName'] };
}

/**
 * Semantic icon registry for editor chrome. Components may still import a
 * genuinely domain-specific Font Awesome definition, but recurring actions,
 * content kinds, status, and viewport tools use these stable meanings.
 */
export const editorIcons = {
  action: {
    add: faPlus,
    close: faXmark,
    delete: faTrash,
    search: faMagnifyingGlass,
    refresh: faArrowsRotate,
    undo: faRotateLeft,
    redo: faRotateRight,
    build: faHammer,
    export: faFileExport,
    select: faArrowPointer,
  },
  transport: {
    play: faPlay,
    pause: faPause,
    restart: faRotateRight,
    stop: faStop,
    step: faForwardStep,
  },
  content: {
    project: faFolderOpen,
    folder: faFolder,
    file: faFile,
    source: faFileCode,
    scene: faBookOpen,
    entity: faCube,
    component: faPuzzlePiece,
    camera: faCamera,
    light: faLightbulb,
    image: faImage,
    audio: faMusic,
    data: faTable,
    code: faCode,
    stateMachine: faDiagramProject,
  },
  status: {
    success: faCheck,
    info: faCircleInfo,
    warning: faTriangleExclamation,
    error: faCircleExclamation,
    visible: faEye,
    hidden: faEyeSlash,
    locked: faLock,
    unlocked: faLockOpen,
  },
  /** The 3D viewport's navigation cluster (`ViewportFurniture`). */
  viewport: {
    zoomIn: faMagnifyingGlassPlus,
    zoomOut: faMagnifyingGlassMinus,
    pan: faHand,
    frame: faExpand,
    /**
     * IT OWNS ITS NAME, for the reason `modeling` below states in full:
     * Blender's mark for this toggle is a grid IN PERSPECTIVE — a trapezoid,
     * measured 32x26 device on `modeling-edit-none.png`'s navigation capsule —
     * while three other sites ask for `border-all` and all three mean a FLAT
     * grid (the canvas viewport's grid toggle, the 3D overlay's, and the CSS
     * border editor's "all borders"). Redrawing the shared name would have
     * put a receding floor on a CSS border button. Font Awesome's `border-all`
     * stays as the drawing, so a set without this key paints what it painted.
     */
    projection: meshGlyph('viewport-projection', faBorderAll),
    /** The same toggle in an orthographic view: Blender's flat grid (`VIEW_ORTHO`). */
    projectionOrthographic: meshGlyph('viewport-orthographic', faBorderAll),
    /** Look through the document's camera (Blender's `VIEW_CAMERA_UNSELECTED`)… */
    camera: meshGlyph('viewport-camera', faVideo),
    /** …and the same button while looking through it (`VIEW_CAMERA`). */
    cameraView: meshGlyph('viewport-camera-view', faVideo),
    /** A camera view locked to its camera (`VIEW_LOCKED`), and not (`VIEW_UNLOCKED`). */
    cameraLocked: meshGlyph('viewport-camera-locked', faLock),
    cameraUnlocked: meshGlyph('viewport-camera-unlocked', faLockOpen),
  },
  /**
   * Mesh-modeling operators — the shelf glyphs a modeling document shows
   * (Blender's toolbar column). One per operator the `mesh` capability ships;
   * a contribution reaches them through `@volter/editor-sdk/widgets`.
   *
   * EACH OWNS ITS NAME. An icon set keys a glyph by `icon.iconName`
   * (`EditorIcon` → `activeIconGlyph`), so while these pointed at
   * `scissors`/`compress`/`grip-lines`/`table-cells` the operator mark and
   * every OTHER site using that name were one drawing: redrawing Knife as a
   * cut cube would have recut the editor's scissors everywhere. Blender draws
   * an operator AS THE OPERATION ON A CUBE, which is meaningless as a generic
   * mark, so the two must be separable — hence the `mesh-*` names below, which
   * no other site asks for.
   *
   * Font Awesome's `IconPrefix`/`IconName` are closed string unions of ITS
   * catalog, so a name of ours cannot typecheck as one: the prefix stays the
   * source definition's (nothing looks a glyph up by prefix) and the name is
   * asserted. The `icon` tuple stays the source's too, so a set that does not
   * carry the `mesh-*` name still paints exactly what it painted before.
   */
  modeling: {
    extrude: meshGlyph('mesh-extrude', faArrowUpFromBracket),
    inset: meshGlyph('mesh-inset', faCompress),
    bevel: meshGlyph('mesh-bevel', faBorderTopLeft),
    loopCut: meshGlyph('mesh-loop-cut', faGripLines),
    knife: meshGlyph('mesh-knife', faScissors),
    smooth: meshGlyph('mesh-smooth', faCircleHalfStroke),
    shrinkFatten: meshGlyph('mesh-shrink-fatten', faUpRightAndDownLeftFromCenter),
    subdivide: meshGlyph('mesh-subdivide', faTableCells),
  },
  tool: {
    extension: faPuzzlePiece,
    /**
     * THE TRANSFORM TOOLS OF THE SHELF (`ToolStrip`) — Blender's Edit Mode
     * toolbar group 2, in Blender's own order: Move, Rotate, Scale,
     * Transform.
     *
     * Move and Rotate keep the shared Font Awesome names because the Blender
     * set's drawings for `up-down-left-right` and `rotate` say the same thing
     * at every other site that asks for them. Scale and Transform do not:
     * they asked for `maximize` (Font Awesome's window-expand cross) and
     * `arrows-to-dot` (a crosshair), which are generic meanings other
     * surfaces can reasonably want, and Blender's marks for the two tools —
     * a small square growing into a larger outlined one, and a square inside
     * a broken ring of arrows — are not those meanings. Same rule as
     * `modeling` above: a glyph that IS an operation owns its own name.
     */
    /** Blender's group 1, Select Box — the tool that arms no gizmo. Its Blender mark is a pointer
     *  inside a dashed marquee, which is the tool and not the action set's `select` above, so it
     *  owns `tool-select-box`; a set without it draws the pointer (`arrow-pointer`). */
    select: meshGlyph('tool-select-box', faArrowPointer),
    move: faUpDownLeftRight,
    rotate: faRotate,
    scale: meshGlyph('tool-scale', faMaximize),
    transform: meshGlyph('tool-transform', faArrowsToDot),
    snap: faMagnet,
    frame: faCrosshairs,
    grid: faBorderAll,
    profiler: faChartSimple,
  },
  /**
   * A STATIC PANEL'S OWN GLYPH — what Blender puts in an area's EDITOR-TYPE
   * WELL, and the only place this editor draws one (`workspace-regions.ts`'s
   * `groupTabs`). `workspace-static-panels.ts` declares WHICH glyph per panel
   * by name and takes {@link WorkspacePanelGlyphName} as a type-only import,
   * so the inventory stays a dependency-free table and no panel can name a
   * glyph this one does not resolve.
   *
   * TWO OF THESE ARE MEASURED AND FIVE ARE OURS, and the split is a fact
   * about the reference frames rather than about effort. `outliner` and
   * `properties` are Blender's own marks, read at native 2x off
   * `outliner.png` and `modeling-edit-none.png`'s Properties area and drawn
   * in `@vgai/blender`'s `blender-icons.source.mjs`, which carries the pixel
   * edges. The other five have NO Blender reading at all: the reference set
   * photographs the Layout, Modeling, Sculpting and Texture Paint workspaces
   * — 3D View, Outliner, Properties, Timeline, Image Editor and the asset
   * shelf — with every editor-type dropdown CLOSED, so it contains no File
   * Browser, no Asset Browser, and no picture of the editors our Content,
   * Library, Conversations, Project work and History panels correspond to.
   * They reuse names the Blender set already draws, chosen here, so a well
   * stays in that set's idiom instead of falling through to a Font Awesome
   * silhouette beside two measured marks.
   */
  panel: {
    outliner: meshGlyph('outliner', faFolderTree),
    properties: meshGlyph('properties', faSliders),
    'folder-open': faFolderOpen,
    'cubes-stacked': faCubesStacked,
    users: faUsers,
    list: faList,
    'rotate-left': faRotateLeft,
  },
} as const;

/** The glyph names a static panel may declare (`workspace-static-panels.ts`). */
export type WorkspacePanelGlyphName = keyof (typeof editorIcons)['panel'];
