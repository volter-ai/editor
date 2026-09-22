/**
 * FINDER — prefabs from colocated portable-CSF story registrations.
 *
 * IT LIVES HERE, and not in the engine's finder namespace, since 2026-09-18
 * (phase 1 unit 11, edge 8). It was `packages/project/src/adapter/finders/
 * prefabs-from-stories.ts`, a host-owned discovery algorithm the engine
 * registered and whose `input.stories` the editor's adapter loader FILLED from
 * the story registry — which is how `project-adapter.ts` came to import the
 * registry, and through it Storybook, into every editor boot. The finder
 * CONTRIBUTION point (`.finder`, `tool-loader.ts`) already collects
 * package-shipped modules, so the algorithm and its data now arrive together
 * and the host fills nothing: `FinderInput.stories` is gone with it.
 *
 * The finder NAME is unchanged, because it is a project's own declaration
 * (`{ finder: 'prefabsFromStories' }` in every `vgai.adapter.ts`). A build
 * without this package leaves that selection unregistered, which the host
 * already reports as a standing note rather than a throw.
 *
 * The function itself is untouched — pure over its inputs, structurally typed
 * exactly as `@volter/editor-blender`'s `modelsFromBlendFiles` finder is, importing no
 * engine module.
 *
 * ARCHITECTURE-CORE §Roots: "A prefab is an ordinary source component that a
 * designer independently places, duplicates, or reuses, explicitly registered
 * for Content by a colocated portable story whose `meta.component` names it."
 * The registration is the load-bearing reference — delete the story and the
 * declaration is gone — which is why source SHAPE alone never admits a prefab.
 *
 * EXTRACTION, not a new rule. The join implemented here is the one the editor
 * already runs:
 *   - the match + same-source-directory tiebreak:
 *     `packages/editor/src/stories/story-registry.ts:162-186`
 *     (`componentPreviewStories`) and `:148-159` (`pickComponentPreviewStory`);
 *   - the default-story preference: `story-registry.ts:118-123`
 *     (`isDeclaredDefaultStory`);
 *   - the admission rule "a component with no story is not a Content entry at
 *     all": `packages/editor/src/components/AssetBrowser.tsx`, the
 *     `browserEntries` content scope (`if (!previewStory) return []`).
 * `meta.component`'s identity NAME is read live by
 * `packages/editor/src/stories/compose-project-stories.ts:130` /
 * `:185` (`componentIdentityName`) — this finder consumes that answer rather
 * than re-deriving it, so both sides of the join agree by construction.
 *
 * Pure over its inputs: the host hands in the registrations the story registry
 * already produced and the component index it already has.
 */

/** What a finder hands back, structurally (`@editor/finders`'s
 *  `FinderResult`): entries for the document table, plus notes the host
 *  surfaces. Spelled here rather than imported, the way every other
 *  package-shipped finder spells it — the engine's finder namespace has
 *  exactly ONE sanctioned importer and this is not it. */
interface DocumentEntry {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly region?: string | null;
  readonly authorable?: boolean;
  readonly reach?: { readonly kind: 'story'; readonly storyId: string };
  readonly source?: { readonly path: string; readonly export?: string };
  readonly finder?: string;
}
interface FinderResult {
  readonly entries: readonly DocumentEntry[];
  readonly notes: readonly string[];
  readonly defaultId?: string | null;
}
interface PrefabsFromStoriesParams {
  readonly finder: 'prefabsFromStories';
}

/** One composed portable-CSF story, as the host's story registry reports it. */
export interface StoryRegistration {
  /** Project-relative path of the CSF module (`src/prefabs/HeroBox.stories.tsx`). */
  readonly modulePath: string;
  /** The composed story's stable id. */
  readonly storyId: string;
  /** Human label for the story. */
  readonly label: string;
  /**
   * `meta.component`'s identity name. Absent ⇒ this story is joined to nothing
   * and declares no prefab — an ordinary story document, not a defect.
   */
  readonly componentName?: string;
  /** Whether the module declares this story as its component's default. */
  readonly isDefault?: boolean;
}

/** One entry of the host's project component index. */
export interface ProjectComponentRef {
  readonly name: string;
  /** Project-relative source path of the component's own module. */
  readonly path: string;
  /** Region this component's surface belongs to, when the host knows it. */
  readonly region?: string | null;
}

export interface PrefabsFromStoriesInput {
  readonly stories: readonly StoryRegistration[];
  /**
   * The project's component index. Supplies each prefab's own source path and
   * region; absent, entries still exist (the story IS the declaration) and
   * simply carry no `source`.
   */
  readonly components?: readonly ProjectComponentRef[];
}

/** Directory portion of a project-relative path — `story-registry.ts:126`'s `sourceDir`. */
function sourceDir(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  const slash = normalized.lastIndexOf('/');
  return slash >= 0 ? normalized.slice(0, slash) : '';
}

/** Group the registrations by the component their meta NAMES. A story naming
 *  none is joined to nothing and declares no prefab. */
function storiesByComponent(
  stories: readonly StoryRegistration[],
): Map<string, StoryRegistration[]> {
  const byComponent = new Map<string, StoryRegistration[]>();
  for (const story of stories) {
    const name = story.componentName;
    if (name === undefined || name === '') continue;
    const bucket = byComponent.get(name);
    if (bucket) bucket.push(story);
    else byComponent.set(name, [story]);
  }
  return byComponent;
}

/**
 * The story that speaks for a component: colocated beats distant
 * (story-registry.ts:177-180 — two files can export a same-named component),
 * and within that set the module's own declared default wins
 * (story-registry.ts:118-123).
 */
function chooseStory(
  stories: readonly StoryRegistration[],
  component: ProjectComponentRef | undefined,
): { chosen: StoryRegistration | undefined; colocated: boolean } {
  const sameDir = component
    ? stories.filter((story) => sourceDir(story.modulePath) === sourceDir(component.path))
    : [];
  const pool = sameDir.length > 0 ? sameDir : stories;
  return {
    chosen: pool.find((story) => story.isDefault === true) ?? pool[0],
    colocated: sameDir.length > 0,
  };
}

export function prefabsFromStories(
  _params: PrefabsFromStoriesParams,
  input: PrefabsFromStoriesInput,
): FinderResult {
  const entries: DocumentEntry[] = [];
  const notes: string[] = [];
  for (const [componentName, stories] of storiesByComponent(input.stories)) {
    const component = input.components?.find((candidate) => candidate.name === componentName);
    const { chosen, colocated } = chooseStory(stories, component);
    if (!chosen) continue;
    if (component && !colocated) {
      notes.push(
        `prefabsFromStories: "${componentName}" is declared by ${chosen.modulePath}, which is not ` +
          `colocated with ${component.path}. The join is by name; confirm it names this component.`,
      );
    }
    entries.push({
      id: componentName,
      label: componentName,
      kind: 'prefab',
      region: component?.region ?? null,
      authorable: true,
      reach: { kind: 'story', storyId: chosen.storyId },
      ...(component ? { source: { path: component.path, export: component.name } } : {}),
      finder: 'prefabsFromStories',
    });
  }

  // Prefabs are sibling documents, never the default scene — a finder that
  // cannot settle a default says nothing rather than nominating one.
  return { entries, notes };
}
