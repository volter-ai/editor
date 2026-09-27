/**
 * THE BOARD SUBSTRATE'S PRESENTATION CONTRACT — types only, no runtime import
 * of any kind, and that is the whole point.
 *
 * `react-story-board.ts` is THE board substrate and stays in the host: two
 * host chrome files draw OVER it (`components/ReactCanvasControls.tsx`, the
 * viewport strip; `components/RootSelectionOverlay.tsx`, the frame hit-test),
 * which is a different question from how a board MOUNTS. But it used to
 * compute its own layout by calling `stories/story-presentation.ts`, which
 * imports `storybook/viewport` and `storybook/internal/csf` — so the one file
 * the host genuinely owns dragged Storybook in behind it.
 *
 * The decoupling is an injected RESOLVER, not a dropped default: the board
 * resolves a presentation per story, per viewport override, INSIDE its own
 * layout pass ({@link StoryBoardPresentation.resolve}), so a caller cannot
 * pre-compute the answers and hand over a table. The callers — `@vgai/dom`'s
 * design-time mount and the canvas 2D board — each supply an
 * implementation; `stories/story-presentation.ts` is the one that exists,
 * and it implements these types rather than declaring its own, the way
 * `design-time-layers.ts` exports `LayerMountResult` for the mounts that fill
 * it.
 *
 * Storybook's slash title/path model is the organization source behind every
 * implementation there is today, but nothing here says so: these are a board's
 * own vocabulary — sections, nodes, a cell size, a viewport choice.
 */

/** How a frame's content sits inside its cell. */
export type StoryLayout = 'padded' | 'centered' | 'fullscreen';

/** One selectable frame size, in authored px. */
export interface StoryViewportChoice {
  readonly id: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

/** What a presentation is resolved FROM — everything a board frame knows
 *  about its own story. */
export interface StoryPresentationInput {
  readonly id: string;
  readonly label: string;
  readonly modulePath: string;
  readonly title?: string | undefined;
  readonly parameters?: Readonly<Record<string, unknown>> | undefined;
  readonly globals?: Readonly<Record<string, unknown>> | undefined;
  readonly viewportLocked?: boolean | undefined;
}

/** One component section: the frames that belong together on the board. */
export interface StoryPresentationSection {
  readonly id: string;
  readonly label: string;
  readonly storyIds: readonly string[];
}

/** One row of the navigation tree the hierarchy and the board share. */
export interface StoryPresentationTreeNode {
  readonly id: string;
  readonly label: string;
  readonly role: 'folder' | 'component';
  readonly kind: 'group' | 'component';
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly secondaryLabel?: string;
  readonly typeLabel: 'Category' | 'Folder' | 'Component';
}

/** The whole navigation index: how a set of stories is organized. */
export interface StoryPresentationIndex {
  readonly sections: readonly StoryPresentationSection[];
  readonly nodes: readonly StoryPresentationTreeNode[];
  readonly rootIds: readonly string[];
  readonly storyParentIds: ReadonlyMap<string, string>;
}

/** One frame's resolved cell. */
export interface ResolvedStoryPresentation {
  readonly layout: StoryLayout;
  readonly choices: readonly StoryViewportChoice[];
  readonly selectedViewportId: string | null;
  readonly locked: boolean;
  readonly rotated: boolean;
  readonly width: number;
  readonly height: number;
}

/**
 * What a board is handed instead of an implementation: the index it lays out
 * by, and the per-frame resolver it calls during that layout.
 */
export interface StoryBoardPresentation {
  /** How this board's stories are organized into sections and tree rows. */
  readonly index: StoryPresentationIndex;
  /**
   * This story's cell, right now. Called per story and again on every
   * viewport/rotation override, which is why it is a function the board holds
   * rather than a table it was given.
   *
   * `fallback` is the board's own default cell for a story that authored
   * none; `sessionViewportId` is `undefined` for "whatever the story
   * authored" and `null` for "explicitly none".
   */
  readonly resolve: (
    story: StoryPresentationInput,
    fallback?: { readonly width: number; readonly height: number },
    sessionViewportId?: string | null,
    sessionRotated?: boolean,
  ) => ResolvedStoryPresentation;
}
