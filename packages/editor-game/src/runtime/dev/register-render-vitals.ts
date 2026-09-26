/**
 * THE DOOR for live render vitals: one provider and four commands on the
 * game's own debug registry (`runtime/debug-registry.ts`), so a running game
 * explains its own frame cost through the SAME seam every other reading and
 * verb uses — `game.state('render.vitals')` / `game.command('render.census')`
 * through `vgai eval`, and `game.providers()`/`game.commands()` to discover
 * them without being told they exist.
 *
 * Engine-owned and first-party, seeded by BOTH three-root mount paths — a game
 * writes nothing to get these, and there is no capability to install:
 *  - `editor-game/src/host/roots/r3f-root.tsx` (a TSX/R3F world — the shape EVERY
 *    scaffolded project's three root has), right after fiber's first commit
 *    resolves the scene.
 * Both is the whole point and not redundancy: they are two independent mounts
 * onto the same `Game`, and a door wired into only one of them is a door half
 * the engine's worlds never get (issue #1518 — the R3F half was dark
 * everywhere, found in the field on a package-native project).
 * The measurement half is `dev/render-vitals.ts`
 * (derived entirely from profiler frames); the address-book half is
 * `dev/render-census.ts` (pure walks over the live scene). This module is only
 * the wiring between them and the registry.
 *
 * ── THE READING AND THE EXPERIMENTS ─────────────────────────────────────────
 * A number alone does not route an investigation, so each command is the
 * experiment that turns one reading into an address:
 *  - `render.census`   — which subtree owns the meshes and triangles, with a
 *                        drill-down argument;
 *  - `render.families` — which meshes are identical enough to instance;
 *  - `render.toggle`   — hide a subtree and watch the stat move (the only way
 *                        to ATTRIBUTE cost rather than infer it);
 *  - `render.dpr`      — change the pixel count, which separates GPU fill cost
 *                        from vsync idle: render CPU that does not move when
 *                        the drawing buffer halves was never fill-bound.
 *
 * ── GATING ──────────────────────────────────────────────────────────────────
 * The caller gates. Both seeders call this only under `devBuildEnabled()`
 * (`runtime/dev-build.ts` — the ONE owner of "is this a dev context"), so a
 * ship build registers nothing and pays nothing. Each also requires a `Game`
 * shell (there is no profiler to fold without one) and a non-headless mount
 * (nothing brackets a submission, so the readings could only ever be empty).
 *
 * ── RESOURCE OWNERSHIP ──────────────────────────────────────────────────────
 * OWNER: {@link registerRenderVitals}'s caller. It allocates one
 * {@link RenderVitals} fold (which owns one `profiler.subscribe`), a SECOND,
 * self-ending `profiler.subscribe` for the static-batch advisory, and the
 * registrations, whose provenance is the caller's `worldId`. SHARERS: none.
 * TEARDOWN: the returned `dispose()` — the ONE path that ends both
 * subscriptions. The REGISTRATIONS are ended by the registry's own
 * `strip(worldId)`, which the adapter already runs on stop and warm restart;
 * this module never strips, because a blind strip here would take the game's
 * registrations with it.
 */

import * as THREE from 'three';
import { z } from 'zod';
import type { DebugRegistry } from '../debug-registry';
import type { PerformanceProfiler } from './performance-profiler';
import { findByName, meshFamilies, sceneCensus, structuralBatchScan } from './render-census';
import { createRenderVitals, type RenderVitals } from './render-vitals';
import {
  ADVISOR_SETTLE_FRAMES,
  decideStaticBatchAdvisory,
  warnStaticBatchAdvisory,
} from './static-batch-advisor';

/** The one provider name — spelled here, referenced everywhere else. */
export const RENDER_VITALS_PROVIDER = 'render.vitals';
export const RENDER_CENSUS_COMMAND = 'render.census';
export const RENDER_FAMILIES_COMMAND = 'render.families';
export const RENDER_TOGGLE_COMMAND = 'render.toggle';
export const RENDER_DPR_COMMAND = 'render.dpr';

/** The slice of `THREE.WebGLRenderer` `render.dpr` actuates. Narrow on
 *  purpose: a headless mount has no renderer at all and passes `null`. */
export interface RenderVitalsRenderer {
  getSize(target: THREE.Vector2): THREE.Vector2;
  setPixelRatio(value: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  getPixelRatio(): number;
  readonly domElement: { readonly width: number; readonly height: number };
}

export interface RenderVitalsRegistration {
  /** The live fold, exposed so a test can drive it without a registry. */
  readonly vitals: RenderVitals;
  /** See the ownership note — the ONE teardown path. Idempotent. */
  dispose(): void;
}

export interface RegisterRenderVitalsDeps {
  readonly registry: DebugRegistry;
  /** Registration provenance — the mount's adapter id, so the adapter's own
   *  `strip(worldId)` on stop/warm-restart removes exactly these. */
  readonly worldId: string;
  readonly profiler: PerformanceProfiler;
  /** The live scene the census walks. */
  readonly scene: THREE.Object3D;
  /** `null` under a headless mount — `render.dpr` then refuses by name rather
   *  than silently doing nothing. */
  readonly renderer: RenderVitalsRenderer | null;
}

const NO_RENDERER =
  'render.dpr: this world has no WebGL renderer (headless mount), so there is no pixel ratio ' +
  'to change. The other render.* commands still work — they read the scene graph.';

/**
 * Seed the vitals door for one world. Returns `null` when another live world
 * already owns the door: the names are fixed and discoverable on purpose, and
 * the registry (correctly) throws on a cross-world name collision, so the
 * FIRST three root to mount owns them. A second three root's draws still show
 * up in the readings — the profiler is game-scoped, so every world's
 * submission folds into the same frame — but the census commands address the
 * owning root's scene.
 */
export function registerRenderVitals(
  deps: RegisterRenderVitalsDeps,
): RenderVitalsRegistration | null {
  const { registry, worldId, profiler, scene, renderer } = deps;
  const taken = registry.adapter
    .providers()
    .some((provider) => provider.name === RENDER_VITALS_PROVIDER);
  if (taken) {
    // Loud, by name. This branch used to return `null` in silence, and a
    // silent decline is indistinguishable from a door that was never seeded —
    // which is precisely how issue #1518 stayed a mystery through a field
    // session: every hypothesis about WHY the door was closed had to be
    // guessed, because nothing on any path said anything. It costs one line to
    // make the one legitimate decline explain itself, and the same line names
    // the mount/teardown OVERLAP case (a re-mount seeding before the outgoing
    // mount's `strip()` runs), where the second world would otherwise lose the
    // door and no log would mention it.
    console.warn(
      `[render-vitals] world "${worldId}" did not get the ${RENDER_VITALS_PROVIDER} door: ` +
        'another live world already owns it (the names are fixed, so the first three root to ' +
        'mount wins). Its draws still fold into the readings — the profiler is game-scoped — ' +
        'but render.census/families/toggle address the owning root. If this world IS the ' +
        'current one, the previous mount was torn down AFTER this one seeded and its ' +
        'strip() took the door with it.',
    );
    return null;
  }

  const vitals = createRenderVitals(profiler);
  const debug = registry.forRoot(worldId);

  debug.registerStateProvider(RENDER_VITALS_PROVIDER, () => vitals.read());

  debug.registerCommand(
    RENDER_CENSUS_COMMAND,
    {
      description:
        'Visible meshes and triangles per subtree — the address book behind the draw-call ' +
        'reading. Pass a subtree name (as listed by a previous census) to drill into it.',
      args: z.tuple([z.string().optional()]),
      locus: 'client',
    },
    (subtree) => {
      if (subtree === undefined || subtree === '') return sceneCensus(scene);
      const node = findByName(scene, subtree);
      if (!node) {
        throw new Error(
          `render.census: no node named "${subtree}" in this world. Run render.census with no ` +
            'argument to list the addressable subtrees.',
        );
      }
      return sceneCensus(node, subtree);
    },
  );

  debug.registerCommand(
    RENDER_FAMILIES_COMMAND,
    {
      description:
        'Meshes grouped by shared (geometry, material) identity, largest group first — the ' +
        'instancing shortlist for a draw-call diet. `structural` is the same scan keyed by ' +
        'VALUE instead of object identity: what would collapse under a <Frozen> wrapper ' +
        '(vgai add static-batch) even when every mesh carries its own inline material.',
      args: z.tuple([]),
      locus: 'client',
    },
    // Two readings, deliberately: the identity families (what can be instanced
    // as the scene stands) and the STRUCTURAL scan (what would collapse if the
    // same draws were batched by value). A world writing inline materials —
    // every fresh scaffold — has families of one and a large structural win,
    // and reporting only the first would say "nothing to do" about the exact
    // scene the `static-batch` capability exists for.
    () => ({ ...meshFamilies(scene), structural: structuralBatchScan(scene) }),
  );

  debug.registerCommand(
    RENDER_TOGGLE_COMMAND,
    {
      description:
        'Show/hide a named subtree (as listed by render.census) and read render.vitals again — ' +
        'the difference is what that subtree costs.',
      args: z.tuple([z.string()]),
      locus: 'client',
    },
    (name) => {
      const node = findByName(scene, name);
      if (!node) {
        throw new Error(
          `render.toggle: no node named "${name}" in this world. Run render.census to list the ` +
            'addressable subtrees.',
        );
      }
      node.visible = !node.visible;
      return { name, visible: node.visible };
    },
  );

  debug.registerCommand(
    RENDER_DPR_COMMAND,
    {
      description:
        'Set the renderer pixel ratio (retina default is ~2) to probe GPU fill cost — render CPU ' +
        'that does not move when the drawing buffer shrinks was never fill-bound.',
      args: z.tuple([z.number().positive().max(8)]),
      locus: 'client',
    },
    (ratio) => {
      if (!renderer) throw new Error(NO_RENDERER);
      const size = renderer.getSize(new THREE.Vector2());
      renderer.setPixelRatio(ratio);
      // `updateStyle: false` — the CSS size is the layout's, not ours to
      // change; only the drawing buffer moves, which is the whole experiment.
      renderer.setSize(size.x, size.y, false);
      return {
        pixelRatio: renderer.getPixelRatio(),
        drawingBuffer: { width: renderer.domElement.width, height: renderer.domElement.height },
      };
    },
  );

  // --- The static-batch advisory (issue #1503) -------------------------------
  // A reading nobody asks for is a reading nobody gets, so the measurement
  // routes itself: once the frame rate has settled, scan ONCE, and if this
  // world is paying for draws it does not have to, name the exact wrapper on
  // the console (`dev/static-batch-advisor.ts` owns the decision and the
  // wording; this owns only WHEN).
  //
  // It rides the profiler subscription rather than a timer because the trigger
  // is presented frames, not wall time: a tab that never presents (hidden,
  // headless) should never scan, and a slow boot should not be measured before
  // its assets are in the graph. The subscription ends itself the moment it
  // fires or the advisory turns out to be `null`.
  let stopAdvisor: (() => void) | null = null;
  let advised = false;
  const advisorTick = (): void => {
    if (advised) return;
    if (vitals.read().presentedFrames < ADVISOR_SETTLE_FRAMES) return;
    advised = true;
    stopAdvisor?.();
    stopAdvisor = null;
    const advisory = decideStaticBatchAdvisory({
      drawCalls: vitals.read().drawCalls,
      census: sceneCensus(scene),
      structural: structuralBatchScan(scene),
    });
    if (advisory) warnStaticBatchAdvisory(advisory);
  };
  stopAdvisor = profiler.subscribe(advisorTick);

  let disposed = false;
  return {
    vitals,
    dispose() {
      if (disposed) return;
      disposed = true;
      stopAdvisor?.();
      stopAdvisor = null;
      vitals.dispose();
    },
  };
}
