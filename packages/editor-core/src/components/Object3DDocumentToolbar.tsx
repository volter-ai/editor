import {
  faBone,
  faCamera,
  faCaretDown,
  faCheck,
  faCube,
  faEllipsis,
  faExpand,
  faRotateLeft,
} from '@fortawesome/free-solid-svg-icons';
import {
  AnchoredMenu,
  Button,
  EditorBanner,
  EditorIcon,
  EditorPopover,
  EditorToolbar,
  IconButton,
  MenuItem,
  MenuSeparator,
  Select,
  Text,
  TextInput,
  Tooltip,
} from '@volter/editor-sdk/widgets';
import { useRef, useState, useSyncExternalStore } from 'react';
import { captureModelAssetPreview, captureObjectAssetPreview } from '../asset-preview';
import {
  type ModelCameraPreset,
  supportedModelDiagnosticModes,
} from '../asset-workflow/model-inspection';
import type { Object3DDocumentViewMode } from '../authoring/object3d-document-session';
import {
  object3DDocumentSession,
  object3DDocumentSessionsVersion,
  subscribeObject3DDocumentSessions,
} from '../authoring/object3d-document-session-registry';
import {
  contributedChromeVersion,
  contributedHeaderItems,
  subscribeContributedChrome,
} from '../chrome-registry';
import type { HelperVisibility } from '../editor-shell-store';
import { object3DDocumentWritePolicy } from '../object3d-document-write-policy';
import { stageStore, stageStoresVersion, subscribeStageStores } from '../stage-store-registry';
import { viewportStageHelperKinds } from '../viewport-door';
import {
  DOCUMENT_STUDIO_PRESET,
  setViewPresentation,
  studioPresets,
  viewPresentationBinding,
  subscribeViewportPresentation,
  viewPresentation,
  viewportPresentationVersion,
} from '@volter/editor-sdk/kit/viewport-presentation';
import { ViewportOverlaysGlyph, ViewportOverlaysMenu } from './ViewportOverlaysMenu';
import {
  type ViewportDisplayModeChoice,
  ViewportDisplayModeMenu,
  viewportShadingModes,
  viewportShadingSegments,
} from './ViewportShadingMenu';

const subscribeToNothing = () => () => undefined;
const noSessionVersion = () => 0;

/**
 * THE DOCUMENT'S OWN OVERLAY ROWS, beside Grid and Bounds.
 *
 * Blender's viewport overlay popover carries a BONES checkbox
 * (`View3DOverlay.show_bones`, `makesrna/intern/rna_space.cc:5125-5129`, drawn
 * by `scripts/startup/bl_ui/space_view3d.py:7161` with `text="Bones"`), and it
 * is Blender's noun that is used here rather than the Helpers vocabulary's
 * `Skeletons`, because this menu IS that popover — the comment on the eye below
 * says so. `Weights` has no Blender checkbox at all: Blender reaches weight
 * colours through Weight Paint MODE, and an inspection surface has no brushes
 * to enter one, so it is a display toggle here (WORK.md §Blender in the tab is
 * Blender, "Inspection parity", I4).
 *
 * A ROW STANDS ONLY WHERE THE DOCUMENT PUT A HELPER OF THAT KIND on this stage
 * (`viewportStageHelperKinds`) — the same rule the Outliner's restriction
 * columns follow: a control follows what the thing behind it answers, never a
 * knob. So an imported GLB's Asset Lab document, which shows no bones, draws
 * neither row.
 */
const DOCUMENT_HELPER_ROWS: readonly { key: keyof HelperVisibility; label: string }[] = [
  { key: 'skeletons', label: 'Bones' },
  { key: 'weights', label: 'Weights' },
];
export function Object3DDocumentToolbar({
  documentId,
  assetPath,
}: {
  readonly documentId: string;
  readonly assetPath?: string;
}) {
  useSyncExternalStore(
    subscribeObject3DDocumentSessions,
    object3DDocumentSessionsVersion,
    object3DDocumentSessionsVersion,
  );
  const session = object3DDocumentSession(documentId);
  useSyncExternalStore(
    subscribeContributedChrome,
    contributedChromeVersion,
    contributedChromeVersion,
  );
  useSyncExternalStore(
    session?.subscribe ?? subscribeToNothing,
    session?.getSnapshot ?? noSessionVersion,
    session?.getSnapshot ?? noSessionVersion,
  );
  // THIS STAGE's own store and its own helpers: the shared panels read
  // whichever store the FOCUSED document's stage runs on (ARCHITECTURE-CORE
  // §One stage), and a toolbar is a control over ITS document, never over the
  // world root's.
  useSyncExternalStore(subscribeStageStores, stageStoresVersion, stageStoresVersion);
  const stage = stageStore(documentId);
  useSyncExternalStore(
    stage?.subscribe ?? subscribeToNothing,
    stage?.getSnapshot ?? noSessionVersion,
    stage?.getSnapshot ?? noSessionVersion,
  );
  const helperKinds = viewportStageHelperKinds(documentId);
  const [capture, setCapture] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const viewRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  useSyncExternalStore(subscribeViewportPresentation, viewportPresentationVersion, viewportPresentationVersion);
  if (!session) return null;
  const presentation = session.presentation();
  const { lighting } = viewPresentation(documentId);
  const documentStudioOffered =
    viewPresentationBinding(documentId)?.documentLayer?.all?.lighting?.studioPreset === DOCUMENT_STUDIO_PRESET.id;
  const availableModes = new Set(
    supportedModelDiagnosticModes(session.root)
      .filter((item) => item.available)
      .map((item) => item.mode),
  );
  const modes: Array<ViewportDisplayModeChoice<Object3DDocumentViewMode>> = [
    ...viewportShadingModes,
    ...(availableModes.has('uv')
      ? [{ mode: 'uv' as const, label: 'UV', description: 'UV coordinates as surface color' }]
      : []),
    ...(availableModes.has('vertex-colors')
      ? [
          {
            mode: 'vertex-colors' as const,
            label: 'Vertex colors',
            description: 'Authored color attributes without textures',
          },
        ]
      : []),
  ];

  const saveThumbnailFraming = async (reset: boolean) => {
    if (!assetPath) return;
    setError(null);
    try {
      // The shell owns where a framing is RECORDED (`.vgai/thumbnails.json`,
      // written through the project-file route); this surface only knows the
      // asset and the pose. See `object3d-document-write-policy.ts`.
      await object3DDocumentWritePolicy().saveThumbnailFraming(
        assetPath,
        reset ? undefined : session.cameraPose(),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const capturePreview = async () => {
    setError(null);
    try {
      const options = { background: presentation.background } as const;
      const result = assetPath?.toLowerCase().endsWith('.spz')
        ? await captureModelAssetPreview(assetPath, options)
        : captureObjectAssetPreview(session.root, options);
      setCapture(`data:image/png;base64,${result.contactSheet.base64}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const frameLabel = session.selection().length > 0 ? 'Frame selection' : 'Frame all';
  return (
    <div className="vgai-model-document-header">
      <EditorToolbar
        compact
        label="Viewport view controls"
        className="vgai-model-viewport-toolbar vgai-model-viewport-toolbar--view"
      >
        {/* THE BUTTON SAYS WHAT IT DOES. `session.frame()` frames the
            selection when there is one and the whole subject when there is
            not, but it was labelled "Frame selection" unconditionally — so a
            tester hunting a fit-the-board control on the 3D board reported
            finding none, then discovered this button does exactly that
            (runhuman passes 87 and 89). One control, named for the job it is
            about to do. */}
        <Tooltip text={frameLabel}>
          <IconButton aria-label={frameLabel} onClick={() => session.frame()}>
            <EditorIcon icon={faExpand} size="md" />
          </IconButton>
        </Tooltip>
        <div className="vgai-viewport-popover-anchor">
          <Tooltip text="Camera orientation and projection">
            <Button
              ref={viewRef}
              type="button"
              size="compact"
              // A dropdown TRIGGER is a widget, not a label: Blender's
              // `Object Mode v` in the same row of chrome is a 20px well
              // (#272727 in a 1px #3c3c3c border) while its plain menu words
              // — View/Select/Add — carry no chrome at all. `ghost` said this
              // was the second kind; it is the first.
              variant="secondary"
              aria-label={`Camera view: ${presentation.projection}`}
              aria-haspopup="menu"
              aria-expanded={viewOpen}
              onClick={() => setViewOpen((open) => !open)}
              className="vgai-model-toolbar-labelled-control"
            >
              <EditorIcon icon={faCube} size="sm" />
              <span>
                {presentation.projection === 'perspective' ? 'Perspective' : 'Orthographic'}
              </span>
              <EditorIcon icon={faCaretDown} size="xs" />
            </Button>
          </Tooltip>
          {viewOpen && (
            <AnchoredMenu
              anchorRef={viewRef}
              align="start"
              clamp
              aria-label="Camera view"
              onDismiss={() => setViewOpen(false)}
              style={{ minWidth: 210 }}
            >
              {(['front', 'right', 'top', 'isometric'] as ModelCameraPreset[]).map((preset) => (
                <MenuItem
                  key={preset}
                  onSelect={() => {
                    session.setViewPreset(preset);
                    setViewOpen(false);
                  }}
                >
                  {preset === 'isometric'
                    ? 'Perspective 3/4'
                    : `${preset[0]?.toUpperCase()}${preset.slice(1)} view`}
                </MenuItem>
              ))}
              <MenuSeparator />
              {(['perspective', 'orthographic'] as const).map((projection) => (
                <MenuItem
                  key={projection}
                  role="menuitemradio"
                  aria-checked={presentation.projection === projection}
                  onSelect={() => {
                    session.setProjection(projection);
                    setViewOpen(false);
                  }}
                >
                  <span className="vgai-menu-check">
                    {presentation.projection === projection && (
                      <EditorIcon icon={faCheck} size="xs" />
                    )}
                  </span>
                  {projection === 'perspective' ? 'Perspective' : 'Orthographic'}
                </MenuItem>
              ))}
            </AnchoredMenu>
          )}
        </div>
        {availableModes.has('skeleton') ? (
          <Tooltip text={`Rig: ${presentation.skeleton ? 'Visible' : 'Hidden'}`}>
            <IconButton
              aria-label="Toggle rig overlay"
              aria-pressed={presentation.skeleton}
              onClick={() => session.setSkeleton(!presentation.skeleton)}
            >
              <EditorIcon icon={faBone} size="md" />
            </IconButton>
          </Tooltip>
        ) : null}
        {/* A package's own controls on this document (`@volter/editor-sdk/chrome`,
            `placement: 'object3d-document'`): handed the document's id; the
            contribution resolves its subject through its own integration. */}
        {contributedHeaderItems('object3d-document').map(({ id, Component }) => (
          <Component key={id} documentId={documentId} />
        ))}
      </EditorToolbar>
      <EditorToolbar
        compact
        label="Viewport preview controls"
        className="vgai-model-viewport-toolbar vgai-model-viewport-toolbar--preview"
      >
        {/* THE DISPLAY CONTROLS SIT AT THE TRAILING EDGE, which is where
            Blender's are: its 3D View header packs Visibility, Gizmo,
            Overlays, X-Ray and Shading hard against the region's right border
            and leaves the middle empty. Ours used to clump them after the
            view controls with three hundred pixels of bare header to their
            right and this group's `...` alone at the edge. */}
        {/* BLENDER'S SHADING CONTROL, one widget: the segments it has, and the
            chevron's popover carrying every other mode AND the lighting rows
            that used to be a second `Studio v` dropdown further along the row.
            Blender's own shading popover is where Lighting lives (Studio /
            MatCap / Flat), so the two controls were always one control drawn
            twice — measured in `modeling-edit-none.png`, its header's trailing
            cluster is five icon groups and no words at all. */}
        <ViewportDisplayModeMenu
          mode={presentation.mode}
          onChange={(mode) => session.setMode(mode)}
          choices={modes}
          segments={viewportShadingSegments}
        >
          {/* LIGHTING AND EXPOSURE ARE THE VIEW'S PRESENTATION (`kit/viewport-presentation`):
              a studio preset, or the scene's own lights, and the tone's exposure. */}
          <label>
            <span>Lighting</span>
            <Select
              aria-label="Lighting"
              value={lighting.source === 'studio' ? `studio:${lighting.studioPreset}` : lighting.source}
              onChange={(event) => {
                const value = event.target.value;
                setViewPresentation(
                  documentId,
                  value.startsWith('studio:')
                    ? { all: { lighting: { source: 'studio', studioPreset: value.slice('studio:'.length) } } }
                    : { all: { lighting: { source: value as 'scene' } } },
                );
              }}
            >
              {studioPresets()
                // The document's own studio is a choice only where the document brought one.
                .filter((preset) => preset.id !== DOCUMENT_STUDIO_PRESET.id || documentStudioOffered)
                .map((preset) => (
                <option key={preset.id} value={`studio:${preset.id}`}>
                  {preset.title}
                </option>
              ))}
              <option value="scene">Scene lights</option>
            </Select>
          </label>
          <label>
            <span>Exposure</span>
            <TextInput
              aria-label="Preview exposure"
              type="range"
              min="0.2"
              max="2"
              step="0.1"
              value={lighting.tone.exposure}
              onChange={(event) =>
                setViewPresentation(documentId, {
                  all: { lighting: { tone: { exposure: Number(event.target.value) } } },
                })
              }
            />
            <Text as="span" variant="caption">
              {lighting.tone.exposure.toFixed(1)}
            </Text>
          </label>
        </ViewportDisplayModeMenu>
        {/* THE EYE WAS THE OVERLAYS CONTROL ALL ALONG — measured by what it
            toggles, which is Grid and Bounds, exactly Blender's Show Overlays
            subject. It takes Blender's mark. It does NOT take Blender's split
            toggle+chevron: that toggle binds to a MASTER overlays flag this
            document's session does not have, and deriving one from "any
            overlay is on" would silently drop the per-overlay state on the
            first click. One button, one job, until the session has the flag. */}
        <ViewportOverlaysMenu
          glyph={<ViewportOverlaysGlyph />}
          choices={[
            {
              id: 'grid',
              label: 'Grid',
              enabled: presentation.grid,
              onToggle: () => session.setGrid(!presentation.grid),
            },
            {
              id: 'bounds',
              label: 'Bounds',
              enabled: presentation.bounds,
              onToggle: () => session.setBounds(!presentation.bounds),
            },
            ...(stage === null
              ? []
              : DOCUMENT_HELPER_ROWS.filter((row) => helperKinds.includes(row.key)).map((row) => ({
                  id: row.key,
                  label: row.label,
                  enabled: stage.helperVisibility[row.key],
                  onToggle: () => stage.toggleHelperType(row.key),
                }))),
          ]}
        />
        <div className="vgai-viewport-popover-anchor">
          <Tooltip text="Asset preview actions">
            <IconButton
              ref={moreRef}
              aria-label="Asset preview actions"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((open) => !open)}
            >
              <EditorIcon icon={faEllipsis} size="md" />
            </IconButton>
          </Tooltip>
          {moreOpen && (
            <AnchoredMenu
              anchorRef={moreRef}
              clamp
              aria-label="Asset preview actions"
              onDismiss={() => setMoreOpen(false)}
              style={{ minWidth: 210 }}
            >
              <MenuItem
                onSelect={() => {
                  setMoreOpen(false);
                  void capturePreview();
                }}
              >
                <EditorIcon icon={faCamera} size="sm" />
                Capture preview
              </MenuItem>
              {assetPath ? (
                <>
                  <MenuItem
                    onSelect={() => {
                      setMoreOpen(false);
                      void saveThumbnailFraming(false);
                    }}
                  >
                    Save thumbnail framing
                  </MenuItem>
                  <MenuItem
                    onSelect={() => {
                      setMoreOpen(false);
                      void saveThumbnailFraming(true);
                    }}
                  >
                    Reset thumbnail framing
                  </MenuItem>
                </>
              ) : null}
              <MenuSeparator />
              <MenuItem
                onSelect={() => {
                  session.resetPresentation();
                  setMoreOpen(false);
                }}
              >
                <EditorIcon icon={faRotateLeft} size="sm" />
                Reset viewport settings
              </MenuItem>
            </AnchoredMenu>
          )}
        </div>
      </EditorToolbar>
      {capture ? (
        <EditorPopover className="vgai-model-capture-preview">
          <div>
            <Text as="strong" variant="label">
              Deterministic views
            </Text>
            <Button type="button" variant="ghost" onClick={() => setCapture(null)}>
              Close
            </Button>
          </div>
          <img src={capture} alt="Front, right, top, and three-quarter model preview" />
        </EditorPopover>
      ) : null}
      {error ? (
        <EditorBanner className="vgai-model-toolbar-error" tone="error">
          {error}
        </EditorBanner>
      ) : null}
    </div>
  );
}
