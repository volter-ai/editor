#!/usr/bin/env node
// The machine as a fine-ink card illustration, split into the pieces the
// site's own exploded pose moves, for a gacha-card assembly animation.
//
// Same scene, poster state and camera as cyclotron-machine.svg
// (machine-scene.mjs), framed into a 240 x 280 card illustration area with a
// 6% margin and kept at full detail: only meshes under 1.2 units on screen go.
//
// Pieces: every unit that moves on its own in the site's exploded pose (a part
// group, or one of the housing's children, which fly out separately), split
// into its natural sub-pieces: sub-assemblies, arrays of identical meshes
// (ticks, fins, windings, posts) and fastener sets, which follow the body they
// fasten. Each piece gets its hidden-line strokes, its screen offset in the
// exploded pose (page time 3.0) and an assembly order (core first, outward
// last).
//
// Usage: node card-machine.mjs [--out card-machine.json] [--preview card-preview.png] [--site <model-editor>]

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadMachine, makeCamera, visibleMeshes, fitView, screenRadius, partOf, makeOccluder, meshEdges, visiblePieces, chain, dp, lengthOf, mergeParallel, pathData, viewTriangles, traceSilhouette, BIAS } from './machine-scene.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const SITE = path.resolve(arg('site', path.join(HERE, '..', 'sites-home', 'model-editor')));
const OUT = path.resolve(arg('out', path.join(HERE, 'card-machine.json')));
const PREVIEW = path.resolve(arg('preview', path.join(HERE, 'card-preview.png')));

const CARD = { width: 240, height: 280, margin: .06 };
const CONFIG = {
  strokeWidth: .9,        // viewBox units: 1 px at 270 px wide
  minSize: 1.2,           // drop meshes whose on-screen bounding diameter is below this
  creaseDeg: 28,          // the site's EdgesGeometry threshold
  torusContourOnly: false,// keep the tori's crease rings: the site's plotter look
  step: .2,               // hidden-line sample spacing, viewBox units
  mergeDistance: Number(arg('merge', 1.2)), // near-parallel doubles closer than this merge: bevel doubles (1.15) blur at 270 px
  mergeAngle: 20,
  stub: .8,               // leftover stubs beside a merged line shorter than this go
  simplify: .06,          // Douglas-Peucker tolerance (merges collinear runs)
  speck: .5,              // polylines shorter than this go
  minPiece: 2.5,          // pieces with less visible stroke than this (a speck peeking through) go
  explodedTime: 3.0,      // renderHybrid: amount 1, separation 1, drift 0, no swap begun
};

// ------------------------------------------------------------- scene ----
const { THREE, site, assemblyOrder, pose } = await loadMachine(SITE);
const ACCENT = new Set(site.PARTS.filter(p => p[3] !== 'STOCK').map(p => p[0]));   // 28-31
const camera = makeCamera(THREE), VIEW = camera.matrixWorldInverse;
pose(0);
const scene = pose(0);
const meshes = visibleMeshes(scene);
const { scale, toBox, bounds } = fitView(THREE, meshes, VIEW, { width: CARD.width, height: CARD.height, marginX: CARD.width * CARD.margin, marginY: CARD.height * CARD.margin });
const kept = meshes.filter(o => 2 * screenRadius(THREE, o, scale) >= CONFIG.minSize);

// ------------------------------------------------------------ pieces ----
const partGroupOf = o => { for (let n = o; n; n = n.parent) if (n.userData?.partId) return n; return null; };
const isFastener = o => (o.geometry.type === 'CylinderGeometry' && o.geometry.parameters.radialSegments === 6)
  || (o.geometry.type === 'TorusGeometry' && o.geometry.parameters.radius < .2);
const round = v => typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v;
const geomSig = o => `${o.geometry.type}|${JSON.stringify(o.geometry.parameters, (k, v) => (k === 'uuid' ? undefined : round(v)))}|${[o.scale.x, o.scale.y, o.scale.z].map(round)}`;
// The unit that moves on its own: the part group, or for the housing (28) its child.
function unitOf(o) {
  const pg = partGroupOf(o), id = pg.userData.partId;
  if (id !== '28') return { key: id, group: pg, part: id };
  let n = o; while (n.parent !== pg) n = n.parent;
  return { key: `28:${pg.children.indexOf(n)}`, group: n, part: id };
}
const units = new Map();
for (const o of kept) {
  const u = unitOf(o);
  if (!units.has(u.key)) units.set(u.key, { ...u, pieces: new Map() });
  const unit = units.get(u.key), fast = isFastener(o);
  let key, owner = null;
  if (o === unit.group) key = 'body';
  else {
    let c = o; while (c.parent !== unit.group) c = c.parent;
    if (c === o) key = (fast ? 'fasteners|' : 'array|') + geomSig(o);       // loose meshes: identical siblings travel as one array
    else { owner = unit.group.children.indexOf(c); key = (fast ? 'fasteners@' : 'assembly@') + owner; }
  }
  if (!unit.pieces.has(key)) unit.pieces.set(key, { key, owner, fastener: key.startsWith('fasteners'), meshes: [] });
  unit.pieces.get(key).meshes.push(o);
}

// ------------------------------------------------------- line work ----
const tris = [], edges = [];
const pieceOf = new Map();   // mesh -> piece
for (const unit of units.values()) for (const p of unit.pieces.values()) { p.unit = unit; for (const o of p.meshes) pieceOf.set(o, p); }
for (const o of kept) for (const e of meshEdges(THREE, o, VIEW, CONFIG, tris)) edges.push({ ...e, piece: pieceOf.get(o) });
const { visible } = makeOccluder(tris, bounds, BIAS);
const vis = visiblePieces(edges, visible, toBox, scale, CONFIG.step);
const segsOf = new Map();
for (const v of vis) { const p = v.src.piece; if (!segsOf.has(p)) segsOf.set(p, []); segsOf.get(p).push([v.a, v.b]); }
const polys = [];
for (const [piece, segs] of segsOf) { piece.lines = []; for (const pts of chain(segs)) polys.push({ piece, pts, len: lengthOf(pts) }); }
const mergedAway = mergeParallel(polys, { distance: CONFIG.mergeDistance, angle: CONFIG.mergeAngle, stub: CONFIG.stub }, (poly, run) => poly.piece.lines.push(run));
for (const piece of segsOf.keys()) {
  const lines = piece.lines.map(l => dp(l, CONFIG.simplify)).filter(l => lengthOf(l) >= CONFIG.speck)
    .sort((a, b) => Math.min(a[0][1], a.at(-1)[1]) - Math.min(b[0][1], b.at(-1)[1]));
  piece.d = pathData(lines);
  piece.length = lines.reduce((s, l) => s + lengthOf(l), 0);
}

// ------------------------------------------------------------ explode ----
const v3 = new THREE.Vector3();
const screenMean = list => { let x = 0, y = 0, n = 0; for (const o of list) { const pos = o.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) { v3.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(VIEW); const [bx, by] = toBox(v3.x, v3.y); x += bx; y += by; n++; } }
  return [x / n, y / n]; };
const worldRadius = list => { const c = new THREE.Vector3(); let n = 0; for (const o of list) { c.add(new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3())); n++; } c.divideScalar(n); return Math.hypot(c.x, c.z); };
const all = [...units.values()].flatMap(u => [...u.pieces.values()]);
for (const p of all) { p.home = screenMean(p.meshes); p.radius = worldRadius(p.meshes); p.size = Math.max(...p.meshes.map(o => screenRadius(THREE, o, scale))); }
pose(CONFIG.explodedTime);
for (const p of all) { const m = screenMean(p.meshes); p.explode = [m[0] - p.home[0], m[1] - p.home[1]]; }
pose(0);

// -------------------------------------------------------------- order ----
// The site's reassembly order (core first, outer parts last), with the housing
// fitted before the controls and emitter that sit on it. Within a unit:
// bodies largest first, each fastener set straight after the body it fastens,
// loose fasteners last. Housing pieces go inner first.
let rank = [...assemblyOrder];
if (rank.includes('28')) { rank = rank.filter(id => id !== '28'); const at = rank.findIndex(id => ['29', '30', '31'].includes(id)); rank.splice(at < 0 ? rank.length : at, 0, '28'); }
const rankOf = id => { const i = rank.indexOf(id); return i < 0 ? rank.length : i; };
const unitList = [...units.values()].sort((a, b) => rankOf(a.part) - rankOf(b.part)
  || ([...a.pieces.values()].reduce((s, p) => Math.min(s, p.radius), Infinity) - [...b.pieces.values()].reduce((s, p) => Math.min(s, p.radius), Infinity)));
const ordered = [];
for (const unit of unitList) {
  const ps = [...unit.pieces.values()].filter(p => p.d && p.length >= CONFIG.minPiece);
  const bodies = ps.filter(p => !p.fastener).sort((a, b) => b.size - a.size);
  const loose = ps.filter(p => p.fastener && p.owner === null);
  for (const b of bodies) { ordered.push(b); for (const f of ps) if (f.fastener && f.owner !== null && f.owner === b.owner) ordered.push(f); }
  for (const f of ps) if (f.fastener && f.owner !== null && !bodies.some(b => b.owner === f.owner)) ordered.push(f);   // fasteners whose body is hidden
  ordered.push(...loose);
}
const subCount = new Map();
const r1 = v => Math.round(v * 10) / 10;
const kindOf = p => p.fastener ? 'fasteners' : p.key.startsWith('array|') ? (p.meshes.length > 1 ? 'array' : 'piece') : p.key === 'body' ? 'piece' : 'assembly';
const partsOut = ordered.map((p, order) => {
  const n = (subCount.get(p.unit.part) || 0) + 1; subCount.set(p.unit.part, n);
  return { id: `${p.unit.part}.${String(n).padStart(2, '0')}`, part: p.unit.part, kind: kindOf(p), meshes: p.meshes.length,
    accent: ACCENT.has(p.unit.part), order, explode: [r1(p.explode[0]), r1(p.explode[1])], d: p.d };
});

// --------------------------------------------------------- silhouette ----
const silTris = []; for (const o of kept) viewTriangles(THREE, o, VIEW, silTris);
const sil = traceSilhouette(silTris, toBox, { width: CARD.width, height: CARD.height, res: 4, budget: 3500 });

// -------------------------------------------------------------- write ----
const pathBytes = partsOut.reduce((s, p) => s + p.d.length, 0);
const json = {
  source: 'sites-home/model-editor/src/assembly/scene.mjs: page time 0 (poster), poster camera; exploded pose = page time 3.0',
  viewBox: [0, 0, CARD.width, CARD.height], yAxis: 'down', strokeWidth: CONFIG.strokeWidth,
  frame: { margin: CARD.margin, worldToViewBox: Math.round(scale * 1000) / 1000 },
  conventions: {
    id: 'scene part id . sub-index in assembly order within that part',
    kind: 'piece (one mesh), array (identical meshes that travel together: ticks, fins, windings, posts), assembly (a sub-group: a pod and the like), fasteners (bolts, nuts, washers; listed straight after what they fasten)',
    explode: 'screen offset of the piece in the site\'s exploded pose minus its assembled position, same camera and scale (mean over its mesh vertices)',
    order: 'assembly order: core first, outer parts last, fasteners after their body',
    accent: 'parts the page swaps in (PARTS manifest REPLACED/ADDED, 28-31) among those drawn',
  },
  stats: { parts: partsOut.length, pathBytes, meshesDrawn: kept.length, meshesDropped: meshes.length - kept.length },
  parts: partsOut,
  silhouette: { d: sil.d, bytes: sil.d.length, points: sil.points, tolerance: Math.round(sil.tolerance * 100) / 100, droppedIslands: sil.islands.length },
};
fs.writeFileSync(OUT, JSON.stringify(json, null, 1) + '\n');
const hidden = all.filter(p => !p.d || p.length < CONFIG.minPiece).length;
console.log(`meshes ${meshes.length}, drawn ${kept.length}; units ${units.size}; pieces ${all.length} (${hidden} fully hidden) -> parts ${partsOut.length}`);
console.log(`edges ${edges.length}, visible pieces ${vis.length}, polylines ${polys.length}, merged away ${mergedAway.toFixed(0)} units`);
console.log(`path data ${pathBytes} bytes; silhouette ${sil.d.length} bytes; ${OUT}: ${fs.statSync(OUT).size} bytes`);
const byPart = {}; for (const p of partsOut) byPart[p.part] = (byPart[p.part] || 0) + 1;
console.log('parts per scene part:', Object.entries(byPart).map(([k, v]) => `${k}:${v}`).join(' '));

// ------------------------------------------------------------ preview ----
{
  const sharp = createRequire(path.join(SITE, '..', 'package.json'))('sharp');
  const INK = '#16252c', PAPER = '#f7f6f1', LILAC = '#dcd5e9', ACC = '#8fa31f';
  const W = CARD.width, H = CARD.height, OFF = 7, RX = 9;
  const strokes = (k = 0) => partsOut.map(p => `<path d="${p.d}"${p.accent ? ` stroke="${ACC}"` : ''}${k ? ` transform="translate(${r1(p.explode[0] * k)} ${r1(p.explode[1] * k)})"` : ''}/>`).join('');
  const card = (px, k = 0, pad = 0) => {
    const vb = [-pad, -pad, W + 2 * pad + OFF, H + 2 * pad + OFF], h = Math.round(px * vb[3] / vb[2]);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${h}" viewBox="${vb.join(' ')}">
<rect x="${OFF}" y="${OFF}" width="${W}" height="${H}" rx="${RX}" fill="${LILAC}"/>
<rect width="${W}" height="${H}" rx="${RX}" fill="${PAPER}"/>
${k ? `<g stroke="#b9b2c8" stroke-width=".35">${partsOut.map(p => { const c = centreOf(p.d); return `<line x1="${c[0]}" y1="${c[1]}" x2="${r1(c[0] + p.explode[0] * k)}" y2="${r1(c[1] + p.explode[1] * k)}"/>`; }).join('')}</g>` : ''}
<g fill="none" stroke="${INK}" stroke-width="${CONFIG.strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${strokes(k)}</g>
</svg>`;
  };
  const panels = [[270, 0, 0], [540, 0, 0], [405, .35, 60]];
  const imgs = [];
  for (const [px, k, pad] of panels) imgs.push(await sharp(Buffer.from(card(px, k, pad))).png().toBuffer());
  const metas = await Promise.all(imgs.map(b => sharp(b).metadata()));
  const G = 28, totalW = metas.reduce((s, m) => s + m.width, 0) + G * (imgs.length + 1), totalH = Math.max(...metas.map(m => m.height)) + 2 * G;
  let x = G; const comp = imgs.map((input, i) => { const c = { input, left: x, top: G }; x += metas[i].width + G; return c; });
  await sharp({ create: { width: totalW, height: totalH, channels: 4, background: '#ffffff' } }).composite(comp).png().toFile(PREVIEW);
  console.log(PREVIEW);
}
function centreOf(d) {
  const tok = d.match(/[Mml]|-?(?:\d+\.?\d*|\.\d+)/g); let cmd = '', x = 0, y = 0, sx = 0, sy = 0, n = 0;
  for (let i = 0; i < tok.length;) { if (/[Mml]/.test(tok[i])) { cmd = tok[i++]; continue; } const a = +tok[i++], b = +tok[i++];
    if (cmd === 'M') { x = a; y = b; cmd = 'l'; } else { x += a; y += b; if (cmd === 'm') cmd = 'l'; } sx += x; sy += y; n++; }
  return [r1(sx / n), r1(sy / n)];
}
