/**
 * The `prefabsFromStories` FINDER — the name a project's `vgai.adapter.ts`
 * selects, registered beside the story registry it reads.
 *
 * WHY IT READS ITS OWN LEDGER. The algorithm used to be an ENGINE finder
 * (`packages/editor/src/finders/prefabs-from-stories.ts`) whose
 * `input.stories` the editor's adapter loader filled, which is how the loader
 * came to reach the story registry through a contract field nothing else ever
 * filled. `FinderInput.stories` is gone; the finder gathers its own
 * registrations here, and `input.components` is the only project fact it is
 * handed.
 *
 * Registered by `project-adapter.ts`, the ONE sanctioned importer of the
 * engine's finder namespace (that file's header states the rule).
 */

import { z } from 'zod';
import { prefabsFromStories, type StoryRegistration } from './prefabs-from-stories';
import { getProjectStoryModules, isDeclaredDefaultStory } from './story-registry';

/** Every story the project's registry has composed, in the finder's
 *  vocabulary. */
function storyRegistrations(): StoryRegistration[] {
  const out: StoryRegistration[] = [];
  for (const module_ of getProjectStoryModules()) {
    if (!module_.ok) continue;
    for (const story of module_.stories) {
      out.push({
        modulePath: module_.modulePath,
        storyId: story.id,
        label: story.label,
        ...(story.componentName === undefined ? {} : { componentName: story.componentName }),
        isDefault: isDeclaredDefaultStory(story),
      });
    }
  }
  return out;
}

export const storyPrefabsFinder = {
  name: 'prefabsFromStories',
  schema: z.object({ finder: z.literal('prefabsFromStories') }).strict(),
  run(
    selection: { finder: 'prefabsFromStories' },
    input: {
      components?: readonly { name: string; path: string; region?: string | null }[];
    },
  ) {
    return prefabsFromStories(selection, {
      stories: storyRegistrations(),
      ...(input.components === undefined ? {} : { components: input.components }),
    });
  },
};
