/**
 * BLENDER'S OUTPUT TAB, as a Properties section (WORK.md §Blender in the tab
 * is Blender, "Inspection parity", I2). Blender's own panels over the RNA
 * door, with the generic view beneath under "All properties".
 *
 * THE SPECIFICATION IS `scripts/startup/bl_ui/properties_output.py` at the
 * engine's pin — `classes` (`:728-748`) is the panel order, `bl_label` the
 * title, each `layout.prop(rd, "x")` an entry in the order the draw function
 * lists it. Blender's UI layer is never run, ported or recorded.
 *
 * THE TAB'S DATABLOCK IS `scene.render`, and three panels reach past it: Frame
 * Range is the SCENE's own `frame_start`/`frame_end`/`frame_step` (`:151`),
 * Output's Color Management is `rd.image_settings` (`:371`), and Encoding is
 * `rd.ffmpeg` (`:499`). The context door names each beside the render
 * settings as one of this tab's paths and the rows say which they come from
 * ({@link BlenderCuratedProperty}).
 *
 * WHAT THE TRANSCRIPTION DELIBERATELY DROPS:
 *  - the preset menus (`RENDER_PT_format_presets` `:15`,
 *    `RENDER_MT_framerate_presets` `:28`, `RENDER_PT_ffmpeg_presets` `:22`)
 *    and `template_image_settings`/`template_image_views` — operator and
 *    template widgets. Inspection parity, not editing parity.
 *  - `RENDER_PT_output_pixel_density` (`:396`), whose body is a preset menu
 *    plus two properties behind it; the two are named here.
 *
 * It stands when: `buttons_context_path_scene` — the same path as Render.
 */
import { blenderPropertiesTabMatch, blenderPropertiesTabSection } from './blender-properties-tab';
import type { BlenderCuratedPanel } from './blender-properties-view';

/** `properties_output.py`, panel by panel. Line numbers are that file's. */
const CURATED: readonly BlenderCuratedPanel[] = [
  {
    // RENDER_PT_format, :53 — the draw order is resolution, aspect, border,
    // then the frame rate block (`draw_framerate`, :95).
    title: 'Format',
    properties: [
      'resolution_x',
      'resolution_y',
      'resolution_percentage',
      'pixel_aspect_x',
      'pixel_aspect_y',
      'use_border',
      'use_crop_to_border',
      'fps',
      'fps_base',
    ],
  },
  {
    // RENDER_PT_frame_range, :135 — the SCENE's, not the render settings'.
    title: 'Frame Range',
    properties: [
      { from: 'Scene', property: 'frame_start' },
      { from: 'Scene', property: 'frame_end' },
      { from: 'Scene', property: 'frame_step' },
    ],
    sub: [
      // RENDER_PT_time_stretching, :156.
      { title: 'Time Stretching', closed: true, properties: ['frame_map_old', 'frame_map_new'] },
    ],
  },
  {
    // RENDER_PT_stereoscopy, :676 — `use_multiview` is the header checkbox
    // (:687); the views themselves are a `template_list` over `rd.views`.
    title: 'Stereoscopy',
    closed: true,
    properties: ['use_multiview', 'views_format', 'views'],
  },
  {
    // RENDER_PT_output, :291.
    title: 'Output',
    properties: [
      'save_output',
      'filepath',
      'use_file_extension',
      'use_render_cache',
      'use_overwrite',
      'use_placeholder',
    ],
    sub: [
      // RENDER_PT_output_color_management, :351 — `image_settings.color_management`
      // then the display device beneath it.
      {
        title: 'Color Management',
        closed: true,
        from: 'Image',
        properties: ['color_management'],
      },
      // RENDER_PT_output_pixel_density, :396.
      { title: 'Pixel Density', closed: true, properties: ['ppm_factor', 'ppm_base'] },
    ],
  },
  {
    // RENDER_PT_encoding, :473 — `rd.ffmpeg`, and its poll is the image
    // format being one of FFMPEG/XVID/H264/THEORA (:496).
    title: 'Encoding',
    closed: true,
    from: 'FFmpeg',
    when: [
      {
        from: 'Image',
        property: 'file_format',
        is: ['FFMPEG', 'XVID', 'H264', 'THEORA'],
      },
    ],
    properties: ['format', 'use_autosplit'],
    sub: [
      // RENDER_PT_encoding_video, :503.
      {
        title: 'Video',
        from: 'FFmpeg',
        properties: [
          'codec',
          { from: 'Image', property: 'color_depth' },
          'use_lossless_output',
          'ffmpeg_prores_profile',
          'constant_rate_factor',
          'custom_constant_rate_factor',
          'ffmpeg_preset',
          'gopsize',
          'use_max_b_frames',
          'max_b_frames',
          'video_bitrate',
          'minrate',
          'maxrate',
          'buffersize',
          'muxrate',
          'packetsize',
        ],
      },
      // RENDER_PT_encoding_audio, :633.
      {
        title: 'Audio',
        from: 'FFmpeg',
        properties: [
          'audio_codec',
          'audio_channels',
          'audio_mixrate',
          'audio_volume',
          'audio_bitrate',
        ],
      },
    ],
  },
  {
    // RENDER_PT_stamp, :200 — `metadata_input` is drawn first (:217), then
    // the flag grid.
    title: 'Metadata',
    closed: true,
    properties: [
      'metadata_input',
      'use_stamp_date',
      'use_stamp_time',
      'use_stamp_render_time',
      'use_stamp_frame',
      'use_stamp_frame_range',
      'use_stamp_memory',
      'use_stamp_hostname',
      'use_stamp_camera',
      'use_stamp_lens',
      'use_stamp_scene',
      'use_stamp_marker',
      'use_stamp_filename',
      'use_stamp_sequencer_strip',
    ],
    sub: [
      // RENDER_PT_stamp_note, :237 — `use_stamp_note` is its header checkbox.
      { title: 'Note', closed: true, properties: ['use_stamp_note', 'stamp_note_text'] },
      // RENDER_PT_stamp_burn, :261 — `use_stamp` is its header checkbox.
      {
        title: 'Burn Into Image',
        closed: true,
        properties: [
          'use_stamp',
          'stamp_font_size',
          'stamp_foreground',
          'stamp_background',
          'use_stamp_labels',
        ],
      },
    ],
  },
  {
    // RENDER_PT_post_processing, :178.
    title: 'Post Processing',
    closed: true,
    properties: ['use_compositing', 'use_sequencer', 'dither_intensity'],
  },
];

const TAB = { id: 'output', standing: 'any', curated: CURATED } as const;

export const point = 'selection.inspector';
export const title = 'Output';
/** `blender.icons.json` — Blender's own mark, TRACED from
 *  `release/datafiles/icons_svg/` at the engine's pin (the icon this tab draws
 *  is named in `buttons_context_items`, `makesrna/intern/rna_space.cc:579`),
 *  and tinted by the group `UI_icons.hh` declares it in. */
export const icon = 'properties-output';
/** `ED_buttons_tabs_list` (`space_buttons.cc:218-252`) is the rail's order;
 *  these are that order, spaced so a tab can be inserted between two. */
export const order = 20;
/** THE RAIL'S GROUPS, from `ED_buttons_tabs_list`'s own `add_spacer()` calls
 *  (`space_buttons/space_buttons.cc:201-255`): the tool tab, then the scene
 *  group (Render, Output, View Layer, Scene, World), then Collection, then the
 *  object group (Object … Material), then Texture. The presentation draws a
 *  separator wherever this changes. */
export const railGroup = 'scene';
export const match = blenderPropertiesTabMatch(TAB);
export default blenderPropertiesTabSection(TAB);
