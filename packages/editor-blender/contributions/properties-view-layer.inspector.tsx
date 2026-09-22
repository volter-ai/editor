/**
 * BLENDER'S VIEW LAYER TAB, as a Properties section (WORK.md §Blender in the
 * tab is Blender, "Inspection parity", I2). Blender's own panels over the RNA
 * door, with the generic view beneath under "All properties".
 *
 * THE SPECIFICATION IS `scripts/startup/bl_ui/properties_view_layer.py` at the
 * engine's pin — `classes` (`:345-360`) is the panel order, `bl_label` the
 * title, each `layout.prop(view_layer, "x")` an entry. Blender's UI layer is
 * never run, ported or recorded.
 *
 * THE PASSES PANEL IS TWO PANELS UNDER TWO ENGINES, and that is why this tab
 * reads `COMPAT_ENGINES`. `VIEWLAYER_PT_eevee_layer_passes_data` (`:111`) and
 * `VIEWLAYER_PT_workbench_layer_passes_data` (`:137`) carry the SAME
 * `bl_label` ("Data") and differ only by engine — Workbench shows three
 * passes where EEVEE shows seven, off the same `ViewLayer` datablock. Nothing
 * about the datablock could say which; `rna_context`'s `engine` does. The
 * Light panel (`:156`) is EEVEE-only for the same reason, and it also reads
 * `view_layer.eevee`, which the context door names beside the layer.
 *
 * WHAT THE TRANSCRIPTION DELIBERATELY DROPS: `VIEWLAYER_PT_context_layer`
 * (`:51`, `bl_label = ""`) — the layer search template, the host's identity
 * row here; `VIEWLAYER_PT_layer_custom_props` (`:340`), IDProperties rather
 * than RNA; and the AOV / light-group add-remove operators, which are
 * editing rather than inspection. The two lists themselves are here as their
 * collections.
 *
 * It stands when: `buttons_context_path_view_layer` — the window's view layer
 * always resolves.
 */
import { blenderPropertiesTabMatch, blenderPropertiesTabSection } from './blender-properties-tab';
import type { BlenderCuratedPanel } from './blender-properties-view';

/** `properties_view_layer.py`, panel by panel. Line numbers are that file's. */
const CURATED: readonly BlenderCuratedPanel[] = [
  {
    // VIEWLAYER_PT_layer, :78 — `layer.use` then `rd.use_single_layer`.
    title: 'View Layer',
    properties: ['use', { from: 'Render', property: 'use_single_layer' }],
  },
  {
    // VIEWLAYER_PT_layer_passes, :100 — an empty body with five children.
    title: 'Passes',
    properties: [],
    sub: [
      // VIEWLAYER_PT_eevee_layer_passes_data, :111.
      {
        title: 'Data',
        engine: ['BLENDER_EEVEE'],
        properties: [
          'use_pass_combined',
          'use_pass_z',
          'use_pass_mist',
          'use_pass_normal',
          'use_pass_position',
          'use_pass_vector',
          'use_pass_grease_pencil',
        ],
      },
      // VIEWLAYER_PT_workbench_layer_passes_data, :137 — the same title under
      // the other engine, with three of the seven.
      {
        title: 'Data',
        engine: ['BLENDER_WORKBENCH'],
        properties: ['use_pass_combined', 'use_pass_z', 'use_pass_grease_pencil'],
      },
      // VIEWLAYER_PT_eevee_layer_passes_light, :156 — `view_layer` and
      // `view_layer_eevee = view_layer.eevee` (:169) in one list.
      {
        title: 'Light',
        engine: ['BLENDER_EEVEE'],
        properties: [
          'use_pass_diffuse_direct',
          'use_pass_diffuse_color',
          'use_pass_glossy_direct',
          'use_pass_glossy_color',
          { from: 'EEVEE', property: 'use_pass_volume_direct' },
          'use_pass_emit',
          'use_pass_environment',
          'use_pass_shadow',
          'use_pass_ambient_occlusion',
          { from: 'EEVEE', property: 'use_pass_transparent' },
          { from: 'EEVEE', property: 'ambient_occlusion_distance' },
        ],
      },
      // VIEWLAYER_PT_layer_passes_cryptomatte, :248, whose body is
      // ViewLayerCryptomattePanelHelper.draw (:224).
      {
        title: 'Cryptomatte',
        closed: true,
        properties: [
          'use_pass_cryptomatte_object',
          'use_pass_cryptomatte_material',
          'use_pass_cryptomatte_asset',
          'pass_cryptomatte_depth',
        ],
      },
      // VIEWLAYER_PT_layer_passes_aov, :219 (ViewLayerAOVPanelHelper, :194) —
      // a `template_list` over `view_layer.aovs`.
      { title: 'Shader AOV', closed: true, properties: ['aovs'] },
      // VIEWLAYER_PT_layer_passes_lightgroups, :289
      // (ViewLayerLightgroupsPanelHelper, :263).
      { title: 'Light Groups', closed: true, properties: ['lightgroups'] },
    ],
  },
  {
    // VIEWLAYER_PT_filter, :294.
    title: 'Filter',
    closed: true,
    properties: [
      'use_sky',
      'use_solid',
      'use_strand',
      'use_volumes',
      'use_grease_pencil',
      'use_motion_blur',
    ],
  },
  {
    // VIEWLAYER_PT_override, :320.
    title: 'Override',
    closed: true,
    properties: ['material_override', 'world_override', 'samples'],
  },
];

const TAB = { id: 'view_layer', standing: 'any', curated: CURATED } as const;

export const point = 'selection.inspector';
export const title = 'View Layer';
/** `blender.icons.json` — Blender's own mark, TRACED from
 *  `release/datafiles/icons_svg/` at the engine's pin (the icon this tab draws
 *  is named in `buttons_context_items`, `makesrna/intern/rna_space.cc:579`),
 *  and tinted by the group `UI_icons.hh` declares it in. */
export const icon = 'properties-view-layer';
/** `ED_buttons_tabs_list` (`space_buttons.cc:218-252`) is the rail's order;
 *  these are that order, spaced so a tab can be inserted between two. */
export const order = 30;
/** THE RAIL'S GROUPS, from `ED_buttons_tabs_list`'s own `add_spacer()` calls
 *  (`space_buttons/space_buttons.cc:201-255`): the tool tab, then the scene
 *  group (Render, Output, View Layer, Scene, World), then Collection, then the
 *  object group (Object … Material), then Texture. The presentation draws a
 *  separator wherever this changes. */
export const railGroup = 'scene';
export const match = blenderPropertiesTabMatch(TAB);
export default blenderPropertiesTabSection(TAB);
