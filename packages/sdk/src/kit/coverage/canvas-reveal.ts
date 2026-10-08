/**
 * WHICH CANVAS IS PRESENTING, and the bounded failsafe for when NONE is.
 *
 * The `canvas-revealed` ontology invariant (`ontology-invariants.ts`) asks one
 * question: is this session drawing onto a surface nobody can see? Its own
 * `fix` text has always named "the reveal failsafe" — and there wasn't one.
 * This module is both halves, kept pure (facts in, decision out) so every
 * transition is testable with no browser, the same contract the invariants
 * themselves follow.
 *
 * ## Half one: the measurement was picking the wrong canvas
 *
 * The facts used to come from `findPrimaryCanvas`, which ranks by painted
 * AREA and is blind to visibility — a canvas hidden by `visibility: hidden`
 * keeps its full bounding box. Measured live on a racing-game ingest session
 * (2026-08-15): during Play the Scene document's render overlay is hidden
 * with an inline `visibility: hidden` while the game's own canvas
 * fills the pane. The editor's Scene canvas — full-size, correctly hidden,
 * shallower in the tree — won the ranking, so the invariant reported
 * "4 frame(s) produced in 3389ms while the viewport canvas is hidden
 * (visibility: hidden)" for a session whose screenshot showed the game
 * rendering perfectly. A standing warning on a healthy session is the failure
 * mode the invariant module's own comments warn about, so it is fixed at the
 * source: **a session is revealed when ANY of its canvases is revealed**, and
 * only when every one of them is hidden does the row name the largest one's
 * reason.
 *
 * ## Half two: firing, not just reporting
 *
 * When every canvas IS hidden while frames are being produced, reporting is
 * not enough — the user is looking at a blank viewport and the fix is one
 * style write away. The failsafe fires it, and is deliberately narrow:
 *
 *  - **Only inline hiding on the canvas ITSELF.** A canvas hidden by an
 *    ancestor (a render overlay) or by a stylesheet rule is somebody
 *    else's decision, expressed somewhere this must not reach into.
 *  - **Only a canvas with no declared owner.** The editor's own viewport
 *    canvas is inline `opacity: 0` whenever `isThreejsSurfaceVisible` says so
 *    — a computed decision with a name — and React would re-apply it anyway.
 *    Fighting it would put a permanent false alarm on every DOM-only project.
 *  - **Once per canvas, after a bounded wait.** A mount is legitimately hidden
 *    for a moment; a failsafe that fires on the transient is a failsafe that
 *    cries wolf. And a failsafe is an emergency, never a policy: it clears the
 *    style once and then stops, so it can never become the mechanism a broken
 *    reveal path quietly relies on.
 *
 * Firing is LOUD by design. The ledger entry says the failsafe fired, what it
 * had to undo, and that this is a defect worth reporting upstream — because a
 * silently-repaired reveal is a reveal nobody ever fixes.
 */

/** One canvas as the DOM layer measured it. */
export interface CanvasVisibilityFact {
  /** How the message names it — a `data-testid`, a class, or its index. */
  readonly label: string;
  /** Painted area in CSS px², used only to pick the one the row speaks for. */
  readonly area: number;
  /** Why it is not visible, in the measurement's own words, or `null` when it
   *  IS visible. */
  readonly hiddenBy: string | null;
  /** Which of the canvas' OWN inline style properties is what hides it, or
   *  `null` when the hiding comes from anywhere else (an ancestor, a
   *  stylesheet, a zero-size box). Only this is ever cleared. */
  readonly inlineHiding: 'opacity' | 'visibility' | 'display' | null;
  /** True when this canvas' visibility is nobody's declared decision. The
   *  editor's own viewport canvas is `false` — see the module header. */
  readonly failsafeEligible: boolean;
}

/**
 * Why the session has no visible presentation surface, in the measurement's
 * own words — `undefined` when there is no canvas to measure at all, `null`
 * when at least one canvas is revealed.
 *
 * This is the whole of half one: the presence of ONE revealed canvas is what
 * makes the session presentable, whatever the others are doing.
 */
export function presentingCanvasHiddenBy(
  canvases: readonly CanvasVisibilityFact[],
): string | null | undefined {
  if (canvases.length === 0) return undefined;
  if (canvases.some((canvas) => canvas.hiddenBy === null)) return null;
  const largest = [...canvases].sort((a, b) => b.area - a.area)[0];
  return largest?.hiddenBy ?? null;
}

/**
 * One line per hidden canvas: which one, why, and whose doing it is.
 *
 * The row used to say only "the viewport canvas is hidden (visibility:
 * hidden)" — a sentence you cannot act on, because a session has several
 * canvases and the reason does not say which of them is the subject or who
 * hid it. Verifying this work against a live session was blocked on exactly
 * that gap, which is the argument for it being in the report rather than in a
 * debug affordance.
 */
export function hiddenCanvasBreakdown(
  canvases: readonly CanvasVisibilityFact[],
): readonly string[] {
  return canvases
    .filter((canvas) => canvas.hiddenBy !== null)
    .sort((a, b) => b.area - a.area)
    .map(
      (canvas) =>
        `${canvas.label} (${canvas.hiddenBy}, ${
          canvas.inlineHiding === null
            ? 'from an ancestor or a stylesheet'
            : canvas.failsafeEligible
              ? 'its own inline style, unowned'
              : 'its own inline style, by a declared owner'
        }, ${Math.round(canvas.area)}px²)`,
    );
}

/**
 * THE ONE SUBJECT DEFINITION — a canvas hiding ITSELF with nobody owning that
 * decision. Both the invariant row and the failsafe below turn on this, which
 * is why it is a function rather than two filters that could drift apart.
 *
 * Two facts have to line up, and each was measured as a false positive on the
 * same live racing-ingest session (2026-08-15) when it did not:
 *
 *  - hidden by its OWN box or inline style. On the UI Components document,
 *    every canvas is hidden by an ANCESTOR — the editor
 *    showing a different document, which is what the user opened.
 *  - and NOT a canvas whose visibility is somebody's declared decision. The
 *    editor's own viewport canvas carries inline `opacity: 0` from
 *    `isThreejsSurfaceVisible`, so during Play over an ingest root it read as
 *    "a canvas hiding itself" and kept the row violating on a healthy session.
 */
export function selfHiddenSubjects(
  canvases: readonly CanvasVisibilityFact[],
): readonly CanvasVisibilityFact[] {
  return canvases.filter((canvas) => canvas.failsafeEligible && canvas.inlineHiding !== null);
}

/**
 * Of the hidden canvases, is any of them {@link selfHiddenSubjects | hiding
 * itself}? `null` when nothing is hidden at all — there is no question to
 * answer.
 */
export function anyCanvasHidesItself(canvases: readonly CanvasVisibilityFact[]): boolean | null {
  if (!canvases.some((canvas) => canvas.hiddenBy !== null)) return null;
  return selfHiddenSubjects(canvases).length > 0;
}

/**
 * How long the all-hidden-while-drawing condition must hold before the
 * failsafe fires. Longer than one vitals sample, so the condition has to
 * SURVIVE a sample rather than merely be observed once during a mount.
 */
export const REVEAL_FAILSAFE_DEADLINE_MS = 4_000;

export type RevealFailsafeDecision =
  | { readonly fire: false }
  | { readonly fire: true; readonly target: CanvasVisibilityFact; readonly ledger: string };

export interface RevealFailsafeInput {
  readonly canvases: readonly CanvasVisibilityFact[];
  /** Frames the page produced in the sample window. */
  readonly framesProduced: number;
  /** How long the condition has held, or `null` when this is the first sample
   *  that has seen it (nothing has held yet). */
  readonly hiddenForMs: number | null;
  readonly deadlineMs?: number;
}

/**
 * Whether to force the reveal, and the ledger line that must accompany it.
 *
 * Every gate is a fact the caller measured; nothing here reads a clock or the
 * DOM.
 */
export function decideRevealFailsafe(input: RevealFailsafeInput): RevealFailsafeDecision {
  const deadline = input.deadlineMs ?? REVEAL_FAILSAFE_DEADLINE_MS;
  if (input.framesProduced <= 0) return { fire: false };
  if (input.hiddenForMs === null || input.hiddenForMs < deadline) return { fire: false };
  if (presentingCanvasHiddenBy(input.canvases) === null) return { fire: false };
  const target = [...selfHiddenSubjects(input.canvases)].sort((a, b) => b.area - a.area)[0];
  if (!target) return { fire: false };
  return {
    fire: true,
    target,
    ledger:
      `canvas reveal FAILSAFE FIRED — the "${target.label}" canvas was still hidden by its own ` +
      `inline ${target.inlineHiding} (${target.hiddenBy}) ${Math.round(input.hiddenForMs / 1000)}s ` +
      'after frames started arriving, so the editor cleared that style to put the picture on ' +
      'screen. THIS IS A DEFECT, not a feature: the mount path that hid this canvas never ran ' +
      'its own reveal, and the failsafe fires ONCE — a second mount in this state stays blank. ' +
      'Report it upstream with the mount that owns this canvas.',
  };
}
