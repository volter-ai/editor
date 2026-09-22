/**
 * THE SETTINGS DOCUMENT — the Zod truth for the two shared settings layers
 * (ARCHITECTURE-CORE §Editor chrome, "Settings have four layers with named
 * homes"):
 *
 *   ~/.vgai/settings.json     the USER layer — one person, every project
 *   <project>/.vgai/settings.json   the PROJECT layer — one project, committed,
 *                             every person who opens it
 *
 * Both files carry the same shape; the project layer overrides the user layer
 * key by key (`mergeEditorSettings`). Neither layer holds authored content —
 * an unreadable file is reported by name and falls back to defaults, never
 * migrated. The generated JSON Schema (`npm run generate-schema` →
 * `packages/project/schemas/vgai-settings.schema.json`) is what an editor
 * autocompletes against when a person edits either file by hand.
 *
 * Every field here has a runtime reader in the editor's settings store
 * consumers (`theme-preference.ts`, `workspace-regions.ts`,
 * `keymap-presets.ts`, `workspace-presets.ts`, `device-preview.ts`); a field
 * with no reader does not get declared (CLAUDE.md, "Do not author schema
 * fields that have no runtime reader").
 */
import { z } from 'zod';

const RegionVisibility = z.enum(['shown', 'hidden']);

export const ChromeRegionsSettingsSchema = z
  .object({
    workspaceTabs: RegionVisibility.optional().describe(
      "The workspace tab strip in the top bar (Blender's); hidden unless a style shows it.",
    ),
    header: RegionVisibility.optional().describe('The top header bar.'),
    shelf: RegionVisibility.optional().describe('The utility shelf.'),
    inspector: z
      .enum(['column', 'properties', 'card'])
      .optional()
      .describe('Inspector presentation: the narrow docked column or a properties panel.'),
    drawer: RegionVisibility.optional().describe('The bottom drawer.'),
    telemetry: RegionVisibility.optional().describe(
      "The top bar's runtime telemetry cluster: the frame-rate readout, its sparkline and the audio meter. The Profiler utility is the same information's other door.",
    ),
    hierarchyTypeSuffix: RegionVisibility.optional().describe(
      "The `·TypeName` a component-instance row prints after its name in the hierarchy. Hidden leaves the row its name alone, the way Blender's Outliner does; the type stays reachable through the row's own tooltip and the inspector.",
    ),
    hierarchyInstanceRule: RegionVisibility.optional().describe(
      "The dotted rule a component-instance row draws under its name in the hierarchy. Hidden leaves the name unmarked, the way Blender's Outliner does; the fact stays reachable through the row's own tooltip, its source actions and the inspector.",
    ),
    hierarchyRestrictions: z
      .enum(['select+viewport', 'viewport+render'])
      .optional()
      .describe(
        "Which restriction columns a hierarchy row carries at its right edge: this editor's selection lock beside the eye, or Blender's default filter — the eye in its own column with the render column reserved and blank, three.js having one visibility flag for viewport and render alike.",
      ),
  })
  .strict()
  .describe('Which chrome regions a style bundle shows or hides.');

export const EditorSettingsSchema = z
  .object({
    $schema: z
      .string()
      .optional()
      .describe('JSON Schema pointer for editor autocomplete; ignored by the editor.'),
    appearance: z
      .object({
        palette: z
          .string()
          .optional()
          .describe('Editor palette id — a built-in or a custom theme document.'),
        material: z
          .string()
          .optional()
          .describe('Editor material id (`classic`, `glass`, or one a style bundle carries).'),
        icons: z
          .string()
          .optional()
          .describe('Editor icon set id (`default`, or one a style bundle carries).'),
        regions: ChromeRegionsSettingsSchema.optional(),
      })
      .strict()
      .optional()
      .describe('How the editor chrome looks.'),
    keymap: z.string().optional().describe('Active keymap preset id (`vgai`, `blender`, …).'),
    play: z
      .object({
        keepPanelsVisible: z
          .boolean()
          .optional()
          .describe(
            'Keep editor panels visible when starting Play, instead of letting an immersive workspace hide them. Turning this on during Play restores the panels; turning it off applies on the next Play.',
          ),
      })
      .strict()
      .optional()
      .describe('How the editor presents Play mode.'),
    devicePreview: z
      .object({
        preset: z.string().optional().describe('Device preview frame preset id.'),
        touch: z
          .boolean()
          .nullable()
          .optional()
          .describe('Touch emulation override; null follows the preset.'),
      })
      .strict()
      .optional()
      .describe('The device frame the Game document previews in.'),
  })
  .strict()
  .describe('Editor settings — the user layer and the project layer share this shape.');

export type EditorSettings = z.infer<typeof EditorSettingsSchema>;
export type ChromeRegionsSettings = z.infer<typeof ChromeRegionsSettingsSchema>;

/** Which layer a file is; the file paths are the server's. */
export type SettingsLayer = 'user' | 'project';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep-merge plain objects; anything else (primitives, arrays, null)
 *  replaces. `merge(user, project)` is the effective document. */
export function mergeEditorSettings(base: EditorSettings, over: EditorSettings): EditorSettings {
  const out: Record<string, unknown> = { ...base };
  const patch = over as Record<string, unknown>;
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    const current = out[key];
    out[key] =
      isPlainObject(current) && isPlainObject(value)
        ? mergeEditorSettings(current as EditorSettings, value as EditorSettings)
        : value;
  }
  return out as EditorSettings;
}

/** Validate a raw document. The result carries the parsed settings or the
 *  issues, spelled for a person who has the file open. */
export function parseEditorSettings(
  raw: unknown,
): { settings: EditorSettings; issues: [] } | { settings: null; issues: string[] } {
  const result = EditorSettingsSchema.safeParse(raw);
  if (result.success) return { settings: result.data, issues: [] };
  return {
    settings: null,
    issues: result.error.issues.map((issue) =>
      issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
    ),
  };
}
