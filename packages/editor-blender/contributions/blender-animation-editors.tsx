/**
 * BLENDER'S ANIMATION EDITORS beside the Timeline, in the bottom area's Animation view: the editor-
 * type menu Blender's area header has, the Dope Sheet's ACTION EDITOR and the NLA editor.
 *
 * - **Action Editor** (`SpaceAction.mode == 'ACTION'`): one armature's active action. Its
 *   selector is Blender's: picking an action writes `animation_data.action` (and its slot), so the
 *   character plays it; the channel list is one row per bone with the frames it keys.
 * - **NLA** (`SPACE_NLA`): each armature's tracks, bottom track last as Blender lists them, their
 *   strips over scene frames, and the active action's own line on top.
 *
 * WHILE A GAME RUNS both show what the game is animating, read-only, the way a game engine's
 * animator view highlights the live state: each character's clips as its last update posed them
 * (`blender-play-skin.ts`'s `live`), with the frame and influence of each. Nothing is written
 * then: the game owns its copy.
 */
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { blenderRnaSet, blenderRnaVersion, subscribeBlenderRna } from '../host/blender-runtime-host';
import { liveAnimation, subscribeLiveAnimation } from '../src/play-live';
import {
  type AnimationEditor,
  setTimelineViewState,
  subscribeTimelineView,
  timelineViewState,
  timelineViewVersion,
} from '../src/timeline-view-state';
import { PlayModeSwitch } from './blender-game-panel';
import { blenderSkin, blenderSkinVersion, subscribeBlenderSkin } from './blender-runtime-skin';
import {
  CHANNEL_HEIGHT,
  DIAMOND_RADIUS,
  DIAMOND_STROKE,
  HEADER_HEIGHT,
  KEY_COLORS,
  PLAYHEAD,
  SCRUB_HEIGHT,
  TIMELINE_CHROME,
  TIMELINE_THEME,
} from './blender-timeline-geometry';

const EDITORS: readonly { readonly id: AnimationEditor; readonly label: string }[] = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'action', label: 'Action Editor' },
  { id: 'nla', label: 'Nonlinear Animation' },
];
/** The channel region's width: Blender's default `ACHANNEL_NAMEWIDTH` area for a Dope Sheet. */
const CHANNELS_WIDTH = 200;

/** BLENDER'S EDITOR-TYPE MENU, limited to its animation editors: which one this area shows. */
export function AnimationEditorMenu() {
  useSyncExternalStore(subscribeTimelineView, timelineViewVersion, timelineViewVersion);
  const { editor } = timelineViewState();
  return (
    <select
      aria-label="Animation editor"
      data-testid="animation-editor-type"
      value={editor}
      onChange={(event) => setTimelineViewState({ editor: event.target.value as AnimationEditor })}
      style={{
        height: TIMELINE_CHROME.unit,
        border: `1px solid ${TIMELINE_CHROME.widgetOutline}`,
        borderRadius: TIMELINE_CHROME.widgetRadius,
        background: TIMELINE_CHROME.widget,
        color: TIMELINE_CHROME.widgetText,
        font: 'inherit',
      }}
    >
      {EDITORS.map((one) => <option key={one.id} value={one.id}>{one.label}</option>)}
    </select>
  );
}

/** Re-render on every frame while a game runs (its animation changes each update), else never. */
function useLive() {
  const live = useSyncExternalStore(subscribeLiveAnimation, liveAnimation, () => null);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!live) return;
    let frame = requestAnimationFrame(function tick() {
      setTick((n) => (n + 1) % 1_000_000);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [live]);
  return live;
}

function useMeasured() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize({ w: element.clientWidth, h: element.clientHeight }));
    observer.observe(element);
    setSize({ w: element.clientWidth, h: element.clientHeight });
    return () => observer.disconnect();
  }, []);
  return { ref, size };
}

function Header({ children }: { readonly children?: ReactNode }) {
  return (
    <div
      style={{
        height: HEADER_HEIGHT,
        flex: `0 0 ${HEADER_HEIGHT}px`,
        display: 'flex',
        alignItems: 'center',
        gap: TIMELINE_CHROME.headerGap,
        padding: TIMELINE_CHROME.headerPadding,
        background: TIMELINE_THEME.header,
        borderBottom: `1px solid ${TIMELINE_CHROME.rule}`,
      }}
    >
      <PlayModeSwitch title="Animation" />
      <AnimationEditorMenu />
      {children}
    </div>
  );
}

function Frame({ children, header }: { readonly children: ReactNode; readonly header: ReactNode }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: TIMELINE_THEME.back,
        color: TIMELINE_CHROME.text,
        font: '11px Inter, system-ui, sans-serif',
      }}
    >
      {header}
      {children}
    </div>
  );
}

/** A frame ruler over [start, end] in `width` pixels: majors every step that keeps labels apart. */
function ruler(start: number, end: number, width: number) {
  const span = Math.max(1, end - start);
  const pixelsPerFrame = Math.max(1e-6, width / (span * 1.1));
  const first = start - span * 0.05;
  const toX = (frame: number) => (frame - first) * pixelsPerFrame;
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 250, 500, 1000];
  const step = steps.find((one) => one * pixelsPerFrame >= 40) ?? 1000;
  const majors: number[] = [];
  // Unmeasured (zero width) draws no ruler; a measured one has at most width / 40 labels.
  if (width > 0)
    for (let frame = Math.ceil(first / step) * step; toX(frame) <= width && majors.length < 500; frame += step) majors.push(frame);
  return { toX, majors, toFrame: (x: number) => first + x / pixelsPerFrame };
}

function Playhead({ x, frame, height }: { readonly x: number; readonly frame: number; readonly height: number }) {
  const text = `${Math.round(frame)}`;
  const width = Math.max(PLAYHEAD.minPillWidth, text.length * 6 + 2 * PLAYHEAD.textPadding);
  return (
    <g>
      <rect x={x - PLAYHEAD.stalkWidth / 2} y={SCRUB_HEIGHT} width={PLAYHEAD.stalkWidth} height={Math.max(0, height - SCRUB_HEIGHT)} fill={TIMELINE_THEME.playhead} />
      <rect x={x - width / 2} y={PLAYHEAD.margin} width={width} height={SCRUB_HEIGHT - 2 * PLAYHEAD.margin} rx={PLAYHEAD.radius} fill={TIMELINE_THEME.playhead} />
      <text x={x} y={15.5} textAnchor="middle" fill={TIMELINE_THEME.playheadText} fontSize={11}>{text}</text>
    </g>
  );
}

function Grid({ majors, toX, width, height }: { readonly majors: number[]; readonly toX: (f: number) => number; readonly width: number; readonly height: number }) {
  return (
    <g>
      {majors.map((frame) => <line key={`g${frame}`} x1={toX(frame)} y1={SCRUB_HEIGHT} x2={toX(frame)} y2={height} stroke={TIMELINE_THEME.grid} />)}
      <rect x={0} y={0} width={width} height={SCRUB_HEIGHT} fill={TIMELINE_THEME.scrubBack} />
      {majors.map((frame) => <text key={`t${frame}`} x={toX(frame)} y={15.5} textAnchor="middle" fill={TIMELINE_THEME.scrubText} fontSize={11}>{frame}</text>)}
    </g>
  );
}

function diamond(x: number, y: number, key: string) {
  const r = DIAMOND_RADIUS;
  return <polygon key={key} points={`${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}`} fill={KEY_COLORS['KEYFRAME']!.fill} stroke={TIMELINE_THEME.keyBorder} strokeWidth={DIAMOND_STROKE} />;
}

const address = (armature: string) => `bpy.data.objects[${JSON.stringify(armature)}].animation_data`;

/**
 * THE DOPE SHEET'S ACTION EDITOR for the armature the Timeline describes. Its selector is
 * Blender's: an action picked here becomes the armature's `animation_data.action`.
 */
export function BlenderActionEditor() {
  useSyncExternalStore(subscribeBlenderRna, blenderRnaVersion, blenderRnaVersion);
  useSyncExternalStore(subscribeBlenderSkin, blenderSkinVersion, blenderSkinVersion);
  const live = useLive();
  const { ref, size } = useMeasured();
  const [refusal, setRefusal] = useState<string | null>(null);
  const play = blenderSkin.state();
  const armature = blenderSkin.subject ?? play.armature;
  const running = live?.live().find((one) => one.armature === armature) ?? null;
  // READ-ONLY WHILE ANY GAME RUNS: the game owns its copy, and the document is not edited under it.
  const gameRunning = live !== null;
  const top = running?.layers.at(-1) ?? null;
  const action = running ? top?.action ?? null : play.action;
  const channels = useMemo(
    () => (running && action ? live!.channels(running.armature, action) : blenderSkin.channels()),
    // The live clip's keys do not change while it plays; the edited clip's change with its revision.
    [running ? action : play.action, play.engineCalls, live],
  );
  const frames = channels.flatMap((channel) => channel.keys);
  const start = frames.length ? Math.min(...frames) : play.start;
  const end = frames.length ? Math.max(...frames) : play.end;
  const width = Math.max(0, size.w - CHANNELS_WIDTH);
  const { toX, majors, toFrame } = ruler(start, end, width);
  const frame = running ? top?.frame ?? start : play.frame;
  const rowTop = (i: number) => SCRUB_HEIGHT + CHANNEL_HEIGHT * (i + 1);
  const height = SCRUB_HEIGHT + CHANNEL_HEIGHT * (channels.length + 2);
  const summary = [...new Set(frames)].sort((a, b) => a - b);

  const pick = async (name: string) => {
    if (!armature || gameRunning) return;
    setRefusal(null);
    // ONE WRITE, as Blender's own selector makes it: assigning the action lets Blender choose the
    // slot that fits this armature (measured: `OBArmature` for a UAL1 clip on a renamed rig).
    try {
      await blenderRnaSet(address(armature), 'action', `bpy.data.actions[${JSON.stringify(name)}]`);
    } catch (error) {
      setRefusal(`${name} could not be assigned to ${armature}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const header = (
    <Header>
      <span style={{ color: TIMELINE_CHROME.textHi }}>{armature ?? 'No armature'}</span>
      <select
        aria-label="Action"
        data-testid="action-editor-action"
        value={action ?? ''}
        disabled={!armature || gameRunning}
        title={gameRunning ? 'A game is running; it chooses the clips while it runs' : 'The action this armature plays (animation_data.action)'}
        onChange={(event) => void pick(event.target.value)}
        style={{
          height: TIMELINE_CHROME.unit,
          minWidth: 180,
          border: `1px solid ${TIMELINE_CHROME.widgetOutline}`,
          borderRadius: TIMELINE_CHROME.widgetRadius,
          background: TIMELINE_CHROME.widget,
          color: TIMELINE_CHROME.widgetText,
          font: 'inherit',
        }}
      >
        {action === null ? <option value="">No action</option> : null}
        {(running && action ? [action] : blenderSkin.actionNames()).map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
      {running ? (
        <span data-testid="action-editor-live" style={{ color: TIMELINE_THEME.playhead }}>
          ● game running: {running.layers.map((layer) => `${layer.action} @${layer.frame.toFixed(1)} ×${layer.influence.toFixed(2)}`).join(' + ')}
        </span>
      ) : null}
      <div style={{ flex: 1 }} />
      {refusal ? <span style={{ color: TIMELINE_CHROME.refusal }}>{refusal}</span> : null}
    </Header>
  );

  return (
    <Frame header={header}>
      <div ref={ref} style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        <div style={{ display: 'flex', minHeight: height }}>
          <div style={{ width: CHANNELS_WIDTH, flex: `0 0 ${CHANNELS_WIDTH}px`, borderRight: `1px solid ${TIMELINE_CHROME.rule}` }}>
            <div style={{ height: SCRUB_HEIGHT, background: TIMELINE_THEME.scrubBack }} />
            <div style={{ height: CHANNEL_HEIGHT, paddingLeft: 6, color: TIMELINE_CHROME.textHi }}>Summary</div>
            {channels.map((channel) => (
              <div key={channel.bone} style={{ height: CHANNEL_HEIGHT, paddingLeft: 18, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{channel.bone}</div>
            ))}
          </div>
          <svg
            width={width}
            height={height}
            style={{ display: 'block', cursor: gameRunning ? 'default' : 'ew-resize' }}
            aria-label="Action Editor"
            onPointerDown={(event) => {
              if (gameRunning) return;
              const box = event.currentTarget.getBoundingClientRect();
              blenderSkin.transport?.seekFrame(Math.round(toFrame(event.clientX - box.left)));
            }}
          >
            <rect x={0} y={0} width={width} height={height} fill={TIMELINE_THEME.back} />
            <Grid majors={majors} toX={toX} width={width} height={height} />
            {summary.map((key) => diamond(toX(key), rowTop(0) - CHANNEL_HEIGHT / 2, `s${key}`))}
            {channels.map((channel, i) => channel.keys.map((key) => diamond(toX(key), rowTop(i + 1) - CHANNEL_HEIGHT / 2, `${channel.bone}${key}`)))}
            <Playhead x={toX(frame)} frame={frame} height={height} />
          </svg>
        </div>
      </div>
    </Frame>
  );
}

/** THE NLA EDITOR: every armature's tracks and strips over scene frames, and its active action. */
export function BlenderNlaEditor() {
  useSyncExternalStore(subscribeBlenderRna, blenderRnaVersion, blenderRnaVersion);
  useSyncExternalStore(subscribeBlenderSkin, blenderSkinVersion, blenderSkinVersion);
  const live = useLive();
  const { ref, size } = useMeasured();
  const play = blenderSkin.state();
  const stacks = blenderSkin.stacks();
  const running = live?.live() ?? null;
  const width = Math.max(0, size.w - CHANNELS_WIDTH);
  const { toX, majors } = ruler(play.start, play.end, width);
  type Row = { label: string; kind: 'armature' | 'action' | 'track'; strips: { name: string; start: number; end: number; mute: boolean }[]; live?: string; mute?: boolean };
  const rows: Row[] = [];
  for (const stack of stacks) {
    const layers = running?.find((one) => one.armature === stack.armature)?.layers ?? null;
    const influence = (track: string | null) => {
      const layer = layers?.find((one) => one.track === track);
      return layer ? `@${layer.frame.toFixed(1)} ×${layer.influence.toFixed(2)}` : undefined;
    };
    rows.push({ label: stack.armature, kind: 'armature', strips: [] });
    const activeAction = layers ? layers.find((one) => one.track === null)?.action ?? null : stack.action;
    const activeLive = influence(null);
    rows.push({ label: activeAction ? `[Action] ${activeAction}` : '[Action] (none)', kind: 'action', strips: [], ...(activeLive ? { live: activeLive } : {}) });
    for (const track of [...(stack.animation?.tracks ?? [])].reverse()) {
      const playingHere = influence(track.name);
      rows.push({
        label: track.name,
        kind: 'track',
        mute: track.mute,
        strips: track.strips.map((strip) => ({ name: strip.name, start: strip.start, end: strip.end, mute: strip.mute })),
        ...(playingHere ? { live: playingHere } : {}),
      });
    }
  }
  const height = SCRUB_HEIGHT + CHANNEL_HEIGHT * (rows.length + 1);
  const header = (
    <Header>
      {running ? <span data-testid="nla-live" style={{ color: TIMELINE_THEME.playhead }}>● game running: each playing track shows the game's frame and influence; the strips are the file's layout</span> : null}
    </Header>
  );
  return (
    <Frame header={header}>
      <div ref={ref} style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        <div style={{ display: 'flex', minHeight: height }}>
          <div style={{ width: CHANNELS_WIDTH, flex: `0 0 ${CHANNELS_WIDTH}px`, borderRight: `1px solid ${TIMELINE_CHROME.rule}` }}>
            <div style={{ height: SCRUB_HEIGHT, background: TIMELINE_THEME.scrubBack }} />
            {rows.map((row, i) => (
              <div
                key={`${row.label}${i}`}
                data-testid={`nla-row-${row.kind}`}
                style={{
                  height: CHANNEL_HEIGHT,
                  paddingLeft: row.kind === 'armature' ? 6 : 18,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  color: row.kind === 'armature' ? TIMELINE_CHROME.textHi : row.mute ? '#6a6a6a' : TIMELINE_CHROME.text,
                }}
              >
                {row.label}{row.live ? <span style={{ color: TIMELINE_THEME.playhead }}> {row.live}</span> : null}
              </div>
            ))}
          </div>
          <svg width={width} height={height} style={{ display: 'block' }} aria-label="NLA">
            <rect x={0} y={0} width={width} height={height} fill={TIMELINE_THEME.back} />
            <Grid majors={majors} toX={toX} width={width} height={height} />
            {rows.map((row, i) => {
              const y = SCRUB_HEIGHT + CHANNEL_HEIGHT * i + 2;
              return row.strips.map((strip) => (
                <g key={`${i}${strip.name}${strip.start}`}>
                  <rect
                    x={toX(strip.start)}
                    y={y}
                    width={Math.max(2, toX(strip.end) - toX(strip.start))}
                    height={CHANNEL_HEIGHT - 4}
                    rx={2}
                    fill={strip.mute || row.mute ? '#4a4a4a' : running ? (row.live ? '#5a7fb8' : '#555555') : '#7b7b7b'}
                    opacity={running ? 0.6 : 1}
                    stroke="#1a1a1a"
                  />
                  <text x={toX(strip.start) + 4} y={y + CHANNEL_HEIGHT - 7} fill="#ffffff" fontSize={10}>{strip.name}</text>
                </g>
              ));
            })}
            {running ? null : <Playhead x={toX(play.frame)} frame={play.frame} height={height} />}
          </svg>
        </div>
      </div>
    </Frame>
  );
}
