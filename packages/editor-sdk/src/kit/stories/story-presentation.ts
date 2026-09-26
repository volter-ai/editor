/**
 * PORTABLE CSF'S ANSWER to the board substrate's presentation contract
 * (`@editor/authoring/story-board-presentation.ts`): Storybook's slash
 * title/path model organizes the frames, and Storybook's viewport parameters
 * size them.
 *
 * The TYPES are the host's — `react-story-board.ts` is host chrome's
 * substrate and declares what it needs, the same way `design-time-layers.ts`
 * exports `LayerMountResult` for the mounts that fill it. This module
 * IMPLEMENTS them and re-exports them so a reader following a story does not
 * have to know which side owns which half.
 */

import { MINIMAL_VIEWPORTS } from 'storybook/viewport';
import type {
  ResolvedStoryPresentation,
  StoryBoardPresentation,
  StoryLayout,
  StoryPresentationIndex,
  StoryPresentationInput,
  StoryPresentationTreeNode,
} from '../authoring/story-board-presentation';
import { deriveStoryGroupPath, formatStoryGroupPath } from '@volter/editor-sdk/kit/stories/story-grouping';

export type {
  ResolvedStoryPresentation,
  StoryBoardPresentation,
  StoryLayout,
  StoryPresentationIndex,
  StoryPresentationInput,
  StoryPresentationSection,
  StoryPresentationTreeNode,
  StoryViewportChoice,
} from '../authoring/story-board-presentation';

/** Storybook's own per-viewport shape, as authored in a story's
 *  `parameters.viewport.options`. Internal: the board sees the resolved
 *  `StoryViewportChoice`, never this. */
interface StoryViewportOption {
  readonly name: string;
  readonly styles: { readonly width: string; readonly height: string };
  readonly type?: string;
}

const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 400;

function stableNodeId(role: 'folder' | 'component', path: readonly string[]): string {
  return `portable-${role}:${path.map((part) => encodeURIComponent(part)).join('/')}`;
}

/**
 * Build the one Storybook navigation index used by both the hierarchy and
 * the Figma-style board. Storybook's slash title/path model remains the
 * organization source: first segment is the category, middle segments are
 * folders, the final segment is the component, and named exports are stories.
 */
export function createStoryPresentationIndex(
  stories: readonly StoryPresentationInput[],
): StoryPresentationIndex {
  const mutableNodes = new Map<string, StoryPresentationTreeNode & { childIds: string[] }>();
  const rootIds: string[] = [];
  const storyParentIds = new Map<string, string>();
  const sections = new Map<string, { id: string; label: string; storyIds: string[] }>();

  for (const story of stories) {
    const group = deriveStoryGroupPath({
      modulePath: story.modulePath,
      ...(story.title ? { title: story.title } : {}),
    });
    const fullPath = [...group.segments, group.leaf];
    let parentId: string | null = null;
    for (let index = 0; index < fullPath.length; index++) {
      const path = fullPath.slice(0, index + 1);
      const component = index === fullPath.length - 1;
      const id = stableNodeId(component ? 'component' : 'folder', path);
      if (!mutableNodes.has(id)) {
        mutableNodes.set(id, {
          id,
          label: path.at(-1)!,
          role: component ? 'component' : 'folder',
          kind: component ? 'component' : 'group',
          typeLabel: component ? 'Component' : index === 0 ? 'Category' : 'Folder',
          parentId,
          childIds: [],
          ...(component ? { secondaryLabel: story.modulePath } : {}),
        });
        if (parentId) mutableNodes.get(parentId)?.childIds.push(id);
        else rootIds.push(id);
      }
      parentId = id;
    }

    const componentId = parentId!;
    mutableNodes.get(componentId)?.childIds.push(story.id);
    storyParentIds.set(story.id, componentId);
    const section = sections.get(componentId);
    if (section) section.storyIds.push(story.id);
    else {
      sections.set(componentId, {
        id: componentId,
        label: formatStoryGroupPath(group),
        storyIds: [story.id],
      });
    }
  }

  return {
    sections: [...sections.values()],
    nodes: [...mutableNodes.values()],
    rootIds,
    storyParentIds,
  };
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function pixels(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function viewportOptions(
  parameters: Readonly<Record<string, unknown>>,
): Record<string, StoryViewportOption> {
  const custom = object(object(parameters['viewport'])?.['options']);
  const options: Record<string, StoryViewportOption> = { ...MINIMAL_VIEWPORTS };
  if (!custom) return options;
  for (const [id, raw] of Object.entries(custom)) {
    const option = object(raw);
    const styles = object(option?.['styles']);
    if (
      !option ||
      !styles ||
      typeof option['name'] !== 'string' ||
      typeof styles['width'] !== 'string' ||
      typeof styles['height'] !== 'string'
    ) {
      continue;
    }
    options[id] = {
      name: option['name'],
      styles: { width: styles['width'], height: styles['height'] },
      ...(typeof option['type'] === 'string' ? { type: option['type'] } : {}),
    };
  }
  return options;
}

function viewportGlobal(globals: Readonly<Record<string, unknown>>): {
  value: string | null;
  isRotated: boolean;
} {
  const viewport = globals['viewport'];
  if (typeof viewport === 'string') return { value: viewport || null, isRotated: false };
  const value = object(viewport);
  return {
    value: typeof value?.['value'] === 'string' && value['value'] ? value['value'] : null,
    isRotated: value?.['isRotated'] === true,
  };
}

/** Resolve only Storybook-native layout/viewport values into an artboard. */
export function resolveStoryPresentation(
  story: StoryPresentationInput,
  fallback?: { readonly width: number; readonly height: number },
  sessionViewportId?: string | null,
  sessionRotated?: boolean,
): ResolvedStoryPresentation {
  const parameters = story.parameters ?? {};
  const globals = story.globals ?? {};
  const authoredLayout = parameters['layout'];
  const layout: StoryLayout =
    authoredLayout === 'centered' || authoredLayout === 'fullscreen' || authoredLayout === 'padded'
      ? authoredLayout
      : 'padded';
  const options = viewportOptions(parameters);
  const choices = Object.entries(options).flatMap(([id, option]) => {
    const width = pixels(option.styles.width);
    const height = pixels(option.styles.height);
    return width && height ? [{ id, label: option.name, width, height }] : [];
  });
  const authoredViewport = viewportGlobal(globals);
  const selectedViewportId =
    sessionViewportId === undefined ? authoredViewport.value : sessionViewportId;
  const choice = choices.find((candidate) => candidate.id === selectedViewportId);
  const baseWidth = choice?.width ?? fallback?.width ?? DEFAULT_WIDTH;
  const baseHeight = choice?.height ?? fallback?.height ?? DEFAULT_HEIGHT;
  const rotated = sessionRotated ?? authoredViewport.isRotated;
  return {
    layout,
    choices,
    selectedViewportId: choice?.id ?? null,
    locked: story.viewportLocked === true,
    rotated,
    width: rotated ? baseHeight : baseWidth,
    height: rotated ? baseWidth : baseHeight,
  };
}

/**
 * The board substrate's {@link StoryBoardPresentation} for one set of stories
 * — what a caller hands `createReactStoryBoard` instead of letting it reach
 * for this module. `index` is built once; `resolve` runs inside the board's
 * layout pass, per story and per viewport override.
 */
export function storyBoardPresentation(
  stories: readonly StoryPresentationInput[],
  index: StoryPresentationIndex = createStoryPresentationIndex(stories),
): StoryBoardPresentation {
  return { index, resolve: resolveStoryPresentation };
}
