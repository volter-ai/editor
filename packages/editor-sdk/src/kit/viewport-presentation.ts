/**
 * VIEWPORT PRESENTATION — what a 3D viewport DOES, as data: its draw mode, where the light on
 * the model comes from, what is drawn behind the scene, which overlays show, how its tools
 * behave and how its world is oriented. The ruling is
 * `docs/VIEWPORT-STAGE.md` §The ruling (owner, 2026-09-25): the LOOK holds colours only (the
 * palette's `color.viewport`), and light and environment are per-view settings a person toggles,
 * as they are in every target — Blender's shading popover, Godot's Preview Sun and Environment,
 * Unity's Scene-view lighting and skybox toggles.
 *
 * THIS MODULE IS MEDIUM-NEUTRAL (ARCHITECTURE.md rule 5). It names no Three type: a studio
 * light is a colour, an intensity and a direction, and the viewport that draws in a medium
 * applies it. It holds four things:
 *  - the TYPES of the four settings;
 *  - STUDIO PRESETS, the light rigs a `studio` lighting names by id (Blender's studio lights are
 *    data, `release/datafiles/studiolights/studio/*.sl`; so are ours);
 *  - STARTING VALUES, declared by whoever builds a kind of stage (an integration or a product),
 *    beneath the person's choices and outside the look (`workspace-style.ts` never sees them,
 *    so a style switch cannot wipe a toggle and a toggle cannot make a style read as custom);
 *  - the PER-VIEW choices a person made, which the document that owns the view persists in its
 *    own blob (`workspace-document-restore.ts`), through {@link viewPresentationSnapshot} and
 *    {@link restoreViewPresentation}.
 *
 * Resolution, lowest first: the kit's defaults, the stage kind's starting values, the
 * document's override, the person's per-view choices. Lighting and backdrop are kept PER DRAW
 * MODE (Blender keeps its lighting per shading type), so switching to wireframe and back finds
 * the lighting where it was left.
 */
import type { ShadingMode } from '../types';

/** The draw modes a viewport already has (`ShadingMode`), unchanged. */
export type ViewportDrawMode = ShadingMode;

/** An sRGB hex colour, `#rrggbb`. */
export type PresentationColor = string;

/** A light in a studio preset. `camera` lights move with the view (Blender's studio lights,
 *  Unity's headlight); `world` lights stay put. The direction points FROM the light. */
export interface StudioLight {
  readonly color: PresentationColor;
  readonly intensity: number;
  readonly direction: readonly [number, number, number];
  readonly space: 'camera' | 'world';
  /** Blender's per-light specular colour and wrap (0..1), when the preset carries them. */
  readonly specular?: PresentationColor;
  readonly wrap?: number;
  readonly castShadow?: boolean;
}

export interface StudioPreset {
  readonly id: string;
  readonly title: string;
  readonly lights: readonly StudioLight[];
  readonly ambient: { readonly color: PresentationColor; readonly intensity: number };
  /** Image-based light strength under this preset (0 turns it off). */
  readonly environmentIntensity: number;
}

/** What in the scene takes over from the view's own lighting, for `auto` (Godot: a directional
 *  light or a world environment, and an omni or spot light does not count; `light` is any light,
 *  the kit's own rule that a document's authored lighting wins). */
export type SceneTakeover = 'light' | 'directional-light' | 'environment';

export interface PreviewLighting {
  /** Whether the scene's own lights also light the view (Godot's preview adds its sun to them;
   *  Blender's Material Preview draws without them: Scene Lights is off by default). */
  readonly sceneLights: boolean;
  readonly sun: {
    readonly enabled: boolean;
    readonly color: PresentationColor;
    readonly energy: number;
    /** Degrees above the horizon and clockwise from north (Godot: 60 and 150). */
    readonly altitude: number;
    readonly azimuth: number;
    /** Shadow distance in scene units; 0 casts none. */
    readonly shadowDistance: number;
  };
  readonly environment: {
    readonly enabled: boolean;
    /** A procedural sky (Godot's preview sky; Unity's default skybox). The horizon is the
     *  target's own derivation, so it is stated rather than computed here. */
    readonly sky: {
      readonly top: PresentationColor;
      readonly horizon: PresentationColor;
      readonly ground: PresentationColor;
      /** How fast the horizon gives way to the top colour above it and to the ground below it
       *  (Godot's `sky_curve` 0.15 and `ground_curve` 0.02; Unity's horizon haze is a
       *  narrower band). */
      readonly topCurve: number;
      readonly groundCurve: number;
      /** A cloud layer over the sky above the horizon (Unreal's `BP_Sky_Sphere`), or `null` for
       *  a clear sky (Godot, Unity). `cover` is the share of the sky clouded (0 to 1),
       *  `opacity` how much they hide the sky, `scale` how many cloud features span the sky. */
      readonly clouds: { readonly cover: number; readonly opacity: number; readonly scale: number } | null;
    };
    /** A registered environment image (`kit/environment-images`) in place of the sky: the
     *  panorama drawn behind the scene and lit by (Blender's Material Preview HDRI; Unreal's
     *  preview-scene panorama). `null`: the procedural sky above. */
    readonly image: string | null;
    readonly energy: number;
    /** Rotation about the vertical axis, degrees (Blender's Material Preview HDRI). */
    readonly rotation: number;
  };
}

export interface ViewportLighting {
  /** `studio`: the named preset, ignoring the scene's lights (Blender's Solid).
   *  `preview`: the preview sun and environment (Godot; Blender's Material Preview).
   *  `scene`: the scene's own lights and environment only (Blender's Rendered; Unity with
   *  scene lighting on). */
  readonly source: 'studio' | 'preview' | 'scene';
  /** When set, the view's own lighting gives way to the scene's when the scene has any of
   *  `takeover`, and `overridable` says whether the person may turn it back on (Godot: false).
   *  `null`: the source never changes on its own (Blender, Unity). */
  readonly auto: { readonly takeover: readonly SceneTakeover[]; readonly overridable: boolean } | null;
  readonly studioPreset: string;
  readonly preview: PreviewLighting;
  readonly tone: { readonly mapper: 'none' | 'filmic' | 'aces' | 'agx'; readonly exposure: number };
}

export interface ViewportBackdrop {
  /** `fill`: the look's fill (its colour and form, `color.viewport`).
   *  `color`: this view's own colour (Blender's "Viewport" background).
   *  `environment`: the lighting environment drawn behind the scene.
   *  `scene`: the scene's own background (Unity's skybox toggle; Blender's "World").
   *  `transparent`: nothing (a capture over a page). */
  readonly source: 'fill' | 'color' | 'environment' | 'scene' | 'transparent';
  readonly color: PresentationColor;
  /** For `environment`: how much of it shows over the fill, and how blurred (Blender's World
   *  Opacity and Blur, both defaulting to 0 in Material Preview). */
  readonly opacity: number;
  readonly blur: number;
}

export interface ViewportOverlays {
  readonly grid: {
    readonly visible: boolean;
    /** Minor cells per major line (Blender 10, Godot 8). */
    readonly majorEvery: number;
    readonly planes: { readonly xz: boolean; readonly xy: boolean; readonly yz: boolean };
  };
  /** Any set of selection marks (Unity can show outline and wire together; Godot a box), and
   *  a dot at each selected object's origin (Blender's Origins overlay). */
  readonly selection: {
    readonly outline: boolean;
    readonly wire: boolean;
    readonly box: boolean;
    readonly origins: boolean;
  };
  /**
   * Which of the world's axis lines are drawn, named by the WORLD's axes: `floor` is the two
   * that lie on the floor (Blender's X and Y), an object states each (Blender's X/Y/Z overlay
   * toggles; Godot draws all three, Y vertical; Unity and Unreal none).
   */
  readonly axes: 'floor' | { readonly x: boolean; readonly y: boolean; readonly z: boolean };
  /** The navigation gizmo: `interactive` (a click turns the view to that axis — Blender's,
   *  Godot's, Unity's), `indicator` (drawn, not clicked — Unreal's axis triad) or `hidden`. */
  readonly navigation: 'interactive' | 'indicator' | 'hidden';
  /** A floor under what the view shows, taking the preview sun's shadow (Unreal's preview
   *  floor, a Show toggle; the others show none). It lies at the content's lowest point, as
   *  Unreal's asset editors place theirs at the bottom of the mesh's bounds. */
  readonly floor: { readonly visible: boolean; readonly color: PresentationColor };
}

/** How the stage's tools behave (function, ARCHITECTURE.md rule 7): the tool its shelf opens
 *  on, and what a box drag selects. Blender opens on Select Box and selects anything a box
 *  touches; the editor's own opens on the transform gizmo and selects what a box contains. */
export interface ViewportInteraction {
  /** The tool the shelf opens on: Select (Blender's Select Box), the combined transform tool
   *  (the editor's own, Godot's Select gizmo), or one transform alone (Unity's and Unreal's
   *  Move). */
  readonly bootTool: 'select' | 'transform' | 'move' | 'rotate' | 'scale';
  readonly boxSelect: 'contain' | 'touch';
  /**
   * Which handles the combined transform tool offers beside its arrows and rings: scaling,
   * rotating about the view axis (the outer ring), and moving freely (the centre). The
   * editor's own offers all three; Godot's Select gizmo moves and rotates only.
   */
  readonly transformHandles: {
    readonly scale: boolean;
    readonly viewRotate: boolean;
    readonly freeMove: boolean;
  };
}

/** How the world the stage presents is oriented: which of its axes is up, which is what the
 *  gizmos name their axes by (Blender's world is Z-up, presented through three's Y-up). */
export interface ViewportWorld {
  readonly upAxis: 'y' | 'z';
  /** Unreal's world is LEFT-handed (Z up, Y to the right of X), so its Y points the other
   *  way from Blender's; the gizmos name and draw their axes by it. */
  readonly handedness: 'right' | 'left';
}

/** One draw mode's lighting and backdrop. */
export interface ViewportModePresentation {
  readonly lighting: ViewportLighting;
  readonly backdrop: ViewportBackdrop;
}

/** A view's whole presentation, resolved. */
export interface ViewportPresentation extends ViewportModePresentation {
  readonly drawMode: ViewportDrawMode;
  readonly overlays: ViewportOverlays;
  readonly interaction: ViewportInteraction;
  readonly world: ViewportWorld;
}

type DeepPartial<T> = { readonly [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** A partial presentation: starting values, a document override, a person's choices. Lighting
 *  and backdrop may be given for every mode (`all`) and per draw mode (`modes`). */
export interface PresentationLayer {
  readonly drawMode?: ViewportDrawMode;
  readonly overlays?: DeepPartial<ViewportOverlays>;
  readonly interaction?: DeepPartial<ViewportInteraction>;
  readonly world?: Partial<ViewportWorld>;
  readonly all?: DeepPartial<ViewportModePresentation>;
  readonly modes?: { readonly [M in ViewportDrawMode]?: DeepPartial<ViewportModePresentation> };
}

// ---- The kit's own defaults ------------------------------------------------------------------

/** The kit's studio rig: the lights a document stage wore before they were fitted to Blender —
 *  the dressing's key, warm (`#fff3dd`; engine `913444142` made it white), the viewport's own
 *  directional and ambient, and the image-based fill at three's default strength (engine
 *  `750b13fa9` set 0.3, later 0.85). */
export const KIT_STUDIO_PRESET: StudioPreset = Object.freeze<StudioPreset>({
  id: 'kit',
  title: 'Studio',
  lights: [
    { color: '#fff3dd', intensity: 1.9, direction: [-6, -10, 4], space: 'world', castShadow: true },
    { color: '#ffffff', intensity: 1, direction: [-10, -20, -10], space: 'world' },
  ],
  ambient: { color: '#ffffff', intensity: 0.5 },
  environmentIntensity: 1,
});

export const KIT_PRESENTATION: ViewportPresentation = Object.freeze<ViewportPresentation>({
  drawMode: 'solid',
  lighting: {
    source: 'studio',
    // The kit's own rule, kept: a document whose content carries lights wears them.
    auto: { takeover: ['light'], overridable: true },
    studioPreset: KIT_STUDIO_PRESET.id,
    // Godot's preview defaults (`node_3d_editor_plugin.cpp` `_load_default_preview_settings`),
    // the one target that ships a preview sun and sky, so `preview` means something out of the box.
    preview: {
      sceneLights: true,
      sun: { enabled: true, color: '#ffffff', energy: 1, altitude: 60, azimuth: 150, shadowDistance: 100 },
      environment: {
        enabled: true,
        // Top (0.385, 0.454, 0.55) and ground (0.2, 0.169, 0.133); the horizon is Godot's own
        // derivation from them (their mix, pulled halfway to its luminance x 3.333).
        sky: { top: '#62748c', horizon: '#a9abaf', ground: '#332b22', topCurve: 0.15, groundCurve: 0.02, clouds: null },
        image: null,
        energy: 1,
        rotation: 0,
      },
    },
    tone: { mapper: 'aces', exposure: 1 },
  },
  backdrop: { source: 'fill', color: '#3d3d3d', opacity: 0, blur: 0 },
  overlays: {
    grid: { visible: true, majorEvery: 10, planes: { xz: true, xy: false, yz: false } },
    selection: { outline: true, wire: false, box: false, origins: false },
    axes: 'floor',
    navigation: 'interactive',
    floor: { visible: false, color: '#2b3038' },
  },
  interaction: {
    bootTool: 'transform',
    boxSelect: 'contain',
    transformHandles: { scale: true, viewRotate: true, freeMove: true },
  },
  world: { upAxis: 'y', handedness: 'right' },
});

// ---- Studio presets ----------------------------------------------------------------------------

/**
 * THE DOCUMENT'S OWN STUDIO — the lights a document hands its stage to turn with the view
 * (`ToolViewportDressing.viewLocked`): Blender's four Solid-mode lights, built by the Blender
 * engine from Blender's own data. The stage draws them in place of a preset's lights; the preset
 * itself carries none, and no image-based light (Blender's Solid mode has none).
 */
export const DOCUMENT_STUDIO_PRESET: StudioPreset = Object.freeze<StudioPreset>({
  id: 'document',
  title: "Document's studio",
  lights: [],
  ambient: { color: '#ffffff', intensity: 0 },
  environmentIntensity: 0,
});

const presets = new Map<string, StudioPreset>([
  [KIT_STUDIO_PRESET.id, KIT_STUDIO_PRESET],
  [DOCUMENT_STUDIO_PRESET.id, DOCUMENT_STUDIO_PRESET],
]);

/** Register a studio preset (an integration's own studio lights). A duplicate id throws. */
export function registerStudioPreset(preset: StudioPreset): () => void {
  if (presets.has(preset.id)) throw new Error(`registerStudioPreset: "${preset.id}" is already registered.`);
  presets.set(preset.id, preset);
  bump();
  return () => {
    if (presets.get(preset.id) !== preset) return;
    presets.delete(preset.id);
    bump();
  };
}

/** The preset for an id, or the kit's when the id is not (or no longer) registered. */
export function studioPreset(id: string): StudioPreset {
  return presets.get(id) ?? KIT_STUDIO_PRESET;
}

export function studioPresets(): readonly StudioPreset[] {
  return [...presets.values()];
}

// ---- The grid switch ------------------------------------------------------------------------------

/**
 * WHETHER A VIEW DRAWS ITS GRID — the person's grid toggle, which is the view's own choice
 * (`overlays.grid.visible`): every door that toggles a grid (the viewport's button, the overlays
 * menu, the Toggle Grid action, `set-grid`, a restored view) writes it here, per view, and the
 * stage and the status read it back. One home; a view the person never touched shows its grid.
 */
export function viewGridVisible(viewId: string): boolean {
  return viewPresentation(viewId).overlays.grid.visible;
}

export function setViewGridVisible(viewId: string, visible: boolean): void {
  if (viewGridVisible(viewId) === visible) return;
  setViewPresentation(viewId, { overlays: { grid: { visible } } });
}

// ---- View presets --------------------------------------------------------------------------------

/**
 * A NAMED VIEW: a whole presentation a person can put on a view at once — a target engine's
 * default viewport (Godot's preview sun and sky, all three axis lines, the box, its Select
 * gizmo), contributed as data by the package that knows it (`*.view.ts`). It is the view's
 * FUNCTION and light, never its look: the style stays whatever the person wears.
 */
export interface ViewPreset {
  readonly id: string;
  readonly title: string;
  readonly layer: PresentationLayer;
}

const viewPresetsById = new Map<string, ViewPreset>();

export function registerViewPreset(preset: ViewPreset): () => void {
  if (viewPresetsById.has(preset.id)) throw new Error(`registerViewPreset: "${preset.id}" is already registered.`);
  viewPresetsById.set(preset.id, preset);
  bump();
  return () => {
    if (viewPresetsById.get(preset.id) !== preset) return;
    viewPresetsById.delete(preset.id);
    bump();
  };
}

export function viewPresets(): readonly ViewPreset[] {
  return [...viewPresetsById.values()];
}

/** Put a named view on a view: the person's choices become the preset's, whole. `false` for
 *  an id no package registered. */
export function applyViewPreset(viewId: string, presetId: string): boolean {
  const preset = viewPresetsById.get(presetId);
  if (!preset) return false;
  resetViewPresentation(viewId);
  setViewPresentation(viewId, preset.layer);
  return true;
}

// ---- Starting values, per kind of stage ---------------------------------------------------------

const starting = new Map<string, PresentationLayer>();

/**
 * Declare the starting presentation of a kind of stage (`'model'`, `'scene'`, …): the builder's
 * say, beneath every person's choice. One declaration per kind; a second throws, as two builders
 * of one stage would be a composition defect.
 */
export function registerStartingPresentation(stageKind: string, layer: PresentationLayer): () => void {
  if (starting.has(stageKind)) {
    throw new Error(`registerStartingPresentation: the "${stageKind}" stage already has starting values.`);
  }
  starting.set(stageKind, layer);
  bump();
  return () => {
    if (starting.get(stageKind) !== layer) return;
    starting.delete(stageKind);
    bump();
  };
}

// ---- Per-view choices ---------------------------------------------------------------------------

interface ViewRecord {
  readonly stageKind: string;
  readonly documentLayer: PresentationLayer | null;
  readonly chosen: PresentationLayer;
}

const views = new Map<string, ViewRecord>();

/** What the builder of a kind of stage declared as its starting presentation, or null. */
export function startingPresentation(stageKind: string): PresentationLayer | null {
  return starting.get(stageKind) ?? null;
}

/** Whether a kind of stage keeps its lighting per draw mode, as Blender's shading types each keep
 *  theirs: its builder stated lighting for a draw mode. Then a person's lighting choice is the
 *  current mode's, not every mode's. */
export function stageLightsPerMode(stageKind: string): boolean {
  const modes = starting.get(stageKind)?.modes;
  return modes !== undefined && Object.values(modes).some((mode) => mode?.lighting !== undefined);
}

/** Bind a view to its kind of stage and its document's override. Idempotent; a person's
 *  choices already recorded for the view are kept. */
export function bindViewPresentation(
  viewId: string,
  stageKind: string,
  documentLayer: PresentationLayer | null = null,
): void {
  const current = views.get(viewId);
  if (current && current.stageKind === stageKind && current.documentLayer === documentLayer) return;
  views.set(viewId, { stageKind, documentLayer, chosen: current?.chosen ?? {} });
  bump();
}

/** Record a person's choice for a view (a toggle, a menu pick), merged over earlier ones. */
export function setViewPresentation(viewId: string, choice: PresentationLayer): void {
  const current = views.get(viewId) ?? { stageKind: '', documentLayer: null, chosen: {} };
  views.set(viewId, { ...current, chosen: mergeLayers(current.chosen, choice) });
  bump();
}

/** Forget a person's choices for a view: it falls back to its document and starting values. */
export function resetViewPresentation(viewId: string): void {
  const current = views.get(viewId);
  if (!current) return;
  views.set(viewId, { ...current, chosen: {} });
  bump();
}

/** The person's choices for a view, as the document persists them. */
export function viewPresentationSnapshot(viewId: string): PresentationLayer {
  return views.get(viewId)?.chosen ?? {};
}

/** Put back the choices a document persisted (`restore` of its blob). */
export function restoreViewPresentation(viewId: string, chosen: PresentationLayer): void {
  const current = views.get(viewId) ?? { stageKind: '', documentLayer: null, chosen: {} };
  views.set(viewId, { ...current, chosen });
  bump();
}

/** How a view is bound — its kind of stage and whether its document states a layer — or `null`
 *  when no stage has bound it (a view id no stage draws). */
export function viewPresentationBinding(
  viewId: string,
): { readonly stageKind: string; readonly documentLayer: PresentationLayer | null } | null {
  const record = views.get(viewId);
  return record && record.stageKind !== '' ? { stageKind: record.stageKind, documentLayer: record.documentLayer } : null;
}

/** What a view's LAST DRAW lit by, as its stage reports it: the source after `auto`, the
 *  preset, and which light sets were showing. The readout for an agent asking "is the view
 *  wearing what its presentation says". */
export interface ViewDrawReport {
  readonly source: 'studio' | 'preview' | 'scene';
  readonly presetId: string | null;
  readonly presetLights: boolean;
  readonly documentStudio: boolean | null;
  readonly contentLights: number;
  readonly contentLightsDarkened: number;
  readonly environmentIntensity: number;
  /** The environment image this draw showed (`null`: the procedural sky or none), and the one
   *  the view names while it is still loading or after it failed to load. */
  readonly environmentImage: string | null;
  readonly environmentImagePending: { readonly id: string; readonly state: 'unregistered' | 'loading' | 'failed' } | null;
  readonly toneMapping: string;
}

const drawReports = new Map<string, ViewDrawReport>();

export function reportViewDraw(viewId: string, report: ViewDrawReport): void {
  drawReports.set(viewId, report);
}

export function viewDrawReport(viewId: string): ViewDrawReport | null {
  return drawReports.get(viewId) ?? null;
}

/** Every view a stage has bound, by id and kind of stage. */
export function boundViewPresentations(): readonly { readonly viewId: string; readonly stageKind: string }[] {
  return [...views.entries()]
    .filter(([, record]) => record.stageKind !== '')
    .map(([viewId, record]) => ({ viewId, stageKind: record.stageKind }));
}

export function unbindViewPresentation(viewId: string): void {
  if (views.delete(viewId)) bump();
}

/** A view's presentation, resolved: kit, starting values, document, person — lighting and
 *  backdrop for the view's current draw mode. */
export function viewPresentation(viewId: string): ViewportPresentation {
  const record = views.get(viewId);
  const layers = [starting.get(record?.stageKind ?? ''), record?.documentLayer ?? undefined, record?.chosen].filter(
    (layer): layer is PresentationLayer => layer !== undefined,
  );
  return resolvePresentation(layers);
}

/** Resolve layers (lowest first) over the kit's defaults. Pure; exported for a stage that
 *  resolves without a bound view (a capture, a preview). */
export function resolvePresentation(layers: readonly PresentationLayer[]): ViewportPresentation {
  const drawMode = layers.reduce<ViewportDrawMode>((mode, layer) => layer.drawMode ?? mode, KIT_PRESENTATION.drawMode);
  let mode: ViewportModePresentation = { lighting: KIT_PRESENTATION.lighting, backdrop: KIT_PRESENTATION.backdrop };
  let overlays: ViewportOverlays = KIT_PRESENTATION.overlays;
  let interaction: ViewportInteraction = KIT_PRESENTATION.interaction;
  let world: ViewportWorld = KIT_PRESENTATION.world;
  for (const layer of layers) {
    if (layer.all) mode = deepMerge(mode, layer.all);
    const forMode = layer.modes?.[drawMode];
    if (forMode) mode = deepMerge(mode, forMode);
    if (layer.overlays) overlays = deepMerge(overlays, layer.overlays);
    if (layer.interaction) interaction = deepMerge(interaction, layer.interaction);
    if (layer.world) world = deepMerge(world, layer.world);
  }
  return { drawMode, lighting: mode.lighting, backdrop: mode.backdrop, overlays, interaction, world };
}

// ---- Change notification ------------------------------------------------------------------------

let version = 0;
const listeners = new Set<() => void>();

function bump(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeViewportPresentation(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function viewportPresentationVersion(): number {
  return version;
}

// ---- Merging -----------------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? deepMerge(out[key], value) : value;
  }
  return out as T;
}

/** Merge two layers: `later` wins, per field, including per draw mode. */
export function mergeLayers(earlier: PresentationLayer, later: PresentationLayer): PresentationLayer {
  return deepMerge(earlier, later);
}
