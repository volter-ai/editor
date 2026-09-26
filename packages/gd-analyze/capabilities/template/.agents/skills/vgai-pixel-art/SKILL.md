---
name: vgai-pixel-art
description: Pixel art authored as construction scripts of drawing verbs with rendered previews — retro and limited-palette game styles, glyph-scale sprites, tiles, and per-pixel touch-ups of vector bakes. Use when a game's art direction is pixel/retro/chunky-low-res, when authoring tiny sprites or tile sets at 8–32px, or when polishing individual frames of a baked atlas at the pixel level. Read vgai-2d-assets first for the shared doctrine (SVG source, atlases, cycle contracts, provenance); this skill is the grid craft. Do not use for smooth vector styles (vgai-2d-assets) or provider image generation (vgai-generative-assets).
---

# VGAI Pixel Art

**A pixel asset is a construction PROGRAM, exactly like a mesh.** Its
source is a script of drawing verbs — the same shape as the mesh kit's
"Blender as code": nobody tool-calls one stroke at a time; you write the
program, run it, look at the emitted previews, and edit the program. The
measured evidence behind this (the Aseprite-MCP lineage of experiments):
models produce real pixel art — up to ~32×32 stills and short cycles —
when they work through drawing OPERATIONS with rendered feedback, and fail
when they emit pixel grids from memory ("one pixel at a time, ascii
style": column drift, broken silhouettes, from about 16×16 up). Those
experiments issued one tool call per operation only because they bridged a
chat assistant to a GUI app — their own budgets (40 turns a sprite) and
their raw-script escape hatch point at the batched form; a script of two
hundred verbs costs the same one execution as five.

So: the committed source is the SCRIPT (deterministic, replayable,
diffable — a palette swap is one constant; "undo" is deleting a line); the
indexed grid is its intermediate; the PNG is the bake, recorded in
provenance; frames exit through the same atlas + spritesheet JSON as
vector bakes, so the game never knows which craft drew a frame.

## The loop, and its three affordances

**Edit script → run → LOOK → edit again** — one execution per look,
unlimited verbs inside, and never more than one region of the sprite
changed between looks (a whole character drawn blind between previews is
the failure mode dressed as efficiency):

1. **Primitives above pixels** — line, rect, ellipse, flood-fill,
   `mirrorX`, wrap-shift, auto-outline, ramp-shade along a direction,
   checker-dither a region, replace-color. Tool richness was the largest
   quality lever in the measured experiments (the same lesson as the mesh
   kit's Blender verbs): verbs at the level pixel artists think, never
   cell-by-cell placement.
2. **The preview** — 8× nearest-neighbor render into your context after
   each burst of ops, against BOTH a dark and a light backdrop; tiles
   additionally as a 2×2 self-tiling to prove the seams.
3. **Cycle support** — an onion-skin composite (previous frame ghosted
   under the working one) plus the reference frame pinned in context while
   drawing every other frame, and a frame-diff view (exactly which pixels
   changed) so identity drift is countable, not a vibe. Frame-identity
   drift is the dominant observed failure of pixel animation; these are
   its mitigations.

## Palette craft

Work indexed, never freehand RGB: a named ramp per material (shadow / base /
light, hue-shifted — shadows lean cool, lights lean warm — not merely
darkened), one outline value shared across the cast, and the fewest ramps
the style survives. Cluster control beats texture: large readable clusters
of one value, dithering reserved for deliberate gradient bands, never
scattered noise. Silhouette first, value structure second, hue last — the
same review order as vector, at 1× and 8× both.

## The honest envelope

Scripted pixel authoring is reliable at glyph-and-critter scale — 8×8 to
~32×32, short cycles (2–6 frames: blink, bob, hop, a 4-frame slash).
Deliberately-tiny styles (PICO-8-class) play entirely to strength. Past
that envelope, do not author freehand: **pixelize the rig instead** — bake
the SVG rig at low resolution with nearest-neighbor and palette
quantization, then touch up per-pixel where it matters. Coherent hordes and
long cycles come from rigs; the grid craft is for heroes, tiles, glyphs,
and the final 5% of polish on any frame.

## The tooling (in the `sprite` capability)

The kit ships in `src/lib/sprite/` when a project has the `sprite`
capability: `pixel-grid.ts` (the canvas model + every verb above, pure
functions — the same code runs in the Node bake and in the browser for art
the game mutates, which is how pixel-eroding geometry works),
`pixel-preview.ts` (the sight loop: 8× dark/light previews, cycle sheet,
onion, frame-diff with changed-cell counts, 2×2 tiling proof),
`pixel-atlas.ts` (grids ride the SAME atlas/spritesheet pipeline as vector
rigs — a grid becomes an SVG fragment, a cycle a flipbook rig; no second
pipeline), and `runtime.ts` (`scaleMode: 'nearest'` — without it linear
filtering kills the pixel look — plus `gridTexture`/`updateGridTexture`
for runtime grid→texture updates). The worked donor is
`examples/retro-shooter`: nine construction scripts, a 6-ramp/14-swatch
palette, per-pixel bunker erosion, and the loop's caught-defect comments
left in place as teaching. Never emit a grid from memory, and never bridge
to an external DCC app.
