/**
 * THE STAGE TRANSPORT'S PUBLISHED TYPES — the vocabulary a contribution needs
 * to attach something to a stage's transport and to draw a look over it.
 *
 * Declared HERE rather than beside the implementation
 * (`@editor/animation/stage-transport`) so `@vgai/blender` — and any other
 * skew package — reaches them through `@volter/editor-sdk/host` with no
 * dependency on the editor's own source and no engine value import. The
 * implementation imports these; nothing imports the implementation.
 *
 * TIME IS A POSITION ON FACTS A WORLD OWNS, AND A POSITION HAS A DRIVER
 * (WORK.md §The stage transport and the animation door). In Edit, time is
 * WRITTEN: nothing is running, and "show me frame 24" originates in the
 * transport and is seeked down into the world. In Play, time is READ: the
 * game's loop advances its own time and the editor may not write it — the
 * transport's `driver` says which of the two is true, and the write verbs
 * refuse by name while it answers `'world'`.
 *
 * SECONDS ARE THE SEAM. `fps` is a subject's DISPLAY rate, carried so a look
 * that thinks in frames (Blender's Timeline) can convert at its own edge and
 * nowhere else. Keys are deliberately NOT here: Blender's authored keys are
 * the door's key COLUMNS rather than a per-frame bake, and its bone names
 * break three's `PropertyBinding` grammar, so no honest common drawing
 * projection exists — each look draws its own from its own door.
 */

/**
 * What a world attaches to a stage so the transport can show it at a time.
 *
 * A subject is the world's own object: `seek` calls the world's own code
 * (Blender's `mixer.setTime` through the wire, three's `AnimationMixer`).
 * The transport owns the position; the subject owns what that position MEANS.
 */
export interface TransportSubject {
  /** Stable for the lifetime of the attachment. Blender: the action name;
   *  three: the clip name (or the object's uuid when it carries several). */
  readonly id: string;
  readonly label: string;
  /** The subject's own valid time domain and its display rate. */
  range(): { start: number; end: number; fps: number };
  /** THE ONE WRITE. Must be idempotent and synchronous: the transport calls
   *  it for every crossing, including a re-seek to the time already shown. */
  seek(seconds: number): void;
  /** Optional — which of several clips this subject is showing (three).
   *  Blender omits it: an action IS the subject there. */
  clips?(): readonly { id: string; label: string }[];
  setClip?(id: string): void;
}

export type TransportPlaybackState = 'stopped' | 'paused' | 'playing';

/** Everything a look needs to draw the transport, in one immutable read. */
export interface StageTransportSnapshot {
  readonly time: number;
  readonly range: { start: number; end: number; fps: number; loop: boolean };
  readonly playbackState: TransportPlaybackState;
  readonly timeScale: number;
  readonly activeSubject: string | null;
  readonly subjects: readonly { id: string; label: string }[];
  /**
   * `'world'` ⇔ this stage's store is in Play, so the game's own loop is
   * advancing time and the editor did not cause it. Every write verb below
   * refuses while this answers `'world'`; a look draws itself read-only and
   * says why rather than disabling a button with no reason.
   */
  readonly driver: 'editor' | 'world';
}

/**
 * The transport as a CONTRIBUTION sees it — the editor's own class minus its
 * construction and disposal, which belong to the stage that owns it.
 */
export interface StageTransportHandle {
  snapshot(): StageTransportSnapshot;
  subscribe(listener: () => void): () => void;
  /** Attach a subject; the first attach becomes active. Returns detach. */
  attach(subject: TransportSubject): () => void;
  setActiveSubject(id: string): void;
  /** The active subject's clips, or `null` when it has none to choose between. */
  activeClips(): readonly { id: string; label: string }[] | null;
  setActiveClip(id: string): void;
  /** `'reverse'` plays backwards — Blender's Timeline has a play-reverse
   *  button beside play, and the engine's clock has carried the direction all
   *  along (`AnimationClock.play(direction)`). */
  play(direction?: 'forward' | 'reverse'): void;
  pause(): void;
  stop(): void;
  seek(seconds: number): void;
  seekFrame(frame: number): void;
  setLoop(loop: boolean): void;
  setTimeScale(scale: number): void;
  /**
   * Fires when the playhead SETTLES — on `pause()`, and at scrub-end (the
   * first 150 ms with no further `seek` while not playing). A world with a
   * persisted playhead (Blender's `scene.frame_current`) writes its bookmark
   * here, so a slider drag writes once instead of once per frame. A `seek`
   * while playing never settles.
   */
  onSettled(listener: (seconds: number) => void): () => void;
}
