/** The identity inventory of the HOST's own utility tabs — the ones
 *  `components/core-utilities.tsx` registers. */
export const CORE_WORKSPACE_UTILITIES = {
  console: { id: 'console', title: 'Console' },
  lightExplorer: { id: 'light-explorer', title: 'Light Explorer' },
} as const;

/**
 * Utility tabs a PACKAGE registers, whose ids the host still declares.
 *
 * A tab id keys persisted dock state and is part of the shareable view address
 * space (`EDITOR_VIEW_BUILT_IN_UTILITY_IDS` in `@volter/editor-sdk`, which this
 * list must equal), so the address is the host's even when the surface is not:
 * the package imports its row from here rather than spelling the id twice.
 * `@vgai/game` registers all four — the story trio through
 * `story-documents.service.ts`, Generations through `generation.service.ts`.
 * Build Output is NOT here: it is a `workspace.utility` CONTRIBUTION, so the
 * loader namespaces its id as `tool:build-output.utility` and no host
 * declaration exists.
 */
export const CONTRIBUTED_WORKSPACE_UTILITIES = {
  storyActions: { id: 'story-actions', title: 'Actions' },
  storyInteractions: { id: 'story-interactions', title: 'Interactions' },
  storyAccessibility: { id: 'story-accessibility', title: 'Accessibility' },
  generations: { id: 'generations', title: 'Generations' },
} as const;

export const BUILT_IN_WORKSPACE_UTILITIES = [
  ...Object.values(CORE_WORKSPACE_UTILITIES),
  ...Object.values(CONTRIBUTED_WORKSPACE_UTILITIES),
] as const;
