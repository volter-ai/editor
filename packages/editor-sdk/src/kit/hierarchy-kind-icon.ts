/**
 * Hierarchy row glyphs. Canvas kinds used to fall through to a circle because
 * KIND_ICON only named three-lane kinds — every Sprite/Text/Container looked
 * the same.
 *
 * THE THREE OBJECT KINDS OWN THEIR NAMES, for the same reason
 * `editorIcons.modeling` does (`components/primitives/editor-icons.ts` — read
 * its docblock) and here the reason is COLOUR rather than shape. An icon set
 * keys a glyph by `icon.iconName` and may give it a category TONE, so a tone
 * on `cube` would tint EVERY site that asks for a cube — and measured in the
 * live editor, the Blender set's `object` orange landed on the viewport
 * header's Perspective/Orthographic dropdown (`Object3DDocumentToolbar.tsx`
 * draws it with `faCube`) and on the transform-space toggle, neither of which
 * is an object. `faLightbulb` and `faCamera` reuse the same way (the viewport
 * lighting overlay, the camera view menu).
 *
 * Blender's evidence for the colour is the OUTLINER specifically — a row's
 * type glyph — so the tone belongs to a name only the outliner asks for.
 * The `icon` tuple stays Font Awesome's, so a set that does not carry these
 * names paints exactly what it painted before.
 */
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faBookOpen,
  faCamera,
  faCircle,
  faCircleDot,
  faCirclePlay,
  faCode,
  faCube,
  faDrawPolygon,
  faFont,
  faImage,
  faLayerGroup,
  faLightbulb,
  faLink,
  faList,
  faObjectGroup,
  faPuzzlePiece,
  faSquare,
  faSquareCheck,
  faVideoSlash,
  faVolumeHigh,
} from '@fortawesome/free-solid-svg-icons';

/** A definition under a name of OURS carrying Font Awesome's drawing until an
 *  icon set supplies its own — the same three lines as `editor-icons.ts`'s
 *  `meshGlyph`, kept local so this module's import closure stays FA-only. */
function outlinerGlyph(iconName: string, source: IconDefinition): IconDefinition {
  return { ...source, iconName: iconName as IconDefinition['iconName'] };
}

const OUTLINER_OBJECT = outlinerGlyph('outliner-object', faCube);
const OUTLINER_LIGHT = outlinerGlyph('outliner-light', faLightbulb);
const OUTLINER_CAMERA = outlinerGlyph('outliner-camera', faCamera);
// The speaker is the header's mute button too (`HeaderTelemetry.tsx`), which is
// exactly the reuse this module's docblock names: an outliner tone on the bare
// `volume-high` would tint that control as well.
const OUTLINER_AUDIO = outlinerGlyph('outliner-audio', faVolumeHigh);
/**
 * A DATABLOCK row, not an object row — the geometry a mesh carries
 * (ARCHITECTURE-CORE §A model is
 * data). Blender's Outliner draws it in the DATA green where the object above
 * it is orange, which is the whole reason it gets a name of its own rather
 * than reusing the rail's `properties-data`: the two are the same drawing but
 * the two sites' STATES differ: the outliner composites its glyphs at α 0.80
 * over the row, and so does the Properties rail's CLOSED tab, while its open
 * tab paints the ink full. One ink, three states — the palette carries the
 * ink and each site declares its own alpha (`theme.ts`'s category docblock
 * carries the solve and the frames it was measured in).
 */
const OUTLINER_DATA = outlinerGlyph('outliner-data', faDrawPolygon);
/**
 * A MESH object's own mark. Blender's Outliner does not draw a cube for one:
 * measured on `outliner.png`, the Cube row carries an apex-down triangle — the
 * object-type sibling of the datablock's mark, in the object orange — while
 * `outliner-object`'s cube stays for a generic three-object row that names no
 * mesh. A set without the name draws Font Awesome's cube, exactly as before.
 */
const OUTLINER_MESH = outlinerGlyph('outliner-mesh', faCube);

const KIND_ICON: Record<string, IconDefinition> = {
  three: OUTLINER_OBJECT,
  react: faCode,
  canvas: faLayerGroup,
  scene: faBookOpen,
  mesh: OUTLINER_MESH,
  'skinned-mesh': OUTLINER_MESH,
  'mesh-data': OUTLINER_DATA,
  // A MODEL DOCUMENT'S ROOT is the datablock, not an object carrying one
  // (ARCHITECTURE-CORE §A model is data) — which is why `@volter/editor-blender` hangs a
  // `mesh-data` row off it in the first place. These are the two kind names
  // `source-object3d-authoring-adapter.ts` mints for that root, and they read
  // the DATA glyph for the same reason `mesh-data` does. This is the "one
  // line here and nothing else moves" the note below describes; the consumer
  // that needed it is the Properties breadcrumb, whose glyph Blender takes
  // from the datablock and never from the open tab.
  'three-source': OUTLINER_DATA,
  'model-asset': OUTLINER_DATA,
  light: OUTLINER_LIGHT,
  camera: OUTLINER_CAMERA,
  audio: OUTLINER_AUDIO,
  'reflection-probe': faCircleDot,
  group: faObjectGroup,
  object: faCircle,
  component: faPuzzlePiece,
  img: faImage,
  a: faLink,
  ul: faList,
  ol: faList,
  li: faList,
  button: faSquare,
  sprite: faImage,
  animatedsprite: faCirclePlay,
  nineslicesprite: faImage,
  tilingsprite: faImage,
  text: faFont,
  graphics: faSquare,
  container: faObjectGroup,
};

/**
 * THE TWO RESTRICTION-COLUMN GLYPHS THAT ARE NOT THE EYE — Blender's Disable
 * in Renders column (`outliner_draw.cc:1363-1384`). Names of OURS for the same
 * reason the outliner marks above have them: the bare `camera` name is the
 * viewport header's camera menu, and a skin that drew Blender's
 * `restrict_render_*` mark under it would repaint that menu too.
 */
export const OUTLINER_RENDER_ON = outlinerGlyph('outliner-render-on', faCamera);
export const OUTLINER_RENDER_OFF = outlinerGlyph('outliner-render-off', faVideoSlash);

/**
 * THE EXCLUDE COLUMN's pair — Blender's leftmost restriction column, drawn for
 * `LayerCollection` rows (`outliner_draw.cc:1634-1653`). It asks for
 * `ICON_NONE` on an icon toggle, which is how a boolean draws the WIDGET's own
 * checkbox, so the marks are `checkbox_hlt` / `checkbox_dehlt` — named here the
 * way the render pair is, because a bare `checkbox` name would repaint every
 * checkbox in the editor.
 */
export const OUTLINER_EXCLUDE_ON = outlinerGlyph('outliner-exclude-on', faSquareCheck);
export const OUTLINER_EXCLUDE_OFF = outlinerGlyph('outliner-exclude-off', faSquare);

/**
 * A `blender-` KIND NAMES ITS OWN GLYPH, and that is the whole rule.
 *
 * `@volter/editor-blender`'s Outliner rows carry Blender's own `ICON_*` per row
 * (`tree_element_get_icon`, `outliner_draw.cc:2619-2945`) — 70-odd marks across
 * the object types, the data types, the modifier and constraint families. A
 * table here with one line per mark would be a transcription of Blender's
 * switch maintained in a second place; the adapter already knows the name, so
 * the kind IS the name (`blender-outliner-ob-mesh`, `blender-mod-subsurf`) and
 * the icon SET decides whether it draws it. A set that does not carry the name
 * falls through to Font Awesome's circle, exactly as any unknown kind does.
 */
const BLENDER_KIND = /^blender-[a-z0-9-]+$/;

export function hierarchyKindIcon(
  kind: string,
  fallback: IconDefinition = faCircle,
): IconDefinition {
  const known = KIND_ICON[kind];
  if (known) return known;
  if (BLENDER_KIND.test(kind)) return outlinerGlyph(kind, fallback);
  return fallback;
}

/**
 * THE DATABLOCK KINDS — the rows Blender's Outliner hangs OFF an object rather
 * than under it, and the one place this editor decides which those are.
 *
 * Measured on `outliner.png`: at rest every object row is COLLAPSED and carries
 * its datablock as an inline glyph after the label, one cell to the right
 * (Camera's at src x 288-327, Cube's at 263-302, Light's at 266-291 — the label
 * ink ends at 246/222/218, so the gap is 40-41 device px, one 20-point cell
 * every time). Expanding is what produces the child row.
 *
 * WHY A KIND LIST AND NOT A ROLE. The datablock row is `role: 'element'`
 * and so is every ordinary JSX
 * child in the DOM and React lanes — a rule keyed on the role would collapse
 * those trees by default, which is a regression, not a transcription. The KIND
 * is the adapter's own vocabulary and this module is already where the host
 * reads it: `KIND_ICON` above gives `mesh-data` the DATA glyph because it is a
 * datablock. A future `light-data`/`camera-data` adds one line here and
 * nothing else moves.
 *
 * `EditorNode` gains no field for this. The kind is open by construction (the
 * previous unit's ruling), so a new noun on the kernel object would buy
 * nothing that the name the adapter already sends does not.
 */
const DATABLOCK_KINDS: ReadonlySet<string> = new Set([
  'mesh-data',
  // Blender's own DATA marks, which is exactly what
  // `tree_element_get_icon_from_id` (`outliner_draw.cc:2479-2610`) answers for
  // a non-object ID: the mark a Model document's rows carry for an object's
  // data, its materials and its shape keys. The object marks
  // (`blender-outliner-ob-*`) are deliberately NOT here — those are the row
  // itself, not something hung off it.
  'blender-material-data',
  'blender-shapekey-data',
  'blender-texture-data',
  'blender-image-data',
]);

/** The prefixes of the same set that are keyed by a VALUE rather than a struct
 *  — a light's lamp type and a probe's (`outliner_draw.cc:2508-2521`,
 *  `:2578-2589`) — plus the `OUTLINER_DATA_*` family. */
const DATABLOCK_KIND_PREFIXES: readonly string[] = [
  'blender-outliner-data-',
  'blender-light-',
  'blender-lightprobe-',
];

export function isDatablockKind(kind: string | undefined): boolean {
  if (kind === undefined) return false;
  if (DATABLOCK_KINDS.has(kind)) return true;
  return DATABLOCK_KIND_PREFIXES.some((prefix) => kind.startsWith(prefix));
}
