/**
 * Story grouping — the ONE optional grouping model for stories, shared by
 * every story surface. The React design-time board and hierarchy both turn
 * this path into Storybook's Category → Folder → Component → Story tree;
 * later surfaces reuse it rather than deriving a second organization.
 *
 * It is PRESENTATION-ONLY. A group never affects story↔component
 * association, default-story picking, mounting, or any other runtime
 * meaning — it decides layout and labels and nothing else. Nothing here is
 * a new authored vgai parameter either: the two inputs are facts the story
 * already carries.
 *
 * The group path is Storybook's own convention, in Storybook's own order of
 * precedence:
 *   1. the CSF meta `title` when the module authored one (slash-separated),
 *      parsed by Storybook's exported `parseKind` rather than a local split
 *      so the separator semantics stay theirs;
 *   2. otherwise DERIVED from the module's own project-relative path — the
 *      same thing Storybook does for an untitled CSF file (its automatic
 *      title comes from the file path) — relative to the project's `src/`
 *      and with the `*.stories.*` suffix stripped.
 *
 * `segments` is the category/folder ancestry (empty for an ungrouped story);
 * `leaf` is the component name inside that ancestry.
 */

import { parseKind } from 'storybook/internal/csf';
import { userOrAutoTitleFromSpecifier } from 'storybook/internal/preview-api';
import type { NormalizedStoriesSpecifier } from 'storybook/internal/types';

/** One story module's place in the grouping model. */
export interface StoryGroupPath {
  /** Ancestor group segments. EMPTY means ungrouped — the flat case, which
   *  every surface must render exactly as it did before grouping existed. */
  readonly segments: readonly string[];
  /** The component/document name within {@link segments}. */
  readonly leaf: string;
}

/** Only `.stories.ts(x)` files are discovered (`story-discovery.ts`); the
 *  `j` variants cost nothing and keep a JS project's derivation honest. */
const STORY_MODULE_SUFFIX = /\.stories\.[jt]sx?$/i;

/** A project's story modules live under its `src/`, so that prefix is the
 *  derivation's root — it is shared by every module and would only ever be a
 *  group everything belongs to. */
function titleSegments(title: string): string[] {
  // Storybook's own parse. `rootSeparator`/`groupSeparator` are its documented
  // defaults; `root` is simply the first segment for our purposes, since a
  // group path here has no separate "root" concept.
  const { root, groups } = parseKind(title, { rootSeparator: '|', groupSeparator: '/' });
  return [...(root ? [root] : []), ...groups].map((part) => part.trim()).filter(Boolean);
}

function conventionalStorySpecifier(modulePath: string): NormalizedStoriesSpecifier {
  const normalized = modulePath.replaceAll('\\', '/').replace(/^\.\//, '');
  const nestedSource = normalized.lastIndexOf('/src/');
  const directory = normalized.startsWith('src/')
    ? 'src'
    : nestedSource >= 0
      ? normalized.slice(0, nestedSource + 4)
      : normalized.slice(0, Math.max(0, normalized.lastIndexOf('/')));
  return {
    directory,
    files: '**/*.stories.@(js|jsx|mjs|ts|tsx)',
    titlePrefix: '',
    importPathMatcher: STORY_MODULE_SUFFIX,
  };
}

/**
 * The group path of one composed story module: its authored CSF title when
 * it has one, else its module path relative to the project `src/`.
 */
export function deriveStoryGroupPath(input: {
  modulePath: string;
  title?: string | undefined;
}): StoryGroupPath {
  const modulePath = input.modulePath.replaceAll('\\', '/').replace(/^\.\//, '');
  const userTitle = input.title && titleSegments(input.title).length > 0 ? input.title : undefined;
  const nativeTitle = userOrAutoTitleFromSpecifier(
    modulePath,
    conventionalStorySpecifier(modulePath),
    userTitle,
  );
  // Storybook's auto-title only speaks for files its own specifier matches, so
  // it returns nothing for a row that is not a discovered CSF module at all —
  // the `2D` board's ghost slots, which name a COMPONENT that has no story yet
  // (`canvas-board/canvas-board-model.ts`). An explicitly supplied title is the
  // caller's own statement about where the row belongs and stands either way;
  // without this, such a row falls back to its raw path and every ghost lands
  // in a district of its own.
  const parts = nativeTitle
    ? titleSegments(nativeTitle)
    : userTitle
      ? titleSegments(userTitle)
      : [modulePath];
  return { segments: parts.slice(0, -1), leaf: parts.at(-1) ?? input.modulePath };
}

/** The clustering key of a group path — the ancestors alone, so every story
 *  of one group shares it. `''` is the ungrouped/flat case. */
export function storyGroupKey(group: StoryGroupPath): string {
  return group.segments.join('/');
}

/** The full, human-facing group path (`UI/Button`) — what a surface labels a
 *  story document with. */
export function formatStoryGroupPath(group: StoryGroupPath): string {
  return [...group.segments, group.leaf].join('/');
}
