// Shared by generate.mjs and boot-geometry.mjs: the site's own machine scene in
// node, the poster camera, the 240-unit fit and an orthographic ray caster.
//
// src/assembly/scene.mjs is loaded with two in-memory edits: its three.js
// import points at a shim whose WebGLRenderer is a stub that hands back the
// scene, and each part group is tagged with its id. Nothing on disk changes.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const VIEW_SIZE = 240;     // viewBox size
export const MARGIN = 7;          // viewBox units kept clear on the longer axis
export const CAMERA_ANGLE = .664; // renderHybrid camera angle at t=0 (the poster)
export const BIAS = .012;         // world units a surface must be in front of a point to hide it
export const MIN_RADIUS = 4.4;    // meshes smaller than this on screen (viewBox units) are left out

const dataUrl = src => 'data:text/javascript;charset=utf-8,' + encodeURIComponent(src);

export async function loadMachine(siteDir) {
  const assembly = path.join(siteDir, 'src', 'assembly');
  const threeUrl = pathToFileURL(path.join(assembly, 'three.module.js')).href;
  const THREE = await import(threeUrl);
  const capture = {};
  globalThis.__mascotCapture = capture;
  const shim = `export * from ${JSON.stringify(threeUrl)};
export class WebGLRenderer{constructor(){this.domElement={};this.outputColorSpace='';}
setPixelRatio(){}setSize(){}setClearColor(){}dispose(){}
render(scene,camera){globalThis.__mascotCapture.scene=scene;globalThis.__mascotCapture.camera=camera;}}`;

  let source = fs.readFileSync(path.join(assembly, 'scene.mjs'), 'utf8');
  const patch = (from, to) => { if (!source.includes(from)) throw new Error(`scene.mjs changed: cannot find ${from}`); source = source.replace(from, to); };
  patch(`import * as THREE from './three.module.js';`, `import * as THREE from ${JSON.stringify(dataUrl(shim))};`);
  patch('function part(id,pos,delta){const g=group(root);', 'function part(id,pos,delta){const g=group(root);g.userData.partId=id;');
  const orderMatch = source.match(/const order=\[([^\]]*)\]/);
  if (!orderMatch) throw new Error('scene.mjs changed: no part order');
  // The site takes the machine apart outside-in; reassembly runs that backwards.
  const assemblyOrder = [...orderMatch[1].matchAll(/'(\d+)'/g)].map(m => m[1]).reverse();

  globalThis.Image ??= class { decode() { return Promise.resolve(); } };
  const noop = () => {};
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => ((t[k] = v), true) });
  const canvas = { width: 855, height: 917, getContext: () => ctx };

  // Colours never reach the drawing; the real tokens are used when a build exists.
  const tokensPath = path.join(siteDir, 'dist', 'brand', 'tokens.json');
  const fallback = { surface: { page: '#f7f6f1', raised: '#ffffff' }, status: { live: { soft: '#eef4c4', text: '#3f6b17' } }, text: { primary: '#16252c', muted: '#5b666b', onStrong: '#ffffff' }, border: { strong: '#c9c7bd' }, accent: { lime: '#e4f09c', limeStrong: '#d8eb6a' } };
  const tokens = fs.existsSync(tokensPath) ? JSON.parse(fs.readFileSync(tokensPath, 'utf8')) : { semantic: fallback, semanticDark: fallback };

  const site = await import(dataUrl(source));
  const art = await site.createArtwork({ canvas, tokens, pageOnly: true });
  // Pose the page's machine at page time t (renderHybrid's own pose and part
  // visibility) and return the scene.
  const pose = t => {
    art.drawDetailedAssembly(t, t);
    if (!capture.scene) throw new Error('the scene never reached the renderer');
    capture.scene.updateMatrixWorld(true);
    return capture.scene;
  };
  return { THREE, site, assemblyOrder, pose };
}

export function makeCamera(THREE) {
  const camera = new THREE.OrthographicCamera(-12, 12, 12, -12, .1, 200);
  camera.position.set(Math.sin(CAMERA_ANGLE) * 31, 20, Math.cos(CAMERA_ANGLE) * 31);
  camera.lookAt(0, 3.0, 0);
  camera.updateMatrixWorld(true);
  return camera;
}

export const shown = o => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
export const partOf = o => { for (let n = o; n; n = n.parent) if (n.userData?.partId) return n.userData.partId; return null; };
export function visibleMeshes(scene) { const list = []; scene.traverse(o => { if (o.isMesh && shown(o)) list.push(o); }); return list; }

// World -> viewBox for the whole machine: fit the view-space bounds of every
// visible mesh into width x height less the margins, centred. toBox takes
// view-space x, y. The default is the mascot's 240 square with a 7-unit margin.
export function fitView(THREE, meshes, VIEW, { width = VIEW_SIZE, height = VIEW_SIZE, marginX = MARGIN, marginY = MARGIN } = {}) {
  const tmp = new THREE.Vector3();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const o of meshes) {
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      tmp.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(VIEW);
      x0 = Math.min(x0, tmp.x); x1 = Math.max(x1, tmp.x); y0 = Math.min(y0, tmp.y); y1 = Math.max(y1, tmp.y);
    }
  }
  const scale = Math.min((width - 2 * marginX) / (x1 - x0), (height - 2 * marginY) / (y1 - y0));
  const ox = width / 2 - (x0 + x1) / 2 * scale, oy = height / 2 + (y0 + y1) / 2 * scale;
  return { scale, ox, oy, bounds: { x0, y0, x1, y1 }, toBox: (x, y) => [ox + x * scale, oy - y * scale] };
}

export function screenRadius(THREE, o, scale) {
  if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
  const s = new THREE.Vector3(); o.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
  return o.geometry.boundingSphere.radius * Math.max(s.x, s.y, s.z) * scale;
}

// Every triangle of a mesh in view space, appended to out as x0,y0,z0,...,z2.
export function viewTriangles(THREE, o, VIEW, out = []) {
  const m = new THREE.Matrix4().multiplyMatrices(VIEW, o.matrixWorld), v = new THREE.Vector3();
  const pos = o.geometry.attributes.position, index = o.geometry.index;
  const n = index ? index.count : pos.count;
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(m); out.push(v.x, v.y, v.z); }
  return out;
}

// Orthographic ray caster over view-space triangles, binned in a screen grid
// spanning `bounds`. visible(x, y, z): no surface lies nearer than z + bias.
export function makeOccluder(tris, bounds, bias = BIAS) {
  const T = tris instanceof Float64Array ? tris : new Float64Array(tris), nT = T.length / 9;
  const { x0: bx0, y0: by0, x1: bx1, y1: by1 } = bounds;
  const G = 384, cw = (bx1 - bx0) / G + 1e-9, ch = (by1 - by0) / G + 1e-9;
  const cells = Array.from({ length: G * G }, () => []);
  const det = new Float64Array(nT);
  for (let t = 0; t < nT; t++) {
    const o = 9 * t, x0 = T[o], y0 = T[o + 1], x1 = T[o + 3], y1 = T[o + 4], x2 = T[o + 6], y2 = T[o + 7];
    det[t] = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(det[t]) < 1e-10) continue;   // edge-on sliver: occludes nothing
    const cx0 = Math.max(0, Math.floor((Math.min(x0, x1, x2) - bx0) / cw)), cx1 = Math.min(G - 1, Math.floor((Math.max(x0, x1, x2) - bx0) / cw));
    const cy0 = Math.max(0, Math.floor((Math.min(y0, y1, y2) - by0) / ch)), cy1 = Math.min(G - 1, Math.floor((Math.max(y0, y1, y2) - by0) / ch));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) cells[cy * G + cx].push(t);
  }
  function visible(x, y, z) {
    const cx = Math.floor((x - bx0) / cw), cy = Math.floor((y - by0) / ch);
    if (cx < 0 || cy < 0 || cx >= G || cy >= G) return true;
    const list = cells[cy * G + cx], limit = z + bias;
    for (let i = 0; i < list.length; i++) {
      const t = list[i], o = 9 * t, d = det[t], x0 = T[o], y0 = T[o + 1];
      const l1 = ((x - x0) * (T[o + 7] - y0) - (T[o + 6] - x0) * (y - y0)) / d;
      if (l1 < 0 || l1 > 1) continue;
      const l2 = ((T[o + 3] - x0) * (y - y0) - (x - x0) * (T[o + 4] - y0)) / d;
      if (l2 < 0 || l1 + l2 > 1) continue;
      if ((1 - l1 - l2) * T[o + 2] + l1 * T[o + 5] + l2 * T[o + 8] > limit) return false;
    }
    return true;
  }
  return { visible, count: nT };
}

// ------------------------------------------------------------ line work ----
// Candidate lines of one mesh in view space: the site's EdgesGeometry creases
// (welded like EdgesGeometry, 4 decimals) plus view contours (front face meets
// back face) and open boundaries. torusContourOnly keeps a torus's silhouette
// only. Every triangle is appended to tris (the occluders).
export function meshEdges(THREE, o, VIEW, { creaseDeg = 28, torusContourOnly = true } = {}, tris = []) {
  const g = o.geometry, pos = g.attributes.position, index = g.index, tmp = new THREE.Vector3();
  const m = new THREE.Matrix4().multiplyMatrices(VIEW, o.matrixWorld);
  const flip = m.determinant() < 0 ? -1 : 1, cosCrease = Math.cos(creaseDeg * Math.PI / 180);
  const torus = g.type === 'TorusGeometry' && torusContourOnly;
  const weld = new Map(), verts = [], remap = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let w = weld.get(key);
    if (w === undefined) { w = verts.length; weld.set(key, w); tmp.set(x, y, z).applyMatrix4(m); verts.push([tmp.x, tmp.y, tmp.z]); }
    remap[i] = w;
  }
  const faceCount = index ? index.count / 3 : pos.count / 3, faces = [];
  for (let f = 0; f < faceCount; f++) {
    const at = k => remap[index ? index.getX(3 * f + k) : 3 * f + k];
    const i0 = at(0), i1 = at(1), i2 = at(2);
    if (i0 === i1 || i1 === i2 || i0 === i2) continue;
    const a = verts[i0], b = verts[i1], c = verts[i2];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz); if (len < 1e-12) continue;
    nx *= flip / len; ny *= flip / len; nz *= flip / len;
    faces.push({ v: [i0, i1, i2], n: [nx, ny, nz] });
    tris.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  }
  const map = new Map();
  faces.forEach((f, fi) => {
    for (let k = 0; k < 3; k++) {
      const p = f.v[k], q = f.v[(k + 1) % 3], key = p < q ? p * 1e7 + q : q * 1e7 + p;
      const list = map.get(key); if (list) list.push(fi); else map.set(key, [fi]);
    }
  });
  const edges = [];
  for (const [key, list] of map) {
    let keep;
    if (list.length === 1) keep = !torus;                 // open boundary
    else {
      const n1 = faces[list[0]].n, n2 = faces[list[1]].n;
      const crease = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2] <= cosCrease;
      const contour = (n1[2] > 0) !== (n2[2] > 0);       // front meets back
      keep = contour || (crease && !torus);
    }
    if (keep) edges.push({ a: verts[Math.floor(key / 1e7)], b: verts[key % 1e7] });
  }
  return edges;
}

// Visible pieces of view-space edges, in viewBox units: sample every `step`
// viewBox units and bisect each visibility change. Returns [{a, b, src}].
export function visiblePieces(edges, visible, toBox, scale, step) {
  const pieces = [];
  for (const e of edges) {
    const [ax, ay, az] = e.a, [ex, ey, ez] = e.b;
    const n = Math.max(2, Math.ceil(Math.hypot(ex - ax, ey - ay) * scale / step) + 1);
    const at = s => visible(ax + (ex - ax) * s, ay + (ey - ay) * s, az + (ez - az) * s);
    const refine = (lo, hi, loVis) => { for (let k = 0; k < 8; k++) { const mid = (lo + hi) / 2; if (at(mid) === loVis) lo = mid; else hi = mid; } return (lo + hi) / 2; };
    const emit = (s0, s1) => pieces.push({ a: toBox(ax + (ex - ax) * s0, ay + (ey - ay) * s0), b: toBox(ax + (ex - ax) * s1, ay + (ey - ay) * s1), src: e });
    let prev = at(0), start = prev ? 0 : null;
    for (let i = 1; i < n; i++) {
      const s = i / (n - 1), v = at(s);
      if (v !== prev) {
        const cut = refine((i - 1) / (n - 1), s, prev);
        if (v) start = cut; else { emit(start, cut); start = null; }
        prev = v;
      }
    }
    if (prev && start !== null) emit(start, 1);
  }
  return pieces;
}

// Join 2D segments [[a,b], ...] that share endpoints (to 0.05) into polylines.
export function chain(list) {
  const q = v => `${Math.round(v[0] * 20)},${Math.round(v[1] * 20)}`;
  const ends = new Map(), used = new Uint8Array(list.length);
  list.forEach((s, i) => { for (const k of [q(s[0]), q(s[1])]) { const l = ends.get(k); if (l) l.push(i); else ends.set(k, [i]); } });
  const take = k => { const l = ends.get(k); if (!l) return -1; for (const i of l) if (!used[i]) return i; return -1; };
  const lines = [];
  for (let i = 0; i < list.length; i++) {
    if (used[i]) continue; used[i] = 1;
    const line = [list[i][0], list[i][1]];
    for (const forward of [true, false]) {
      for (;;) {
        const tip = forward ? line[line.length - 1] : line[0], j = take(q(tip));
        if (j < 0) break; used[j] = 1;
        const [a, b] = list[j], next = q(a) === q(tip) ? b : a;
        if (forward) line.push(next); else line.unshift(next);
      }
    }
    lines.push(line);
  }
  return lines;
}
export function dp(points, tol) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop(), [ax, ay] = points[i], [bx, by] = points[j];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    let worst = -1, at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = L > 1e-9 ? Math.abs((points[k][0] - ax) * dy - (points[k][1] - ay) * dx) / L : Math.hypot(points[k][0] - ax, points[k][1] - ay);
      if (d > worst) { worst = d; at = k; }
    }
    if (worst > tol) { keep[at] = 1; stack.push([i, at], [at, j]); }
  }
  return points.filter((_, k) => keep[k]);
}
export const lengthOf = l => l.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) : 0), 0);

// Whole polylines ({pts, len}), longest first: a line survives only where no
// longer kept line runs beside it (within `distance` and `angle` degrees,
// projecting inside that line's span). Collapses bevel doubles, stacked plates
// and rim-on-rim without two parts' coincident contours alternating dash by
// dash. keep(poly, run) receives each surviving run; returns the length removed.
export function mergeParallel(polys, { distance, angle, stub = 1.2 }, keep) {
  const R = distance, cosMerge = Math.cos(angle * Math.PI / 180);
  const hash = new Map(), hkey = (i, j) => i * 100003 + j;
  function insert(a, b) {
    const s = { a, b };
    const i0 = Math.floor((Math.min(a[0], b[0]) - R) / R), i1 = Math.floor((Math.max(a[0], b[0]) + R) / R);
    const j0 = Math.floor((Math.min(a[1], b[1]) - R) / R), j1 = Math.floor((Math.max(a[1], b[1]) + R) / R);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = hkey(i, j), l = hash.get(k); if (l) l.push(s); else hash.set(k, [s]); }
  }
  function covered(x, y, dx, dy) {
    const l = hash.get(hkey(Math.floor(x / R), Math.floor(y / R))); if (!l) return false;
    for (const { a, b } of l) {
      const qx = b[0] - a[0], qy = b[1] - a[1], L = Math.hypot(qx, qy); if (L < 1e-9) continue;
      if (Math.abs(dx * qx + dy * qy) / L < cosMerge) continue;
      const u = ((x - a[0]) * qx + (y - a[1]) * qy) / (L * L); if (u < 0 || u > 1) continue;
      if (Math.abs((x - a[0]) * qy - (y - a[1]) * qx) / L < R) return true;
    }
    return false;
  }
  polys.sort((p, q) => q.len - p.len);
  let removed = 0;
  for (const poly of polys) {
    const pts = poly.pts, runs = []; let run = null, whole = true;
    for (let s = 1; s < pts.length; s++) {
      const a = pts[s - 1], b = pts[s], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-9) continue;
      const dx = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L, n = Math.max(1, Math.ceil(L / .25));
      for (let i = run || s > 1 ? 1 : 0; i <= n; i++) {
        const x = a[0] + dx * L * i / n, y = a[1] + dy * L * i / n;
        if (covered(x, y, dx, dy)) { whole = false; if (run) { runs.push(run); run = null; } }
        else if (run) run.push([x, y]); else run = [[x, y]];
      }
    }
    if (run) runs.push(run);
    const kept = whole ? [pts] : runs.filter(r => lengthOf(r) >= stub);   // drop stubs left beside a merged line
    if (!whole) removed += poly.len - kept.reduce((s, r) => s + lengthOf(r), 0);
    for (const r of kept) { for (let i = 1; i < r.length; i++) insert(r[i - 1], r[i]); keep(poly, r); }
  }
  return removed;
}

// Compact path data: tenths, relative after the first move ("M12.3 4l1-.5m...").
const num = v => (v / 10).toString().replace(/^(-?)0\./, '$1.');
export function pathData(lines, { close = false } = {}) {
  let d = '', cur = null;
  const out = (v, first) => { const s = num(v); return (first || s[0] === '-' ? '' : ' ') + s; };
  for (const line of lines) {
    const p = line.map(([x, y]) => [Math.round(x * 10), Math.round(y * 10)]).filter((v, i, a) => !i || v[0] !== a[i - 1][0] || v[1] !== a[i - 1][1]);
    if (p.length < 2) continue;
    d += cur ? 'm' + out(p[0][0] - cur[0], true) + out(p[0][1] - cur[1]) : 'M' + out(p[0][0], true) + out(p[0][1]);
    d += 'l';
    for (let i = 1; i < p.length; i++) d += out(p[i][0] - p[i - 1][0], i === 1) + out(p[i][1] - p[i - 1][1]);
    if (close) d += 'z';
    cur = close ? p[0] : p[p.length - 1];
  }
  return d;
}

// ----------------------------------------------------------- silhouette ----
// Outer outline of view-space triangles in a width x height viewBox: raster at
// `res` px per unit, holes filled, the largest component traced (Moore radial
// sweep) and simplified until the path fits `budget` bytes. rowExtent(y) gives
// the filled body's horizontal span on a row, for callout placement.
export function traceSilhouette(tris, toBox, { width = VIEW_SIZE, height = VIEW_SIZE, res = 4, budget = 3000, tolerance = .25 } = {}) {
  const W = Math.round(width * res), H = Math.round(height * res), mask = new Uint8Array(W * H);
  for (let t = 0; t < tris.length; t += 9) {
    const P = [0, 3, 6].map(k => { const [x, y] = toBox(tris[t + k], tris[t + k + 1]); return [x * res - .5, y * res - .5]; });
    const area = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]);
    if (Math.abs(area) < 1e-9) continue;
    const xs = P.map(p => p[0]), ys = P.map(p => p[1]);
    const xa = Math.max(0, Math.ceil(Math.min(...xs))), xb = Math.min(W - 1, Math.floor(Math.max(...xs)));
    const ya = Math.max(0, Math.ceil(Math.min(...ys))), yb = Math.min(H - 1, Math.floor(Math.max(...ys)));
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      let inside = true;
      for (let k = 0; k < 3 && inside; k++) {
        const a = P[k], b = P[(k + 1) % 3], e = ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) * Math.sign(area);
        if (e < -1e-9) inside = false;
      }
      if (inside) mask[y * W + x] = 1;
    }
  }
  // Fill holes: whatever the border cannot reach (4-connected) is body.
  const outside = new Uint8Array(W * H), stack = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x); for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  while (stack.length) { const i = stack.pop(); if (outside[i] || mask[i]) continue; outside[i] = 1; const x = i % W, y = (i / W) | 0;
    if (x > 0) stack.push(i - 1); if (x < W - 1) stack.push(i + 1); if (y > 0) stack.push(i - W); if (y < H - 1) stack.push(i + W); }
  const body = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) body[i] = outside[i] ? 0 : 1;
  // Components (8-connected), so a stray island is reported rather than lost silently.
  const label = new Int32Array(W * H), comps = [];
  for (let s = 0; s < W * H; s++) {
    if (!body[s] || label[s]) continue; const id = comps.length + 1; let n = 0, top = s; const st = [s]; label[s] = id;
    while (st.length) { const i = st.pop(); n++; if (i < top) top = i; const x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy, j = ny * W + nx;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && body[j] && !label[j]) { label[j] = id; st.push(j); } } }
    comps.push({ id, area: n / res / res, top });
  }
  comps.sort((a, b) => b.area - a.area);
  const main = comps[0];
  const D = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];
  const inMain = (x, y) => x >= 0 && y >= 0 && x < W && y < H && label[y * W + x] === main.id;
  let px = main.top % W, py = (main.top / W) | 0, back = 0; const ring = [[px, py]], first = [px, py];
  for (let guard = 0; guard < W * H * 4; guard++) {
    let found = -1;
    for (let j = 1; j <= 8; j++) { const k = (back + j) % 8; if (inMain(px + D[k][0], py + D[k][1])) { found = k; break; } }
    if (found < 0) break;                                        // isolated pixel
    const nx = px + D[found][0], ny = py + D[found][1];
    back = (found + 4) % 8;                                       // radial sweep: resume clockwise from the previous pixel
    if (px === first[0] && py === first[1] && ring.length > 2 && nx === ring[1][0] && ny === ring[1][1]) break;
    px = nx; py = ny; ring.push([px, py]);
  }
  function dpClosed(points, tol) {
    let far = 0, best = -1; points.forEach((p, k) => { const d = Math.hypot(p[0] - points[0][0], p[1] - points[0][1]); if (d > best) { best = d; far = k; } });
    return [...dp(points.slice(0, far + 1), tol).slice(0, -1), ...dp([...points.slice(far), points[0]], tol).slice(0, -1)];
  }
  const units = ring.map(([x, y]) => [(x + .5) / res, (y + .5) / res]);
  let tol = tolerance, poly, d;
  for (;;) { poly = dpClosed(units, tol); d = pathData([poly], { close: true }); if (d.length <= budget || tol > 3) break; tol *= 1.15; }
  const rowExtent = y => {
    const row = Math.min(H - 1, Math.max(0, Math.round(y * res - .5)));
    let a = -1, b = -1; for (let x = 0; x < W; x++) if (body[row * W + x]) { if (a < 0) a = x; b = x; }
    return a < 0 ? null : [(a + .5) / res, (b + .5) / res];
  };
  return { d, points: poly.length, tolerance: tol, area: main.area, islands: comps.slice(1).map(c => c.area), rowExtent };
}
