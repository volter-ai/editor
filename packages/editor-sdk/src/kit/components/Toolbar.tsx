import {
  faArrowDown,
  faArrowsToDot,
  type faArrowsUpDownLeftRight,
  faBullseye,
  faCaretDown,
  faCheck,
  faCircleDot,
  faCrosshairs,
  faCube,
  faGlobe,
  faMagnet,
} from '@fortawesome/free-solid-svg-icons';
import type { StageTransformDoor, StageTransformKind } from '@volter/editor-sdk/contributions';
import {
  AnchoredMenu,
  Button,
  Checkbox,
  EditorIcon,
  EditorPopover,
  EditorToolbar,
  editorIcons,
  FloatingToolbar,
  IconButton,
  Inline,
  Keycap,
  MenuItem,
  SplitButtonGroup,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@volter/editor-sdk/widgets';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useEditorStore } from '../editor-runtime';
import { useViewportChrome } from '@volter/editor-sdk/kit/native-selection-style';
import type { GizmoAnchor, PivotMode } from '@volter/editor-sdk/kit/shell-store';
import type { ShellStore } from '@volter/editor-sdk/kit/shell-store';
import {
  activeEditorKeymap,
  type EditorKeyActionId,
  shortcutFor,
  subscribeEditorKeymap,
} from '@volter/editor-sdk/kit/keymap-presets';
import { requestTransformMode } from '../transform-mode-request';

/** WHETHER IT IS LIT AND WHAT IT ARMS ARE THE STAGE'S ANSWER, not this
 *  button's: the gizmo arm reads `store.transformMode`, a modal door reads its
 *  own `armed()` (see `stageTransformDriver` in `stage-context.ts`). */
function ModeButton({
  active,
  onArm,
  faIcon,
  action,
  label,
}: {
  active: boolean;
  onArm: () => void;
  faIcon: typeof faArrowsUpDownLeftRight;
  /** The LOGICAL action — its printed key comes from the active keymap. */
  action: EditorKeyActionId;
  label: string;
}) {
  return (
    <Tooltip text={label} hotkey={shortcutFor(action)}>
      <IconButton
        aria-label={label}
        aria-pressed={active}
        shape="segment"
        size="comfortable"
        onClick={onArm}
      >
        <EditorIcon icon={faIcon} size="md" />
      </IconButton>
    </Tooltip>
  );
}

function SnapButton({
  store,
  dimensions = '3d',
  size = 'comfortable',
  variant = 'ghost',
  showValues = false,
}: {
  store: ShellStore;
  dimensions?: '2d' | '3d';
  size?: 'compact' | 'default' | 'comfortable';
  variant?: 'ghost' | 'secondary';
  /** Draw the three steps themselves as the settings' trigger (Unreal's viewport row: the grid
   *  step, the angle and the scale step), each opening the same settings. */
  showValues?: boolean;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!popoverOpen) return;
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setPopoverOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [popoverOpen]);

  return (
    <div ref={ref} className="vgai-viewport-popover-anchor">
      <SplitButtonGroup>
        {dimensions === '2d' && (
          // Godot's 2D toolbar has two snap toggles: smart snapping (alignment to the parent,
          // other nodes and guides) and grid snapping (the step). This is the first.
          <Tooltip text="Smart Snap">
            <IconButton
              aria-label="Toggle smart snap"
              aria-pressed={store.smartSnap.enabled}
              variant={variant}
              size={size}
              onClick={() => store.setSmartSnap({ enabled: !store.smartSnap.enabled })}
            >
              <EditorIcon icon={faArrowsToDot} size="md" />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip
          text={dimensions === '2d' ? 'Grid Snap' : 'Toggle Snap'}
          hotkey={shortcutFor('viewport.toggleSnap')}
        >
          <IconButton
            aria-label="Toggle snap"
            aria-pressed={store.snapEnabled}
            variant={variant}
            size={size}
            onClick={() => store.toggleSnap()}
          >
            <EditorIcon icon={faMagnet} size="md" />
          </IconButton>
        </Tooltip>
        {showValues ? (
          (
            [
              ['translate', editorIcons.tool.move, `${store.snapValues.translate}`],
              ['rotate', editorIcons.tool.rotate, `${store.snapValues.rotate}°`],
              ['scale', editorIcons.tool.scale, `${store.snapValues.scale}`],
            ] as const
          ).map(([channel, icon, value]) => (
            <Tooltip key={channel} text="Snap Settings">
              <Button
                aria-label={`${channel} snap step`}
                aria-haspopup="dialog"
                aria-expanded={popoverOpen}
                variant={variant}
                size={size}
                data-snap-step={channel}
                onClick={() => setPopoverOpen(!popoverOpen)}
              >
                <EditorIcon icon={icon} size="xs" />
                {value}
              </Button>
            </Tooltip>
          ))
        ) : (
        <Tooltip text="Snap Settings">
          <IconButton
            aria-label="Snap settings"
            // A trigger that opens an anchored SETTINGS popover is a menu
            // button, and `theme.css` reads that off the ARIA rather than a
            // marker attribute — the same honest `dialog` the `Studio v`
            // trigger declares. Blender's snap group is exactly this two-tone
            // split: the magnet half in the pushbutton colour, this half in
            // the menu well (measured native 2x `modeling.png` y=62, the
            // toggle x 1411..1445 at #535353 and the dropdown x 1448..1507 at
            // #272727, one 1 CSS px #3c3c3c divider between them).
            aria-haspopup="dialog"
            aria-expanded={popoverOpen}
            variant={variant}
            size={size}
            onClick={() => setPopoverOpen(!popoverOpen)}
          >
            <EditorIcon icon={faCaretDown} size="xs" />
          </IconButton>
        </Tooltip>
        )}
      </SplitButtonGroup>
      {popoverOpen && (
        <EditorPopover className="vgai-snap-popover">
          <Stack gap={2}>
            <Text variant="caption" tone="muted">
              Translate
            </Text>
            <TextInput
              type="number"
              value={store.snapValues.translate}
              step={0.25}
              min={0.01}
              onChange={(event) =>
                store.setSnapValues({ translate: Number(event.target.value) || 1 })
              }
            />
            <Text variant="caption" tone="muted">
              Rotate (deg)
            </Text>
            <TextInput
              type="number"
              value={store.snapValues.rotate}
              step={5}
              min={1}
              onChange={(event) =>
                store.setSnapValues({ rotate: Number(event.target.value) || 15 })
              }
            />
            <Text variant="caption" tone="muted">
              Scale
            </Text>
            <TextInput
              type="number"
              value={store.snapValues.scale}
              step={0.05}
              min={0.01}
              onChange={(event) =>
                store.setSnapValues({ scale: Number(event.target.value) || 0.25 })
              }
            />
            {dimensions === '2d' && (
              <>
                {(
                  [
                    ['Use Rotation Snap', store.rotationSnap, () => store.setRotationSnap(!store.rotationSnap)],
                    ['Use Scale Snap', store.scaleSnap, () => store.setScaleSnap(!store.scaleSnap)],
                  ] as const
                ).map(([label, on, toggle]) => (
                  <Inline key={label} gap={2} align="center" role="menuitemcheckbox" aria-checked={on} onClick={toggle}>
                    <Checkbox checked={on} readOnly />
                    <Text>{label}</Text>
                  </Inline>
                ))}
                <Text variant="caption" tone="muted">
                  Smart Snapping
                </Text>
                {(
                  [
                    ['parent', 'Snap to Parent'],
                    ['sides', 'Snap to Node Sides'],
                    ['center', 'Snap to Node Center'],
                    ['guides', 'Snap to Guides'],
                  ] as const
                ).map(([target, label]) => (
                  <Inline
                    key={target}
                    gap={2}
                    align="center"
                    role="menuitemcheckbox"
                    aria-checked={store.smartSnap[target]}
                    onClick={() => store.setSmartSnap({ [target]: !store.smartSnap[target] })}
                  >
                    <Checkbox checked={store.smartSnap[target]} readOnly />
                    <Text>{label}</Text>
                  </Inline>
                ))}
              </>
            )}
            {dimensions === '3d' && (
              <>
                <Inline gap={2} align="center" onClick={() => store.toggleSnapToSurface()}>
                  <Checkbox checked={store.snapToSurface} readOnly />
                  <Text>Snap to Surface</Text>
                </Inline>
                <Text variant="caption" tone="dim">
                  Hold <Keycap>Ctrl</Keycap> while dragging to snap once ·{' '}
                  <Keycap>{shortcutFor('viewport.toggleSnap')}</Keycap> toggles
                </Text>
                <Text variant="caption" tone="dim">
                  Hold <Keycap>{shortcutFor('viewport.vertexSnapHold')}</Keycap> during translate
                  for vertex snap
                </Text>
              </>
            )}
          </Stack>
        </EditorPopover>
      )}
    </div>
  );
}

const pivotLabels: Record<PivotMode, string> = {
  'active-element': 'Active Element',
  'median-point': 'Median Point',
  'individual-origins': 'Individual Origins',
};

function PivotButton({ store }: { store: ShellStore }) {
  const modes: PivotMode[] = ['active-element', 'median-point', 'individual-origins'];
  const label = `Pivot: ${pivotLabels[store.pivotMode]}`;
  return (
    <Tooltip text={label} hotkey={shortcutFor('viewport.cyclePivot')}>
      <IconButton
        aria-label={label}
        aria-pressed={store.pivotMode !== 'active-element'}
        variant="secondary"
        onClick={() => {
          const index = modes.indexOf(store.pivotMode);
          store.setPivotMode(modes[(index + 1) % modes.length]!);
        }}
      >
        <EditorIcon icon={faCrosshairs} size="md" />
      </IconButton>
    </Tooltip>
  );
}

const anchorLabels: Record<GizmoAnchor, string> = {
  auto: 'Auto',
  pivot: 'Pivot',
  center: 'Center',
};

/**
 * WHERE the gizmo is drawn — the standard DCC pivot/centre affordance, cycled
 * the way its `PivotButton` neighbour cycles its own three states.
 *
 * `Auto` leads because the right answer is a property of the SUBJECT: an
 * ordinary node's pivot already sits in its content and nothing moves, while a
 * world-anchored instanced system's sits at (0,0,0) with everything visible
 * somewhere else (`instanced-presentation.ts`). The two explicit states are the
 * override, in both directions.
 */
function AnchorButton({ store }: { store: ShellStore }) {
  const modes: GizmoAnchor[] = ['auto', 'pivot', 'center'];
  const label = `Anchor: ${anchorLabels[store.gizmoAnchor]}`;
  return (
    <Tooltip text={label}>
      <IconButton
        aria-label={label}
        aria-pressed={store.gizmoAnchor !== 'auto'}
        variant="secondary"
        onClick={() => {
          const index = modes.indexOf(store.gizmoAnchor);
          store.setGizmoAnchor(modes[(index + 1) % modes.length]!);
        }}
      >
        <EditorIcon icon={store.gizmoAnchor === 'center' ? faCircleDot : faBullseye} size="md" />
      </IconButton>
    </Tooltip>
  );
}

function TransformOptionsButton({ store }: { store: ShellStore }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={ref} className="vgai-viewport-popover-anchor">
      <Tooltip text="Transform options">
        <IconButton
          aria-label="Transform options"
          // Same reading as the snap group's dropdown half: an anchored
          // settings popover is a menu button, and this is where Blender's
          // proportional-editing dropdown sits in the row.
          aria-haspopup="dialog"
          aria-expanded={open}
          variant="secondary"
          onClick={() => setOpen((value) => !value)}
        >
          <EditorIcon icon={faArrowDown} size="md" />
        </IconButton>
      </Tooltip>
      {open ? (
        <EditorPopover style={{ minWidth: 240 }}>
          <Stack gap={3}>
            <Button
              size="compact"
              variant="ghost"
              onClick={() => {
                store.snapSelectionToFloor();
                setOpen(false);
              }}
            >
              Snap Selection to Floor <Keycap>{shortcutFor('viewport.snapToFloor')}</Keycap>
            </Button>
            <Inline
              gap={2}
              align="center"
              onClick={() => store.togglePreserveChildrenTransform()}
              style={{ cursor: 'pointer' }}
            >
              <Checkbox checked={store.preserveChildrenTransform} readOnly />
              <Text>Preserve Children Transform</Text>
            </Inline>
            <Text variant="caption" tone="dim">
              Keep source-writable children fixed in world space while their parent moves.
            </Text>
          </Stack>
        </EditorPopover>
      ) : null}
    </div>
  );
}

/**
 * THE TRANSFORM ORIENTATION control, transcribed from the frame rather than
 * inferred: Blender's is a LABELLED DROPDOWN, not a cycling toggle. Measured on
 * the native 2x `modeling.png` at row y=70 — the well runs x 1170..1323 (a
 * 1 px #3c3c3c border at each end, #272727 fill between), i.e. 77 CSS px wide,
 * because it carries an orientation glyph, the word `Global`, and a chevron at
 * x 1304..1316 (13x8 device px, 6.5x4 CSS, peak 216). Ours was a 20 px
 * icon-only button that cycled on click, which is also why the widget-colour
 * rule painted it the #535353 pushbutton where the frame shows the menu well:
 * the colour was agreeing with what the control DID.
 *
 * The STORE's vocabulary is unchanged and stays three.js's (`world`/`local`);
 * only the printed word is the reference's, because `Global` is what this
 * control is called in the frame this skew is transcribing.
 */
function TransformOrientationButton({ store }: { store: ShellStore }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const label = store.transformSpace === 'world' ? 'Global' : 'Local';
  return (
    <div className="vgai-viewport-popover-anchor">
      <Tooltip text={`Transform orientation: ${label}`}>
        <Button
          ref={triggerRef}
          type="button"
          size="compact"
          variant="secondary"
          aria-label={`Transform orientation: ${label}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="vgai-transform-orientation-trigger"
        >
          <EditorIcon icon={store.transformSpace === 'world' ? faGlobe : faCube} size="sm" />
          <span>{label}</span>
          <EditorIcon icon={faCaretDown} size="xs" />
        </Button>
      </Tooltip>
      {open && (
        <AnchoredMenu
          anchorRef={triggerRef}
          align="start"
          clamp
          aria-label="Transform orientation"
          onDismiss={() => setOpen(false)}
        >
          {(['world', 'local'] as const).map((space) => (
            <MenuItem
              key={space}
              role="menuitemradio"
              aria-checked={store.transformSpace === space}
              onSelect={() => {
                store.setTransformSpace(space);
                setOpen(false);
              }}
            >
              <span className="vgai-menu-check">
                {store.transformSpace === space && <EditorIcon icon={faCheck} size="xs" />}
              </span>
              {space === 'world' ? 'Global' : 'Local'}
            </MenuItem>
          ))}
        </AnchoredMenu>
      )}
    </div>
  );
}

/**
 * THE VIEWPORT HEADER'S TRANSFORM CONTROLS — orientation, pivot, snap and the
 * transform options, drawn in the document's header beside the host's 3D
 * controls (`DocumentHeaderStrip`).
 *
 * WHY HERE AND NOT ON THE SHELF: a control is placed by the panel that owns its
 * job in the reference. In Blender's 3D viewport these four are HEADER
 * controls — transform orientation, transform pivot point, snapping with its
 * dropdown, proportional editing — and the tool shelf (T) holds tools only.
 * They rode the `ToolStrip` here until 2026-09-18, and the magnet is what
 * showed it: a horizontal `SplitButtonGroup` inside a rail one tool wide spent
 * two boxes and hung a half-width caret off the column.
 *
 * THE GROUPING IS TRANSCRIBED, measured on the native 2x `modeling.png`
 * (row y=62, x in device px): Blender lays four separate WELLS with 12 device
 * px (6 CSS px) of bare header between them — orientation x 1171..1322 (76 CSS
 * px, it carries the "Global" label), pivot x 1335..1396 (31), snap
 * x 1409..1510 (51), proportional editing x 1523..1624 (51). The last two are
 * SPLIT: a toggle segment in the pushbutton colour (#535353) then a one-pixel
 * #3c3c3c divider then an icon+caret dropdown in the menu-well colour
 * (#272727) — exactly the `SplitButtonGroup` shape the magnet already had, in
 * the row where it lays out. Each well is 40 device px tall (20 CSS px, the
 * density's control height) inside a 54-device-px header band.
 *
 * Each control is `secondary`, so the estate's widget-colour rule paints it:
 * a toggle takes the pushbutton class and a popover trigger the menu well,
 * read off the trigger's own ARIA (`theme.css`, "A MENU BUTTON"). They drew as
 * ghost icons floating on the header band before that — measured beside the
 * frame at 4x, every one of Blender's carries a well.
 *
 * Three readings where ours differs from the frame, kept as they are because
 * this unit moves placement and not shape: Blender's orientation is a labelled
 * dropdown (`Global v`) where ours cycles world/local on click — so ours takes
 * the pushbutton #535353 where the frame shows the #272727 menu well, which is
 * the colour rule agreeing with what the control DOES; its pivot is one
 * dropdown where we carry two cycling toggles — pivot MODE and gizmo ANCHOR,
 * sharing one well because they are one job (where the gizmo sits), which is
 * how Blender groups them; and our toggles are 20x20 against the frame's 31
 * for pivot, because a cycling toggle carries no caret.
 */
export function TransformHeaderControls({ store: stage }: { store?: ShellStore } = {}) {
  // THE STAGE'S OWN STORE, when the caller knows it. Every stage owns an
  // `EditorShellStore` (`stage-store-registry.ts`) and these four configure
  // the gizmo in THAT stage's viewport, so writing the shell's from over a
  // document stage set a value nothing on screen reads — MEASURED 2026-09-19
  // on a prefab story: with the shell at `rotate`, the story's stage kept
  // drawing the default COMBINED gizmo, and two captures a mode apart were
  // byte-identical. The world root's stage runs on the shell store itself, so
  // the Scene document is unchanged either way.
  const shell = useEditorStore();
  const store = stage ?? shell;
  useSyncExternalStore(store.subscribe, store.getShellSnapshot ?? store.getSnapshot);
  useSyncExternalStore(subscribeEditorKeymap, activeEditorKeymap, activeEditorKeymap);
  // On the look's bar (Unreal's row) the snap steps are shown, as Unreal's row shows them.
  const onBar = useViewportChrome().transformControls === 'bar';
  return (
    <EditorToolbar
      compact
      label="Transform controls"
      data-testid="transform-header-controls"
      className="vgai-transform-header-controls"
    >
      <TransformOrientationButton store={store} />
      <SplitButtonGroup>
        <PivotButton store={store} />
        <AnchorButton store={store} />
      </SplitButtonGroup>
      <SnapButton store={store} size="default" variant="secondary" showValues={onBar} />
      <TransformOptionsButton store={store} />
    </EditorToolbar>
  );
}

/**
 * THE TOOL SHELF'S STRIP — tools, and nothing else (Blender's T shelf). The
 * four header controls that used to trail it live in
 * {@link TransformHeaderControls} now; the 2D canvas surface keeps its snap
 * control inline because this strip lays out as a ROW over that stage (see
 * `.vgai-viewport-toolbar-left` in `workspace-dock.css`) and that surface has
 * no Blender analogue to place it against.
 *
 * THESE FOUR ARE BLENDER'S OWN SECOND TOOLBAR GROUP, and the order is its
 * order. Measured 2026-09-19 on `modeling-edit-none.png`: the Edit Mode
 * toolbar's 21 buttons run in five groups of 2 / 4 / 2 / 1 / 12, and group 2
 * is exactly Move, Rotate, Scale, Transform — the same four verbs this strip
 * has always carried, under Font Awesome drawings and with the combined tool
 * FIRST. So the answer to "do the host's navigation buttons belong at the top
 * of a Blender toolbar at all" is yes and they were already right; what was
 * wrong was the order (Transform leads in Blender's list only as the LAST
 * member, the all-handles fallback after the three single-channel tools) and
 * two of the glyphs (`editorIcons.tool`'s docblock says which and why).
 * BLENDER'S GROUP 1 IS SELECT BOX AND THE 3D CURSOR, and as of 2026-09-21 the
 * FIRST of the two is drawn above them while the second is still not. The
 * earlier note here said neither was, and its reason was right at the time:
 * neither had anything behind it once the Edit Mesh document was deleted (the
 * 21-row table that said what each of the twenty-one does is in git,
 * `packages/mesh/contributions/mesh-edit-document.tsx` before 2026-09-19).
 * Select Box has something behind it NOW — `TransformMode`'s `'select'`, the
 * state in which no transform gizmo is drawn at all, which is what Blender's
 * viewport opens in (`gizmo-select-box.png`; the Blender stage's starting presentation states
 * it, `interaction.bootTool`). The 3D cursor now exists — `Scene.cursor`, drawn
 * and placed with Blender's Shift+Right-click on the Model document
 * (`@volter/blender-engine`'s `blender-runtime-cursor.ts`) — but its toolbar
 * tool, which places it with the LEFT button, is a transform mode this kit does
 * not have, and a button without one would be the inert control the paragraph
 * below removes.
 *
 * WHAT THEY DRIVE IS THE STAGE'S ANSWER, in two parts.
 *
 * `store` — WHICH STAGE'S GIZMO. Every stage owns an `EditorShellStore`
 * (`stage-store-registry.ts`), and these four write `transformMode`, which
 * that stage's `EditorViewport` reads. Writing the SHELL's from over a
 * document stage set a value nothing on screen read: MEASURED 2026-09-19 on
 * a prefab story with its subject selected, the shell store at `rotate`, the
 * stage still drawing the default COMBINED gizmo, and two `capture-active-
 * document` frames a mode apart BYTE-IDENTICAL. That, not a missing gizmo,
 * is why these four were inert over a document stage. The world root's stage
 * runs on the shell store itself, so the Scene document is unchanged.
 *
 * `door` — a stage that transforms MODALLY instead (a Model document's
 * `G`/`R`/`S`, `registerStageTransform` in `@volter/editor-sdk/contributions`,
 * whose note carries that measurement). Then the three single-channel tools
 * arm it and the all-handles tool is NOT DRAWN: Blender's fourth is a gizmo
 * and a modal transform has no twin for it, so drawing it would be the inert
 * control this seam exists to remove. `stageTransformDriver`
 * (`stage-context.ts`) is what chooses between the two.
 */
const NO_DOOR_SUBSCRIBE = () => () => {};
const NO_DOOR_ARMED = () => null;

export function ToolStrip({
  dimensions = '3d',
  door,
  store: stage,
}: {
  dimensions?: '2d' | '3d';
  door?: StageTransformDoor;
  store?: ShellStore;
} = {}) {
  const shell = useEditorStore();
  const store = stage ?? shell;
  useSyncExternalStore(store.subscribe, store.getShellSnapshot ?? store.getSnapshot);
  // Every hint below is rendered from the active keymap; a live switch must
  // repaint the strip rather than leave it advertising the other table.
  useSyncExternalStore(subscribeEditorKeymap, activeEditorKeymap, activeEditorKeymap);
  // A modal transform's lit state is the DOOR's, and it changes without the
  // shell store moving at all — the same `useSyncExternalStore` pair every
  // out-of-tree panel uses, with the mesh document's own null-session shape
  // for the gizmo arm (hooks cannot be conditional).
  const armed = useSyncExternalStore(
    door?.subscribe ?? NO_DOOR_SUBSCRIBE,
    door?.armed ?? NO_DOOR_ARMED,
    door?.armed ?? NO_DOOR_ARMED,
  );
  const single = [
    {
      mode: 'translate',
      faIcon: editorIcons.tool.move,
      action: 'transform.translate',
      label: 'Move',
    },
    {
      mode: 'rotate',
      faIcon: editorIcons.tool.rotate,
      action: 'transform.rotate',
      label: 'Rotate',
    },
    { mode: 'scale', faIcon: editorIcons.tool.scale, action: 'transform.scale', label: 'Scale' },
  ] as const satisfies readonly {
    mode: StageTransformKind;
    faIcon: typeof faArrowsUpDownLeftRight;
    action: EditorKeyActionId;
    label: string;
  }[];
  return (
    <FloatingToolbar
      label="Transform tools"
      data-testid={dimensions === '2d' ? 'canvas-2d-toolstrip' : 'threejs-toolstrip'}
      className="vgai-viewport-toolbar vgai-viewport-toolbar-left"
    >
      {/* SELECT BOX, first — Blender's own group 1 (see the docblock). It is
          not offered over a MODAL door: `door.begin` takes a transform kind
          and a modal transform has no "arm nothing" member, so the button
          would have nothing to call. */}
      {door ? null : (
        <ModeButton
          faIcon={editorIcons.tool.select}
          action="transform.select"
          label="Select"
          // On a 2D surface Select is the handle mode, which the store names `combined`.
          active={store.transformMode === 'select' || (dimensions === '2d' && store.transformMode === 'combined')}
          onArm={() => requestTransformMode(store, 'select')}
        />
      )}
      {single.map((tool) => (
        <ModeButton
          key={tool.mode}
          faIcon={tool.faIcon}
          action={tool.action}
          label={tool.label}
          active={door ? armed === tool.mode : store.transformMode === tool.mode}
          onArm={() => (door ? door.begin(tool.mode) : requestTransformMode(store, tool.mode))}
        />
      ))}
      {door || dimensions === '2d' ? null : (
        <ModeButton
          faIcon={editorIcons.tool.transform}
          action="transform.combined"
          label="Transform (all handles)"
          active={store.transformMode === 'combined'}
          onArm={() => requestTransformMode(store, 'combined')}
        />
      )}
      {dimensions === '2d' ? <SnapButton store={store} dimensions="2d" /> : null}
    </FloatingToolbar>
  );
}
