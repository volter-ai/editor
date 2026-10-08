#!/usr/bin/env node
// Cyclotron mascot: a hidden-line SVG of the home page's "machine".
//
// The geometry is the site's own: src/assembly/scene.mjs is loaded with two
// in-memory edits (its three.js import points at a shim whose WebGLRenderer is
// a stub that hands back the scene, and each part group is tagged with its id).
// The page's own drawDetailedAssembly() poses the machine; the camera is the
// one renderHybrid uses at page time 0, which is the poster's view.
//
// Lines = the site's EdgesGeometry(28 deg) creases plus view contours, kept
// only where an orthographic ray from the camera reaches them first (exact ray
// casting against every visible triangle, binned in a screen-space grid).
//
// Usage: node generate.mjs [--state poster|cyclotron] [--site <model-editor>]
//                          [--accent 28,29,30] [--out <dir>] [--no-preview]
//   poster     (default) the machine as the page first shows it (assembly-poster.webp)
//   cyclotron  the page's last frame: reassembled with the modified parts
//   --accent   part ids drawn in the accent ink (default: what the site draws
//              lime plus the PARTS manifest's REPLACED/ADDED slots, 28-31)

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadMachine, makeCamera, visibleMeshes, fitView, screenRadius, partOf, makeOccluder, meshEdges, visiblePieces, chain, dp, lengthOf, mergeParallel, pathData, VIEW_SIZE, MIN_RADIUS, BIAS } from './machine-scene.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const SITE = path.resolve(arg('site', path.join(HERE, '..', 'sites-home', 'model-editor')));
const OUT = path.resolve(arg('out', HERE));
const STATE = arg('state', 'poster');
const PREVIEW = !argv.includes('--no-preview');
if (!['poster', 'cyclotron'].includes(STATE)) throw new Error(`--state must be poster or cyclotron, not ${STATE}`);

const CONFIG = {
  time: STATE === 'poster' ? 0 : 26, // page timeline: 0 = poster frame, 26 = every swap done
  creaseDeg: 28,        // EdgesGeometry threshold used by every site mesh
  view: VIEW_SIZE,      // viewBox size; camera, fit and ray caster live in machine-scene.mjs
  strokeWidth: 2.1,     // viewBox units: about 1 px at 120 px
  step: .3,             // sample spacing along an edge, viewBox units
  // Size budget. Meshes whose on-screen bounding radius is below this (viewBox
  // units) are left out entirely, as lines and as occluders: bolts, washers,
  // dial ticks and hands, plug caps, stub pipes.
  minRadius: MIN_RADIUS,
  // Thin tori (rings, seals, washers) draw their silhouette only; their eight
  // 45-degree crease circles become a solid band at mascot size.
  torusContourOnly: true,
  // Lines nearer than this to a longer, near-parallel kept line merge into it
  // (bevel doubles, stacked plates, rim-on-rim): viewBox units and degrees.
  mergeDistance: 2.4,
  mergeAngle: 22,
  simplify: .15,        // Douglas-Peucker tolerance, viewBox units (merges collinear runs)
  speck: 2,             // drop polylines shorter than this, viewBox units (1 px at 120 px)
};

// ---------------------------------------------------------------- scene ----
const { THREE, site, assemblyOrder: ASSEMBLY_ORDER, pose } = await loadMachine(SITE);
// Accent = what the site draws in lime (meshes of the modified build) plus the
// PARTS manifest's REPLACED/ADDED slots.
const OVERRIDE = arg('accent');
const REPLACED = new Set(OVERRIDE !== undefined ? OVERRIDE.split(',').filter(Boolean) : site.PARTS.filter(p => p[3] !== 'STOCK').map(p => p[0]));
const scene = pose(CONFIG.time);
const camera = makeCamera(THREE);
const VIEW = camera.matrixWorldInverse;

// --------------------------------------------------------- mesh harvest ----
const meshes = visibleMeshes(scene);
const { scale, toBox, bounds } = fitView(THREE, meshes, VIEW);

const kept = [], dropped = new Map();
for (const o of meshes) {
  if (screenRadius(THREE, o, scale) < CONFIG.minRadius) { const id = partOf(o); dropped.set(id, (dropped.get(id) || 0) + 1); continue; }
  kept.push(o);
}

const tris = [];          // occluders: x0,y0,z0, x1,y1,z1, x2,y2,z2 in view space
const edges = [];         // candidate lines {a:[x,y,z], b:[x,y,z], part, accent}
for (const o of kept) {
  const part = partOf(o), accent = (OVERRIDE === undefined && !!o.userData.accent) || REPLACED.has(part);
  for (const e of meshEdges(THREE, o, VIEW, CONFIG, tris)) edges.push({ ...e, part, accent });
}

// ------------------------------------------------------ hidden lines ----
const { visible, count: nT } = makeOccluder(tris, bounds, BIAS);
const pieces = visiblePieces(edges, visible, toBox, scale, CONFIG.step)
  .map(p => ({ a: p.a, b: p.b, part: p.src.part, accent: p.src.accent }));

// ------------------------------------------------------- polylines ----
const parts = new Map();   // id -> {accent, plain, lines}
for (const p of pieces) {
  if (!parts.has(p.part)) parts.set(p.part, { accent: 0, plain: 0, segs: [], lines: [] });
  const g = parts.get(p.part); g.segs.push([p.a, p.b]); g[p.accent ? 'accent' : 'plain']++;
}
const polys = [];
for (const [part, g] of parts) for (const pts of chain(g.segs)) polys.push({ part, pts, len: lengthOf(pts) });
// Near-parallel doubles merge into the longer line (machine-scene.mjs).
const mergedAway = mergeParallel(polys, { distance: CONFIG.mergeDistance, angle: CONFIG.mergeAngle }, (poly, run) => parts.get(poly.part).lines.push(run));

const order = [...ASSEMBLY_ORDER, ...[...parts.keys()].filter(id => !ASSEMBLY_ORDER.includes(id)).sort()];
const groups = [], stats = [];
for (const id of order) {
  const p = parts.get(id); if (!p) continue;
  // Draw each part top-down, left to right, so a draw-in reads naturally.
  const lines = p.lines.map(l => dp(l, CONFIG.simplify)).filter(l => lengthOf(l) >= CONFIG.speck)
    .sort((a, b) => Math.min(a[0][1], a.at(-1)[1]) - Math.min(b[0][1], b.at(-1)[1]));
  const d = pathData(lines); if (!d) continue;
  const accent = p.accent > p.plain;
  groups.push(`<g data-part="${id}"${accent ? ' class="accent"' : ''}><path d="${d}"/></g>`);
  stats.push({ id, accent, polylines: lines.length, bytes: d.length });
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CONFIG.view} ${CONFIG.view}" fill="none" stroke="currentColor" stroke-width="${CONFIG.strokeWidth}" stroke-linecap="round" stroke-linejoin="round">
<title>Cyclotron</title>
<style>.accent{stroke:var(--cyclotron-accent,#cde86b)}</style>
${groups.join('\n')}
</svg>
`;
fs.mkdirSync(OUT, { recursive: true });
const svgPath = path.join(OUT, 'cyclotron-machine.svg');
fs.writeFileSync(svgPath, svg);

console.log(`state ${STATE} (page t=${CONFIG.time}); meshes ${meshes.length}, kept ${kept.length}, dropped ${meshes.length - kept.length} (${[...dropped].map(([k, v]) => `${k}:${v}`).join(' ')})`);
console.log(`occluder triangles ${nT}, candidate edges ${edges.length}, visible pieces ${pieces.length}, polylines ${polys.length}, merged away ${mergedAway.toFixed(0)} units`);
console.log(`parts ${groups.length}: ${stats.map(s => `${s.id}${s.accent ? '*' : ''}:${s.bytes}`).join(' ')}  (* accent)`);
console.log(`${svgPath}: ${Buffer.byteLength(svg)} bytes`);

// ------------------------------------------------------------- preview ----
if (PREVIEW) {
  const sharp = loadSharp();
  const themes = [
    { file: 'preview-dark.png', bg: '#161616', ink: '#e6e6e6', accent: '#cde86b' },
    { file: 'preview-light.png', bg: '#f7f6f1', ink: '#16252c', accent: '#5f9a2e' },
  ];
  for (const th of themes) {
    const sized = size => Buffer.from(svg
      .replace('<svg ', `<svg width="${size}" height="${size}" color="${th.ink}" `)
      .replace('var(--cyclotron-accent,#cde86b)', th.accent));
    const pad = 24, W = pad * 3 + 120 + 360, H = pad * 2 + 360;
    const small = await sharp(sized(120)).png().toBuffer(), large = await sharp(sized(360)).png().toBuffer();
    await sharp({ create: { width: W, height: H, channels: 4, background: th.bg } })
      .composite([{ input: small, left: pad, top: pad + 120 }, { input: large, left: pad * 2 + 120, top: pad }])
      .png().toFile(path.join(OUT, th.file));
    console.log(path.join(OUT, th.file));
  }
}

function loadSharp() {
  for (const base of [OUT, HERE, path.join(SITE, '..')]) {
    try { return createRequire(path.join(base, 'package.json'))('sharp'); } catch {}
  }
  throw new Error('sharp not found: npm install sharp inside the mascot folder, or pass --no-preview');
}
