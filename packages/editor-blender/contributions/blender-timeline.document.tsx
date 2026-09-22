/**
 * THE TIMELINE — Blender's, at the bottom of the Model workspace (owner,
 * 2026-09-20: "doesn't blender have a timeline at the bottom?"). It does: the
 * default Layout screen's `DOPESHEET_EDITOR` in `TIMELINE` mode, and the model
 * editor is not Blender-shaped without it.
 *
 * ## It is an AREA, so it is an editor group
 *
 * RULED 2026-09-19 (orchestrator): "A Blender editor AREA is an editor group;
 * the drawer holds utilities." Blender's Layout screen puts the Timeline
 * full-width UNDER the 3D viewport, and `model.layout.ts` declares it as an
 * `areas` entry with Blender's own measured proportion. This is a
 * `workspace.document`, never a drawer utility.
 *
 * ## THREE.JS PLAYS IT; BLENDER HOLDS IT
 *
 * Owner rule, 2026-09-20: "we visualize with three.js, not Blender." The scrub
 * does NOT ask Blender to evaluate frame N and re-export the mesh — it moves an
 * `AnimationMixer` over a `SkinnedMesh` the presenter bound once
 * (`blender-runtime-skin.ts`), so a scrub and a played frame cost ZERO calls
 * into the engine. `state` reports `engineCalls` precisely so that claim is
 * checkable rather than asserted.
 *
 * Blender's `scene.frame_current` IS written — ONCE, on pause and at
 * scrub-end, through the RNA door — so bpy readers and the Properties rail
 * agree with what the person is looking at. Never per frame.
 *
 * ## Every constant it draws with is `./blender-timeline-geometry.ts`
 *
 * Read from Blender's source at the engine's pin AND confirmed against a pixel
 * in Blender's own frame — this is the first unit of the inspection arc with a
 * sighted read behind it (`scripts/blender-reference-frames.py`).
 *
 * ## It never edits, and every gesture that would is refused BY NAME
 *
 * Setting the range, inserting a key and moving a key all write the file.
 * `frame` is the ONE verb that changes anything, and what it changes is where
 * you are looking.
 */

import { blenderModelView } from '@volter/blender-engine/browser/three/blender-runtime-view';
import type { StageTransportHandle } from '@volter/editor-sdk/host';
import { registerViewVerbs } from '@volter/editor-sdk/views';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  blenderActionClip,
  blenderRig,
  blenderRnaVersion,
  subscribeBlenderRna,
} from '../host/blender-runtime-host';
import {
  refuseTimelineGesture,
  requestTimelineViewAll,
  setTimelineOnlySelected,
  setTimelineViewState,
  subscribeTimelineView,
  timelineViewAllRequest,
  timelineViewState,
  timelineViewVersion,
} from '../src/timeline-view-state';
import { blenderSkin, blenderSkinVersion, subscribeBlenderSkin } from './blender-runtime-skin';
import {
  CHANNEL_HEIGHT,
  DIAMOND_RADIUS,
  DIAMOND_SPRITE,
  DIAMOND_STROKE,
  FIRST_CHANNEL_TOP,
  gridStep,
  HEADER_HEIGHT,
  KEY_COLORS,
  KEY_SIZE_FACTOR,
  LABEL_PADDING,
  MIN_MAJOR_LINE_DISTANCE,
  minorStep,
  OUT_OF_RANGE,
  PLAYHEAD,
  SCRUB_HEIGHT,
  TIMELINE_CHROME,
  TIMELINE_THEME,
} from './blender-timeline-geometry';

export const point = 'workspace.document';
/** Blender's own name for this editor: `rna_space.cc`'s `SPACE_ACTION` item
 *  reads "Timeline" when `SpaceAction.mode` is `TIMELINE`
 *  (`rna_space.cc:257`), which is the mode the Layout workspace opens it in
 *  (measured on the engine: that screen's `DOPESHEET_EDITOR` area answers
 *  `ui_type: 'TIMELINE'`). */
export const title = 'Timeline';

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 200;

const REFUSALS = {
  'set-range':
    "Setting the frame range writes `scene.frame_start`/`frame_end`, which the document would save. This is Blender's Timeline as an INSPECTION surface: the range is drawn, never set. Change it in bpy and the Timeline re-reads it.",
  'insert-key':
    'Inserting a keyframe writes the action. Editing parity is not the program — key it in bpy (`pose_bone.keyframe_insert`) and the Timeline re-reads the action on the next present.',
  'move-key':
    "Moving a keyframe writes the F-Curve's control points. The summary row draws the keys the action HAS; the Dope Sheet that would move them is the Animation workspace's, and it is not built.",
  'delete-key': 'Deleting a keyframe writes the action. Editing parity is not the program.',
  'set-interpolation':
    "Setting a key's interpolation writes the F-Curve. Note also that this view PLAYS a per-frame bake (`rna_action_clip`), so interpolation is not a thing it reads back.",
  'select-key':
    'Selecting a keyframe writes `Keyframe.select_control_point`. The view draws the flags the data carries — a selected key takes `.common.anim.keyframe_selected` — and changes none of them.',
} as const;

/**
 * WHY A TRANSPORT GESTURE DOES NOTHING OVER A FILE WITH NO ACTION, in one
 * sentence, with ONE author: the `play` verb throws it and the header's
 * controls wear it as their title while they are disabled.
 *
 * It exists because the two halves disagreed. `vgai.timeline.play` refused by
 * name while the BUTTON called `transport()?.play()` straight through — the
 * clock went to `playing`, both glyphs flipped to Pause, and the playhead
 * stayed on frame 1 forever, because `#seek`/the play tick return early with
 * no mixer to move (`blender-runtime-skin.ts`). Measured on U8's walk 3
 * (2026-09-20) over a `--template models` scaffold: `vgai.timeline.state`
 * answered `action: null` with that warning while the header showed a running
 * transport. A control whose success can be invisible must say so.
 */
const NOT_PLAYABLE =
  'Nothing here is playable: no object in the scene carries an action this view could bind a mixer to.';

/**
 * THE TRANSPORT THIS LOOK DRIVES — the Model document's, attached by
 * `blenderSkin.attachTo` (Step 6). The Timeline cannot name a document id (it
 * binds to the `blenderModelView` singleton), so it reads the handle the skin
 * was given rather than looking one up.
 *
 * `null` before the Model document attaches. A gesture then refuses by name
 * instead of silently doing nothing — a Timeline with no transport is a
 * Timeline over nothing.
 */
function transport(): StageTransportHandle | null {
  return blenderSkin.transport;
}

function playing(): boolean {
  return transport()?.snapshot().playbackState === 'playing';
}

function refuse(text: string): unknown {
  refuseTimelineGesture(text);
  return report();
}

/** `Keyframe.type`'s significance order, as `session.py`'s `_KEY_TYPE_RANK`
 *  mirrors it from `keyframes_keylist.cc`'s `KEYFRAME_STATE` merge — a column
 *  drawn from several curves, or from several OBJECTS, takes the most
 *  significant type any of them carries. */
const KEY_TYPE_RANK: Record<string, number> = {
  JITTER: 1,
  GENERATED: 2,
  MOVING_HOLD: 3,
  BREAKDOWN: 4,
  KEYFRAME: 5,
  EXTREME: 6,
};

/**
 * THE SUMMARY ROW, FILTERED BY SELECTION — Blender's `show_keys_from_selected_only`.
 *
 * Blender's Timeline reads that flag off the SCENE (`ac->scene->flag &
 * SCE_KEYS_NO_SELONLY` → `ADS_FILTER_ONLYSEL`, `anim_filter.cc:254-270`) and
 * then skips any object whose base is not selected (`anim_filter.cc:2307`);
 * the surviving objects' channels are merged into ONE row by
 * `summary_to_keylist` (`keyframes_keylist.cc:1019`), which is the union of
 * frames with the most significant type and `sel` OR-ed — so this merges the
 * same way across objects that `session.py` already merges across curves.
 *
 * WHAT THE FILTER DOES NOT TOUCH is what PLAYS: the mixer holds the bound
 * action whatever the row draws, in Blender and here.
 *
 * The reference read is why the default is ON: with the probe's rig
 * unselected, Blender's own Timeline drew a ruler, a playhead, the range
 * shading and an EMPTY summary row while its Dope Sheet drew all five keys in
 * the same file.
 */
function summaryColumns(
  summary: ReturnType<typeof blenderSkin.state>['summary'],
  onlySelected: boolean,
): { columns: readonly { frame: number; type: string; select: boolean }[]; objects: string[] } {
  const objects: string[] = [];
  const merged = new Map<number, { frame: number; type: string; select: boolean }>();
  for (const entry of summary) {
    if (onlySelected && !entry.selected) continue;
    objects.push(entry.object);
    for (const column of entry.keyframes) {
      const existing = merged.get(column.frame);
      if (!existing) {
        merged.set(column.frame, { ...column });
        continue;
      }
      existing.select = existing.select || column.select;
      if ((KEY_TYPE_RANK[column.type] ?? 0) > (KEY_TYPE_RANK[existing.type] ?? 0))
        existing.type = column.type;
    }
  }
  return { columns: [...merged.values()].sort((a, b) => a.frame - b.frame), objects };
}

/** The frames the summary row is currently drawing — what `next-keyframe` and
 *  `prev-keyframe` navigate, because the row and the jump are the same
 *  question. Blender's `screen.keyframe_jump` builds its keylist through the
 *  very same filtered walk. */
function summaryFrames(): number[] {
  return summaryColumns(blenderSkin.state().summary, timelineViewState().onlySelected).columns.map(
    (column) => column.frame,
  );
}

/** THE ONE REPORT: the mixer's state plus what the drawing measured itself at.
 *  Both halves in one answer, because a caller asking "where is the playhead"
 *  and a caller asking "did the ruler step correctly" are the same caller. */
function report(): unknown {
  const view = timelineViewState();
  return {
    ...blenderSkin.state(),
    transform: view.transform,
    size: view.size,
    refusal: view.refusal,
    drawn: view.drawn,
  };
}

/** THE SCRUB. It moves the mixer and forces the bones' world matrices; the
 *  stage's own render loop draws the next frame from them. Blender is not
 *  called — `state().engineCalls` is how that is checked.
 *
 *  IT REFUSES OVER A FILE WITH NO ACTION, for the reason {@link NOT_PLAYABLE}
 *  states and with that one sentence: `#seek` returns at its first line with
 *  no mixer (`blender-runtime-skin.ts`), so the seek was a no-op and
 *  `report()` then answered `frame: 1` — the playhead's honest position and a
 *  complete lie about the gesture. Measured on walk 5 over a fresh
 *  `model-editor create` scaffold: `vgai.timeline.frame {frame:120}` and
 *  `vgai.timeline.jump-end` (frame 250) both answered `frame: 1`,
 *  `refusal: null`. This is the half of walk 4's W5 (#7740) that the header
 *  got and the VERBS did not — there the buttons were disabled wearing this
 *  sentence as their title while `play` threw it, and the five verbs that
 *  route through here kept answering as if they had moved something. All five
 *  are fixed by this one guard: `frame`, `jump-start`, `jump-end`,
 *  `next-keyframe`, `prev-keyframe`. */
function scrubTo(frame: number): unknown {
  if (!blenderSkin.playable) return refuse(NOT_PLAYABLE);
  const handle = transport();
  if (!handle) return refuse('No stage transport is attached yet; open the model document first.');
  handle.seekFrame(frame);
  return report();
}

registerViewVerbs({
  view: 'timeline',
  title,
  verbs: [
    { id: 'state', run: () => report() },
    {
      id: 'frame',
      title: 'Timeline: Set Frame',
      run: (args) => {
        const frame = Number(args?.['frame'] ?? args?.['to']);
        if (!Number.isFinite(frame))
          throw new Error('frame needs a numeric `frame` — a Blender frame number.');
        return scrubTo(frame);
      },
    },
    {
      id: 'play',
      title: 'Timeline: Play',
      run: () => {
        if (!blenderSkin.playable) throw new Error(NOT_PLAYABLE);
        const handle = transport();
        if (!handle)
          throw new Error('No stage transport is attached yet; open the model document first.');
        handle.play();
        return report();
      },
    },
    {
      id: 'pause',
      title: 'Timeline: Pause',
      run: () => {
        // The bookmark write is no longer this look's: pausing SETTLES the
        // transport, and the skin's `onSettled` subscription is what writes
        // `frame_current` once.
        const handle = transport();
        if (!handle) return refuse('No stage transport is attached yet.');
        handle.pause();
        return report();
      },
    },
    {
      id: 'jump-start',
      title: 'Timeline: Jump to Start',
      run: () => scrubTo(blenderSkin.state().start),
    },
    {
      id: 'jump-end',
      title: 'Timeline: Jump to End',
      run: () => scrubTo(blenderSkin.state().end),
    },
    {
      id: 'next-keyframe',
      title: 'Timeline: Next Keyframe',
      run: () => {
        const frame = blenderSkin.frame();
        const next = summaryFrames().find((key) => key > frame + 1e-4);
        if (next === undefined) return report();
        return scrubTo(next);
      },
    },
    {
      id: 'prev-keyframe',
      title: 'Timeline: Previous Keyframe',
      run: () => {
        const frame = blenderSkin.frame();
        const previous = summaryFrames()
          .reverse()
          .find((key) => key < frame - 1e-4);
        if (previous === undefined) return report();
        return scrubTo(previous);
      },
    },
    {
      id: 'view-all',
      title: 'Timeline: View All',
      run: () => {
        requestTimelineViewAll();
        return report();
      },
    },
    {
      id: 'zoom',
      title: 'Timeline: Zoom',
      run: (args) => {
        const to = Number(args?.['to'] ?? args?.['zoom']);
        if (!Number.isFinite(to))
          throw new Error('zoom needs a numeric `to` — CSS pixels per frame, 0.25 … 200.');
        const { transform, size } = timelineViewState();
        const centre = transform.startFrame + size.w / 2 / transform.pixelsPerFrame;
        const pixelsPerFrame = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, to));
        setTimelineViewState({
          transform: { pixelsPerFrame, startFrame: centre - size.w / 2 / pixelsPerFrame },
        });
        return report();
      },
    },
    {
      id: 'pan',
      title: 'Timeline: Pan',
      run: (args) => {
        const frames = Number(args?.['frames'] ?? 0);
        if (!Number.isFinite(frames)) throw new Error('pan needs a numeric `frames`.');
        const { transform } = timelineViewState();
        setTimelineViewState({
          transform: { ...transform, startFrame: transform.startFrame + frames },
        });
        return report();
      },
    },
    ...(Object.keys(REFUSALS) as (keyof typeof REFUSALS)[]).map((id) => ({
      id,
      run: () => refuse(REFUSALS[id]),
    })),
  ],
});

export default function BlenderTimeline() {
  // THE FRESHNESS IS THE RNA DOOR'S (ruling 3, 2026-09-19): every write and
  // every presented frame bumps it, which is exactly when a rig or an action
  // can have moved.
  const rnaVersion = useSyncExternalStore(
    subscribeBlenderRna,
    blenderRnaVersion,
    blenderRnaVersion,
  );
  useSyncExternalStore(subscribeBlenderSkin, blenderSkinVersion, blenderSkinVersion);
  useSyncExternalStore(subscribeTimelineView, timelineViewVersion, timelineViewVersion);
  const canvas = useRef<HTMLDivElement | null>(null);
  const framed = useRef(-1);
  const { transform, size, refusal, onlySelected } = timelineViewState();
  const play = blenderSkin.state();

  // THE BIND LIVES WITH THE TIMELINE, not with every present, and that is a
  // cost decision stated rather than implied: `rna_rig` walks every vertex of
  // every rigged mesh and `rna_action_clip` bakes every bone per frame, so
  // paying for both on each of a session's hundreds of `blender-execute`
  // presents would be a round trip nobody asked for. A project with no
  // Timeline open therefore presents exactly as it did before this unit, with
  // ordinary `THREE.Mesh`es.
  useEffect(() => {
    let live = true;
    void blenderSkin
      .bind(blenderModelView, {
        rig: () => blenderRig(),
        clip: () => blenderActionClip(),
      })
      .catch((thrown: unknown) => {
        if (!live) return;
        refuseTimelineGesture(
          `The Timeline could not read this file's rig: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
        );
      });
    return () => {
      live = false;
    };
  }, [rnaVersion]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const next = { w: element.clientWidth, h: element.clientHeight };
      const current = timelineViewState().size;
      if (current.w !== next.w || current.h !== next.h) setTimelineViewState({ size: next });
    });
    observer.observe(element);
    setTimelineViewState({ size: { w: element.clientWidth, h: element.clientHeight } });
    return () => observer.disconnect();
  }, []);

  // VIEW ALL — Blender's `action.view_all` over the SCENE range with the same
  // margin its own `view_all` uses; the ASK is a counter because framing needs
  // the measured box, which the verb does not have.
  const request = timelineViewAllRequest();
  useEffect(() => {
    // `framed` starts at −1 so the FIRST pass frames and every later one waits
    // for a real ask. It was `0` against a request counter that also starts at
    // 0, with a `request !== 0` escape — which re-framed on every render and
    // was one of the two feedback loops the first walk found.
    if (request === framed.current) return;
    framed.current = request;
    const { w } = timelineViewState().size;
    if (w === 0) return;
    const span = Math.max(1, play.end - play.start);
    const pixelsPerFrame = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (w * 0.9) / span));
    setTimelineViewState({
      transform: { pixelsPerFrame, startFrame: play.start - (w * 0.05) / pixelsPerFrame },
      framedAt: Date.now(),
    });
  }, [request, play.start, play.end]);

  const toX = useCallback(
    (frame: number) => (frame - transform.startFrame) * transform.pixelsPerFrame,
    [transform],
  );
  const toFrame = useCallback(
    (x: number) => transform.startFrame + x / transform.pixelsPerFrame,
    [transform],
  );

  // THE SUMMARY ROW'S OWN COLUMNS — the door's per-object report put through
  // Blender's selection filter. `play.keyframes` is the SUBJECT's action and
  // stays what the mixer plays; this is what the row DRAWS.
  const summary = useMemo(
    () => summaryColumns(play.summary, onlySelected),
    [play.summary, onlySelected],
  );

  const ruler = useMemo(() => {
    if (size.w === 0) return null;
    const viewFrames = size.w / transform.pixelsPerFrame;
    // `get_min_line_distance_x` (`view2d_draw.cc:485`): the larger of
    // `MIN_MAJOR_LINE_DISTANCE` and the widest label plus its padding. The
    // label is a frame integer at 11 px, and Blender measures the string it
    // would actually draw at both ends of the view.
    const widest = Math.max(
      `${Math.round(transform.startFrame)}`.length,
      `${Math.round(transform.startFrame + viewFrames)}`.length,
    );
    const minDistance = Math.max(MIN_MAJOR_LINE_DISTANCE, widest * 6 + LABEL_PADDING);
    // `base` is the scene FPS: `ED_time_scrub_draw` passes it
    // (`space_action.cc:296-298`), which is why Blender's ruler prefers
    // second-aligned steps.
    const major = gridStep(Math.round(play.fps), size.w + 1, viewFrames, minDistance);
    const minor = minorStep(major);
    const first = Math.ceil(transform.startFrame / major) * major;
    const majors: number[] = [];
    for (let frame = first; frame <= transform.startFrame + viewFrames; frame += major)
      majors.push(frame);
    const minors: number[] = [];
    // `view2d_draw_lines` (`view2d_draw.cc:273-275`): the minor lines draw
    // only while `(pixel_width / view_width) * (major / divisor)` — the minor
    // step's own PIXEL distance — stays above `MIN_MAJOR_LINE_DISTANCE / 5`.
    // It is the STEP's distance, not the frame's; dropping the step from the
    // product hid every minor line at any zoom below 7 px per frame, which is
    // most of them (measured on the probe: 4.76 px/frame, minor step 6, so
    // 28.6 px between minor lines against a 7-px floor).
    if (minor !== null && minor * transform.pixelsPerFrame >= MIN_MAJOR_LINE_DISTANCE / 5) {
      const firstMinor = Math.ceil(transform.startFrame / minor) * minor;
      for (let frame = firstMinor; frame <= transform.startFrame + viewFrames; frame += minor)
        if (Math.abs(frame / major - Math.round(frame / major)) > 1e-6) minors.push(frame);
    }
    return { major, minor, majors, minors };
  }, [size.w, transform, play.fps]);

  const bodyTop = SCRUB_HEIGHT;
  const rowTop = FIRST_CHANNEL_TOP;
  const rowCentre = rowTop + CHANNEL_HEIGHT / 2;

  // WHAT THE VIEW ACTUALLY DREW, published so a parity table is a measurement
  // of the shipped drawing rather than a second run of the same arithmetic.
  useEffect(() => {
    if (!ruler) return;
    const warnings: string[] = [...play.warnings];
    if (!play.action)
      warnings.push(
        "Nothing in this file carries an action, so the summary row is empty — which is Blender's own empty state for a Timeline over a still file.",
      );
    warnings.push(
      'While a clip plays, the picture is three.js evaluating the skin over the mesh columns Blender exported at the BIND frame. Anything else Blender would re-evaluate per frame — shape keys, a Displace or Cloth modifier reading the frame, a geometry driver — does not follow the playhead.',
    );
    warnings.push(
      `Blender puts this view's ONLY-SHOW-SELECTED toggle in the Timeline header's View MENU (\`TIME_MT_view\`'s \`layout.prop(scene, "show_keys_from_selected_only")\`, \`space_time.py\`); this header has no menu region, so the same toggle is drawn as a header button at the leading edge, where that menu sits. The filter itself is Blender's — \`ADS_FILTER_ONLYSEL\`, \`anim_filter.cc:254-270\`, tested per object at \`:2307\`.`,
    );
    if (onlySelected && summary.objects.length === 0 && play.summary.length > 0)
      warnings.push(
        `The summary row is empty because nothing animated is SELECTED, which is Blender's own answer with this filter on. ${play.summary.map((entry) => entry.object).join(', ')} carr${play.summary.length === 1 ? 'ies' : 'y'} an action; select it, or turn the filter off.`,
      );
    warnings.push(
      "Markers, the cache bar and the preview range are drawn by Blender's Timeline and not here; the door carries none of them.",
    );
    const next = {
      drawn: {
        action: play.action,
        object: play.object,
        armature: play.armature,
        frame: play.frame,
        start: play.start,
        end: play.end,
        fps: play.fps,
        playing: playing(),
        keyframes: summary.columns.map((key) => key.frame),
        onlySelected,
        summaryObjects: summary.objects,
        majorStep: ruler.major,
        minorStep: ruler.minor,
        majorLines: ruler.majors.length,
        minorLines: ruler.minors.length,
        labels: ruler.majors.length,
        diamonds: summary.columns.length,
        diamondRadius: DIAMOND_RADIUS,
        diamondSprite: DIAMOND_SPRITE,
        bones: play.bones,
        tracks: play.tracks,
        engineCalls: play.engineCalls,
        warnings,
      },
    };
    // PUBLISHED ONLY WHEN IT CHANGED, and that is not an optimisation — it is
    // the fix for a REAL LOOP the first walk found: this effect's inputs
    // include `play`, which is a fresh object every render, so an
    // unconditional publish re-rendered, which re-ran the effect, which
    // published again. React caught it by name ("Maximum update depth
    // exceeded ... Tool crashed: blender-timeline.document.tsx") and the whole
    // area painted the crash card instead of a Timeline. A published
    // measurement is a VALUE, so comparing values is what stops it.
    if (JSON.stringify(next.drawn) !== JSON.stringify(timelineViewState().drawn))
      setTimelineViewState(next);
  }, [ruler, play, summary, onlySelected]);

  const dragging = useRef(false);
  const scrubFromPointer = useCallback(
    (clientX: number) => {
      const element = canvas.current;
      if (!element) return;
      const box = element.getBoundingClientRect();
      transport()?.seekFrame(Math.round(toFrame(clientX - box.left)));
    },
    [toFrame],
  );

  const pillText = `${Math.round(play.frame)}`;
  const pillWidth = Math.max(PLAYHEAD.minPillWidth, pillText.length * 6 + 2 * PLAYHEAD.textPadding);
  const playheadX = toX(play.frame);

  return (
    <div
      data-testid="blender-timeline"
      style={{
        // FILLED FROM THE HOST BOX, NOT `height: 100%` — the measured
        // difference between a drawer panel and an EDITOR GROUP that the UV
        // view's walk found: in an area's auto-height content box `100%`
        // resolves to ZERO and the view reads everything it needs with nowhere
        // to draw it.
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
      <TimelineHeader />
      <div ref={canvas} style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <svg
          width={size.w}
          height={size.h}
          style={{ display: 'block', cursor: 'ew-resize' }}
          aria-label="Timeline"
          onPointerDown={(event) => {
            dragging.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            scrubFromPointer(event.clientX);
          }}
          onPointerMove={(event) => {
            if (dragging.current) scrubFromPointer(event.clientX);
          }}
          onPointerUp={(event) => {
            dragging.current = false;
            event.currentTarget.releasePointerCapture(event.pointerId);
            // NOTHING IS WRITTEN HERE. Scrub-end is the TRANSPORT's — the
            // quiet after the last seek settles it, and the skin's `onSettled`
            // subscription writes `frame_current` once. A second write here
            // would race that one and re-introduce the per-gesture double
            // write this step removed.
          }}
        >
          <title>Timeline</title>
          {/* THE REGION'S CLEAR, then the OUT-OF-RANGE shading over it
              (`ANIM_draw_framerange`, `anim_draw.cc:172-190`). */}
          <rect x={0} y={0} width={size.w} height={size.h} fill={TIMELINE_THEME.back} />
          <rect
            x={0}
            y={bodyTop}
            width={Math.max(0, toX(play.start))}
            height={Math.max(0, size.h - bodyTop)}
            fill={OUT_OF_RANGE}
          />
          <rect
            x={toX(play.end)}
            y={bodyTop}
            width={Math.max(0, size.w - toX(play.end))}
            height={Math.max(0, size.h - bodyTop)}
            fill={OUT_OF_RANGE}
          />
          {/* THE GRID — minor first, then major, the order
              `view2d_draw_lines` uses (`view2d_draw.cc:260-292`). */}
          {ruler?.minors.map((frame) => (
            <line
              key={`n${frame}`}
              x1={toX(frame)}
              y1={bodyTop}
              x2={toX(frame)}
              y2={size.h}
              stroke={TIMELINE_THEME.gridMinor}
              strokeWidth={1}
            />
          ))}
          {ruler?.majors.map((frame) => (
            <line
              key={`m${frame}`}
              x1={toX(frame)}
              y1={bodyTop}
              x2={toX(frame)}
              y2={size.h}
              stroke={TIMELINE_THEME.grid}
              strokeWidth={1}
            />
          ))}
          {/* THE SCRUB STRIP — `ED_time_scrub_draw`'s own background
              (`time_scrub_ui.cc:52-65`, `TH_TIME_SCRUB_BACKGROUND`). */}
          <rect x={0} y={0} width={size.w} height={SCRUB_HEIGHT} fill={TIMELINE_THEME.scrubBack} />
          {ruler?.majors.map((frame) => (
            <text
              key={`t${frame}`}
              x={toX(frame)}
              y={15.5}
              textAnchor="middle"
              fill={TIMELINE_THEME.scrubText}
              // `draw_horizontal_scale_indicators` (`view2d_draw.cc:340-348`):
              // the baseline is `rect.ymin + 4 * UI_SCALE_FAC` and the label is
              // centred on the line by `x − trunc(width / 2)`. Confirmed in
              // Blender's frame: the glyph rows are 34…41 under a 26-px header,
              // i.e. a baseline 15.5 px below the region's top edge.
              fontSize={11}
            >
              {Math.round(frame)}
            </text>
          ))}
          {/* THE SUMMARY ROW'S DISCLOSURE TRIANGLE, at the region's leading
              edge — Blender draws one there for the collapsed summary channel
              (`ANIM_channel_draw`'s expand icon; measured on Blender 5.2.0 LTS
              as a small `>` at x~4 on the channel row). It is DRAWN, not
              clickable: expanding the summary would list per-object channels,
              which is the Dope Sheet's job and is not built — the same reason
              `insert-key` and friends are recorded refusals rather than
              controls. */}
          <path
            d={`M3,${rowCentre - 3.5} L6.5,${rowCentre} L3,${rowCentre + 3.5} Z`}
            fill={TIMELINE_THEME.scrubText}
          />
          {/* THE SUMMARY ROW'S KEYS. Blender's Timeline draws exactly one
              channel — see `TIMELINE_ROWS` for the two source facts that make
              that so — and its diamonds are the shader's shape. The columns
              are the SELECTION-FILTERED merge (`summaryColumns`), which is
              what `show_keys_from_selected_only` decides; the action the mixer
              plays is `play.keyframes` and is unaffected. */}
          {summary.columns.map((key) => {
            const factor = KEY_SIZE_FACTOR[key.type] ?? 1;
            const radius = DIAMOND_RADIUS * factor;
            const colors = KEY_COLORS[key.type] ?? KEY_COLORS['KEYFRAME']!;
            const x = toX(key.frame);
            return (
              <polygon
                key={`k${key.frame}`}
                points={`${x},${rowCentre - radius} ${x + radius},${rowCentre} ${x},${rowCentre + radius} ${x - radius},${rowCentre}`}
                fill={key.select ? colors.selected : colors.fill}
                stroke={TIMELINE_THEME.keyBorder}
                strokeWidth={DIAMOND_STROKE * factor}
              />
            );
          })}
          {/* THE PLAYHEAD: stalk, pill, number, tip — `draw_playhead_stalk` /
              `_box` / `_tip` (`time_scrub_ui.cc:118-206`). */}
          <rect
            x={playheadX - PLAYHEAD.stalkWidth / 2}
            y={SCRUB_HEIGHT}
            width={PLAYHEAD.stalkWidth}
            height={Math.max(0, size.h - SCRUB_HEIGHT)}
            fill={TIMELINE_THEME.playhead}
          />
          <rect
            x={playheadX - pillWidth / 2}
            y={PLAYHEAD.margin}
            width={pillWidth}
            height={SCRUB_HEIGHT - 2 * PLAYHEAD.margin}
            rx={PLAYHEAD.radius}
            fill={TIMELINE_THEME.playhead}
          />
          <polygon
            points={`${playheadX - PLAYHEAD.tipHalfWidth},${SCRUB_HEIGHT - PLAYHEAD.margin} ${playheadX + PLAYHEAD.tipHalfWidth},${SCRUB_HEIGHT - PLAYHEAD.margin} ${playheadX},${SCRUB_HEIGHT - PLAYHEAD.margin + PLAYHEAD.tipHeight}`}
            fill={TIMELINE_THEME.playhead}
          />
          <text
            x={playheadX}
            y={15.5}
            textAnchor="middle"
            fill={TIMELINE_THEME.playheadText}
            fontSize={11}
          >
            {pillText}
          </text>
        </svg>
      </div>
      {refusal ? (
        <div
          style={{
            borderTop: `1px solid ${TIMELINE_CHROME.rule}`,
            padding: TIMELINE_CHROME.statusPadding,
            color: TIMELINE_CHROME.refusal,
          }}
        >
          {refusal}
        </div>
      ) : null}
    </div>
  );
}

/**
 * THE HEADER — `space_time.py`'s `playback_controls`, read as the
 * SPECIFICATION of what to draw and never run (the standing ruling). Its order
 * is that function's, top to bottom: the Playback popover, a spacer, the
 * auto-key toggle, the SIX transport buttons
 * (`screen.frame_jump` REW → `screen.keyframe_jump` PREV_KEYFRAME →
 * `screen.animation_play` PLAY_REVERSE → PLAY → `keyframe_jump` NEXT_KEYFRAME
 * → `frame_jump` FF), the time-jump pair, the snap toggle, a spacer, the frame
 * field, and the Start/End pair.
 *
 * WHAT IS DRAWN AND WHAT IS NOT. The six transport buttons and the frame field
 * are real — they are the scrub, which is the one thing this surface changes.
 * Start and End are READ-ONLY readouts, because writing them writes the file
 * (`set-range` refuses by name). The Playback and snap popovers are not drawn
 * at all: every control in them sets a preference or a tool setting that this
 * view does not read, and a popover that opens onto nothing is worse than an
 * absent one. Named here rather than painted.
 *
 * THE BUTTONS ARE 20 px — `UI_UNIT_X` (`wm_window.cc:779`'s `widget_unit`),
 * confirmed in Blender's own frame: the block of six spans exactly 120 px.
 * Their glyphs are TRACED from Blender's own icon sources the way I2's tab
 * glyphs are — see `blender-icons.source.mjs`; until that trace covers the
 * transport family they are drawn here as the plain geometric marks
 * `release/datafiles/icons_svg/{rew,prev_keyframe,play,ff}.svg` are built from
 * (a triangle, a triangle with a bar, a pair), which is a KNOWN gap and is in
 * the view's own warnings rather than implied to be Blender's mark.
 */
/**
 * THE VIEW MENU — Blender's `TIME_MT_view`, and the reason this exists is a
 * deviation the old header admitted in its own comment: `show_keys_from_selected_only`
 * belongs in a View MENU (`space_time.py`'s `layout.prop`), and with no menu
 * region it was drawn as a lone toggle at the leading edge instead.
 *
 * Measured against Blender 5.2.0 LTS at 1728x997: its header's leading cluster
 * is an editor-type dropdown then `View`, `Marker` and `Playback`. This builds
 * `View` and ONLY `View`, because View is the one whose items this surface
 * actually has — `Only Show Selected` and `Frame All`. `Marker` and `Playback`
 * would be empty shells over behaviour that does not exist here, and a menu
 * that exists to look like Blender is exactly the invented affordance the
 * program forbids. Their absence is a STATED gap in WORK.md, not a pretence.
 */
function TimelineViewMenu() {
  useSyncExternalStore(subscribeTimelineView, timelineViewVersion, timelineViewVersion);
  const { onlySelected } = timelineViewState();
  const [open, setOpen] = useState(false);
  const item = (label: string, checked: boolean | null, run: () => void) => (
    <button
      type="button"
      onClick={() => {
        run();
        setOpen(false);
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--vgai-space-2)',
        width: '100%',
        padding: 'var(--vgai-space-1) var(--vgai-space-3)',
        border: 'none',
        background: 'transparent',
        color: TIMELINE_CHROME.widgetText,
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <span style={{ width: 12, display: 'inline-block' }}>
        {checked === null ? '' : checked ? '✓' : ''}
      </span>
      {label}
    </button>
  );
  return (
    <span style={{ position: 'relative' }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        style={{
          border: 'none',
          background: 'transparent',
          color: TIMELINE_CHROME.text,
          font: 'inherit',
          padding: '0 var(--vgai-space-2)',
          cursor: 'pointer',
        }}
      >
        View
      </button>
      {open ? (
        <span
          role="menu"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 20,
            minWidth: 210,
            display: 'flex',
            flexDirection: 'column',
            background: TIMELINE_CHROME.widget,
            border: `1px solid ${TIMELINE_CHROME.widgetOutline}`,
            boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
          }}
        >
          {item('Only Show Selected', onlySelected, () => setTimelineOnlySelected(!onlySelected))}
          {item('Frame All', null, () => requestTimelineViewAll())}
        </span>
      ) : null}
    </span>
  );
}

function TimelineHeader() {
  useSyncExternalStore(subscribeBlenderSkin, blenderSkinVersion, blenderSkinVersion);
  useSyncExternalStore(subscribeTimelineView, timelineViewVersion, timelineViewVersion);
  const play = blenderSkin.state();
  const unit = TIMELINE_CHROME.unit;
  // THE TRANSPORT IS ONLY AS TRUE AS THE FILE. With no action there is no
  // mixer, so every seek and the play tick return early; a control that still
  // accepted the click reported a state the picture never took (see
  // NOT_PLAYABLE). Disabled, wearing the reason as its title, is what the
  // `play` verb already answers.
  const playable = blenderSkin.playable;
  const button = (key: string, glyph: ReactNode, onClick: () => void, label: string) => (
    <button
      key={key}
      type="button"
      title={playable ? label : `${label} — ${NOT_PLAYABLE}`}
      aria-label={label}
      disabled={!playable}
      onClick={onClick}
      style={{
        width: unit,
        height: unit,
        padding: 0,
        border: `1px solid ${TIMELINE_CHROME.widgetOutline}`,
        background: TIMELINE_CHROME.widget,
        color: TIMELINE_CHROME.widgetText,
        display: 'grid',
        placeItems: 'center',
        cursor: playable ? 'pointer' : 'not-allowed',
        opacity: playable ? 1 : 0.4,
      }}
    >
      {glyph}
    </button>
  );
  const mark = (path: string) => (
    <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden="true">
      <path d={path} fill={TIMELINE_CHROME.widgetText} />
    </svg>
  );
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
      <span style={{ color: TIMELINE_CHROME.text }}>Timeline</span>
      <TimelineViewMenu />
      {/* TWO SPACERS, which is what CENTRES the transport. Blender's Timeline
          header is three clusters: the menus at the leading edge, the
          transport in the MIDDLE, and the frame/range fields trailing
          (measured against Blender 5.2.0 LTS at 1728x997 — its transport sits
          at roughly x 860-1160 of 2832, dead centre; ours was hard against
          the right edge beside the frame field). */}
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex' }}>
        {button(
          'jump-start',
          mark('M2 2h1.5v8H2zM10 2v8L4.5 6z'),
          () => transport()?.seekFrame(play.start),
          'Jump to Start',
        )}
        {/* PREV/NEXT KEYFRAME are a DOUBLE triangle in Blender, distinct from
            jump-to-start/end's bar-and-triangle. We drew the same path for
            both, so four buttons carried two glyphs and a person could not
            tell "go to the start" from "go to the previous key" — caught by
            putting our header beside Blender's, not by reading the code. */}
        {button(
          'prev-key',
          mark('M5 2.5v7L1.5 6zM8.5 3.2L11 6L8.5 8.8L6 6z'),
          () => {
            const previous = summaryFrames()
              .reverse()
              .find((key) => key < blenderSkin.frame() - 1e-4);
            if (previous !== undefined) transport()?.seekFrame(previous);
          },
          'Jump to Previous Keyframe',
        )}
        {/* PLAY REVERSE, which Blender has beside play and we did not. The
            engine's clock has carried the direction all along
            (`AnimationClock.play(direction)`); nothing new is invented here,
            the button just asks for the arm that already existed. */}
        {playable && playing()
          ? button('pause-rev', mark('M3 2h2v8H3zM7 2h2v8H7z'), () => transport()?.pause(), 'Pause')
          : button(
              'play-reverse',
              mark('M9 2L2 6l7 4z'),
              () => transport()?.play('reverse'),
              'Play Reverse',
            )}
        {playable && playing()
          ? button('pause', mark('M3 2h2v8H3zM7 2h2v8H7z'), () => transport()?.pause(), 'Pause')
          : button('play', mark('M3 2l7 4-7 4z'), () => transport()?.play(), 'Play')}
        {button(
          'next-key',
          mark('M7 2.5v7L10.5 6zM3.5 3.2L6 6L3.5 8.8L1 6z'),
          () => {
            const next = summaryFrames().find((key) => key > blenderSkin.frame() + 1e-4);
            if (next !== undefined) transport()?.seekFrame(next);
          },
          'Jump to Next Keyframe',
        )}
        {button(
          'jump-end',
          mark('M10 2H8.5v8H10zM2 2v8L7.5 6z'),
          () => transport()?.seekFrame(play.end),
          'Jump to End',
        )}
      </div>
      {/* THE FRAME-STEP PAIR, Blender's second transport group: one frame back
          and one frame forward. `seekFrame` already clamps into the clip's
          range, so the ends need no special case here. */}
      <div style={{ display: 'flex' }}>
        {button(
          'step-back',
          mark('M2 2h1.5v8H2zM9.5 2v8L4.5 6z'),
          () => transport()?.seekFrame(Math.round(play.frame) - 1),
          'Step Back One Frame',
        )}
        {button(
          'step-forward',
          mark('M10 2H8.5v8H10zM2.5 2v8L7.5 6z'),
          () => transport()?.seekFrame(Math.round(play.frame) + 1),
          'Step Forward One Frame',
        )}
      </div>
      <div style={{ flex: 1 }} />
      {/* THE FRAME FIELD accepts a typed number — the one control on this
          header that writes anything, and what it writes is where you are
          looking. `scale_x = 0.95` on a `UI_UNIT_X` base is 76 px
          (`space_time.py`'s `row.prop(scene, "frame_current")`); Blender's own
          frame measures 75. */}
      <input
        type="number"
        value={Math.round(play.frame)}
        onChange={(event) => {
          const frame = Number(event.target.value);
          if (Number.isFinite(frame)) transport()?.seekFrame(frame);
        }}
        aria-label="Current frame"
        disabled={!playable}
        title={playable ? undefined : NOT_PLAYABLE}
        style={{
          width: 75,
          height: unit,
          textAlign: 'center',
          border: `1px solid ${TIMELINE_CHROME.widgetOutline}`,
          borderRadius: TIMELINE_CHROME.widgetRadius,
          background: TIMELINE_CHROME.widget,
          color: TIMELINE_CHROME.widgetText,
          font: 'inherit',
          cursor: playable ? 'text' : 'not-allowed',
          opacity: playable ? 1 : 0.4,
        }}
      />
      {/* START AND END ARE READ-ONLY. Writing them writes the file. */}
      <span
        onClick={() => refuseTimelineGesture(REFUSALS['set-range'])}
        onKeyDown={() => undefined}
        style={{ color: TIMELINE_CHROME.text, cursor: 'not-allowed' }}
      >
        Start {play.start} · End {play.end}
      </span>
    </div>
  );
}
