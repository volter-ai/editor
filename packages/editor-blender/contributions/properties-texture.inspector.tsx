/**
 * BLENDER'S TEXTURE TAB, as a Properties section (WORK.md §Blender in the tab
 * is Blender, "Inspection parity", I2). Blender's own panels over the RNA
 * door, with the generic view beneath under "All properties".
 *
 * THE SPECIFICATION IS `scripts/startup/bl_ui/properties_texture.py` at the
 * engine's pin — `classes` (`:958-986`) is the panel order and `bl_label` the
 * title — AND `space_buttons/buttons_texture.cc`, which is the only thing
 * that can say WHICH texture this tab is about. Blender's UI layer is never
 * run, ported or recorded.
 *
 * THIS TAB HAS NO DATABLOCK OF ITS OWN; IT HAS A USER.
 * `buttons_texture_users_from_context` (`buttons_texture.cc:244-366`) walks
 * the context for every struct holding a texture pointer, in this order: the
 * scene's compositing node tree ("Compositor"), the active line style's slots
 * and node tree ("Line Style"), the object's modifiers ("Modifiers"), the
 * ACTIVE particle system's `part.mtex[]` ("Particles"), the object's force
 * field when its type is TEXTURE ("Fields"), and the active paint brush's own
 * two slots ("Brush"). `buttons_texture_context_compute` (`:369`) then takes
 * user `ct->index` — 0 unless a person picks another from the menu — and the
 * texture it points at is `context.texture`. The door mirrors that walk in
 * the C's own order and names the resolved texture as this tab's first path,
 * the holder as its second, and `bpy.data.textures` as its third; the whole
 * user list is on the context as `textureUsers` for anything that wants it.
 *
 * A LIGHT IS NOT A TEXTURE USER AT THIS PIN, and it is worth saying because
 * older Blenders make it a reasonable guess: the C never looks at `ob->data`.
 * Lamp textures went with 2.8's renderer rewrite. Measured, not remembered.
 *
 * THE TYPE PANELS ARE THE `when` MECHANISM'S OTHER HOME. `TextureTypePanel`
 * (`:167`) is `tex.type == cls.tex_type and not tex.use_nodes`, once per type
 * — every one of those properties lives on the same `Texture` struct under
 * every type, so RNA cannot answer it and the condition is read from the
 * engine's live value.
 *
 * WHAT THE TRANSCRIPTION DELIBERATELY DROPS:
 *  - `TEXTURE_PT_preview` (`:68`) and `TEXTURE_PT_context` (`:99`) — a
 *    `template_preview` render and the user-picker/ID templates. The picker
 *    is an editing widget; what it selects is the context door's answer here.
 *  - `TEXTURE_PT_node` (`:143`), `template_node_view` over the active texture
 *    node — the read-only node view is I5.
 *  - `template_image` (`:404`) and `template_color_ramp` (`:910`) — an image
 *    browser and a ramp widget; the `image` pointer and the `color_ramp`
 *    pointer stand and drill.
 *  - `TEXTURE_PT_custom_props` (`:953`), IDProperties rather than RNA.
 *
 * It stands when: the door's mirror of `buttons_texture_context_compute`
 * finds a user, or the file holds textures at all.
 */
import { blenderPropertiesTabMatch, blenderPropertiesTabSection } from './blender-properties-tab';
import type { BlenderCuratedPanel } from './blender-properties-view';

/** `TextureTypePanel.poll` (`:167-173`) for one `tex_type`, as conditions. */
const ofType = (type: string) =>
  [
    { from: 'Texture', property: 'type', is: [type] },
    { from: 'Texture', property: 'use_nodes', is: [false] },
  ] as const;

/** `properties_texture.py`, panel by panel. Line numbers are that file's. */
const CURATED: readonly BlenderCuratedPanel[] = [
  {
    // TEXTURE_PT_context, :99 — its one property row (`tex.type`, :140);
    // everything else in it is a template.
    title: 'Texture',
    from: 'Texture',
    properties: ['type', 'use_nodes', 'node_tree'],
  },
  {
    // TEXTURE_PT_clouds, :176.
    title: 'Clouds',
    from: 'Texture',
    when: ofType('CLOUDS'),
    properties: ['noise_basis', 'noise_type', 'cloud_type', 'noise_scale', 'noise_depth', 'nabla'],
  },
  {
    // TEXTURE_PT_wood, :212.
    title: 'Wood',
    from: 'Texture',
    when: ofType('WOOD'),
    properties: [
      'noise_basis',
      'wood_type',
      'noise_basis_2',
      'noise_type',
      'noise_scale',
      'turbulence',
      'nabla',
    ],
  },
  {
    // TEXTURE_PT_marble, :253.
    title: 'Marble',
    from: 'Texture',
    when: ofType('MARBLE'),
    properties: [
      'noise_basis',
      'marble_type',
      'noise_basis_2',
      'noise_type',
      'noise_scale',
      'noise_depth',
      'turbulence',
      'nabla',
    ],
  },
  {
    // TEXTURE_PT_magic, :291.
    title: 'Magic',
    from: 'Texture',
    when: ofType('MAGIC'),
    properties: ['noise_depth', 'turbulence'],
  },
  {
    // TEXTURE_PT_blend, :314.
    title: 'Blend',
    from: 'Texture',
    when: ofType('BLEND'),
    properties: ['progression', 'use_flip_axis'],
  },
  {
    // TEXTURE_PT_stucci, :340.
    title: 'Stucci',
    from: 'Texture',
    when: ofType('STUCCI'),
    properties: ['noise_basis', 'stucci_type', 'noise_type', 'noise_scale', 'turbulence'],
  },
  {
    // TEXTURE_PT_image, :375 — its body is `template_image`; the pointer row
    // stands and its children carry the properties.
    title: 'Image',
    from: 'Texture',
    when: ofType('IMAGE'),
    properties: ['image', 'image_user'],
    sub: [
      {
        // TEXTURE_PT_image_alpha, :430 — `use_alpha` is the header checkbox.
        title: 'Alpha',
        closed: true,
        from: 'Texture',
        properties: ['use_alpha', 'use_calculate_alpha', 'invert_alpha'],
      },
      {
        // TEXTURE_PT_image_sampling, :407.
        title: 'Sampling',
        closed: true,
        from: 'Texture',
        properties: ['use_interpolation', 'filter_size'],
      },
      {
        // TEXTURE_PT_image_mapping, :457, with its Crop child (:513).
        title: 'Mapping',
        closed: true,
        from: 'Texture',
        properties: [
          'use_flip_axis',
          'extension',
          'repeat_x',
          'repeat_y',
          'use_mirror_x',
          'use_mirror_y',
          'checker_distance',
          'use_checker_even',
          'use_checker_odd',
        ],
        sub: [
          {
            title: 'Crop',
            closed: true,
            from: 'Texture',
            properties: ['crop_min_x', 'crop_min_y', 'crop_max_x', 'crop_max_y'],
          },
        ],
      },
    ],
  },
  {
    // TEXTURE_PT_musgrave, :541.
    title: 'Musgrave',
    from: 'Texture',
    when: ofType('MUSGRAVE'),
    properties: [
      'noise_basis',
      'musgrave_type',
      'noise_scale',
      'nabla',
      'dimension_max',
      'lacunarity',
      'octaves',
      'offset',
      'noise_intensity',
      'gain',
    ],
  },
  {
    // TEXTURE_PT_voronoi, :590, with its Feature Weights child (:626).
    title: 'Voronoi',
    from: 'Texture',
    when: ofType('VORONOI'),
    properties: [
      'distance_metric',
      'minkovsky_exponent',
      'color_mode',
      'noise_intensity',
      'noise_scale',
      'nabla',
    ],
    sub: [
      {
        title: 'Feature Weights',
        from: 'Texture',
        properties: ['weight_1', 'weight_2', 'weight_3', 'weight_4'],
      },
    ],
  },
  {
    // TEXTURE_PT_distortednoise, :652.
    title: 'Distorted Noise',
    from: 'Texture',
    when: ofType('DISTORTED_NOISE'),
    properties: ['noise_basis', 'noise_distortion', 'distortion', 'noise_scale', 'nabla'],
  },
  {
    // TEXTURE_PT_mapping, :698 — a TextureSlotPanel: its rows are the SLOT's
    // (`context.texture_slot`), which is the user the door resolved. A slot
    // that is a node or a brush carries a different subset, and the rows it
    // does not carry are simply not on its RNA.
    title: 'Mapping',
    from: 'User',
    properties: [
      'texture_coords',
      'object',
      'uv_layer',
      'mapping',
      'mapping_x',
      'mapping_y',
      'mapping_z',
      'offset',
      'scale',
    ],
  },
  {
    // TEXTURE_PT_influence, :769 — also the slot's.
    title: 'Influence',
    closed: true,
    from: 'User',
    properties: ['blend_type', 'color'],
  },
  {
    // TEXTURE_PT_colors, :855, with its Color Ramp child (:887).
    title: 'Colors',
    closed: true,
    from: 'Texture',
    properties: [
      'use_clamp',
      'factor_red',
      'factor_green',
      'factor_blue',
      'intensity',
      'contrast',
      'saturation',
    ],
    sub: [
      {
        title: 'Color Ramp',
        closed: true,
        from: 'Texture',
        properties: ['use_color_ramp', 'color_ramp'],
      },
    ],
  },
  {
    // TEXTURE_PT_animation, :915.
    title: 'Animation',
    closed: true,
    from: 'Texture',
    properties: ['animation_data'],
  },
];

const TAB = { id: 'texture', curated: CURATED } as const;

export const point = 'selection.inspector';
export const title = 'Texture';
/** `blender.icons.json` — Blender's own mark, TRACED from
 *  `release/datafiles/icons_svg/` at the engine's pin (the icon this tab draws
 *  is named in `buttons_context_items`, `makesrna/intern/rna_space.cc:579`),
 *  and tinted by the group `UI_icons.hh` declares it in. */
export const icon = 'properties-texture';
/** `ED_buttons_tabs_list` (`space_buttons.cc:218-252`) is the rail's order;
 *  these are that order, spaced so a tab can be inserted between two. */
export const order = 160;
/** THE RAIL'S GROUPS, from `ED_buttons_tabs_list`'s own `add_spacer()` calls
 *  (`space_buttons/space_buttons.cc:201-255`): the tool tab, then the scene
 *  group (Render, Output, View Layer, Scene, World), then Collection, then the
 *  object group (Object … Material), then Texture. The presentation draws a
 *  separator wherever this changes. */
export const railGroup = 'texture';
export const match = blenderPropertiesTabMatch(TAB);
export default blenderPropertiesTabSection(TAB);
