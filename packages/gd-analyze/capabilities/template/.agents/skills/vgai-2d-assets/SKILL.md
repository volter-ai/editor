---
name: vgai-2d-assets
description: Every 2D asset a vgai game ships — world sprites, animation cycles, tiles, HUD icons and glyphs — authored by the agent through native systems and delivered in the consuming surface's own form. Use whenever a canvas (PixiJS) game needs characters, pickups, projectiles, or ground art; whenever ANY game's dom HUD needs icons or vector UI art; when wiring a sprite atlas, animation cycles, or a tiling floor; or when a user brings their own sprite sheets. For pixel-art (grid) style, route to vgai-pixel-art after reading the doctrine here. Do not use for 3D assets (vgai-3d-assets), AI-provider generation (vgai-generative-assets), or runtime gameplay behavior.
---

# VGAI 2D Assets

**The agent is the 2D artist, and SVG is its interchange.** The rule that
generates everything else in this skill: **author vector source; bake only
where the consuming surface needs a file.** A rig is ordinary TypeScript
that EMITS a standard SVG document with named groups, plus a pose function
(phase → per-group transforms) — the `.svg` never lives on disk as an
asset; the program is the source and SVG is the representation every
consumer speaks. Never an invented rig format. From that
one source: the Pixi world gets baked atlas frames (textures batch, cycles
want fixed frames), the dom HUD gets the SVG inline (the web ships vectors
natively — no file, themable via `currentColor`), and a glyph both surfaces
need is ONE source consumed twice. The baked artifact is a BUILD of the rig,
recorded in provenance; the rig code stays in the project as the asset's
source, which is where a change request lands (edit → re-bake), exactly as
a 3D character's kit source outlives its GLB.

## Sprites are the default. "Does the game need the rig?"

Bake to sprites by default — the hero included. Keep articulation live only
where a game rule reads or writes a part's pose: an aim pivot on a turret,
a drake's segment chain, a boss tail with its own hitbox. A part whose pose
is game state is an ENTITY and must be a live node (hit-testable, in the
hierarchy, drivable); parts on either side of that joint are still baked
sprites. A rig is something you add joints to, not something you choose
instead of sprites. Purely presentational motion — a hop cycle over a
contact-circle hitbox — is frames, and belongs in the atlas.

## The REQUIRED floor — every shipped 2D asset

1. **A named prefab component in its own file** (`src/prefabs/<Name>.tsx`),
   pure and prop-driven — sim reads live in the actor wrapper, never the
   prefab, so the story renders exactly what the match renders.
2. **A colocated CSF story whose `meta.component` names it.** Canvas
   stories carry their own `<Application>` decorator and gate on the real
   atlas — a story frame shows the shipped bytes, not a stand-in.
3. **The atlas is the artifact**: one `public/sprites/<name>.png` +
   spritesheet JSON with a named `animations` map, written ONLY by the
   registered bake tool through the project-outputs door so
   `.vgai/provenance.json` records it atomically. Never hand-place binaries
   under `public/`, never hand-write provenance.
4. **Animation runs on game time.** `AnimatedSprite` with
   `autoUpdate: false`, advanced from the actor's tick — pause freezes
   every cycle. Per-entity phase offsets derive from a hash of the entity
   id (deterministic on replay), never a random call.

The worked reference is `examples/top-down-survivor` — hero/imp/brute/gem/
blade/floor as rigs, one atlas, `TilingSprite` ground, actor wrappers, and
the `sprite` capability (`npm run --silent vgai -- add sprite`) carrying the kit.

## Assets take parameters — the artifact is a memoized call

Because the asset is a program, it parameterizes: one rig emits a FAMILY
(`gruntRig({ tier })` — tiers, team colors, size classes, rarity reskins),
which is how the 3D lane's derived characters already work and what
replaces the classic pipeline's file-per-variant explosion. Where a
parameter lives is the same question as the rig's: **does the game need it
live?** A finite, bake-time value set bakes — each value is an atlas
variant, its identity carried in the animation names, provenance-recorded
like any frame. A continuous or gameplay-driven parameter (damage tint,
charge level, per-instance phase) stays on the live node. Guardrails:
parameters are ordinary function arguments — never a parameter-schema
registry or variant manifest — and the no-callers rule applies to them: a
rig grows a parameter when its second caller exists, never because
variation is imaginable.

## Cycle-set contracts — the retarget seam

Sheets interchange when their animation names do. Bake against the named
sets in the kit's `cycles` module — swarm-critter (one loop), top-down
(idle/walk), sidescroller (idle/run/jump/fall/attack) — with the declared
frame counts and pivots. A user's own sheet (Aseprite and TexturePacker
export this exact artifact) drops in with zero code changes when it honors
the names; otherwise the remap is an edit to the JSON `animations` block,
not code surgery. That is the entire bring-your-own-art contract.

## The construction verbs, and the sight loop

Build silhouettes with the kit's Illustrator-verb layer rather than raw
path plotting: `outline` (the chunky look as one offset call), booleans
(`body = union(dome, cape)`, notches by subtraction), `smooth`/
`roundCorners`, `mirrorX` (build half, mirror it), `ramp` (hue-shifted
shadow/light from one base — a cast sharing one palette logic), `rimLight`.
Geometry rides real libraries (clipper2); verbs take and return plain path
data and the render stays the platform's own.

**Never author blind.** Bake, LOOK, revise: the kit's contact-sheet
preview (all phases × game scale and 4× × dark and light backdrops) is the
viewport. Judge in this order: silhouette first (would the shape read in
one glance at game size?), value structure second, hue last — "right
colors, wrong shapes" is a fail. Idle and walk must be distinguishable in
STILL frames at game scale. Motion craft is the classic animation
vocabulary: squash-and-stretch on contact, anticipation, follow-through
(cloth sways opposite the move via skew, not rotation — shear keeps
shoulders put), arcs, and phase offsets so a horde never moves in lockstep.

## UI art — the no-bake half

HUD icons and glyphs are hand-authored inline SVG components:
`viewBox="0 0 24 24"`, `fill="currentColor"` so the surface themes them,
chunky filled silhouettes with round joins, no hairlines, no `<text>`.
Type them against the game's own ids (a `Record<UpgradeId, Component>`
fails typecheck when a new upgrade lacks a glyph). The survivor's
`src/ui/upgrade-glyphs.tsx` is the worked shape. Portraits and painterly
art are the style ceiling of vector construction — flag them rather than
forcing the kit past what flat-shaded craft does well.

## Routing

- Retro / chunky-limited-palette direction, tiny glyph-scale sprites, or
  per-pixel touch-ups → **vgai-pixel-art** (its own craft: grids, palettes,
  the sighted pixel loop). Same atlas out the far end.
- A game that explicitly wants provider-generated imagery →
  **vgai-generative-assets**. Native authoring is the default craft path,
  not the only sanctioned one — but generated output cannot produce
  frame-registered cycles; cycles come from rigs.
- Characters in 3D games, or 2D art baked FROM 3D models →
  **vgai-3d-assets**.
