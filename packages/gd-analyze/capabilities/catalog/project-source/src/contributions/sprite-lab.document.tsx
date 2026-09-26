/**
 * SPRITE LAB — the `Sprites` workspace document. This file is YOURS.
 *
 * WHAT IT IS FOR. 2D art is judged by LOOKING at it moving, and until this
 * existed the only ways to look at a vgai game's sprites were the bake's
 * written-to-disk contact sheets and the game itself. This is the 2D peer of
 * the bird Builder and of a GLB opened in Asset Lab: the frames, playing, at
 * baked scale and zoomed, over the alpha checker or either ground, with the
 * filmstrip and the facts beside them.
 *
 * TWO SUBJECTS, AND THE MENTAL MODEL. A spritesheet is a MATERIAL — committed
 * declarative data, previewed live, not edited here. The rig program
 * (`src/tools/sprite-bake/rigs.ts`) is a SHADER — a program whose output is
 * rendered live, and which you edit at its source. Picking the program subject
 * poses and rasterizes every frame in the browser through the same `poseToSvg`
 * call the bake makes, so the stage shows what the atlas WILL contain; picking
 * a sheet loads the atlas the game actually plays, through the kit's own
 * runtime loader. `sprite-lab/subjects.ts` holds both loaders.
 *
 * THE CHROME IS THE EDITOR'S OWN. Every control here is a design-system
 * component from `@editor/widgets` — `Button`, `Text`, `EditorToolbar`,
 * `EditorSurface`, `Stack`/`Inline`, `FieldGroup` — which is the one
 * sanctioned deep import project tools have, and the reason a capability's
 * document re-skins with the editor instead of drifting into a look of its
 * own. There is no bespoke palette, no hand-rolled button and no px font size
 * in this file; if something needs a treatment the kit does not have, the kit
 * is what should grow.
 *
 * THIS DOCUMENT IS SIGHT, NOT EDITING. No pixel editing, no rect editing, no
 * JSON writing, and no parameter sliders (no shipped rig takes one). The one
 * thing it writes is the bake, and it writes that by invoking the registered
 * `project.sprites.bake` — the same callable a terminal runs — never by
 * touching a file itself.
 *
 * DESIGN-TIME TRANSPORT. Pause here pauses the PREVIEW, not a game: the
 * `AnimatedSprite` is `autoUpdate: false` and advanced from the Application's
 * own ticker, which is also what a game-time sprite does (`lib/sprite/
 * runtime.ts`) — the difference is only whose clock drives it.
 *
 * THE STAGE IS PLAIN PIXI, NOT `@pixi/react`, and that is a boundary rather
 * than a taste: this document renders inside the EDITOR's React tree, where
 * `@pixi/react`'s hooks come from the wrong React on a packaged editor. The
 * whole reason, with the measurement, is in `sprite-lab/stage.ts`'s header.
 * Game-time sprites are unaffected — `lib/sprite/runtime.ts` renders in the
 * GAME's own React and keeps `useTick`.
 */

import {
  Button,
  EditorSurface,
  EditorToolbar,
  FieldGroup,
  Inline,
  Spacer,
  Stack,
  StateSurface,
  Text,
  ToolbarDivider,
  ToolbarGroup,
} from '@editor/widgets';
import type { ToolContributionProps } from '@vgai/editor-sdk/contributions';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  animationSubjects,
  bestCycleSet,
  type CycleSetConformance,
  splitAnimationName,
} from '../lib/sprite/cycles';
import type { SpriteBakeSpec, SpriteRigModule } from '../lib/sprite/svg-rig';
import {
  CHECKER_DARK,
  CHECKER_LIGHT,
  CHECKER_SIZE,
  createSpriteStage,
  type SpriteStage,
  type SpriteStageView,
  STAGE_GROUNDS,
  type StageGround,
  stageBox,
} from './sprite-lab/stage';
import {
  type AtlasProvenance,
  discoverSheetRefs,
  type LabAnimation,
  type LabFrame,
  type LabSubject,
  type LabSubjectRef,
  loadAtlasProvenance,
  loadProgramSubject,
  loadSheetSubject,
} from './sprite-lab/subjects';
import { fitScale, onionFrame, stepFrame } from './sprite-lab/timeline';

/** Editor placement — the module declares its own. */
export const point = 'workspace.document';

/** §8: the title is the SUBJECT, never a technology bucket. */
export const title = 'Sprites';

/** The registered callable this document drives — its `Bake` button. */
export const tool = 'project.sprites.bake';

/**
 * The project's own rig module, by convention — the SAME constant, at the same
 * directory depth, that `sprite-bake.tool.ts` loads it by. It is held in a
 * variable rather than written inline for the same reason it is there: this
 * file ships in the capability DISTRIBUTION, where that project file does not
 * exist, and a static import would fail the distribution's own typecheck. The
 * extension is spelled here because the resolver on this side is the BROWSER
 * (relative to this module's `/@fs/` URL), not Vite's Node loader.
 */
const RIG_MODULE = './sprite-bake/rigs.ts';
const RIG_SOURCE_PATH = 'src/tools/sprite-bake/rigs.ts';

/**
 * Preview playback rate. A cycle contract fixes frame COUNTS, never a rate —
 * the rate a game plays a walk at is the actor's speed, not the sheet's — so
 * this is the viewer's own clock and says so on screen.
 */
const PREVIEW_FPS = 12;

/** The viewing budget `fit` scales INTO — not the size of any stage box. */
const STAGE_SIZE = 200;

/** The box one filmstrip thumbnail fits into, by the same no-resample rule —
 *  what is left of the kit's 72px `vgai-sprite-frame-option` cell once its
 *  padding, gap and frame-number caption have taken their share. */
const THUMB_BOX = 44;

/** `#rrggbb` for the DOM half of a ground the stage draws with Pixi. */
function cssColor(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}

/** The same checker, as a CSS layer, for the filmstrip's thumbnails. */
const CHECKER_CSS =
  `repeating-conic-gradient(${cssColor(CHECKER_LIGHT)} 0% 25%, ` +
  `${cssColor(CHECKER_DARK)} 0% 50%)`;

function groundCss(ground: StageGround): {
  image: string;
  position: string;
  size: string;
} {
  if (ground === 'checker') {
    return {
      image: CHECKER_CSS,
      position: '0 0',
      size: `${CHECKER_SIZE * 2}px ${CHECKER_SIZE * 2}px`,
    };
  }
  const flat = cssColor(STAGE_GROUNDS[ground]);
  return { image: `linear-gradient(${flat}, ${flat})`, position: '0 0', size: '100% 100%' };
}

/** Scale modes the stage offers. `'fit'` resolves per animation. */
type ScaleMode = 'fit' | 1 | 4 | 8;

// ---------------------------------------------------------------------------
// The rig program, loaded (and re-loaded) from project source
// ---------------------------------------------------------------------------

interface ProgramLoad {
  spec: SpriteBakeSpec | null;
  error: string | null;
}

/**
 * ABSENCE IS ASKED ABOUT SEPARATELY, and that split is the whole point.
 *
 * A project with no rig program is the ordinary case — a game that only ships
 * a bought sheet — and it contributes no program subject, quietly. A rig
 * program that EXISTS and cannot be loaded is the opposite: it is a capability
 * this document cannot reach, and it gets said out loud, with the loader's own
 * message. Deciding between the two from the thrown error's TEXT is what
 * conflated them: a browser's "Failed to fetch dynamically imported module" is
 * both a missing file and a module whose import graph reaches something the
 * browser cannot have (a pixel project's `previews()` pulls in the Node-only
 * rasterizer, and that read as "no rig program" — a real gap wearing absence's
 * clothes). So the file is asked for FIRST, by URL.
 */
async function importRigProgram(stamp: number): Promise<ProgramLoad> {
  const url = new URL(RIG_MODULE, import.meta.url);
  try {
    const probe = await fetch(url, { method: 'GET' });
    if (!probe.ok) return { spec: null, error: null };
  } catch {
    return { spec: null, error: null };
  }
  try {
    const module = (await import(
      /* @vite-ignore */ `${RIG_MODULE}?t=${stamp}`
    )) as Partial<SpriteRigModule>;
    if (typeof module.spriteBakeSpec !== 'function') {
      return {
        spec: null,
        error: `${RIG_SOURCE_PATH} must export \`spriteBakeSpec(): SpriteBakeSpec\` — see src/lib/sprite/svg-rig.ts.`,
      };
    }
    return { spec: module.spriteBakeSpec(), error: null };
  } catch (error) {
    return {
      spec: null,
      error:
        `${RIG_SOURCE_PATH} is on disk and did not load in the BROWSER. Sprite Lab renders the ` +
        'rig program live, so every module it imports must be browser-safe; one that reaches the ' +
        `Node-only rasterizer (raster.ts, and so preview.ts / pixel-preview.ts / atlas.ts) cannot. ${String(error)}`,
    };
  }
}

/** Reload the rig program on demand. In development the editor remounts the
 * whole contribution when any `src/tools/**` source changes; the button is the
 * equivalent explicit act for a packaged editor with no HMR socket. */
function useRigProgramStamp(): [number, () => void] {
  const [stamp, setStamp] = useState(() => Date.now());
  const bump = useCallback(() => setStamp(Date.now()), []);
  return [stamp, bump];
}

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

/**
 * ONE STAGE: a Pixi `Application` in a reserved box, driven by props.
 *
 * The Pixi half is `sprite-lab/stage.ts` — plain `pixi.js`, no React, for the
 * dual-React reason its header records. This component is the React half and
 * owns exactly three things: create once, hand it the current view on every
 * commit, destroy on unmount.
 *
 * The playhead is lifted back into React so the filmstrip, the zoom stage and
 * the facts panel all read ONE playhead; only the DRIVEN stage reports it.
 */
function StageCanvas({
  animation,
  frameIndex,
  playing,
  onion,
  ground,
  scale,
  driven,
  onFrame,
  testId,
}: {
  animation: LabAnimation;
  frameIndex: number;
  playing: boolean;
  onion: boolean;
  ground: StageGround;
  scale: number;
  /** This canvas owns the ticker that advances the playhead. */
  driven: boolean;
  onFrame: (index: number) => void;
  testId: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<SpriteStage | null>(null);
  // MEMOIZED, and that is not a micro-optimization: the stage reads a new
  // array as a new animation and re-assigns `.textures`, whose setter STOPS
  // the sprite and rewinds it to frame 0 — a fresh array every render would
  // leave the animation on its first frame forever while every other part of
  // the UI looked correct.
  const textures = useMemo(() => animation.frames.map((frame) => frame.texture), [animation]);

  const view: SpriteStageView = {
    cell: animation.cell,
    driven,
    frameIndex,
    framesPerSecond: PREVIEW_FPS,
    ghostIndex: onion ? onionFrame(frameIndex, animation.frames.length) : null,
    ground,
    playing,
    scale,
    textures,
  };
  // The stage's ticker and its creation both read the LATEST view and callback
  // through these, so neither has to be rebuilt when a prop changes.
  const viewRef = useRef(view);
  const onFrameRef = useRef(onFrame);

  // ONE Application per mounted stage, created once. `Application.init` is
  // async and each one is a real WebGL context: re-creating it per prop change
  // would leak contexts and flash the canvas.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    void createSpriteStage(host, viewRef.current, (index) => onFrameRef.current(index)).then(
      (stage) => {
        if (disposed) {
          stage.destroy();
          return;
        }
        stageRef.current = stage;
        stage.update(viewRef.current);
      },
    );
    return () => {
      disposed = true;
      stageRef.current?.destroy();
      stageRef.current = null;
    };
  }, []);

  // PUSH ON COMMIT, never only on the ticker. Pixi's ticker is rAF, and rAF
  // STOPS in a hidden tab — so a stage that only drew from the ticker is a
  // blank rectangle for every agent capture taken while the editor tab is
  // backgrounded, and for the first frame after any remount. Updating after
  // each React commit makes what is on the canvas a function of the props
  // rather than of the tab's luck.
  useEffect(() => {
    viewRef.current = view;
    onFrameRef.current = onFrame;
    stageRef.current?.update(view);
  });

  const box = stageBox(animation.cell, scale);
  return (
    // TWO RULES THIS WRAPPER OBEYS, both learned from the editor's OWN
    // document screenshot (`composite-screenshot.ts`), which draws each
    // canvas's real pixels and then paints the DOM over them through an SVG
    // foreignObject with every nested canvas REMOVED from the clone:
    //
    //  - it RESERVES ITS BOX rather than taking its size from the canvas.
    //    A layout sized by the canvas collapses in the captured frame and
    //    every sibling reflows into the hole, so the picture disagrees with
    //    the screen.
    //  - it stays TRANSPARENT. The ground is drawn INSIDE the stage, because
    //    a coloured ancestor is part of the DOM layer and would be painted
    //    straight over the sprite in the capture — a correct screen and a
    //    flat rectangle on disk.
    <div
      data-testid={testId}
      ref={hostRef}
      style={{
        borderRadius: 'var(--vgai-radius-sm)',
        flex: '0 0 auto',
        height: box,
        lineHeight: 0,
        overflow: 'hidden',
        width: box,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Chrome, entirely from the editor's own kit
// ---------------------------------------------------------------------------

/**
 * A mode button in a single-selection group.
 *
 * ONE variant in every state, and selection carried by `aria-pressed` alone.
 * That is not a stylistic choice: the kit paints `.vgai-btn[aria-pressed]`
 * with colour ONLY (the 1px border is already reserved transparent on every
 * button), whereas swapping `variant` swaps PADDING with it —
 * `data-variant="primary"` carries its own `padding`, so a selected button
 * is a different size and every neighbour shifts. On a filmstrip that plays,
 * a padding-swapping highlight makes the whole strip crawl.
 */
function ModeButton({
  active,
  children,
  onClick,
  testId,
  title: hint,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
  testId: string;
  title?: string;
}) {
  return (
    <Button
      aria-pressed={active}
      data-testid={testId}
      onClick={onClick}
      shape="segment"
      size="compact"
      title={hint ?? ''}
      variant="ghost"
    >
      {children}
    </Button>
  );
}

function Fact({ children, name }: { children: ReactNode; name: string }) {
  return (
    <Stack gap={1}>
      <Text tone="dim" variant="label">
        {name}
      </Text>
      <Text variant="code">{children}</Text>
    </Stack>
  );
}

/** One thumbnail, painted straight from the atlas PNG (or the frame's own). */
function FrameThumb({
  frame,
  ground,
  scale,
}: {
  frame: LabFrame;
  ground: StageGround;
  scale: number;
}) {
  const backing = groundCss(ground);
  return (
    <div
      style={{
        // Two background layers: the frame's own rect on top, the ground
        // under it — the same order and the same checker the stage draws.
        backgroundImage: `url(${frame.imageUrl}), ${backing.image}`,
        backgroundPosition: `${-frame.x * scale}px ${-frame.y * scale}px, ${backing.position}`,
        backgroundSize: `${frame.imageWidth * scale}px ${frame.imageHeight * scale}px, ${backing.size}`,
        height: frame.height * scale,
        imageRendering: 'pixelated',
        width: frame.width * scale,
      }}
    />
  );
}

/**
 * ONE SUBJECT'S CONFORMANCE to the contract it comes closest to.
 *
 * A sheet is what a game's code binds to, so this is where a rename or a
 * re-timed cycle becomes visible: the cycle set is the 2D analog of a
 * humanoid's named skeleton, and the sheet either answers each of its cycles
 * at the right length or it does not.
 */
function ContractRow({ result }: { result: CycleSetConformance }) {
  return (
    <Stack gap={1}>
      <Text variant="code">
        {result.subject} → {result.set.id}
        {result.set.proven ? '' : ' (unproven set)'}
        {result.conforms ? ' ✓' : ''}
      </Text>
      {result.checks.map((check) => (
        <Text
          key={check.cycle}
          style={{ paddingInlineStart: 'var(--vgai-space-3)' }}
          tone={check.ok ? 'success' : 'warning'}
          variant="code"
        >
          {check.ok ? '✓' : '✗'} {check.cycle}:{' '}
          {check.animation
            ? `${check.animation} — ${check.frames} frames (contract: ${check.expectedFrames})`
            : `no animation named ${result.subject}-${check.cycle}`}
        </Text>
      ))}
      {result.unclaimed.length > 0 ? (
        <Text
          style={{ paddingInlineStart: 'var(--vgai-space-3)' }}
          tone="muted"
          variant="code"
        >{`· outside the set: ${result.unclaimed.join(', ')}`}</Text>
      ) : null}
    </Stack>
  );
}

/** Everything true about the selected animation that a picture cannot show. */
function FactsPanel({
  animation,
  conformance,
  provenance,
  subject,
}: {
  animation: LabAnimation;
  conformance: readonly CycleSetConformance[];
  provenance: AtlasProvenance | null;
  subject: LabSubject | null;
}) {
  return (
    <EditorSurface
      border
      data-testid="sprite-lab-facts"
      style={{ padding: 'var(--vgai-space-3)' }}
      variant="inset"
    >
      <Stack gap={3}>
        <FieldGroup>
          <Inline gap={6}>
            <Fact name="Animation">{animation.name}</Fact>
            <Fact name="Frames">{animation.frames.length}</Fact>
            <Fact name="Cell">
              {animation.cell}×{animation.cell} px
            </Fact>
            <Fact name="Pivot">
              {animation.origin ?? 'not recorded — a spritesheet has no pivot field'}
            </Fact>
          </Inline>
        </FieldGroup>

        {subject?.kind === 'sheet' ? (
          <Stack data-testid="sprite-lab-contracts" gap={2}>
            <Text tone="dim" variant="label">
              Cycle contract (src/lib/sprite/cycles.ts)
            </Text>
            {conformance.length === 0 ? (
              <Text tone="muted" variant="code">
                No named cycle set answers any of these animations.
              </Text>
            ) : null}
            {conformance.map((result) => (
              <ContractRow key={result.subject} result={result} />
            ))}
          </Stack>
        ) : null}

        <Stack gap={1}>
          <Text tone="dim" variant="label">
            Provenance (.vgai/provenance.json)
          </Text>
          {provenance ? (
            <Text data-testid="sprite-lab-provenance" tone="muted" variant="code">
              {provenance.path} · sha256 {provenance.sha256.slice(0, 12)} · {provenance.bytes} B ·{' '}
              {provenance.operation} ← {provenance.source} · {provenance.createdAt}
            </Text>
          ) : (
            <Text tone="muted" variant="code">
              No record names {subject?.imagePath ?? 'this atlas'} yet — run the bake.
            </Text>
          )}
        </Stack>
      </Stack>
    </EditorSurface>
  );
}

/** Whichever loader the picked subject calls for. */
async function loadSubject(ref: LabSubjectRef, spec: SpriteBakeSpec | null): Promise<LabSubject> {
  if (ref.kind !== 'program') return loadSheetSubject(ref);
  if (!spec) throw new Error('The rig program is not loaded.');
  return loadProgramSubject(spec, RIG_SOURCE_PATH);
}

/** Hold the picked animation across a reload when the name survived it. */
function keepOrFirstAnimation(subject: LabSubject, current: string | null): string | null {
  if (current && subject.animations.some((animation) => animation.name === current)) return current;
  return subject.animations[0]?.name ?? null;
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export default function SpriteLabDocument({
  active,
  client,
  documentId,
  surfaces,
  tool: callable,
}: ToolContributionProps) {
  const AssetDocument = surfaces.AssetDocument;
  const [stamp, reloadProgram] = useRigProgramStamp();
  const [refreshToken, setRefreshToken] = useState(0);

  const [program, setProgram] = useState<ProgramLoad>({ spec: null, error: null });
  const [refs, setRefs] = useState<readonly LabSubjectRef[]>([]);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [subject, setSubject] = useState<LabSubject | null>(null);
  const [provenance, setProvenance] = useState<AtlasProvenance | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [animationName, setAnimationName] = useState<string | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [onion, setOnion] = useState(false);
  const [scaleMode, setScaleMode] = useState<ScaleMode>(4);
  const [ground, setGround] = useState<StageGround>('checker');

  const [baking, setBaking] = useState(false);
  const [bakeNote, setBakeNote] = useState<string | null>(null);

  // --- discovery ----------------------------------------------------------
  useEffect(() => {
    if (active === false) return;
    let alive = true;
    void (async () => {
      const [loaded, sheets] = await Promise.all([importRigProgram(stamp), discoverSheetRefs()]);
      if (!alive) return;
      setProgram(loaded);
      const programRef: LabSubjectRef[] = loaded.spec
        ? [{ id: 'program', kind: 'program', label: 'Rig program', sourceLine: RIG_SOURCE_PATH }]
        : [];
      const next = [...programRef, ...sheets];
      setRefs(next);
      setSubjectId((current) =>
        current && next.some((ref) => ref.id === current) ? current : (next[0]?.id ?? null),
      );
    })();
    return () => {
      alive = false;
    };
  }, [active, stamp, refreshToken]);

  // --- the selected subject ----------------------------------------------
  const selectedRef = refs.find((ref) => ref.id === subjectId) ?? null;
  useEffect(() => {
    if (!selectedRef) {
      setSubject(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setLoadError(null);
    void (async () => {
      try {
        const loaded = await loadSubject(selectedRef, program.spec);
        if (!alive) return;
        setSubject(loaded);
        setAnimationName((current) => keepOrFirstAnimation(loaded, current));
        setFrameIndex(0);
        setProvenance(loaded.imagePath ? await loadAtlasProvenance(loaded.imagePath) : null);
      } catch (error) {
        if (alive) setLoadError(String(error));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [selectedRef, program.spec]);

  const animation =
    subject?.animations.find((entry) => entry.name === animationName) ??
    subject?.animations[0] ??
    null;
  const frameCount = animation?.frames.length ?? 0;

  const seek = useCallback(
    (delta: number) => {
      setPlaying(false);
      setFrameIndex((index) => stepFrame(index, frameCount, delta));
    },
    [frameCount],
  );

  const bake = async () => {
    setBaking(true);
    setBakeNote(null);
    try {
      const outcome = await client.runProjectTool(
        callable.name,
        { dryRun: false, preview: false },
        { confirm: true },
      );
      setBakeNote(outcome.ok ? 'Baked.' : outcome.error.message);
      setRefreshToken((token) => token + 1);
    } catch (error) {
      setBakeNote(String(error));
    } finally {
      setBaking(false);
    }
  };

  // --- cycle contract (sheet subjects) ------------------------------------
  let conformance: CycleSetConformance[] = [];
  if (subject?.kind === 'sheet') {
    const frameCounts: Record<string, number> = Object.fromEntries(
      subject.animations.map((entry) => [entry.name, entry.frames.length]),
    );
    conformance = animationSubjects(frameCounts)
      .map((name) => bestCycleSet(name, frameCounts))
      .filter((result): result is CycleSetConformance => result !== null);
  }

  /** Whether the PLAYING animation's contract says it loops, when one applies. */
  const loopNote = (() => {
    if (!animation || subject?.kind !== 'sheet') return 'looping — preview';
    const { subject: actor, cycle } = splitAnimationName(animation.name);
    const match = conformance.find((result) => result.subject === actor);
    const check = match?.checks.find((entry) => entry.animation === animation.name);
    const contract = check ? match?.set.cycles[check.cycle] : undefined;
    if (!contract) return 'looping — preview';
    return contract.loops
      ? `loops — ${match?.set.id}/${cycle}`
      : `holds last frame — ${match?.set.id}/${cycle}`;
  })();

  const fit = fitScale(animation?.cell ?? 0, STAGE_SIZE);
  const stageScale = scaleMode === 'fit' ? fit : scaleMode;
  const scaleLabel =
    scaleMode === 'fit'
      ? `fit — ${fit >= 1 ? `${fit}×` : `1/${Math.round(1 / fit)}×`}`
      : `${scaleMode}×`;
  const thumbScale = fitScale(animation?.frames[0]?.height ?? 0, THUMB_BOX);

  return (
    <EditorSurface
      data-testid="sprite-lab-document"
      scroll
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--vgai-space-3)',
        height: '100%',
        padding: 'var(--vgai-space-3)',
        pointerEvents: 'auto',
      }}
      variant="panel"
    >
      {documentId ? (
        <AssetDocument
          {...(active === undefined ? {} : { active })}
          documentId={documentId}
          status={subject?.sourceLine ?? RIG_SOURCE_PATH}
          title={title}
          type="sprite"
        />
      ) : null}
      {/* 1 — subject picker, source line, bake */}
      <EditorToolbar compact label="Sprite subject">
        {/* A SEGMENTED GROUP rather than a dropdown. A project has a rig
            program and a handful of committed sheets — a set small enough to
            show whole — and showing it whole means the subject you are NOT
            looking at is still on screen, which is most of why you switch. It
            also matches the rest of this toolbar, where every other choice is
            a segment. */}
        <ToolbarGroup aria-label="Sprite subject" data-testid="sprite-lab-subject">
          {refs.length === 0 ? (
            <Text tone="muted" variant="code">
              No sprite subjects
            </Text>
          ) : null}
          {refs.map((ref) => (
            <ModeButton
              active={ref.id === subjectId}
              key={ref.id}
              onClick={() => setSubjectId(ref.id)}
              testId={`sprite-lab-subject-${ref.kind === 'program' ? 'program' : ref.label}`}
            >
              {ref.kind === 'program' ? 'Rig program' : ref.label}
            </ModeButton>
          ))}
        </ToolbarGroup>
        <Text data-testid="sprite-lab-source" tone="muted" variant="code">
          {subject?.sourceLine ?? '—'}
        </Text>
        <Spacer style={{ flex: 1 }} />
        {selectedRef?.kind === 'program' ? (
          <Button
            data-testid="sprite-lab-reload"
            onClick={reloadProgram}
            size="compact"
            title="Re-import the rig program from source."
            variant="secondary"
          >
            Reload
          </Button>
        ) : null}
        <Button
          data-testid="sprite-lab-bake"
          disabled={baking || selectedRef?.kind !== 'program'}
          onClick={() => void bake()}
          size="compact"
          title={
            selectedRef?.kind === 'program'
              ? 'Run this project’s sprite bake: pose every rig, pack the atlas, write it with provenance.'
              : 'A committed sheet is the bake’s OUTPUT — pick the rig program to re-bake it.'
          }
          variant="primary"
        >
          {baking ? 'Baking…' : 'Bake'}
        </Button>
      </EditorToolbar>

      {program.error ? (
        <StateSurface
          compact
          data-testid="sprite-lab-program-error"
          description={program.error}
          title="The rig program did not load"
          tone="error"
        />
      ) : null}
      {loadError ? (
        <StateSurface
          compact
          description={loadError}
          title="This subject did not load"
          tone="error"
        />
      ) : null}
      {bakeNote ? (
        <Text data-testid="sprite-lab-bake-note" tone="muted" variant="code">
          {bakeNote}
        </Text>
      ) : null}

      {!animation ? (
        <StateSurface
          description={
            loading
              ? undefined
              : `A sprite subject is this project’s rig program (${RIG_SOURCE_PATH}) or a spritesheet JSON committed under public/sprites/.`
          }
          title={loading ? 'Loading…' : 'Nothing to show yet'}
          tone={loading ? 'loading' : 'neutral'}
        />
      ) : (
        // TWO COLUMNS, because the dock panel is WIDE and SHORT. Stacking the
        // six bands vertically pushed the facts — the half a picture cannot
        // show — below the fold in every capture and on every default layout.
        // The stage and its transport own the left column; everything that
        // reads as text owns the right one and scrolls inside itself.
        <Inline align="start" gap={5} style={{ flex: 1, minHeight: 0 }}>
          <Stack gap={2} style={{ flex: '0 0 auto' }}>
            {/* 2 — the stage: baked scale beside the chosen zoom */}
            <Inline align="start" gap={2}>
              <Stack gap={1}>
                <Text tone="dim" variant="label">
                  1× — baked size
                </Text>
                <StageCanvas
                  animation={animation}
                  driven
                  frameIndex={frameIndex}
                  ground={ground}
                  onFrame={setFrameIndex}
                  onion={onion}
                  playing={playing}
                  scale={1}
                  testId="sprite-lab-stage"
                />
              </Stack>
              <Stack gap={1}>
                <Text tone="dim" variant="label">
                  {scaleLabel}
                </Text>
                <StageCanvas
                  animation={animation}
                  driven={false}
                  frameIndex={frameIndex}
                  ground={ground}
                  onFrame={setFrameIndex}
                  onion={onion}
                  playing={playing}
                  scale={stageScale}
                  testId="sprite-lab-stage-zoom"
                />
              </Stack>
            </Inline>

            {/* 5 — transport, under the stage it drives */}
            <EditorToolbar compact label="Sprite transport">
              <ToolbarGroup>
                <ModeButton
                  active={false}
                  onClick={() => seek(-1)}
                  testId="sprite-lab-prev"
                  title="Previous frame"
                >
                  ◀
                </ModeButton>
                <ModeButton
                  active={playing}
                  onClick={() => setPlaying(!playing)}
                  testId="sprite-lab-play"
                  title="Play or pause the PREVIEW — this is the viewer's clock, not the game's."
                >
                  {playing ? '❚❚' : '▶'}
                </ModeButton>
                <ModeButton
                  active={false}
                  onClick={() => seek(1)}
                  testId="sprite-lab-next"
                  title="Next frame"
                >
                  ▶
                </ModeButton>
              </ToolbarGroup>
              <ToolbarDivider />
              <ToolbarGroup>
                <ModeButton
                  active={ground === 'checker'}
                  onClick={() => setGround('checker')}
                  testId="sprite-lab-ground-checker"
                  title="The alpha checkerboard — the only ground transparency reads as transparency on."
                >
                  Checker
                </ModeButton>
                <ModeButton
                  active={ground === 'dark'}
                  onClick={() => setGround('dark')}
                  testId="sprite-lab-ground-dark"
                >
                  Dark
                </ModeButton>
                <ModeButton
                  active={ground === 'light'}
                  onClick={() => setGround('light')}
                  testId="sprite-lab-ground-light"
                >
                  Light
                </ModeButton>
              </ToolbarGroup>
              <ToolbarDivider />
              <ToolbarGroup>
                <ModeButton
                  active={scaleMode === 'fit'}
                  onClick={() => setScaleMode('fit')}
                  testId="sprite-lab-scale-fit"
                  title="Show the whole cell, snapped to a whole factor so nothing is resampled."
                >
                  Fit
                </ModeButton>
                <ModeButton
                  active={scaleMode === 1}
                  onClick={() => setScaleMode(1)}
                  testId="sprite-lab-scale-1"
                >
                  1×
                </ModeButton>
                <ModeButton
                  active={scaleMode === 4}
                  onClick={() => setScaleMode(4)}
                  testId="sprite-lab-scale-4"
                >
                  4×
                </ModeButton>
                <ModeButton
                  active={scaleMode === 8}
                  onClick={() => setScaleMode(8)}
                  testId="sprite-lab-scale-8"
                >
                  8×
                </ModeButton>
              </ToolbarGroup>
              <ToolbarDivider />
              <ModeButton
                active={onion}
                onClick={() => setOnion(!onion)}
                testId="sprite-lab-onion"
                title="Ghost the cycle's PREVIOUS frame under the current one — where frame drift shows."
              >
                Onion
              </ModeButton>
            </EditorToolbar>
            <Text data-testid="sprite-lab-transport-readout" tone="muted" variant="code">
              frame {frameIndex + 1}/{frameCount} · {PREVIEW_FPS} fps preview · {loopNote}
            </Text>
          </Stack>

          <Stack gap={3} style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
            {/* 3 — the subject's animations */}
            <Stack gap={1}>
              <Text tone="dim" variant="label">
                Animations
              </Text>
              <Inline gap={1} style={{ flexWrap: 'wrap' }}>
                {subject?.animations.map((entry) => (
                  <ModeButton
                    active={entry.name === animation.name}
                    key={entry.name}
                    onClick={() => {
                      setAnimationName(entry.name);
                      setFrameIndex(0);
                    }}
                    testId={`sprite-lab-animation-${entry.name}`}
                  >
                    {entry.name} · {entry.frames.length}f
                  </ModeButton>
                ))}
              </Inline>
            </Stack>

            {/* 4 — the filmstrip */}
            <Stack gap={1}>
              <Text tone="dim" variant="label">
                Frames
              </Text>
              {/* A GRID, and the cells are the kit's own `vgai-sprite-frame-option`
                  — a fixed-height, fixed-padding frame cell whose `aria-pressed`
                  state changes COLOUR only. Both halves matter for a strip that
                  plays: the grid gives every cell the same track whatever its
                  art, and the class's selection paint adds no border and no
                  padding, so the playhead sweeping the strip moves nothing. */}
              <div
                data-testid="sprite-lab-filmstrip"
                style={{
                  display: 'grid',
                  gap: 'var(--vgai-space-2)',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
                }}
              >
                {animation.frames.map((frame, index) => (
                  <Button
                    aria-label={`Frame ${index}`}
                    aria-pressed={index === frameIndex}
                    className="vgai-sprite-frame-option"
                    data-testid={`sprite-lab-frame-${index}`}
                    key={`${animation.name}:${index}`}
                    onClick={() => {
                      setPlaying(false);
                      setFrameIndex(index);
                    }}
                    size="compact"
                    variant="ghost"
                  >
                    <FrameThumb frame={frame} ground={ground} scale={thumbScale} />
                    <Text tone="dim" variant="caption">
                      {index}
                    </Text>
                  </Button>
                ))}
              </div>
            </Stack>

            {/* 6 — the facts */}
            <FactsPanel
              animation={animation}
              conformance={conformance}
              provenance={provenance}
              subject={subject}
            />
          </Stack>
        </Inline>
      )}
    </EditorSurface>
  );
}
