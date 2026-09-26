// T3.1 slice 1 — the game manifest schema (`vgai.project.json`).
//
// This is the serialized form of the Game's root list for the adjudicated
// field list this file implements exactly. `load.ts` is this schema's runtime
// reader (T4.1 policy): it parses via this schema, then layers the
// cross-field checks and default resolution §3/§5 describe. Every field below
// has a `.describe()` (repo policy — powers `scripts/generate-schema.ts` and
// the T4.1 schema-walk coverage test).
//
// Naming: `XxxSchema` is the Zod schema, `Xxx` the inferred type. Every schema
// file in this repo reads that way, so the bare names stay reserved for the
// types.
//
// Adapter surface values mirror `AdapterSurface` in
// `packages/game-runtime/src/runtime/game.ts` (`'three' | 'canvas' | 'dom'`)
// by value, not by import. The adapter remains the sole root discriminator.

import { z } from 'zod';

/**
 * Current on-disk `vgai.project.json` format. Exported so editor/server
 * compatibility checks do not duplicate the schema's literal value.
 */
export const GAME_MANIFEST_VERSION = 2 as const;

// ---------------------------------------------------------------------------
// Root adapter identity. The adapter is the sole discriminator: a root never
// repeats its rendering substrate in a sibling `kind` field. Module and ingest
// adapters carry the surface their adapter contract exposes because the host
// must allocate a layer before the module has mounted.
//
// The surface vocabulary is `three | canvas | dom` — what the HOST HANDS the
// root, not which library it uses. `canvas` and `dom` are platform primitives:
// a canvas root may be Pixi, Phaser, Babylon, raw WebGL/WebGPU or a 2D context,
// and a dom root may be React, Vue, Svelte or plain HTML, all through the
// identical host. The former `canvas`/`react` named two libraries in a seam
// that has nothing to do with either, which foreclosed the rest by
// construction.
//
// All three surfaces are legal as a BARE adapter string: each names a root the
// editor itself mounts from an `entry` module — `three` through the R3F lane
// (`editor-game/src/host/roots/r3f-root.tsx`), `canvas` through the Pixi lane
// (`@vgai/game-runtime/canvas-react`), `dom` through the React lane. In every case the
// entry's document is its own TSX source. A root the engine does NOT mount
// arrives as an `{ ingest }` root or a `{ module }` adapter the project
// supplies, both of which name their `surface` explicitly.
//
// `three` earns a kind of its own because the host must provide something the
// platform cannot: the ONE shared `three` instance (identity matters — ingest
// games bring their own, and r3f depends on dedupe). React needs no equivalent,
// which is exactly why react is a `dom` root rather than its own kind.
//
// The pre-rename spellings `threejs`/`pixijs`/`react` are REMOVED, not
// normalized (the legacy-removal doctrine at
// ARCHITECTURE-CORE §Vocabulary). Normalization was a second way to say the
// same thing: two spellings both parsed, so both kept being written, and
// SECOND readers grew (the dev server's surface probe, the hosted-editor
// bundler's alias sets) each re-implementing the same map. A manifest naming
// an old spelling now fails to parse with an issue that names the canonical
// value and the exact one-line edit.
// ---------------------------------------------------------------------------

/** Removed spellings → the canonical value each one must be rewritten to. */
const REMOVED_SURFACE_SPELLING: Readonly<Record<string, 'three' | 'canvas' | 'dom'>> = {
  threejs: 'three',
  pixijs: 'canvas',
  react: 'dom',
};

/** Removed spellings legal as a BARE adapter (a root the engine itself mounts). */
const REMOVED_BARE_ADAPTER_SPELLING: Readonly<Record<string, 'three' | 'canvas' | 'dom'>> = {
  threejs: 'three',
  pixijs: 'canvas',
  react: 'dom',
};

function removedSpellingMessage(bad: string, where: 'adapter' | 'adapter.surface'): string {
  const canonical =
    where === 'adapter' ? REMOVED_BARE_ADAPTER_SPELLING[bad] : REMOVED_SURFACE_SPELLING[bad];
  return (
    `Game manifest: \`${where}\`: "${bad}" — that spelling was REMOVED ` +
    '(ARCHITECTURE-CORE §Vocabulary). The surface vocabulary is ' +
    "'three' | 'canvas' | 'dom' — what the HOST HANDS the root, never which " +
    `library it uses.\nFix: change \`${where}\` to "${canonical}".`
  );
}

/** Reject a removed surface spelling wherever one may appear — the bare
 *  shorthand, or the `surface` field of a module/ingest adapter — with an issue
 *  naming the canonical value. Runs as a Zod preprocess so the message wins
 *  over the union's generic discriminant error. */
function rejectRemovedRootAdapterSpelling(value: unknown, ctx: z.core.$RefinementCtx): unknown {
  if (typeof value === 'string' && REMOVED_BARE_ADAPTER_SPELLING[value]) {
    ctx.addIssue({ code: 'custom', message: removedSpellingMessage(value, 'adapter') });
    return z.NEVER;
  }
  if (value && typeof value === 'object' && 'surface' in value) {
    const surface = (value as { surface?: unknown }).surface;
    if (typeof surface === 'string' && REMOVED_SURFACE_SPELLING[surface]) {
      ctx.addIssue({
        code: 'custom',
        message: removedSpellingMessage(surface, 'adapter.surface'),
      });
      return z.NEVER;
    }
  }
  return value;
}

export const RootAdapterSchema = z
  .preprocess(
    rejectRemovedRootAdapterSpelling,
    z.union([
      z.enum(['three', 'canvas', 'dom']),
      z
        .object({
          module: z
            .string()
            .describe('Game-folder-relative path to a custom adapter module (trust boundary)'),
          surface: z
            .enum(['three', 'canvas', 'dom'])
            .describe('Native surface exposed by this custom adapter contract'),
        })
        .strict(),
      z
        .object({
          surface: z
            .enum(['three', 'canvas', 'dom'])
            .describe('Native surface captured from the unmodified game'),
          ingest: z
            .object({
              contractShim: z
                .string()
                .optional()
                .describe(
                  "Project-relative path to a HOST-ADDED ES module that declares this game's " +
                    '`window.vgaiGame` contract (adapter/ingest/game-contract.ts) WITHOUT editing a ' +
                    'vendored byte — the pristine-copy door. The host imports it immediately BEFORE ' +
                    "the game's own entry module, in the editor's realm. " +
                    'TIMING CONTRACT, which a shim author must obey: because it runs before the ' +
                    'game`s entry, it MUST assign `window.vgaiGame` SYNCHRONOUSLY at top level. ' +
                    'Anything that needs the game`s own modules must be LAZY: a dynamic `import()` ' +
                    'INSIDE each verb/provider closure, resolved at call time. Importing a game module ' +
                    'eagerly from the shim would evaluate it ahead of the game`s own entry and reorder ' +
                    'its module side effects. ' +
                    'Every such `import()` MUST take a STRING LITERAL, never a variable/table lookup. ' +
                    'A variable specifier is not statically analyzable, so the dev server leaves it ' +
                    'alone and it resolves at runtime against the shim`s own `/@fs/` url — while the ' +
                    'game`s entry has had ITS relative imports rewritten to whatever url the server ' +
                    'considers canonical for those files. Module identity is per-url, so the shim ' +
                    'silently binds a SECOND, freshly-evaluated copy of the whole game and every ' +
                    'provider reports a game that never started. Measured on a vendored three ' +
                    'game: 285 world segments through the game`s own graph, 0 through the shim`s, ' +
                    'and no error anywhere.',
                ),
              dataWriter: z
                .string()
                .optional()
                .describe(
                  "Project-relative path to a HOST-ADDED ES module that writes this game's own " +
                    'DATA file back — the sibling of a source write for a game whose authorable ' +
                    'truth is not source. A level-based game places its enemies, pickups and ' +
                    'objectives in binary records inside a level file, reaching no source ' +
                    'literal, so an ' +
                    'authored move of one is an edit to that file and nothing else can write it. ' +
                    'The module declares two exports and the host knows nothing else about it: ' +
                    '`dataFile` (a project-relative string — the ONE file this writer edits) and ' +
                    '`planDataEdit(bytes, {record, property, baseline, next})`, which returns ' +
                    '`{changed: true, bytes}` or `{changed: false, reason}` and may be async. ' +
                    'It is loaded in the editor realm beside the game, so it may `import()` the ' +
                    "game's own modules to resolve what only a running game knows (a level " +
                    'writer asks the game`s own spatial lookup which cell a moved object ' +
                    'landed in, and refuses "outside the level" rather than writing data the game ' +
                    'would read back wrong). It NEVER fabricates: a record it cannot address, or ' +
                    'a property it does not model, is a named refusal. ' +
                    'An object is anchored to a record by carrying `userData.vgaiRecordIndex` — ' +
                    'the game declares that identity itself (a recorded patch or a shim); the ' +
                    'host never infers one.',
                ),
              assets: z
                .record(z.string(), z.string())
                .optional()
                .describe(
                  'Path-substring -> served-URL rewrites for this ingested game (IngestGame.assets today)',
                ),
              moduleAliases: z
                .record(z.string(), z.string())
                .optional()
                .describe(
                  "The game's OWN bundler path aliases, restated as a mounting fact so its " +
                    'source resolves unedited. A game built with its own Vite/webpack config ' +
                    'routinely imports itself through an alias (`~/lib/config`, `@/store/x`); the ' +
                    "editor boots Vite from the ENGINE's config and never reads a game's own, so " +
                    'without this every such import is an unresolvable specifier and the mount dies ' +
                    'at transform time. Key = the specifier PREFIX exactly as the game writes it ' +
                    '("~/"); value = the repo-root-relative directory it means ' +
                    '("/vendor/games/<id>/src/"). SELF-SCOPING: the host honors an entry only for ' +
                    "importers inside the vendored game folder the value points into, so one game's " +
                    "alias can never capture another module's import. Rewriting the game's own " +
                    'imports instead would be a large non-seam-shaped diff against unmodified ' +
                    'source — this declares the fact rather than editing it away.',
                ),
              domStubs: z
                .array(z.string())
                .optional()
                .describe(
                  'DOM API stub ids this ingested game requires to run headlessly/in-realm',
                ),
              captureTimeoutMs: z
                .number()
                .optional()
                .describe(
                  "How long the host waits for this game's first captured frame before the mount " +
                    'FAILS by name. A game that needs a long boot (streamed world assets, a menu ' +
                    'the player must clear) raises it; the default is 10s.',
                ),
            })
            .strict()
            .describe(
              'Ingest adapter configuration for an unmodified game (a repo-vendored game or your ' +
                'own external folder)',
            ),
        })
        .strict(),
    ]),
  )
  .describe(
    "Root adapter identity: built-in 'three'/'canvas'/'dom' (what the host hands " +
      "the root — 'canvas' covers Pixi/Phaser/Babylon/raw WebGL, 'dom' covers " +
      'React/Vue/plain HTML), a custom { module, surface } adapter, or an ' +
      '{ ingest, surface } adapter for an unmodified game.',
  );
export type RootAdapter = z.infer<typeof RootAdapterSchema>;

// ---------------------------------------------------------------------------
// Root entry
// ---------------------------------------------------------------------------

export const AdapterRootSchema = z
  .object({
    id: z
      .string()
      .describe(
        'Unique id for this root within the manifest (enforced-unique, D-V6 — GameManifestSchema.roots rejects duplicates)',
      ),
    description: z
      .string()
      .optional()
      .describe(
        "Optional one-line description of this root's game/content (e.g. an ingested game's " +
          "blurb — the manifest-native replacement for a registry entry's description field)",
      ),
    adapter: RootAdapterSchema.describe(
      "This root's adapter and sole rendering/lifecycle discriminator",
    ),
    entry: z
      .string()
      .optional()
      .describe(
        'Module exporting a world root — a TSX/R3F component or a setup()/adapter (three), or a ' +
          'React component (dom). Required for every built-in adapter root.',
      ),
    styles: z
      .array(z.string())
      .optional()
      .describe(
        "Project-root-relative CSS files this root's mount needs — the PAGE-level stylesheet a " +
          'game written to own a browser tab keeps its layout in (an ingested game is the ' +
          'standing case: its own entry imported the sheet, the host shim that replaces that ' +
          'entry cannot, because `html`/`body`/`*` rules would restyle the editor). Declared ' +
          'here, the editor serves each file rewritten to apply ONLY inside the container it ' +
          "mounts the root's DOM in (`@scope`; packages/editor/server/scoped-game-css.ts), so " +
          "the HUD is styled on the UI board's story cards and on the game surface without the " +
          'editor seeing a single one of those rules. The files themselves are never modified.',
      ),
    world: z
      .object({
        entry: z
          .string()
          .describe("Project-relative path to the game's OWN module exporting that component"),
        export: z
          .string()
          .optional()
          .describe(
            'Named export to read from that module; omit when the module default-exports it',
          ),
      })
      .strict()
      .optional()
      .describe(
        "The component this root's WORLD is, in the game's own source. Two readers, and they " +
          "mount different things: the EDITOR mounts THIS component alone as the root's " +
          'design-time document, while `entry` above stays what PLAY mounts (the whole game — ' +
          'its own composition, its own HUD, its own loop). It sits on the ROOT rather than ' +
          'inside any one adapter because the split it names is not about ingest: a game whose ' +
          'runtime entry is a SHELL over the thing an author actually edits has this shape ' +
          'whether the source is vendored or first-party. Two shipped cases, one field: an ' +
          'ingested game whose `entry` mounts game+HUD+loop while the named export is the world ' +
          'alone; and a translated Unity/Godot port, whose `entry` is a scene HOST that mounts ' +
          'the scene the built player starts on (`EditorBuildSettings` index 0 — routinely a ' +
          'menu with no 3D content at all) while the named export opens the scene an author ' +
          "edits. That is Unity's own split: build settings say where the PLAYER starts; the " +
          'Scene view opens a scene, and Unity keeps that fact somewhere else entirely. A game ' +
          'whose world is not a separate component omits this and keeps mounting through ' +
          '`entry` in both modes.',
      ),
    zOrder: z
      .number()
      .int()
      .default(0)
      .describe('Canvas stacking order; ties broken by array order'),
    pausable: z
      .boolean()
      .default(true)
      .describe('Whether play-mode pause/step applies to this root'),
    loop: z
      .enum(['gated', 'self-driven'])
      .default('gated')
      .describe(
        'gated: host-driven loop (default). self-driven: this root drives its own loop ' +
          '(composited, unsynchronized)',
      ),
  })
  .strict();
export type AdapterRoot = z.infer<typeof AdapterRootSchema>;

/**
 * The MEDIUM a root occupies — its surface, i.e. what the host hands it. A
 * bare adapter string names its own surface; `{ module, surface }` and
 * `{ ingest, surface }` name it explicitly. Bucketing by surface is what makes
 * a first-party `@pixi/react` world, an ingested canvas game and a custom
 * canvas module ONE medium: they all compete for the same canvas surface, and
 * which library draws on it is not what the rule below is about.
 */
function rootMedium(root: AdapterRoot): 'three' | 'canvas' | 'dom' {
  return typeof root.adapter === 'string' ? root.adapter : root.adapter.surface;
}

// ---------------------------------------------------------------------------
// Learn metadata (FT-5)
// ---------------------------------------------------------------------------

export const LearnKindSchema = z
  .enum(['starter', 'feature', 'sample-game', 'lesson-companion'])
  .describe(
    'Content kind in the FTUE taxonomy (§3): starter (minimal per-genre starting point), ' +
      'feature (demonstrates a subsystem), sample-game (complete game as an architectural ' +
      'reference), lesson-companion (exists to back a Learn-site lesson)',
  );
export type LearnKind = z.infer<typeof LearnKindSchema>;

export const LearnDifficultySchema = z
  .enum(['beginner', 'intermediate', 'advanced'])
  .describe('Learner-facing difficulty rating');
export type LearnDifficulty = z.infer<typeof LearnDifficultySchema>;

export const LearnMetadataSchema = z
  .object({
    kind: LearnKindSchema,
    title: z.string().min(1).describe('Learner-facing display title (gallery card headline)'),
    summary: z.string().min(1).describe('One-sentence learner-facing summary (gallery card body)'),
    difficulty: LearnDifficultySchema,
    features: z
      .array(z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'features tags must be kebab-case'))
      .describe('Short kebab-case feature tags used as gallery/catalog filter facets'),
    thumbnail: z
      .string()
      .optional()
      .describe(
        'Optional thumbnail image reference, PROJECT-relative (canonical path: ' +
          'learn/thumbnail.png — the §3 schema path). Generated per FT-11 by the deterministic ' +
          'render tooling (scripts/generate-learn-thumbnails.ts), never hand-made',
      ),
    preview: z
      .string()
      .optional()
      .describe(
        'Optional short preview video/loop reference, PROJECT-relative (canonical path: ' +
          'learn/preview.mp4; generated per FT-11)',
      ),
    lesson: z
      .string()
      .optional()
      .describe(
        'Optional Learn-site lesson URL that teaches this project 1:1 ' +
          '(e.g. https://vgai-learn.pages.dev/manual/physics/joints/)',
      ),
  })
  .strict()
  .describe(
    'Learner-facing metadata (FT-5) — powers the example ' +
      'gallery, New Project wizard, and Learn-site catalog. Registries are generated from this ' +
      'block; there is no parallel hand-edited catalog.',
  );
export type LearnMetadata = z.infer<typeof LearnMetadataSchema>;

// ---------------------------------------------------------------------------
// Game manifest (vgai.project.json)
// ---------------------------------------------------------------------------

/** The envelope of one run configuration; the kind's schema takes the rest. */
const ConfigurationEnvelopeSchema = z
  .object({
    id: z.string().min(1).describe('Configuration id, unique in the manifest'),
    kind: z.string().min(1).describe('A registered run kind'),
  })
  .passthrough();

export const GameManifestSchema = z
  .object({
    $schema: z
      .string()
      .optional()
      .describe('Optional JSON Schema URI for editor autocomplete and validation'),
    manifestVersion: z
      .literal(GAME_MANIFEST_VERSION)
      .describe('Manifest file format version (v2 clean roots)'),
    name: z.string().describe('Game display name'),
    appId: z
      .string()
      .optional()
      .describe('Stable reverse-domain application id used by packaged targets'),
    version: z.string().describe("The game's own version (used for orphan detection)"),
    engine: z
      .object({
        version: z
          .string()
          .describe(
            'Exact @volter/editor-project semver this game was scaffolded/last upgraded against — an ' +
              'identity pin, not a range',
          ),
      })
      .strict()
      .describe('Engine version pin'),
    roots: z
      .array(AdapterRootSchema)
      .superRefine((roots, ctx) => {
        // D-V6 (debt): root ids are described as unique above but that was
        // describe-only at the SCHEMA level — only load.ts's loader-level
        // cross-field check caught a collision, so any OTHER consumer of this
        // schema (the generated JSON Schema, editor tooling) saw duplicate
        // ids as legal. Enforced HERE instead, naming every colliding id (not
        // just the first found) — a root id is the key every per-world editor
        // surface is addressed by, so a silently-permitted duplicate would
        // have two roots silently collide.
        const counts = new Map<string, number>();
        for (const root of roots) counts.set(root.id, (counts.get(root.id) ?? 0) + 1);
        const duplicates = [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
        if (duplicates.length > 0) {
          const idsText = duplicates.map((id) => `"${id}"`).join(', ');
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              duplicates.length === 1
                ? `Game manifest: duplicate root id ${idsText} — root ids must be unique across the manifest (enforced-unique).`
                : `Game manifest: duplicate root ids: ${idsText} — root ids must be unique across the manifest (enforced-unique).`,
          });
        }

        // A project has at most ONE world root per MEDIUM (owner-ratified).
        // The medium is the surface (see `rootMedium`), so `three`, `dom` and
        // the canvas surface are the three buckets — a first-party canvas
        // world, a canvas ingest and a canvas module are the SAME medium.
        //
        // Enforced here rather than left to the reader because the editor
        // mounts exactly one root per medium (`resolveFocusedThreejsRootId`
        // is a `find`, and the design-time layer stack hosts the one dom
        // root): a second root of the same medium parsed cleanly and was then
        // silently never mounted, which is the failure mode this rejects.
        //
        const idsByMedium = new Map<string, string[]>();
        for (const root of roots) {
          const medium = rootMedium(root);
          const ids = idsByMedium.get(medium);
          if (ids) ids.push(root.id);
          else idsByMedium.set(medium, [root.id]);
        }
        for (const [medium, ids] of idsByMedium) {
          if (ids.length < 2) continue;
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              `Game manifest: a project has at most one ${medium} world root — ` +
              `${ids.map((id) => `"${id}"`).join(', ')} all occupy the ${medium} surface. ` +
              'Keep one and remove the rest, or move a root to a different medium ' +
              "(three / canvas / dom); only one root per medium is ever mounted, so a second one's " +
              'content would never appear.',
          });
        }
      })
      .describe(
        "The project's explicit adapter-root composition — ZERO OR MORE roots, and no implicit root: a project with no roots mounts nothing (a library of models, a folder of documents) and the editor derives its chrome from what IS declared. " +
          'Root ids are unique, and a project declares at most ONE world root per medium — ' +
          'one `three`, one `dom`, one canvas-surface root (first-party canvas, canvas ingest ' +
          'and canvas module are the same medium).',
      ),
    authoring: z
      .object({
        hierarchy: z
          .object({
            rootLabels: z
              .record(z.string(), z.string())
              .optional()
              .describe('Optional editor labels keyed by adapter-root id'),
            groups: z
              .array(
                z
                  .object({
                    id: z.string().describe('Unique editor-only group id'),
                    label: z.string().describe('Editor-only group label'),
                    roots: z
                      .array(z.string())
                      .min(1)
                      .describe('Adapter-root ids shown under this editor-only group'),
                  })
                  .strict(),
              )
              .optional()
              .describe('Optional editor-only hierarchy groups'),
          })
          .strict()
          .optional()
          .describe('Editor projection for native adapter roots'),
      })
      .strict()
      .optional()
      .describe('Editor-only authoring metadata; never runtime ownership'),
    configurations: z
      .array(ConfigurationEnvelopeSchema)
      .optional()
      .describe(
        "The project's run configurations — its ENTRYPOINTS beyond the host mount (`play`): each an " +
          'id and a registered kind (`process`, `compound`, and whatever a capability registers) with ' +
          "that kind's own fields. The editor's transport, `vgai run <id>` and a harness start the same declaration.",
      ),
    resolution: z
      .object({
        width: z.number().describe('Canvas width in pixels'),
        height: z.number().describe('Canvas height in pixels'),
      })
      .strict()
      .optional()
      .describe('Canvas resolution'),
    rendering: z
      .object({
        antialias: z
          .boolean()
          .describe(
            'Whether every three root is built with a multisampled drawing buffer. This is the ' +
              'ONE render property a world cannot declare for itself (adapter/' +
              'renderer-config.ts): a WebGL context fixes its sample count at CREATION from this ' +
              'boolean, long before a world mounts, so it belongs to the PROJECT. The runtime ' +
              'reader is mount-manifest.ts, which threads it into createHostRenderer for each ' +
              'three root. WebGL exposes no sample COUNT — the implementation picks one (4x on ' +
              'every desktop browser measured), so a source engine that authored 8x/16x gets ' +
              'multisampling but not its exact count.',
          ),
      })
      .strict()
      .optional()
      .describe(
        'Construction-time renderer properties, which no world can declare after the fact. ' +
          'Everything a world CAN declare (tone mapping, output colour space, clear colour, ' +
          "shadow filter) lives on the world's own renderer config instead.",
      ),
    debug: z
      .object({
        allowInProduction: z
          .boolean()
          .describe(
            'Allow the ?vgai-debug=1 introspection bridge and debug-command invocation in ' +
              'production builds. Default false: the bridge only installs in dev builds. The ' +
              'runtime reader is the debug-bridge installer (D18).',
          ),
      })
      .strict()
      .optional()
      .describe(
        'Debug-bridge production gating (D18) — governs whether ?vgai-debug=1 installs ' +
          'window.__vgai outside dev builds.',
      ),
    determinism: z
      .object({
        seededRandom: z
          .boolean()
          .describe(
            'Declares that ALL gameplay RNG in this project flows through ctx.random (the ' +
              'named-stream seeded PRNG) rather than raw ' +
              'Math.random/Date.now/performance.now. Three runtime enforcers key off this flag: ' +
              'the boot-time seeding reader (mount-manifest.ts seeds ctx.random from ' +
              'defaultSeed/?vgai-seed=/explicit config, in that precedence, only when true), the ' +
              'gameplay-rng-ban burn-down scan (test/gameplay-rng-ban.test.ts — lints this ' +
              "project's src/ for raw RNG/wall-clock calls), and the dev-mode Math.random phase " +
              'trap (runtime/gameplay-rng-trap.ts — warns once per call site during a gameplay ' +
              'frame, never throws). Default false: an undeclared project gets no determinism ' +
              'contract at all (that IS the opt-out — no dead field).',
          ),
        defaultSeed: z
          .number()
          .int()
          .optional()
          .describe(
            'The seed ctx.random boots from when seededRandom is true, unless overridden by ' +
              '?vgai-seed=<int> (the query param always wins over this manifest default) or an ' +
              'even higher-precedence explicit config value a host passes directly. Optional — ' +
              "omit to fall back to the runtime's own fixed default seed.",
          ),
      })
      .strict()
      .optional()
      .describe(
        'Seeded-RNG determinism contract (D15) — governs ' +
          'whether ctx.random is boot-seeded from a reproducible seed and whether the ' +
          'gameplay-rng-ban scan / dev-mode Math.random phase trap are active for this project.',
      ),
    budget: z
      .object({
        frameCpuMsP95: z
          .number()
          .positive()
          .optional()
          .describe(
            'Maximum allowed p95 of per-frame CPU time (ms) across the measured frames of a ' +
              '`vgai perf` seeded headless run. CPU-side only: headless runs rasterize under ' +
              'SwiftShader, so this is main-thread frame cost, NOT real GPU frame time. ' +
              'Machine-dependent — prefer the baseline-diff tolerance band for regression ' +
              'gating and use this as a coarse absolute ceiling.',
          ),
        physicsMsP95: z
          .number()
          .positive()
          .optional()
          .describe(
            "Maximum allowed p95 of the profiler's `physics` phase time (ms) per fixed-step " +
              'frame in a `vgai perf` run. Same CPU-timing caveats as frameCpuMsP95.',
          ),
        maxEntities: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            'Maximum allowed entity-tagged scene-graph nodes (nodes carrying ' +
              "userData.entityId) summed across the game's three/canvas worlds at the end " +
              'of a `vgai perf` run. Exact and deterministic under a seed — no tolerance band.',
          ),
        maxDrawCalls: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Maximum allowed renderer draw calls in any measured frame of a `vgai perf` run ' +
              "(the profiler's per-frame render.drawCalls, from renderer.info). Exact and " +
              'deterministic under a seed.',
          ),
        maxTriangles: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Maximum allowed rendered triangles in any measured frame of a `vgai perf` run ' +
              "(the profiler's per-frame render.triangles, from renderer.info). Exact and " +
              'deterministic under a seed.',
          ),
      })
      .strict()
      .refine((budget) => Object.values(budget).some((value) => value !== undefined), {
        message:
          'Game manifest: `budget` must set at least one metric (frameCpuMsP95, physicsMsP95, ' +
          'maxEntities, maxDrawCalls, maxTriangles) — an empty budget block gates nothing ' +
          '(the no-dead-fields policy).',
      })
      .optional()
      .describe(
        'Performance budget (W3d, F11 perf regression gates) asserted by ' +
          '`vgai perf --assert-budget`: a seeded, fixed-step headless run samples the engine ' +
          'profiler and fails (nonzero exit) when any metric here is exceeded. Only ' +
          'headlessly-measurable metrics are budgetable; real GPU frame time is not (SwiftShader).',
      ),
    learn: LearnMetadataSchema.optional().describe(
      'Optional learner-facing metadata (FT-5) — set on shipped example projects so the ' +
        'gallery/wizard/Learn-catalog registries can be generated from the manifest itself',
    ),
  })
  .strict()
  .describe('Game manifest (vgai.project.json) — the complete v2 project configuration');

export type GameManifest = z.infer<typeof GameManifestSchema>;
