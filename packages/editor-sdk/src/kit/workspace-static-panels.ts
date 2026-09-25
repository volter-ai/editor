import type { EditorRegionName, WorkspacePanelGlyphName } from '@volter/editor-sdk/widgets';

/** Stable, geometry-free inventory of the editor's built-in persistent panels.
 *
 *  `region` is a panel's claim on an EDITOR-AREA fill (`EditorTheme.color.region`
 *  carries the measurement): the dock paints the group showing this panel with
 *  that region's colour instead of the one fill every group shares. A panel
 *  that claims none is painted exactly as before the claim existed, which is
 *  every panel no reference frame shows painted differently.
 *
 *  `icon` is the panel's own glyph, drawn in Blender's EDITOR-TYPE WELL — the
 *  32x20 box every area begins with under `groupTabs: 'well'`
 *  (`workspace-regions.ts`). The NAME is declared here and the drawing lives
 *  in the editor's icon registry (`components/primitives/editor-icons.ts`), which also records which two of these are
 *  Blender's own measured marks and which five are ours because no reference
 *  frame photographs that editor. The field is optional so a host may add a
 *  panel without one; every panel below declares one, so the well's
 *  glyph-less branch does not fire in this editor. */
export const WORKSPACE_STATIC_PANELS = [
  {
    kind: 'agent',
    title: 'Conversations',
    hotkeyScope: 'workspace',
    selectableText: true,
    icon: 'users',
  },
  {
    kind: 'project-work',
    title: 'Project work',
    hotkeyScope: 'workspace',
    selectableText: true,
    icon: 'list',
  },
  {
    kind: 'hierarchy',
    title: 'Hierarchy',
    hotkeyScope: 'hierarchy',
    selectableText: false,
    region: 'outliner',
    icon: 'outliner',
  },
  {
    kind: 'assets',
    title: 'Content',
    hotkeyScope: 'asset-browser',
    selectableText: false,
    icon: 'folder-open',
  },
  {
    kind: 'asset-library',
    title: 'Asset Library',
    hotkeyScope: 'asset-browser',
    selectableText: false,
    icon: 'cubes-stacked',
  },
  {
    kind: 'inspector',
    title: 'Inspector',
    hotkeyScope: 'inspector',
    selectableText: false,
    region: 'properties',
    icon: 'properties',
  },
] as const satisfies ReadonlyArray<{
  readonly kind: string;
  readonly title: string;
  readonly hotkeyScope: string;
  readonly selectableText: boolean;
  readonly region?: EditorRegionName;
  readonly icon?: WorkspacePanelGlyphName;
}>;

export type WorkspaceStaticPanelKind = (typeof WORKSPACE_STATIC_PANELS)[number]['kind'];
