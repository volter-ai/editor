// Volter Cyclotron: the editor family's turntable carrying a cyclotron — two D-shaped
// electrodes ("dees") split by the accelerating gap, with the particle's spiral path on them.
// Same construction as volter-model-editor / volter-game-editor: the kit's turntable triangles
// verbatim, the subject as a flat-shaded low-poly mesh in the same orthographic camera, painter-
// sorted; brand = ink/slate/lime per-facet fills; mono = 2.4 silhouette pass + per-facet pass.
// usage: node gen.mjs <brandRepo> <out.json> [key=value ...]
import { readFileSync, writeFileSync } from "node:fs";

const [repo, out, ...kv] = process.argv.slice(2);
const P = Object.fromEntries(kv.map((s) => s.split("=")).map(([k, v]) => [k, +v]));
const opt = (k, d) => (k in P ? P[k] : d);

const src = readFileSync(repo + "/logos/volter-logos.mjs", "utf8");
const line = src.split("\n").find((l) => l.startsWith("const LOGOS = "));
const LOGOS = JSON.parse(line.slice(14).replace(/;\s*$/, ""));

// --- the kit's turntable, verbatim -------------------------------------------------------
const parse = (svg) => [...svg.matchAll(/<path d="([^"]*)" fill="([^"]*)" stroke="([^"]*)" stroke-width="([^"]*)"\/>/g)].map((m) => ({ d: m[1], fill: m[2], stroke: m[3], sw: m[4] }));
const kitB = parse(LOGOS["volter-editor"].brand);
const kitM = parse(LOGOS["volter-editor"].mono);
const N = kitB.length;
const kitM1 = kitM.slice(0, N), kitM2 = kitM.slice(N);

// --- camera fitted to the turntable: platter top is a 12-gon, centre (50,54), radius 39, ratio .415
const CX = 50, CY = 54, S = 39;
const SE = 0.415, CE = Math.sqrt(1 - SE * SE);
const proj = ([x, y, z]) => [CX + S * x, CY - S * (y * CE - z * SE)];
const depth = ([x, y, z]) => z * CE + y * SE;
const VIEW = [0, SE, CE];
const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };

// --- the cyclotron in its own frame (u across the gap, v along it, w up its axis) -----------
const r = opt("r", 0.6), h = opt("h", 0.11), g = opt("g", 0.075);
const tilt = (opt("tilt", 30) * Math.PI) / 180, spin = (opt("spin", 22) * Math.PI) / 180;
const zoff = opt("zoff", -0.12), xoff = opt("xoff", 0);
const SEG = opt("seg", 8);
const turns = opt("turns", 1.75), rw = opt("rw", 0.075), r0 = opt("r0", 0.07), rmax = opt("rmax", 0.8);
const ps = opt("ps", 0.085);

function place([u, v, w]) {
  // spin about w, tilt toward the viewer about X, then set on the platter
  const cs = Math.cos(spin), sn = Math.sin(spin);
  let x = u * cs - v * sn, z = u * sn + v * cs, y = w; // local: x right, z toward viewer, y up
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const y2 = y * ct - z * st, z2 = y * st + z * ct; // rotate so +y leans toward +z (viewer)
  return [x + xoff, y2, z2 + zoff];
}
const tris = []; // {pts:[3d], tone, part}
const quad = (a, b, c, d, tone, part) => { tris.push({ pts: [a, b, c], tone, part }); tris.push({ pts: [a, c, d], tone, part }); };

for (const side of [1, -1]) {
  const arc = [];
  for (let i = 0; i <= SEG; i++) {
    const th = -Math.PI / 2 + (Math.PI * i) / SEG;
    arc.push([side * (g / 2 + r * Math.cos(th)), r * Math.sin(th)]);
  }
  if (side > 0) arc.reverse();
  const top = arc.map(([u, v]) => place([u, v, h]));
  const bot = arc.map(([u, v]) => place([u, v, 0]));
  // top: a strip from the flat edge, so mono's wireframe reads as a D, not a fan of spokes
  const mid = place([side * (g / 2), 0, h]);
  for (let i = 0; i < SEG; i++) tris.push({ pts: [mid, top[i], top[i + 1]], tone: "top", part: "dee" });
  for (let i = 0; i < SEG; i++) quad(top[i], bot[i], bot[i + 1], top[i + 1], "rim", "dee");
  quad(top[SEG], bot[SEG], bot[0], top[0], "rim", "dee"); // the flat inner wall at the gap
}

// lowest point of the dees sits on the platter
const minY = Math.min(...tris.flatMap((t) => t.pts.map((p) => p[1])));
for (const t of tris) t.pts = t.pts.map(([x, y, z]) => [x, y - minY, z]);
const lift = (p) => [p[0], p[1] - minY, p[2]];

// spiral path on the dee tops, broken where it crosses the gap
const spiral = [];
const thMax = turns * 2 * Math.PI, steps = Math.round(turns * 28);
const ptAt = (th, off) => {
  const rho = r0 + ((rmax * r - r0) * th) / thMax + off;
  const a = th + opt("phase", 0) * Math.PI / 180;
  return [rho * Math.cos(a), rho * Math.sin(a)];
};
for (let i = 0; i < steps; i++) {
  const t0 = (thMax * i) / steps, t1 = (thMax * (i + 1)) / steps;
  const a = ptAt(t0, -rw / 2), b = ptAt(t0, rw / 2), c = ptAt(t1, rw / 2), d = ptAt(t1, -rw / 2);
  const inGap = [a, b, c, d].some(([u]) => Math.abs(u) < g / 2 + 0.012);
  if (inGap) continue;
  const W = h + 0.004;
  const q = [a, b, c, d].map(([u, v]) => lift(place([u, v, W])));
  spiral.push({ pts: [q[0], q[1], q[2]], tone: "path", part: "path" }, { pts: [q[0], q[2], q[3]], tone: "path", part: "path" });
}
// the particle: a low-poly bead at the end of the path
const [eu, ev] = ptAt(thMax, 0);
const pc = [eu, ev, h + ps * 0.7];
const oct = [[ps, 0, 0], [-ps, 0, 0], [0, ps, 0], [0, -ps, 0], [0, 0, ps * 0.8], [0, 0, -ps * 0.8]].map((o) => lift(place(pc.map((c, i) => c + o[i]))));
const particle = [];
for (const [i, j] of [[0, 2], [2, 1], [1, 3], [3, 0]]) {
  particle.push({ pts: [oct[i], oct[j], oct[4]], tone: "bead", part: "bead" });
  particle.push({ pts: [oct[j], oct[i], oct[5]], tone: "bead", part: "bead" });
}

// --- shade, cull, sort ---------------------------------------------------------------------
const LIGHT = norm([0.55, 0.75, 0.35]);
const visible = (t) => {
  const n = cross(sub(t.pts[1], t.pts[0]), sub(t.pts[2], t.pts[0]));
  return { n: norm(n), facing: dot(n, VIEW) };
};
const fix = (t) => { const v = visible(t); if (v.facing < 0) { t.pts = [t.pts[0], t.pts[2], t.pts[1]]; } return t; };
const cullSort = (list, cull) => list
  .map((t) => ({ ...t, v: visible(t) }))
  .filter((t) => !cull || t.v.facing > 1e-6)
  .sort((a, b) => Math.min(...a.pts.map(depth)) - Math.min(...b.pts.map(depth)) || depth(a.pts.reduce((s, p) => s.map((v, i) => v + p[i] / 3), [0, 0, 0])) - depth(b.pts.reduce((s, p) => s.map((v, i) => v + p[i] / 3), [0, 0, 0])));
const sortC = (list) => list.map((t) => ({ ...t, v: visible(t) })).filter((t) => t.v.facing > 1e-6)
  .sort((a, b) => { const c = (t) => depth(t.pts.reduce((s, p) => s.map((v, i) => v + p[i] / 3), [0, 0, 0])); return c(a) - c(b); });

const dees = sortC(tris);
const path = spiral.map((t) => ({ ...t, v: { facing: 1 } }));
const bead = sortC(particle);

const INK = "#16252c", SLATE = "#5d6970", LIME = "#d8eb6a";
const brandTone = (t) => {
  if (t.tone === "top") return LIME;
  if (t.tone === "path") return INK;
  if (t.tone === "bead") return dot(t.v.n, LIGHT) > opt("beadlit", 2) ? SLATE : INK;
  return dot(t.v.n, LIGHT) > opt("rimlit", 0.55) ? LIME : INK; // rims: lit faces lime, the rest in shade
};
const monoStyle = (t) => {
  if (t.tone === "top") return ["#fff", "#fff", "0.6"]; // smooth, like the gamepad top, so the path reads
  if (t.tone === "rim") return brandTone(t) === LIME ? ["#fff", "#000", "1.1"] : ["#000", "#000", "1.1"];
  return ["#000", "#000", "1.1"];
};
const f1 = (n) => { const s = (Math.round(n * 10) / 10).toFixed(1); return s.endsWith(".0") ? s.slice(0, -2) : s; };
const D = (t) => { const q = t.pts.map(proj); return `M${f1(q[0][0])} ${f1(q[0][1])} L${f1(q[1][0])} ${f1(q[1][1])} L${f1(q[2][0])} ${f1(q[2][1])} Z`; };
const el = (d, fill, stroke, sw) => `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;

const subject = [...dees, ...path, ...bead];
const brand = `<g stroke-linejoin="round">${kitB.map((k) => el(k.d, k.fill, k.stroke, k.sw)).join("")}${subject.map((t) => { const c = brandTone(t); return el(D(t), c, c, "0.5"); }).join("")}</g>`;
const mono = `<g stroke-linejoin="round">${kitM1.map((k) => el(k.d, k.fill, k.stroke, k.sw)).join("")}${subject.map((t) => el(D(t), "#000", "#000", "2.4")).join("")}${kitM2.map((k) => el(k.d, k.fill, k.stroke, k.sw)).join("")}${subject.map((t) => el(D(t), ...monoStyle(t))).join("")}</g>`;
writeFileSync(out, JSON.stringify({ brand, mono }));
console.log("triangles", N + subject.length, "subject", subject.length, "dees", dees.length, "path", path.length, "bead", bead.length);
