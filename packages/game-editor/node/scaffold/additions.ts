/**
 * What a project can ADD to itself at creation (ARCHITECTURE-CORE §The project
 * model, "New Project is a list of things to ADD to an empty project, never a
 * list of project kinds"). Each addition brings the files, roots,
 * configurations and capabilities its shape needs.
 *
 * THE ADDITIONS ARE THE KIT'S; THE PRESETS ARE A PRODUCT'S. Which additions a
 * named preset composes, what that preset is called, and what the project then
 * declares are a product's declaration (`./product.ts`), because creation is
 * the product's: `game-editor create`, `model-editor create`.
 */

import type { ScaffoldEditorDeclaration } from './product.js';

export const SCAFFOLD_ADDITIONS = ['three', 'ui', 'server', 'blender', 'studio'] as const;
export type ScaffoldAddition = (typeof SCAFFOLD_ADDITIONS)[number];

export const ADDITION_INFO: Readonly<
  Record<ScaffoldAddition, { readonly title: string; readonly description: string }>
> = {
  three: {
    title: '3D world',
    description:
      'A Three.js root (`src/world.tsx`) with the neutral daylight scene, source-owned prefabs and the scene/prefab finders.',
  },
  ui: {
    title: 'UI / website',
    description: 'A React root (`src/ui/`) mounted as a DOM layer — the react-root capability.',
  },
  server: {
    title: 'Multiplayer server',
    description:
      'The Colyseus `server` process configuration and the `play + server` compound the transport starts.',
  },
  studio: {
    title: 'Game development panels',
    description:
      'Unfinished Data, Game Inspector and Analytics panels to implement for this game; brings a 3D world.',
  },
  blender: {
    title: 'Models',
    description:
      'Blender in the tab: `.blend` models under `src/models/` with the bpy that authored them, ' +
      "the Model document, the model finder and Blender's own look.",
  },
};

/**
 * What an addition NEEDS beside it to mean anything (ARCHITECTURE-CORE §Apps
 * are addition presets: "an addition brings the files, roots, configurations
 * and capabilities its shape needs"). The development panels are panels OF a
 * 3D world. The closure is taken once, at every door a list of additions
 * enters (`--with`, the New Project checklist, the browser seed), so no later
 * code path asks "studio without three?".
 */
export const ADDITION_REQUIRES: Readonly<
  Partial<Record<ScaffoldAddition, readonly ScaffoldAddition[]>>
> = {
  studio: ['three'],
};

/** `additions` closed over {@link ADDITION_REQUIRES}, in `SCAFFOLD_ADDITIONS` order. */
export function closeAdditions(additions: Iterable<ScaffoldAddition>): ScaffoldAddition[] {
  const wanted = new Set<ScaffoldAddition>();
  const visit = (addition: ScaffoldAddition) => {
    if (wanted.has(addition)) return;
    wanted.add(addition);
    for (const required of ADDITION_REQUIRES[addition] ?? []) visit(required);
  };
  for (const addition of additions) visit(addition);
  return SCAFFOLD_ADDITIONS.filter((addition) => wanted.has(addition));
}

export function isScaffoldAddition(value: unknown): value is ScaffoldAddition {
  return typeof value === 'string' && (SCAFFOLD_ADDITIONS as readonly string[]).includes(value);
}

/** What the `three` addition OWNS in the template's tree: a project without
 *  a 3D world carries none of it. */
export const THREE_OWNED_PATHS = [
  'src/lib/audio',
  'src/world.tsx',
  'src/scenes',
  'src/prefabs',
  'src/components',
  'src/bot',
] as const;

/**
 * THE PACKAGES THIS KIT ITSELF PUTS IN EVERY PROJECT, and therefore the ones
 * the scaffolder must NOT mistake for a product's composition.
 *
 * The base template is a game project (it is the game editor's full starting
 * point), so its `devDependencies` carry editor-side packages a `models`
 * scaffold must not end up with. The rule that replaces them is stated from
 * the KIT's side — the only side a library may name: every `@volter/*` the
 * template declares that is NOT one of these is the previous product's
 * composition, and the scaffold replaces that whole set with the one the
 * product handed over ({@link ScaffoldComposition.editorPackages}). A media
 * package added to the template would be replaced by the same rule, which is
 * correct: what a project declares beside its product is the product's call,
 * never the template's.
 *
 * `@volter/editor-blender` is deliberately not a product's to declare either: the
 * `blender` CAPABILITY declares it, with `@volter/blender-engine` beside it, and
 * a second declaration of a `private: true` package is the exact spec conflict
 * `checkoutPackageSpec`'s docblock in `scaffold.ts` records (`file:<checkout>`
 * against `0.1.0`, a refusal a probe hit) — so the capability's declaration is
 * the one that stands and this list keeps the scaffolder's hands off it.
 */
export const KIT_DECLARED_PACKAGES = [
  '@volter/editor-blender',
  '@volter/blender-engine',
  '@volter/editor-core',
  '@volter/editor-sdk',
  '@volter/game-runtime',
  '@volter/editor-live',
  '@volter/game-live',
  '@volter/editor-project',
  '@volter/threejs-runtime',
] as const;

/** Optional development surfaces; absent from the prototype preset. */
export const STUDIO_OWNED_PATHS = [
  'src/contributions/data.document.tsx',
  'src/contributions/tester.inspector.tsx',
  'src/contributions/analytics.analytics.tsx',
] as const;

/** A React-only project must be genuinely React-only: dormant scene
 *  components and Three-side capability code would still participate in
 *  `tsc`, so a project that changes its own tuning schema would have to
 *  repair irrelevant demo code before it could pass typecheck.
 *
 *  ONLY when the project has no 3D world. Composed with `three`, the `ui`
 *  addition adds its React root beside the world and removes nothing —
 *  until 2026-09-15 it deleted `src/world.tsx` out from under the manifest
 *  that still declared it, which is exactly the misplaced piece the `full`
 *  preset exists to catch (ARCHITECTURE-CORE §Apps, "The four skews"). */
export const REACT_ONLY_REMOVED_PATHS = [
  'src/prefabs',
  'src/world.tsx',
  'src/components',
  'public',
] as const;

/** True when a template file under `path` (project-relative, no leading
 *  slash) belongs in a project with exactly these additions — the one
 *  predicate the on-disk scaffolder's removals and the in-browser seed's
 *  writes agree on. */
export function compositionKeepsPath(
  path: string,
  additions: ReadonlySet<ScaffoldAddition>,
): boolean {
  const under = (owned: readonly string[]) =>
    owned.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  if (!additions.has('three') && under(THREE_OWNED_PATHS)) return false;
  if ((!additions.has('three') || !additions.has('studio')) && under(STUDIO_OWNED_PATHS))
    return false;
  if (additions.has('ui') && !additions.has('three') && under(REACT_ONLY_REMOVED_PATHS))
    return false;
  return true;
}

// Exported for G3's thumbnail generator (scripts/generate-learn-thumbnails
// .ts): the react composition template has NO committed scene — these
// constants ARE its current look, so the generated `react` template card must
// render exactly this source (FT-11: generated from the buildable truth).
export const REACT_ONLY_PAGE_SOURCE = `export interface ReactGamePageProps {
  readonly lastInput: string;
  readonly title?: string;
}

/** Pure React-only game page. Runtime input ownership stays in game.tsx. */
export function ReactGamePage({ lastInput, title = 'My Game' }: ReactGamePageProps) {
  return (
    <main
      data-testid="game-ui-root"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        pointerEvents: 'auto',
        color: '#f7f4ea',
        background: 'radial-gradient(circle at 50% 30%, #26314b 0%, #111827 68%)',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <section style={{ textAlign: 'center', padding: 32 }}>
        <p style={{ margin: 0, color: '#93c5fd', fontWeight: 700, letterSpacing: 2 }}>
          REACT ADAPTER ROOT
        </p>
        <h1 style={{ margin: '8px 0', fontSize: 'clamp(42px, 8vw, 86px)' }}>{title}</h1>
        <p aria-live="polite" style={{ margin: 0, color: '#cbd5e1' }}>
          Last input: {lastInput}
        </p>
      </section>
    </main>
  );
}
`;

export const REACT_ONLY_GAME_SOURCE = `import { useEffect, useState } from 'react';
import { useDebugProvider } from '@volter/game-runtime/react/world-state';
import { ReactGamePage } from './game-page';

/** React-only live connector: DOM input is gameplay input; no canvas adapter is required. */
export default function GameUI() {
  const [lastInput, setLastInput] = useState('Ready');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.startsWith('Arrow')) setLastInput(event.key);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useDebugProvider('react-starter', () => ({ lastInput }));

  return <ReactGamePage lastInput={lastInput} />;
}
`;

export const REACT_ONLY_STORY_SOURCE = `import type { Meta, StoryObj } from '@storybook/react';
import GameUI from './game';
import { ReactGamePage } from './game-page';

const meta = {
  title: 'Game/React Root',
  // \`component\` is what associates this CSF document with a root: the editor
  // derives it from the component the stories are about, and \`GameUI\` is the
  // \`ui\` root's manifest entry. It owns live input state, so the design-time
  // states below render its presentational body with authored props.
  component: GameUI,
  render: (args) => <ReactGamePage {...args} />,
  parameters: { vgai: { defaultStory: 'Ready' } },
  args: { lastInput: 'Ready', title: 'My Game' },
} satisfies Meta<typeof ReactGamePage>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {};
export const ArrowUp: Story = { args: { lastInput: 'ArrowUp' } };
export const ArrowLeft: Story = { args: { lastInput: 'ArrowLeft' } };
export const LongTitle: Story = {
  args: { title: 'The Long Way Home', lastInput: 'ArrowRight' },
};
`;

export const REACT_ONLY_MAIN_SOURCE = `import { manifestEntryModules } from 'virtual:vgai-manifest-entries';
import { registerReactAdapter } from './lib/react-root';
import { mountGameFromManifest, type ManifestHost } from '@volter/game-runtime/runtime/mount-game';
import manifest from '../vgai.project.json';

registerReactAdapter();

async function main() {
  document.title = manifest.name;
  const container = document.getElementById('game-canvas') as HTMLElement;
  const host: ManifestHost = {
    container,
    async loadEntryModule(path) {
      const entryModule = manifestEntryModules[path];
      if (!entryModule) {
        throw new Error(
          \`main.ts: entry module "\${path}" was not generated from vgai.project.json.\`,
        );
      }
      return entryModule;
    },
  };
  const session = await mountGameFromManifest(manifest, host);
  const resize = () => session.resize(window.innerWidth, window.innerHeight);
  resize();
  window.addEventListener('resize', resize);
}

main().catch(console.error);
`;

/** The `ui` addition's own files (project-relative path → source). */
export const REACT_ONLY_FILES: Readonly<Record<string, string>> = {
  'src/main.ts': REACT_ONLY_MAIN_SOURCE,
  'src/ui/game-page.tsx': REACT_ONLY_PAGE_SOURCE,
  'src/ui/game.tsx': REACT_ONLY_GAME_SOURCE,
  'src/ui/game.stories.tsx': REACT_ONLY_STORY_SOURCE,
};

/**
 * Write the product's editor declaration into the starter's adapter source.
 *
 * Starter choices are adapter code, shared by disk scaffolding and browser
 * creation — and WHICH choices is the product's, never this library's. A
 * models project's LOOK, for instance, is the palette, material, icon set,
 * chrome regions and key bindings the Blender package carries, imported as the
 * objects they are (ARCHITECTURE-CORE §Adapters and contributions are code,
 * not configs); the model editor is what knows to ask for them. This function
 * only renders what it is handed: the imports, in the order the declaration
 * gives them, and the one `editor:` line.
 */
export function withEditorDeclaration(
  source: string,
  declaration: ScaffoldEditorDeclaration,
): string {
  if (!source.includes('defineAdapter({'))
    throw new Error('Starter vgai.adapter.ts must call defineAdapter({ ... }).');
  const look = [
    declaration.style ? `, style: ${declaration.style.name}` : '',
    declaration.keymap ? `, keymap: ${declaration.keymap.name}` : '',
  ].join('');
  const editor =
    `  editor: { Layout: ${declaration.layout.name}${look}, ` +
    `inspector: '${declaration.inspector}' },`;
  // One import statement per module, with every binding that module supplies —
  // a package's layout comes from its `/layouts` entry and its look from
  // `/looks`, so a second statement for the same module would be a duplicate
  // import in generated source.
  const byModule = new Map<string, Set<string>>();
  for (const value of [declaration.layout, declaration.style, declaration.keymap]) {
    if (!value) continue;
    const names = byModule.get(value.from) ?? new Set<string>();
    names.add(value.name);
    byModule.set(value.from, names);
  }
  const imports = [...byModule]
    .map(([from, names]) => `import { ${[...names].sort().join(', ')} } from '${from}';\n`)
    .join('');
  return `${imports}${source.replace('defineAdapter({', `defineAdapter({\n${editor}`)}`;
}

/**
 * THE MODELING SCAFFOLD's own agent contract. The template's `AGENTS.md` is
 * the GAME's (playable slices, live playtests, `game.*`); a project with no
 * root cannot play, and shipping it that contract sent a blind probe
 * (2026-09-17) looking for a Play loop that does not exist. The one
 * instruction that probe needed — how to model — sits in
 * `src/models/cube.py`'s docstring; this contract routes there and to the
 * doors that show a model.
 */
export const MODELS_AGENTS_CONTRACT = `# AGENTS.md — VGAI Models Project

A standalone modeling project built with VGAI — Blender itself, compiled to
WebAssembly and running headless in the editor tab's worker, over this
project's own \`.blend\` files. Work here, not in the engine repo. The editor
is the authoring and verification surface; nothing here plays.

## Route the request first

| Intent | First action |
| --- | --- |
| Model, revise or add a model | \`src/models/<name>.blend\` — read \`src/models/cube.py\`'s docstring first |
| Open the editor, look, or verify | \`.agents/skills/editor/SKILL.md\` |
| Blender-style modeling craft | \`.agents/skills/vgai-3d-models/SKILL.md\` |

\`.agents/\` is canonical; \`.claude/skills/\` and \`.github/skills/\` are
generated projections (never edit); \`CLAUDE.md\` and
\`.github/copilot-instructions.md\` only point here.

## What a model is

A model is a \`.blend\` under \`src/models/\` — Blender's own document, opened,
edited and saved by the Blender running in the editor tab. Beside it sits the
bpy script that authored it (\`cube.blend\` / \`cube.py\`): the script is the
asset's SOURCE and stays in the project, the \`.blend\` is what the editor
opens. The document does not run the script — you do, through the session's
Blender:

\`\`\`bash
npm run --silent vgai -- blender-mcp    # the MCP transport onto the tab's Blender
\`\`\`

Every call is ordinary bpy against the open document, and the session saves it
about a second after your last call. The adapter's \`modelsFromBlendFiles\`
finder lists every \`.blend\` as a document. Coordinates are metres and Z is up
(Blender's); the glTF export converts to the game's Y-up.

## The editor

Workspaces: \`model\`, \`sculpt\`, \`texture\`, \`animate\`, \`design\`, \`look\`
(\`npm run --silent vgai -- eval 'editor.workspace("sculpt")'\`; a wrong id
refuses and names the list). The look and keymap are Blender's
(\`@volter/editor-blender\` contributes them). There is no Game workspace and
\`vgai play\` refuses: this project declares no roots.

## Verification contract — after every change

1. \`npm run typecheck\` — the gate.
2. Open the model's document and read the change through a door:
   \`npm run --silent vgai -- eval 'editor.currentView()'\` names the open
   document; \`npm run --silent vgai -- screenshot editor\` shows it; and
   \`get_scene_info\` over \`blender-mcp\` is what the engine itself says is in
   the file.
3. \`npm run --silent vgai -- console\` silent — an unresolved entry is
   remaining work, never noise.

## Commands

\\\`\\\`\\\`bash
npm run dev                            # open/reuse this project's editor
npm run --silent vgai -- status        # require connected: true
npm run --silent vgai -- screenshot    # visible evidence
npm run --silent vgai -- eval '<js>'   # THE door onto the editor
npm run typecheck                      # THE gate
\\\`\\\`\\\`

Always \`npm run --silent vgai -- <verb>\`, never a bare \`vgai\` (a global one may
belong to another checkout).
`;

/**
 * The agent contract a scaffold ships, decided by what the project HAS rather
 * than by a preset's name: a project that brings Blender and NO root brings
 * nothing that plays, so the template's game contract would be false in it
 * from the first line. Every other composition keeps the template's — an empty
 * project has no models either, and the game contract is the one that stays
 * true as the author adds roots to it.
 */
export function withAgentsContract(
  source: string,
  additions: ReadonlySet<ScaffoldAddition>,
): string {
  const plays = additions.has('three') || additions.has('ui');
  return additions.has('blender') && !plays ? MODELS_AGENTS_CONTRACT : source;
}

/** The finder selections the additions bring, as the adapter source spells
 *  them (`vgai.adapter.ts` `documents.find`). */
export const PAGES_FINDER_SELECTION =
  "{ finder: 'pagesFromUiModules', include: ['src/ui/**/*page.tsx'] }";
export const MODELS_FINDER_SELECTION =
  "{ finder: 'modelsFromBlendFiles', include: ['src/models/**/*.blend'] }";

/** The `ui` root's region declaration. A file's medium is its REGION
 *  (`file-region-resolver.ts`, rung 1: a declared include), and a root's
 *  entry never imports the stories written about it — so without this line
 *  `src/ui/game.stories.tsx` is reached by nothing and the editor reports it
 *  as an undeclared medium on every boot. Mirrors the template's `world`. */
export const UI_REGION_INCLUDE = "ui: {\n      include: ['src/ui/**/*.tsx'],\n    },";

/** The template's adapter (a 3D world's region and its scene and prefab
 *  finders) with what the OTHER additions bring joined in: their finders
 *  after `prefabsFromStories`, and the `ui` root's region beside `world`. */
export function joinAdditionFinders(
  adapterSource: string,
  additions: ReadonlySet<ScaffoldAddition>,
): string {
  const joined: string[] = [];
  if (additions.has('ui')) joined.push(PAGES_FINDER_SELECTION);
  if (additions.has('blender')) joined.push(MODELS_FINDER_SELECTION);
  if (joined.length === 0) return adapterSource;
  const withRegion = additions.has('ui')
    ? adapterSource.replace('regionIncludes: {', `regionIncludes: {\n    ${UI_REGION_INCLUDE}`)
    : adapterSource;
  return withRegion.replace(
    "{ finder: 'prefabsFromStories' },",
    `{ finder: 'prefabsFromStories' },${joined.map((f) => `\n      ${f},`).join('')}`,
  );
}

/** The adapter a project without a 3D world declares: no `world` region,
 *  the `ui` root's region if that addition is present, and only the finders
 *  its additions bring. */
export function adapterSourceFor(additions: ReadonlySet<ScaffoldAddition>): string {
  const finders: string[] = [];
  if (additions.has('ui')) {
    finders.push(PAGES_FINDER_SELECTION);
  }
  if (additions.has('blender')) {
    finders.push(MODELS_FINDER_SELECTION);
  }
  const regions = additions.has('ui')
    ? `\n  regionIncludes: {\n    ${UI_REGION_INCLUDE}\n  },`
    : '';
  const documents =
    finders.length > 0
      ? `\n  documents: {\n    find: [${finders.map((f) => `\n      ${f},`).join('')}\n    ],\n  },\n`
      : '';
  return `import { defineAdapter } from '@volter/editor-project/adapter/adapter-module';

export default defineAdapter({${regions}${documents}});
`;
}
