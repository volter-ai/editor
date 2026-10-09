#!/usr/bin/env node
// Geometry for the animated boot splash, in the mascot SVG's own coordinates
// (viewBox 0 0 240 240, y down). Same scene, camera and fit as generate.mjs
// (machine-scene.mjs), so every value lines up with the drawing.
//
// Usage: node boot-geometry.mjs [--svg <mascot svg>] [--out boot-geometry.json]
//                               [--debug geometry-debug.png] [--site <model-editor>]
//
// Writes:
//   parts       per SVG part: centroid and bbox of its strokes, and its offset in
//               the site's exploded pose (page time 3.0: every part fully out,
//               before the drift and swaps start), seen through the same camera
//   ring        the two housing rings around the middle (and the plane between them)
//               as ellipses, with front and hidden arcs for an orbiting particle
//   gauge       the dial on the body as an ellipse
//   silhouette  outer outline of the assembled machine's opaque body
//   anchors     callout points for parts 01, 12, 28, 29, 30 and a label side

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadMachine, makeCamera, visibleMeshes, fitView, screenRadius, partOf, makeOccluder, viewTriangles, traceSilhouette, VIEW_SIZE, MIN_RADIUS } from './machine-scene.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const SITE = path.resolve(arg('site', path.join(HERE, '..', 'sites-home', 'model-editor')));
const SVG = path.resolve(arg('svg', path.join(HERE, 'variants', 'accent-29-30', 'cyclotron-machine.svg')));
const OUT = path.resolve(arg('out', path.join(HERE, 'boot-geometry.json')));
const DEBUG = path.resolve(arg('debug', path.join(HERE, 'geometry-debug.png')));
const EXPLODED_TIME = 3.0;   // renderHybrid: amount = 1, separation = 1, drift = 0, no swap begun
const ANCHOR_PARTS = ['01', '12', '28', '29', '30'];
const SILHOUETTE_BUDGET = 3000; // bytes of path data

const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
const pt1 = ([x, y]) => [r1(x), r1(y)];

// ------------------------------------------------------------ the SVG ----
const svgText = fs.readFileSync(SVG, 'utf8');
const vb = svgText.match(/viewBox="0 0 (\d+) (\d+)"/);
if (!vb || +vb[1] !== VIEW_SIZE || +vb[2] !== VIEW_SIZE) throw new Error(`${SVG}: expected viewBox 0 0 ${VIEW_SIZE} ${VIEW_SIZE}`);
function parsePath(d) {
  const tok = d.match(/[MmLl]|-?(?:\d+\.?\d*|\.\d+)/g), lines = [];
  let i = 0, cmd = '', x = 0, y = 0, line = null;
  while (i < tok.length) {
    if (/[MmLl]/.test(tok[i])) { cmd = tok[i++]; continue; }
    const a = +tok[i++], b = +tok[i++];
    if (cmd === 'M' || cmd === 'm') {
      x = cmd === 'M' ? a : x + a; y = cmd === 'M' ? b : y + b;
      line = [[x, y]]; lines.push(line); cmd = cmd === 'M' ? 'L' : 'l';
    } else { x = cmd === 'L' ? a : x + a; y = cmd === 'L' ? b : y + b; line.push([x, y]); }
  }
  return lines;
}
const svgParts = [...svgText.matchAll(/<g data-part="(\d+)"( class="accent")?><path d="([^"]+)"\/><\/g>/g)]
  .map(([, id, accent, d]) => ({ id, accent: !!accent, lines: parsePath(d) }));
if (!svgParts.length) throw new Error(`${SVG}: no parts`);
for (const p of svgParts) {
  let L = 0, cx = 0, cy = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const line of p.lines) line.forEach(([x, y], k) => {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    if (!k) return; const [px, py] = line[k - 1], l = Math.hypot(x - px, y - py);
    L += l; cx += (x + px) / 2 * l; cy += (y + py) / 2 * l;
  });
  Object.assign(p, { length: L, centroid: [cx / L, cy / L], bbox: [x0, y0, x1, y1] });
}

// ---------------------------------------------------------- the scene ----
const { THREE, pose } = await loadMachine(SITE);
const camera = makeCamera(THREE), VIEW = camera.matrixWorldInverse;
let scene = pose(0);
const meshes = visibleMeshes(scene);
const { scale, toBox, bounds } = fitView(THREE, meshes, VIEW);
const kept = meshes.filter(o => screenRadius(THREE, o, scale) >= MIN_RADIUS);
const v3 = new THREE.Vector3();
const project = w => { v3.copy(w).applyMatrix4(VIEW); return toBox(v3.x, v3.y); };          // world -> viewBox
const depth = w => v3.copy(w).applyMatrix4(VIEW).z;                                         // larger = nearer
const viewOf = w => { v3.copy(w).applyMatrix4(VIEW); return [v3.x, v3.y, v3.z]; };

// Same-camera screen positions of a part's mesh vertices, in the current pose.
function partPoints(id) {
  const out = [];
  for (const o of kept) {
    if (partOf(o) !== id) continue;
    const pos = o.geometry.attributes.position, w = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) out.push(project(w.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld)));
  }
  return out;
}
const assembled = new Map(svgParts.map(p => [p.id, partPoints(p.id)]));

// ------------------------------------------------------------- rings ----
// A circle in a mesh's local XY plane (TorusGeometry's plane) projects to an
// ellipse: centre c, axes from the 2x2 image of the local x and y unit vectors.
function circleEllipse(o, r, z = 0) {
  const at = (x, y) => new THREE.Vector3(x, y, z).applyMatrix4(o.matrixWorld);
  const C = at(0, 0), c = project(C), a = project(at(r, 0)), b = project(at(0, r));
  const A = [[a[0] - c[0], b[0] - c[0]], [a[1] - c[1], b[1] - c[1]]];
  // M = A A^T; eigen-decomposition gives semi-axes and rotation.
  const m11 = A[0][0] ** 2 + A[0][1] ** 2, m22 = A[1][0] ** 2 + A[1][1] ** 2, m12 = A[0][0] * A[1][0] + A[0][1] * A[1][1];
  const tr = m11 + m22, dt = Math.sqrt(Math.max(0, (m11 - m22) ** 2 / 4 + m12 ** 2));
  const l1 = tr / 2 + dt, l2 = tr / 2 - dt;
  let rot = Math.abs(m12) < 1e-12 ? (m11 >= m22 ? 0 : Math.PI / 2) : Math.atan2(l1 - m11, m12);
  if (rot > Math.PI / 2) rot -= Math.PI; if (rot <= -Math.PI / 2) rot += Math.PI;
  const rx = Math.sqrt(l1), ry = Math.sqrt(Math.max(0, l2));
  // Parametric angle t of a world point on the circle: c + R(rot)(rx cos t, ry sin t).
  const paramOf = w => { const p = project(w), dx = p[0] - c[0], dy = p[1] - c[1];
    const u = Math.cos(rot) * dx + Math.sin(rot) * dy, v = -Math.sin(rot) * dx + Math.cos(rot) * dy;
    return ((Math.atan2(v / ry, u / rx) * 180 / Math.PI) + 360) % 360; };
  const sample = n => Array.from({ length: n }, (_, i) => { const f = i / n * Math.PI * 2; return at(r * Math.cos(f), r * Math.sin(f)); });
  return { cx: c[0], cy: c[1], rx, ry, rotationDeg: rot * 180 / Math.PI, centre: C, paramOf, sample };
}
// Angle ranges (in t) where pred holds, from samples [{t, v}], wrap-aware.
function ranges(samples) {
  const s = [...samples].sort((a, b) => a.t - b.t), out = [];
  let start = null;
  s.forEach((p, i) => { if (p.v && start === null) start = p.t; if (!p.v && start !== null) { out.push([start, s[i - 1].t]); start = null; } });
  if (start !== null) out.push([start, s[s.length - 1].t]);
  if (out.length > 1 && out[0][0] === s[0].t && out.at(-1)[1] === s.at(-1).t) { const first = out.shift(); out[out.length - 1] = [out.at(-1)[0], first[1] + 360]; }
  return out.map(([a, b]) => [r1(a), r1(b)]);
}
function occluderWithout(skip) {
  const tris = [];
  for (const o of kept) if (!skip.includes(o)) viewTriangles(THREE, o, VIEW, tris);
  return makeOccluder(tris, bounds).visible;
}
function orbit(e, skip, axisDepth) {
  const vis = occluderWithout(skip), samples = e.sample(720);
  const front = samples.map(w => ({ t: e.paramOf(w), v: depth(w) > axisDepth }));
  const hidden = samples.map(w => { const [x, y, z] = viewOf(w); return { t: e.paramOf(w), v: !vis(x, y, z) }; });
  return { front: ranges(front), hidden: ranges(hidden) };
}
const ellipseOut = e => ({ cx: r2(e.cx), cy: r2(e.cy), rx: r2(e.rx), ry: r2(e.ry), rotationDeg: r2(e.rotationDeg) });

const tori28 = kept.filter(o => partOf(o) === '28' && o.geometry.type === 'TorusGeometry')
  .sort((a, b) => b.geometry.parameters.radius - a.geometry.parameters.radius);
const big = tori28.filter(o => Math.abs(o.geometry.parameters.radius - tori28[0].geometry.parameters.radius) < 1e-6)
  .map(o => ({ o, y: new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).y })).sort((a, b) => b.y - a.y);
if (big.length !== 2) throw new Error(`expected two belt rings in part 28, found ${big.length}`);
const ringR = big[0].o.geometry.parameters.radius, tube = big[0].o.geometry.parameters.tube;
const ringInfo = (o, name, skip) => {
  const e = circleEllipse(o, ringR), axisDepth = depth(e.centre), outer = circleEllipse(o, ringR + tube), inner = circleEllipse(o, ringR - tube);
  return { name, ...ellipseOut(e), outer: { rx: r2(outer.rx), ry: r2(outer.ry) }, inner: { rx: r2(inner.rx), ry: r2(inner.ry) },
    worldRadius: ringR, worldTube: tube, worldY: r3(e.centre.y), ...orbit(e, skip, axisDepth), _e: e };
};
const upper = ringInfo(big[0].o, 'upper', [big[0].o]);
const lower = ringInfo(big[1].o, 'lower', [big[1].o]);
// The belt's middle plane: same circle, halfway between the two ring centres.
const midMesh = big[0].o.clone(); midMesh.matrixWorld = big[0].o.matrixWorld.clone();
const midY = (big[0].y + big[1].y) / 2; midMesh.matrixWorld.elements[13] = midY;
const midE = circleEllipse(midMesh, ringR);
const mid = { name: 'mid', ...ellipseOut(midE), worldRadius: ringR, worldY: r3(midY), ...orbit(midE, [big[0].o, big[1].o], depth(midE.centre)), _e: midE };

// ------------------------------------------------------------- gauge ----
const dialRing = kept.find(o => partOf(o) === '43' && o.geometry.type === 'TorusGeometry');
if (!dialRing) throw new Error('no dial ring in part 43');
const dialR = dialRing.geometry.parameters.radius, dialT = dialRing.geometry.parameters.tube;
const gaugeE = circleEllipse(dialRing, dialR), gaugeOuter = circleEllipse(dialRing, dialR + dialT), gaugeInner = circleEllipse(dialRing, dialR - dialT);

// -------------------------------------------------------- silhouette ----
const sil = (() => { const tris = []; for (const o of kept) viewTriangles(THREE, o, VIEW, tris); return traceSilhouette(tris, toBox, { budget: SILHOUETTE_BUDGET }); })();
const { rowExtent } = sil;

// ----------------------------------------------------------- explode ----
scene = pose(EXPLODED_TIME);
const machineCentre = (() => { const c = [0, 0]; let L = 0; for (const p of svgParts) { c[0] += p.centroid[0] * p.length; c[1] += p.centroid[1] * p.length; L += p.length; } return [c[0] / L, c[1] / L]; })();
const partsOut = svgParts.map(p => {
  const A = assembled.get(p.id), B = partPoints(p.id), n = A.length;
  const mean = P => P.reduce((s, q) => [s[0] + q[0] / n, s[1] + q[1] / n], [0, 0]);
  const ma = mean(A), mb = mean(B), dx = mb[0] - ma[0], dy = mb[1] - ma[1], len = Math.hypot(dx, dy);
  // Best uniform scale about the assembled mean (catches parts that burst apart).
  let num_ = 0, den = 0, res = 0;
  for (let i = 0; i < n; i++) { const ax = A[i][0] - ma[0], ay = A[i][1] - ma[1]; num_ += ax * (B[i][0] - mb[0]) + ay * (B[i][1] - mb[1]); den += ax * ax + ay * ay; }
  const s = den > 0 ? num_ / den : 1;
  for (let i = 0; i < n; i++) res += Math.hypot(B[i][0] - (mb[0] + s * (A[i][0] - ma[0])), B[i][1] - (mb[1] + s * (A[i][1] - ma[1]))) ** 2;
  const fromCentre = [p.centroid[0] - machineCentre[0], p.centroid[1] - machineCentre[1]], fc = Math.hypot(...fromCentre) || 1;
  const moving = len >= .5;
  const out = { id: p.id, accent: p.accent, centroid: pt1(p.centroid), bbox: p.bbox.map(r1),
    explode: moving ? [r1(dx), r1(dy)] : [0, 0],
    explodeUnit: moving ? [r3(dx / len), r3(dy / len)] : [r3(fromCentre[0] / fc), r3(fromCentre[1] / fc)],
    explodeLength: moving ? r1(len) : 0 };
  if (Math.abs(s - 1) > .15) Object.assign(out, { explodeScale: r3(s), explodeScaleResidual: r1(Math.sqrt(res / n)) });
  return out;
});
scene = pose(0);   // leave the scene assembled

// ------------------------------------------------------------ anchors ----
const partById = new Map(svgParts.map(p => [p.id, p]));
function candidates(id) {
  const out = [];
  for (const line of partById.get(id).lines) for (let k = 1; k < line.length; k++) {
    const [ax, ay] = line[k - 1], [bx, by] = line[k], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    for (let i = 0; i <= n; i++) out.push([ax + (bx - ax) * i / n, ay + (by - ay) * i / n]);
  }
  return out;
}
// Best callout point of a part on one side: the leader leaves the body
// quickly, stays near the part's centre height, and avoids labels already
// placed on that side, away from other parts' strokes. All 2^n side choices
// are tried; lopsided ones pay extra.
// Densified stroke points of every part, for telling whether a spot is unambiguous.
const strokeGrid = new Map(), gk = (x, y) => Math.floor(x / 3) * 1000 + Math.floor(y / 3);
for (const p of svgParts) for (const q of candidates(p.id)) { const k = gk(q[0], q[1]); if (!strokeGrid.has(k)) strokeGrid.set(k, []); strokeGrid.get(k).push([q[0], q[1], p.id]); }
function crowdedBy(id, [x, y], r = 2.5) {
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const [qx, qy, qid] of strokeGrid.get(gk(x + 3 * i, y + 3 * j)) || []) if (qid !== id && Math.hypot(qx - x, qy - y) < r) return true;
  return false;
}
function bestOn(id, side, placed) {
  const part = partById.get(id); let best = null;
  for (const p of candidates(id)) {
    const ext = rowExtent(p[1]); if (!ext) continue;
    const exit = side === 'left' ? ext[0] : ext[1], cross = Math.abs(exit - p[0]);
    const room = side === 'left' ? exit : VIEW_SIZE - exit;
    const crowd = placed.some(a => a.side === side && Math.abs(a.point[1] - p[1]) < 18) ? 40 : 0;
    const score = cross + .35 * Math.abs(p[1] - part.centroid[1]) + crowd + (crowdedBy(id, p) ? 15 : 0) + (room < 40 ? 40 : 0);
    if (!best || score < best.score) best = { score, point: p, side, exit: [exit + (side === 'left' ? -1.5 : 1.5), p[1]], room, cross };
  }
  return best;
}
const anchorIds = ANCHOR_PARTS.filter(id => partById.has(id));
let anchors = null, anchorScore = Infinity;
for (let mask = 0; mask < 1 << anchorIds.length; mask++) {
  const placed = []; let total = 0;
  anchorIds.forEach((id, i) => { const b = bestOn(id, mask >> i & 1 ? 'right' : 'left', placed); total += b.score; placed.push({ id, ...b }); });
  const right = placed.filter(p => p.side === 'right').length;
  total += 10 * Math.abs(anchorIds.length - 2 * right);
  if (total < anchorScore) { anchorScore = total; anchors = placed; }
}
anchors = anchors.map(b => ({ id: b.id, point: pt1(b.point), side: b.side, exit: pt1(b.exit), crossesBody: r1(b.cross), labelRoom: r1(b.room) }));
anchors.sort((a, b) => ANCHOR_PARTS.indexOf(a.id) - ANCHOR_PARTS.indexOf(b.id));

// -------------------------------------------------------------- write ----
const strip = o => { const { _e, ...rest } = o; return rest; };
const json = {
  source: { svg: path.relative(HERE, SVG).split(path.sep).join('/'), viewBox: [0, 0, VIEW_SIZE, VIEW_SIZE], yAxis: 'down',
    scene: 'sites-home/model-editor/src/assembly/scene.mjs, page time 0 (poster), poster camera',
    worldToViewBox: r3(scale), strokeWidth: 2.1 },
  conventions: {
    ellipse: 'point(t) = (cx, cy) + rotate(rotationDeg) * (rx cos t, ry sin t); rotationDeg as in SVG rotate(), y down, so t = 90 is the bottom of an unrotated ellipse',
    ranges: '[fromDeg, toDeg] in t, increasing; toDeg may exceed 360 when a range wraps',
    front: 'arcs of the circle nearer the camera than its own centre (the body axis)',
    hidden: 'arcs where a point on that circle is behind other geometry: the body, the other ring, the belt pods (the ring itself excluded)',
    explode: `screen offset of the part in the site's exploded pose (page time ${EXPLODED_TIME}) minus its assembled position, same camera and scale; mean over the part's mesh vertices`,
    silhouette: 'outer outline of the opaque meshes the SVG draws, holes filled; strokes overhang it by half the stroke width (1.05)',
  },
  parts: partsOut,
  ring: { rings: [strip(upper), strip(lower)], mid: strip(mid) },
  gauge: { part: '43', ...ellipseOut(gaugeE), outer: { rx: r2(gaugeOuter.rx), ry: r2(gaugeOuter.ry) }, inner: { rx: r2(gaugeInner.rx), ry: r2(gaugeInner.ry) } },
  silhouette: { d: sil.d, bytes: sil.d.length, points: sil.points, tolerance: r2(sil.tolerance), area: r1(sil.area),
    droppedIslands: sil.islands.map(area => ({ area: r2(area) })) },
  anchors,
  explodedBounds: (() => { let b = [Infinity, Infinity, -Infinity, -Infinity]; for (const p of partsOut) { b = [Math.min(b[0], p.bbox[0] + p.explode[0]), Math.min(b[1], p.bbox[1] + p.explode[1]), Math.max(b[2], p.bbox[2] + p.explode[0]), Math.max(b[3], p.bbox[3] + p.explode[1])]; } return b.map(r1); })(),
};
fs.writeFileSync(OUT, JSON.stringify(json, null, 1) + '\n');
console.log(`${OUT}: ${fs.statSync(OUT).size} bytes; ${partsOut.length} parts; silhouette ${sil.d.length} bytes (${sil.points} pts, tol ${sil.tolerance.toFixed(2)}), islands dropped ${sil.islands.length}`);
for (const p of partsOut) console.log(`  ${p.id} c=${p.centroid} explode=${p.explode} len=${p.explodeLength}${p.explodeScale ? ` scale=${p.explodeScale} res=${p.explodeScaleResidual}` : ''}`);
for (const r of [upper, lower, mid]) console.log(`  ring ${r.name}: c=(${r2(r.cx)},${r2(r.cy)}) r=(${r2(r.rx)},${r2(r.ry)}) rot=${r2(r.rotationDeg)} front=${JSON.stringify(r.front)} hidden=${JSON.stringify(r.hidden)}`);
console.log(`  gauge: ${JSON.stringify(json.gauge)}`);
console.log(`  anchors: ${JSON.stringify(anchors)}`);

// -------------------------------------------------------------- debug ----
{
  const sharp = createRequire(path.join(SITE, '..', 'package.json'))('sharp');
  const E = (e, stroke, w = .5, extra = '') => `<ellipse cx="${e.cx}" cy="${e.cy}" rx="${e.rx}" ry="${e.ry}" transform="rotate(${e.rotationDeg} ${e.cx} ${e.cy})" fill="none" stroke="${stroke}" stroke-width="${w}" ${extra}/>`;
  const arc = (e, [a, b], stroke, w, extra = '') => {
    const pts = []; for (let t = a; t <= b + 1e-9; t += 2) { const r = t * Math.PI / 180, c = Math.cos(e.rotationDeg * Math.PI / 180), s = Math.sin(e.rotationDeg * Math.PI / 180), u = e.rx * Math.cos(r), v = e.ry * Math.sin(r); pts.push(`${(e.cx + c * u - s * v).toFixed(2)},${(e.cy + s * u + c * v).toFixed(2)}`); }
    return `<polyline points="${pts.join(' ')}" fill="none" stroke="${stroke}" stroke-width="${w}" ${extra}/>`;
  };
  const DRAW = .5; // explode vectors drawn at half length
  const overlay = [
    `<path d="${sil.d}" fill="none" stroke="#ff3b3b" stroke-width=".45"/>`,
    ...[upper, lower].map(r => E(r, '#33d6ff', .5)), E(mid, '#33d6ff', .35, 'stroke-dasharray="1.5 1.5"'),
    ...[upper, lower].flatMap(r => r.front.map(f => arc(r, f, '#33d6ff', 1.1))),
    ...[upper, lower].flatMap(r => r.hidden.map(f => arc(r, f, '#ff9a3b', .5, 'stroke-dasharray=".8 .8"'))),
    E(json.gauge, '#ffe03b', .6),
    ...partsOut.map(p => `<line x1="${p.centroid[0]}" y1="${p.centroid[1]}" x2="${r1(p.centroid[0] + p.explode[0] * DRAW)}" y2="${r1(p.centroid[1] + p.explode[1] * DRAW)}" stroke="#ff5bd6" stroke-width=".5"/>`),
    ...partsOut.map(p => `<circle cx="${p.centroid[0]}" cy="${p.centroid[1]}" r="1.3" fill="#ff5bd6"/>`),
    ...anchors.map(a => `<line x1="${a.point[0]}" y1="${a.point[1]}" x2="${a.side === 'left' ? 8 : 232}" y2="${a.point[1]}" stroke="#9dff6b" stroke-width=".35" stroke-dasharray="1 1"/><circle cx="${a.point[0]}" cy="${a.point[1]}" r="1.4" fill="none" stroke="#9dff6b" stroke-width=".6"/>`),
  ].join('\n');
  // The drawing is shown thinner and dimmer here so the overlays can be checked against it.
  const base = svgText.replace('<svg ', '<svg width="480" height="480" color="#b4b4b4" ').replace(/stroke-width="[0-9.]+"/, 'stroke-width="1"').replace('var(--cyclotron-accent,#cde86b)', '#a9bf55')
    .replace('</svg>', `<g opacity=".95">${overlay}</g></svg>`);
  const px = 480 / VIEW_SIZE, esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const labels = [
    ...partsOut.map(p => ({ x: p.centroid[0] + 1.8, y: p.centroid[1] - 5.5, text: p.id, color: '#ff9bea' })),
    ...anchors.map(a => ({ x: a.side === 'left' ? 9 : 231, y: a.point[1] - 6, text: a.id, color: '#9dff6b', end: a.side === 'right' })),
    { x: 4, y: 229, text: `red silhouette · cyan rings (thick = front arc, dashed = mid plane) · orange dashes = hidden arcs`, color: '#9a9a9a', size: 9 },
    { x: 4, y: 234.5, text: `yellow gauge · pink centroids, explode vectors drawn at x${DRAW} · green anchors and label side · drawing thinned`, color: '#9a9a9a', size: 9 },
  ];
  const composites = [];
  for (const l of labels) {
    const input = await sharp({ text: { text: `<span foreground="${l.color}">${esc(l.text)}</span>`, font: `Arial ${l.size || 10}`, rgba: true, dpi: 72 } }).png().toBuffer();
    const { width } = await sharp(input).metadata();
    composites.push({ input, left: Math.max(0, Math.round(l.x * px - (l.end ? width : 0))), top: Math.max(0, Math.round(l.y * px)) });
  }
  const drawn = await sharp(Buffer.from(base)).flatten({ background: '#161616' }).png().toBuffer();
  await sharp(drawn).composite(composites).png().toFile(DEBUG);
  console.log(DEBUG);
}
