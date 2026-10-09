// Cyclotron boot splash v3 prototype.
//  1. A faint grid and the page's offset lilac plane come up.
//  2. A lime plotter head sweeps up the machine and leaves the ink drawing behind it.
//  3. The swapped-in parts (lime) drop into place last, with a flash; three callouts name parts.
//  4. A particle beam spins up around the ring, the cyclotron, and keeps circling while the editor loads.
// node make-boot-v3.mjs <svg> <geometry.json|-> <out.html>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const [svgPath, geometryPath, outPath] = process.argv.slice(2);
const svg = readFileSync(svgPath, 'utf8');
const parts = [...svg.matchAll(/<g data-part="(\d+)"( class="accent")?><path d="([^"]+)"\/><\/g>/g)]
  .map(([, id, accent, d]) => ({ id, accent: !!accent, d }));
const fmt = (n) => Math.round(n * 10) / 10;

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
const box = [Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1]))];
const geometry = geometryPath !== '-' && existsSync(geometryPath) ? JSON.parse(readFileSync(geometryPath, 'utf8')) : null;
for (const p of parts) {
  const g = geometry?.parts?.find((q) => q.id === p.id);
  const pts = points(p.d);
  p.centroid = g?.centroid ?? [pts.reduce((s, q) => s + q[0], 0) / pts.length, pts.reduce((s, q) => s + q[1], 0) / pts.length];
}
const rings = geometry?.ring ? (Array.isArray(geometry.ring) ? geometry.ring : [geometry.ring]) : [{ cx: 120, cy: 120, rx: 52, ry: 15, rotationDeg: 0 }];
const ring = rings[0];
const silhouette = geometry?.silhouette ?? null;
const anchors = geometry?.anchors ?? {};

// Timeline (ms).
const T = { grid: 0, plane: 120, sweepStart: 250, sweep: 1150, drop: 1250, beam: 1900, title: 1500 };
const top = box[1] - 6, bottom = box[3] + 6;
// When the plotter head passes a height, from the sweep's own easing (approximated linear for callout timing).
const passes = (y) => T.sweepStart + T.sweep * (bottom - y) / (bottom - top);

const ink = parts.filter((p) => !p.accent).map((p) => `<path class="ink" d="${p.d}"/>`).join('\n');
const accents = parts.filter((p) => p.accent).map((p, k) => `<path class="accent" style="--k:${k}" d="${p.d}"/>`).join('\n');

const labelFor = { '01': ['Blender', 'modelling'], '30': ['three.js', 'play'], '29': ['React', 'game UI'] };
const callouts = Object.entries(labelFor).map(([id, [name, role]]) => {
  const p = parts.find((q) => q.id === id); if (!p) return '';
  const a = anchors[id] ?? { point: p.centroid, side: p.centroid[0] < (box[0] + box[2]) / 2 ? 'left' : 'right' };
  const [ax, ay] = a.point; const left = a.side === 'left';
  const ex = left ? box[0] - 22 : box[2] + 22;
  const t = p.accent ? T.drop + 450 : passes(ay) + 120;
  return `<g class="callout" style="--t:${Math.round(t)}ms">
<circle class="tick${p.accent ? ' lime' : ''}" cx="${fmt(ax)}" cy="${fmt(ay)}" r="1.5"/>
<path class="leader" pathLength="1" d="M${fmt(ax)} ${fmt(ay)} L${fmt(ex)} ${fmt(ay)}"/>
<text class="label${p.accent ? ' lime' : ''}" x="${fmt(left ? ex - 5 : ex + 5)}" y="${fmt(ay + 3.2)}" text-anchor="${left ? 'end' : 'start'}">${name}<tspan class="role" dx="5">${role}</tspan></text>
</g>`;
}).join('\n');

const ell = (r) => `M${fmt(r.cx + r.rx)} ${fmt(r.cy)} A${fmt(r.rx)} ${fmt(r.ry)} 0 1 1 ${fmt(r.cx - r.rx)} ${fmt(r.cy)} A${fmt(r.rx)} ${fmt(r.ry)} 0 1 1 ${fmt(r.cx + r.rx)} ${fmt(r.cy)}`;
// A bright head and a fading tail: four dashes of growing length and falling opacity, travelling together.
const tail = [[0.34, 0.10, 1.1], [0.18, 0.32, 1.5], [0.08, 0.7, 2.1], [0.02, 1, 3.4]];
const beamPaths = (r, cls) => tail.map(([len, op, w]) => `<path class="beam ${cls}" pathLength="1" d="${ell(r)}" style="--len:${len};--op:${op};--w:${w}px"/>`).join('');
const beam = rings.map((r, i) => `<g class="orbit" style="--ring:${i}" transform="rotate(${fmt(r.rotationDeg ?? 0)} ${fmt(r.cx)} ${fmt(r.cy)})">
<g clip-path="url(#front${i})">${beamPaths(r, 'front')}</g>
<g clip-path="url(#back${i})"${silhouette ? ' mask="url(#behind)"' : ''}>${beamPaths(r, 'back')}</g>
</g>`).slice(0, 1).join('');
const clips = rings.map((r, i) => `<clipPath id="front${i}"><rect x="-300" y="${fmt(r.cy)}" width="900" height="500"/></clipPath><clipPath id="back${i}"><rect x="-300" y="-500" width="900" height="${fmt(r.cy + 500)}"/></clipPath>`).join('');

const mono = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';
const vb = [-110, box[1] - 24, 460, box[3] - box[1] + 48];
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Cyclotron boot v3</title>
<style>
html,body{margin:0;height:100%;background:#161616;font-family:Inter,"Segoe UI",system-ui,sans-serif}
.cover{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(ellipse 60% 55% at 50% 44%,#1e1e1e 0,#161616 70%);color:#e6e6e6;overflow:hidden}
.stage{width:${vb[2] * 1.32}px;height:${vb[3] * 1.32}px;overflow:visible}
.grid{opacity:0;animation:fade .9s ease-out ${T.grid}ms forwards}
.grid line{stroke:#262626;stroke-width:.45}
.plane{fill:#8f82d9;opacity:0;animation:planein ${T.sweep}ms ease-out ${T.sweepStart}ms forwards}
.ghost path{fill:none;stroke:#e6e6e6;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.ghost{opacity:0;animation:ghostin .7s ease-out 60ms forwards}
.plane-line{fill:none;stroke:#9b8fd6;stroke-width:.6;stroke-opacity:.55;stroke-dasharray:1;stroke-dashoffset:1;animation:plot 1s ease-out ${T.plane}ms forwards}
.machine{animation:float 3.8s ease-in-out ${T.beam + 600}ms infinite}
.ink{fill:none;stroke:#e6e6e6;stroke-opacity:.92;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.accent{fill:none;stroke:#d8eb6a;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round;opacity:0;transform:translateY(-22px);
  animation:drop .55s cubic-bezier(.3,1.4,.5,1) calc(${T.drop}ms + var(--k) * 120ms) forwards,flash 1.3s ease-out calc(${T.drop + 380}ms + var(--k) * 120ms) both}
.sweep-rect{transform:translateY(${fmt(bottom - top)}px);animation:sweep ${T.sweep}ms cubic-bezier(.55,.05,.35,1) ${T.sweepStart}ms forwards}
.head{transform:translateY(${fmt(bottom - top)}px);animation:sweep ${T.sweep}ms cubic-bezier(.55,.05,.35,1) ${T.sweepStart}ms forwards,fadeout .35s ease-in ${T.sweepStart + T.sweep - 60}ms forwards}
.head line{stroke:#d8eb6a;stroke-width:1.1}
.head .halo{fill:url(#halo)}
.callout .tick{fill:#e6e6e6;opacity:0;animation:fade .2s ease-out var(--t) forwards,fadeout .7s ease-in 4200ms forwards}
.callout .tick.lime{fill:#d8eb6a}
.callout .leader{fill:none;stroke:#6a6a6a;stroke-width:.55;stroke-dasharray:1;stroke-dashoffset:1;animation:plot .4s ease-out var(--t) forwards,fadeout .7s ease-in 4200ms forwards}
.callout .label{font:600 8.6px ${mono};letter-spacing:.03em;fill:#d6d6d6;opacity:0;animation:fade .35s ease-out calc(var(--t) + 220ms) forwards,fadeout .7s ease-in 4200ms forwards}
.callout .label.lime{fill:#d8eb6a}
.callout .role{font-weight:400;fill:#6f6f6f}
.beam{fill:none;stroke:#d8eb6a;stroke-linecap:round;stroke-width:var(--w);stroke-dasharray:var(--len) calc(1 - var(--len));opacity:0;
  animation:beamin .5s ease-out ${T.beam}ms forwards,spinup 2.2s cubic-bezier(.5,0,1,1) ${T.beam}ms 1 forwards,orbit 1.5s linear ${T.beam + 2200}ms infinite}
.beam.back{stroke-opacity:.38}
.title{margin-top:10px;font-size:32px;font-weight:300;letter-spacing:-.015em;opacity:0;transform:translateY(8px);animation:rise .8s cubic-bezier(.2,.8,.2,1) ${T.title}ms forwards}
.folder{margin-top:5px;font:11px ${mono};letter-spacing:.06em;color:#8a8a8a;opacity:0;animation:fade .6s ease-out ${T.title + 200}ms forwards}
.rail{position:relative;width:220px;height:2px;margin-top:16px;overflow:hidden;background:#2f2f2f;opacity:0;animation:fade .5s ease-out ${T.title + 300}ms forwards}
.rail::after{content:"";position:absolute;top:0;bottom:0;width:34%;background:linear-gradient(90deg,rgba(216,235,106,0),#d8eb6a 70%,#f2fac8);animation:travel 1.3s ease-in-out infinite}
.state{margin-top:9px;min-height:14px;font:11px ${mono};color:#8a8a8a;opacity:0;animation:fade .5s ease-out ${T.title + 300}ms forwards}
@keyframes fade{to{opacity:1}}
@keyframes fadeout{to{opacity:0}}
@keyframes plot{to{stroke-dashoffset:0}}
@keyframes planein{to{opacity:.11}}
@keyframes ghostin{to{opacity:.075}}
@keyframes sweep{to{transform:translateY(0)}}
@keyframes drop{to{opacity:1;transform:translateY(0)}}
@keyframes flash{0%{filter:drop-shadow(0 0 0 rgba(216,235,106,0))}30%{filter:drop-shadow(0 0 6px rgba(216,235,106,.95))}100%{filter:drop-shadow(0 0 1.5px rgba(216,235,106,.35))}}
@keyframes beamin{to{opacity:var(--op)}}
@keyframes spinup{from{stroke-dashoffset:0}to{stroke-dashoffset:-1}}
@keyframes orbit{from{stroke-dashoffset:0}to{stroke-dashoffset:-1}}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes rise{to{opacity:1;transform:none}}
@keyframes travel{0%{left:-34%}100%{left:100%}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}.sweep-rect{transform:none}.head,.callout{display:none}.accent{opacity:1;transform:none}.grid,.title,.folder,.rail,.state{opacity:1;transform:none}.plane{opacity:.11}.ghost{display:none}.plane-line{stroke-dashoffset:0}.beam{opacity:var(--op)}}
</style></head><body>
<div class="cover">
<svg class="stage" viewBox="${vb.map(fmt).join(' ')}" aria-hidden="true">
<defs>
<radialGradient id="gridfade" cx="120" cy="${fmt((box[1] + box[3]) / 2)}" r="200" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<mask id="gridmask"><rect x="-300" y="-300" width="900" height="900" fill="url(#gridfade)"/></mask>
<linearGradient id="halo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d8eb6a" stop-opacity=".26"/><stop offset="1" stop-color="#d8eb6a" stop-opacity="0"/></linearGradient>
<mask id="reveal"><rect class="sweep-rect" x="-300" y="${fmt(top)}" width="900" height="${fmt(bottom - top + 400)}" fill="#fff"/></mask>
${clips}
${silhouette ? `<mask id="behind"><rect x="-300" y="-300" width="900" height="900" fill="#fff"/><path d="${silhouette}" fill="#000"/></mask>` : ''}
</defs>
<g class="grid" mask="url(#gridmask)">${Array.from({ length: 40 }, (_, k) => `<line x1="${-180 + k * 16}" y1="-200" x2="${-180 + k * 16}" y2="500"/>`).join('')}${Array.from({ length: 40 }, (_, k) => `<line x1="-200" y1="${-180 + k * 16}" x2="500" y2="${-180 + k * 16}"/>`).join('')}</g>
<rect class="plane" x="${fmt(box[0] + 4)}" y="${fmt(box[1] + 6)}" width="${fmt(box[2] - box[0] - 8)}" height="${fmt(box[3] - box[1] - 6)}" transform="rotate(-7 120 ${fmt((box[1] + box[3]) / 2)}) translate(10 6)"/>
<rect class="plane-line" pathLength="1" x="${fmt(box[0] - 10)}" y="${fmt(box[1] - 4)}" width="${fmt(box[2] - box[0] + 20)}" height="${fmt(box[3] - box[1] + 12)}" transform="rotate(-7 120 ${fmt((box[1] + box[3]) / 2)})"/>
<g class="machine">
<g class="ghost">${parts.map((p) => `<path d="${p.d}"/>`).join("")}</g>
<g mask="url(#reveal)">${ink}</g>
${accents}
${beam}
</g>
<g class="head"><rect class="halo" x="${fmt(box[0] - 26)}" y="${fmt(top)}" width="${fmt(box[2] - box[0] + 52)}" height="20"/><line x1="${fmt(box[0] - 26)}" y1="${fmt(top)}" x2="${fmt(box[2] + 26)}" y2="${fmt(top)}"/></g>
${callouts}
</svg>
<div class="title">Cyclotron</div>
<div class="folder">my-race</div>
<div class="rail"></div>
<div class="state">Starting Blender…</div>
</div>
<script>
// Prototype only: the editor says these as it loads; the beam quickens with each. ?loop replays every 9 s.
const states = [[0, "Starting Blender…", 1], [3800, "Opening the first model…", 1.35], [6200, "Drawing…", 1.9]];
function run() {
  const cover = document.querySelector(".cover"); const fresh = cover.cloneNode(true); cover.replaceWith(fresh);
  const state = fresh.querySelector(".state");
  for (const [at, text, rate] of states) setTimeout(() => { state.textContent = text; for (const a of fresh.getAnimations({ subtree: true })) if (a.animationName === "orbit") a.playbackRate = rate; }, at);
}
if (new URLSearchParams(location.search).has("loop")) { run(); setInterval(run, 9000); } else run();
</script>
</body></html>
`;
writeFileSync(outPath, html);
console.log('bytes', html.length, geometry ? 'geometry' : 'estimated', 'box', box.map(fmt).join(' '));
