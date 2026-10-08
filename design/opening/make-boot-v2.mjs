// Cyclotron boot splash v2 prototype: the machine assembles, the swapped-in parts land in lime, callouts name
// them, and a particle beam circles the ring — a cyclotron spinning up. Self-contained HTML for an eye test.
// node make-boot-v2.mjs <svg> <geometry.json|-> <out.html>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const [svgPath, geometryPath, outPath] = process.argv.slice(2);
const svg = readFileSync(svgPath, 'utf8');
const parts = [...svg.matchAll(/<g data-part="(\d+)"( class="accent")?><path d="([^"]+)"\/><\/g>/g)]
  .map(([, id, accent, d]) => ({ id, accent: !!accent, d }));

// Absolute points of an M/m/l path, for centroids and boxes when no geometry file is given.
function points(d) {
  const out = []; let x = 0, y = 0;
  for (const [, cmd, args] of d.matchAll(/([MmLl])([^MmLl]*)/g)) {
    const n = (args.match(/-?\d*\.?\d+/g) || []).map(Number);
    for (let i = 0; i + 1 < n.length; i += 2) {
      if (cmd === 'M' || cmd === 'L') { x = n[i]; y = n[i + 1]; } else { x += n[i]; y += n[i + 1]; }
      out.push([x, y]);
    }
  }
  return out;
}
const all = parts.flatMap((p) => points(p.d));
const center = [all.reduce((s, p) => s + p[0], 0) / all.length, all.reduce((s, p) => s + p[1], 0) / all.length];
const geometry = geometryPath !== '-' && existsSync(geometryPath) ? JSON.parse(readFileSync(geometryPath, 'utf8')) : null;
for (const p of parts) {
  const g = geometry?.parts?.find((q) => q.id === p.id);
  const pts = points(p.d);
  p.centroid = g?.centroid ?? [pts.reduce((s, q) => s + q[0], 0) / pts.length, pts.reduce((s, q) => s + q[1], 0) / pts.length];
  let [dx, dy] = g?.explodeUnit ?? [p.centroid[0] - center[0], p.centroid[1] - center[1]];
  const len = Math.hypot(dx, dy) || 1;
  p.explode = [dx / len * 26, dy / len * 26 - 6];
}
const ring = geometry?.ring?.[0] ?? geometry?.ring ?? { cx: center[0], cy: center[1] + 18, rx: 52, ry: 15, rotationDeg: -4 };
const silhouette = geometry?.silhouette ?? null;
const anchors = geometry?.anchors ?? {};
const labels = { '01': ['01', 'Blender', 'modelling'], '12': ['12', 'Python', 'bpy'], '30': ['30', 'three.js', 'play'], '29': ['29', 'React', 'game UI'], '28': ['28', 'Code-OSS', 'workspace'] };

const STEP = 80, START = 250, DUR = 700;
const landing = (i) => START + i * STEP + DUR;
const fmt = (n) => Math.round(n * 10) / 10;

const partEls = parts.map((p, i) => `<path class="part${p.accent ? ' accent' : ''}" pathLength="1" d="${p.d}" style="--i:${i};--dx:${fmt(p.explode[0])}px;--dy:${fmt(p.explode[1])}px"/>`).join('\n');

// Callouts: a leader from the part out to the side, then a mono label.
const callouts = parts.map((p, i) => ({ p, i })).filter(({ p }) => labels[p.id]).map(({ p, i }, k) => {
  const a = anchors[p.id] ?? { point: p.centroid, side: p.centroid[0] < center[0] ? 'left' : 'right' };
  const [ax, ay] = a.point; const left = a.side === 'left';
  const ex = left ? -18 : 258, ey = ay;
  const [num, name, role] = labels[p.id];
  return `<g class="callout" style="--t:${landing(i)}ms">
<path class="leader" pathLength="1" d="M${fmt(ax)} ${fmt(ay)} L${fmt(left ? ax - 14 : ax + 14)} ${fmt(ay)} L${ex} ${fmt(ey)}"/>
<circle class="tick" cx="${fmt(ax)}" cy="${fmt(ay)}" r="1.6"/>
<text class="label${p.accent ? ' accent' : ''}" x="${left ? ex - 4 : ex + 4}" y="${fmt(ey + 3)}" text-anchor="${left ? 'end' : 'start'}"><tspan class="num">${num}</tspan> ${name} <tspan class="role">${role}</tspan></text>
</g>`;
}).join('\n');

// The beam: an ellipse path one unit long; a bright head and a fading tail of dashes travel it.
const r = ring; const rad = (r.rotationDeg ?? 0);
const ellipse = `M${fmt(r.cx + r.rx)} ${fmt(r.cy)} A${fmt(r.rx)} ${fmt(r.ry)} 0 1 1 ${fmt(r.cx - r.rx)} ${fmt(r.cy)} A${fmt(r.rx)} ${fmt(r.ry)} 0 1 1 ${fmt(r.cx + r.rx)} ${fmt(r.cy)}`;
const beam = (cls) => [
  [0.30, 0.16, 1.2], [0.16, 0.42, 1.6], [0.07, 0.75, 2.0], [0.018, 1, 3.2],
].map(([len, op, w]) => `<path class="beam ${cls}" pathLength="1" d="${ellipse}" style="--len:${len};--op:${op};--w:${w}px"/>`).join('');
const beamOrbit = `<g class="orbit" transform="rotate(${rad} ${fmt(r.cx)} ${fmt(r.cy)})">
<g clip-path="url(#front)">${beam('front')}</g>
<g clip-path="url(#back)" ${silhouette ? 'mask="url(#behind)"' : ''}>${beam('back')}</g>
</g>`;

const finish = landing(parts.length - 1);
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Cyclotron boot v2</title>
<style>
html,body{margin:0;height:100%;background:#161616;font-family:Inter,"Segoe UI",system-ui,sans-serif}
.cover{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 42%,#1d1d1d 0,#161616 58%);color:#e6e6e6;overflow:hidden}
.stage{width:560px;height:330px;overflow:visible}
.grid{opacity:0;animation:fade .9s ease-out .05s forwards}
.grid line{stroke:#2a2a2a;stroke-width:.5}
.plane{fill:none;stroke:#8d82b8;stroke-width:.8;stroke-opacity:.5;stroke-dasharray:1;stroke-dashoffset:1;animation:plot .9s ease-out .15s forwards}
.plane-fill{fill:#8d82b8;opacity:0;animation:planefill 1.2s ease-out .4s forwards}
.machine{animation:float 3.6s ease-in-out ${finish + 400}ms infinite}
.part{fill:none;stroke:#e6e6e6;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1;opacity:0;transform:translate(var(--dx),var(--dy));
  animation:assemble ${DUR}ms cubic-bezier(.2,.85,.3,1.12) calc(${START}ms + var(--i) * ${STEP}ms) forwards}
.part.accent{stroke:#d8eb6a;animation:assemble ${DUR}ms cubic-bezier(.2,.85,.3,1.12) calc(${START}ms + var(--i) * ${STEP}ms) forwards,glow 1.4s ease-out calc(${START + DUR}ms + var(--i) * ${STEP}ms) both}
.callout{opacity:1}
.callout .leader{fill:none;stroke:#7a7a7a;stroke-width:.6;stroke-dasharray:1;stroke-dashoffset:1;animation:plot .45s ease-out var(--t) forwards,fadeout .6s ease-in ${finish + 1700}ms forwards}
.callout .tick{fill:#e6e6e6;opacity:0;animation:fade .2s ease-out var(--t) forwards,fadeout .6s ease-in ${finish + 1700}ms forwards}
.callout .label{font:9.5px ui-monospace,"SF Mono",Menlo,Consolas,monospace;fill:#bdbdbd;letter-spacing:.02em;opacity:0;animation:fade .35s ease-out calc(var(--t) + 250ms) forwards,fadeout .6s ease-in ${finish + 1700}ms forwards}
.callout .label.accent{fill:#d8eb6a}
.callout .num,.callout .role{fill:#6f6f6f}
.beam{fill:none;stroke:#d8eb6a;stroke-linecap:round;stroke-width:var(--w);stroke-dasharray:var(--len) calc(1 - var(--len));stroke-dashoffset:0;opacity:0;
  animation:beamin .6s ease-out ${finish + 150}ms forwards,orbit 1.7s linear ${finish + 150}ms infinite}
.beam.back{stroke-opacity:.45}
.title{margin-top:6px;font-size:30px;font-weight:300;letter-spacing:-.01em;opacity:0;transform:translateY(6px);animation:rise .7s ease-out ${finish - 300}ms forwards}
.folder{margin-top:4px;font:11px ui-monospace,"SF Mono",Menlo,Consolas,monospace;color:#8a8a8a;letter-spacing:.04em;opacity:0;animation:fade .6s ease-out ${finish}ms forwards}
.rail{position:relative;width:220px;height:2px;margin-top:14px;overflow:hidden;background:#333;opacity:0;animation:fade .5s ease-out ${finish}ms forwards}
.rail::after{content:"";position:absolute;top:0;bottom:0;width:36%;background:#d8eb6a;animation:travel 1.25s ease-in-out infinite}
.state{margin-top:8px;min-height:14px;font:11px ui-monospace,"SF Mono",Menlo,Consolas,monospace;color:#8a8a8a;opacity:0;animation:fade .5s ease-out ${finish}ms forwards}
@keyframes plot{to{stroke-dashoffset:0}}
@keyframes fade{to{opacity:1}}
@keyframes fadeout{to{opacity:0}}
@keyframes planefill{to{opacity:.07}}
@keyframes assemble{0%{opacity:0;stroke-dashoffset:1;transform:translate(var(--dx),var(--dy))}35%{opacity:1}100%{opacity:1;stroke-dashoffset:0;transform:translate(0,0)}}
@keyframes glow{0%{filter:drop-shadow(0 0 0 rgba(216,235,106,0))}25%{filter:drop-shadow(0 0 5px rgba(216,235,106,.9))}100%{filter:drop-shadow(0 0 0 rgba(216,235,106,0))}}
@keyframes beamin{to{opacity:var(--op)}}
@keyframes orbit{to{stroke-dashoffset:-1}}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes rise{to{opacity:1;transform:none}}
@keyframes travel{0%{left:-36%}100%{left:100%}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}.part{opacity:1;stroke-dashoffset:0;transform:none}.title,.folder,.rail,.state,.grid{opacity:1;transform:none}.plane{stroke-dashoffset:0}.callout{display:none}.beam{opacity:var(--op)}}
</style></head><body>
<div class="cover">
<svg class="stage" viewBox="-160 -20 560 330" aria-hidden="true">
<defs>
<radialGradient id="gridfade" cx="120" cy="120" r="210" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<mask id="gridmask"><rect x="-160" y="-20" width="560" height="330" fill="url(#gridfade)"/></mask>
<clipPath id="front"><rect x="-200" y="${fmt(r.cy)}" width="700" height="400"/></clipPath>
<clipPath id="back"><rect x="-200" y="-200" width="700" height="${fmt(r.cy + 200)}"/></clipPath>
${silhouette ? `<mask id="behind"><rect x="-200" y="-200" width="700" height="700" fill="#fff"/><path d="${silhouette}" fill="#000"/></mask>` : ''}
</defs>
<g class="grid" mask="url(#gridmask)">${Array.from({ length: 29 }, (_, k) => `<line x1="${-160 + k * 20}" y1="-20" x2="${-160 + k * 20}" y2="310"/>`).join('')}${Array.from({ length: 17 }, (_, k) => `<line x1="-160" y1="${-20 + k * 20}" x2="400" y2="${-20 + k * 20}"/>`).join('')}</g>
<rect class="plane-fill" x="58" y="34" width="124" height="186" transform="rotate(-8 120 127)"/>
<rect class="plane" pathLength="1" x="50" y="26" width="140" height="200" transform="rotate(-8 120 126)"/>
<g class="machine">
${partEls}
${beamOrbit}
</g>
${callouts}
</svg>
<div class="title">Cyclotron</div>
<div class="folder">my-race</div>
<div class="rail"></div>
<div class="state">Starting Blender…</div>
</div></body></html>
`;
writeFileSync(outPath, html);
console.log('parts', parts.length, 'finish', finish, 'ms', 'bytes', html.length, geometry ? 'with geometry' : 'estimated geometry');
