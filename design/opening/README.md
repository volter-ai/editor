# Cyclotron mascot: the machine

`cyclotron-machine.svg` is a hidden-line drawing of the machine on Cyclotron's home page
(`sites-home/model-editor`, the `.machine` element, the same view as `media/assembly-poster.webp`).
It is meant for the editor's boot splash.

## Regenerate

```sh
node generate.mjs                     # writes cyclotron-machine.svg, preview-dark.png, preview-light.png
node generate.mjs --state cyclotron --out variants/finished-cyclotron
node generate.mjs --accent 29,30 --out variants/accent-29-30
node boot-geometry.mjs                # writes boot-geometry.json and geometry-debug.png
node card-machine.mjs                 # writes card-machine.json and card-preview.png
```

Options:

- `--state poster` (the default): the machine the page shows first, at page time 0.
- `--state cyclotron`: the page's last frame, put back together with the modified parts.
- `--accent 28,29,30`: choose which part ids use the accent ink.
- `--site <dir>`: the model-editor folder. The default is `../sites-home/model-editor`.
- `--out <dir>`: where to write the files.
- `--no-preview`: skip the PNG previews.

`boot-geometry.mjs` reads `variants/accent-29-30/cyclotron-machine.svg` by default (`--svg` picks another). It also takes `--out`, `--debug` and `--site`.

You need Node 20 or newer. Node may warn that `three.module.js` has no module type; the warning is harmless. The previews use `sharp`. The script finds the copy in
`sites-home/node_modules`, or you can run `npm install sharp` inside this folder. No browser is used.

## How it works

1. `machine-scene.mjs` holds what both scripts share: the scene, the camera, the 240-unit fit and the ray caster. It loads the site's own `src/assembly/scene.mjs`, with two changes made only in memory:
   - its three.js import points at a shim whose `WebGLRenderer` is a stub that hands back the scene;
   - each part group is tagged with its id.

   The site's file on disk is not changed.
2. The page's own `drawDetailedAssembly(t)` poses the machine. The camera is the one `renderHybrid`
   uses at t=0, which is the poster's view.
3. Two kinds of edge become candidate lines:
   - creases at 28 degrees, the same rule as the site's `EdgesGeometry(geometry, 28)`;
   - view contours, so cylinders get their silhouettes.
4. Hidden lines are removed by casting an orthographic ray from the camera through sample points
   along each edge, against every visible triangle (binned in a screen-space grid), with a 0.012
   world-unit bias.
5. Cleanup:
   - near-parallel lines closer than 2.4 units merge into the longer one (bevel doubles, stacked plates);
   - collinear runs merge (Douglas-Peucker, 0.15);
   - coordinates are rounded to 0.1;
   - polylines shorter than 2 units are dropped.

## Using the SVG

- Ordinary parts use `stroke="currentColor"`.
- Accent parts carry `class="accent"`, and the file's `<style>` sets their colour to
  `var(--cyclotron-accent, #cde86b)`.
- Inline the SVG, or set `color` and `--cyclotron-accent` on its parent. An `<img>` tag would draw the
  ink black.
- Each part is a `<g data-part="NN">` holding one `<path>`. The groups follow the site's reassembly
  order: the reverse of the `order` list in `scene.mjs`, so the core block comes first and the outer
  parts last.
- Inside each path, the lines run from the top down. Animating `stroke-dashoffset` group by group
  draws the machine in the way it is assembled.
- Stroke width is 2.1 viewBox units, about 1 px at 120 px. Lower it with CSS for large sizes.

## What was decided

- **State.** The page's machine is the base build at first sight. Scrolling swaps in the modified
  parts, and the last frame (`--state cyclotron`) is busier and mostly lime. The default is the
  poster state, because that is the machine people recognise. The finished build is in
  `variants/finished-cyclotron/`.
- **Accent.** In the poster state the site draws nothing lime for good. The poster's green lines are
  the t=0 caption highlight on parts 01 and 14. The accent is therefore the PARTS manifest's
  REPLACED/ADDED slots:
  - 28, the housing, which is the machine's outer shell;
  - 29, the controls;
  - 30, the emitter;
  - 31 is absent from the base build.

  In the cyclotron state, the accent is every part the site draws lime.
- **Dropped for size and legibility.** Meshes under 4.4 viewBox units on screen are left out, as
  lines and as occluders: bolts, washers, dial ticks and hands, gear teeth and small stubs (98 of
  239 meshes). Thin rings draw their outline only.

## Boot geometry (boot-geometry.json)

Every value is in the mascot SVG's own space (viewBox 0 0 240 240, y down). The `conventions` block in the file defines the ellipse angles and ranges. It contains:

- **parts**: for each part in SVG order, the centroid and bbox of its strokes, plus `explode`, `explodeUnit` and `explodeLength`. Those three are the part's screen offset in the site's exploded pose (page time 3.0), seen through the same camera.
  - The offsets are large: the exploded machine spans y -110 to 290, so scale them down to stay in frame.
  - Part 28, the housing, does not move as one piece: its rings and pods fly out in all directions. It gets an `explodeScale` instead, a rough fit only.
- **ring**: the two belt rings (`rings[0]` upper, `rings[1]` lower) and the plane between them (`mid`), as ellipses. Each lists `front` arcs and `hidden` arcs (behind the body, the pods or the other ring). The upper ring is the best orbit for a particle: it is hidden only behind the column.
- **gauge**: the dial on the body (part 43), as an ellipse on its front ring.
- **silhouette**: the closed outer outline of the drawn body, holes filled. Strokes overhang it by 1.05.
- **anchors**: callout points and a label side for parts 01, 12, 28, 29 and 30.

`geometry-debug.png` draws these over a thinned copy of the drawing.


## Card machine (card-machine.json)

A fine-ink version of the same machine for the gacha card face. It uses the same poster state and
camera, framed into a 240 x 280 viewBox with a 6% margin, and its lines are meant for stroke width
0.9 at 270 px wide.

- **Detail.** Nothing is cut for size: only meshes under 1.2 units on screen would go, and at this
  framing none do. Tori keep their crease rings, as on the site. Near-parallel doubles closer than
  1.2 units merge (bevel edges, stacked plates).
- **Parts.** A piece is anything that moves on its own in the site's exploded pose: a part group, or
  one child of the housing (28), whose rings, discs and pods each fly out separately. Each unit then
  splits into its natural pieces:
  - sub-assemblies;
  - arrays of identical meshes, such as ticks, fins, windings and posts;
  - fastener sets.
- **Dropped parts.** Pieces with no visible strokes, or under 2.5 units of stroke, are left out.
- **Fields.** Every part has `id` (scene part . sub-index), `kind`, `accent` (28-31), `explode` (the
  screen offset in the site's exploded pose at page time 3.0) and `order` (core first, outer parts
  last, fasteners straight after their body).
- **Silhouette.** The file also carries the closed outline in the same space.

`card-preview.png` shows the card at 270 and 540 px wide, plus one frame at 35% of the explode
offsets, with faint lines along each part's vector.

## 3D asset and card art (asset/)

`node export-asset.mjs` writes `asset/cyclotron-machine.obj` (with `.mtl`) and `asset/cyclotron-machine.parts.json`.

- **What it is.** The site's machine in the poster (assembled) state: 37 objects, one per part id, 239 meshes and 39k triangles.
- **Proportions.** World transforms are baked in, so the site's 1.4x vertical stretch is kept: it is part of the poster's look.
- **Axes and units.** Y is up and units are the site's; the machine is about 11 units tall.
- **Materials by role.** Faces are grouped by role: `body`, `trim` (small or thin pieces), `accent` (parts 28-31) and `metal` (bolts, nuts, washers).
- **The parts map.** It gives each part's accent flag and its name from the site's manifests.

`asset/build_canyon.py` builds the first card setting in headless Blender 5.2.2 (`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`) and renders it:

```sh
blender -b --factory-startup --python asset/build_canyon.py -- [--no-render] [--samples 128] [--out card-canyon.png]
```

- **What the scene contains.** The machine stands on a worn landing pad in a low-poly sandstone canyon at golden hour. The sun sits low behind the viewer's left shoulder, and the sky runs down into lilac at the horizon.
- **Render settings.** EEVEE at 900 x 1200 with the Standard view transform, which keeps the brand colours, and a light bloom on the lime.
- **Outputs.** It saves `asset/canyon.blend` and `asset/card-canyon.png`.
- **Making another setting.** The palette, sun and camera live in `SETTING`, and the backdrop in the `build_*` functions. Copy the script and swap those for a new setting.
