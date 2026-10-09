// Builds a standalone mock of Cyclotron's boot splash with the machine mascot, for an eye test.
// node make-splash-mock.mjs <svg> <out.html>
import { readFileSync, writeFileSync } from 'node:fs';

const [svgPath, outPath] = process.argv.slice(2);
const svg = readFileSync(svgPath, 'utf8');
const parts = [...svg.matchAll(/<g data-part="(\d+)"( class="accent")?><path d="([^"]+)"\/><\/g>/g)]
  .map(([, id, accent, d]) => ({ id, accent: !!accent, d }));
if (parts.length === 0) throw new Error('no parts');

const paths = parts.map((p, i) =>
  `<path class="part${p.accent ? ' accent' : ''}" style="--i:${i}" pathLength="1" d="${p.d}"/>`).join('\n');

writeFileSync(outPath, `<!doctype html><html><head><meta charset="utf-8"><title>Splash mock</title>
<style>
html,body{margin:0;height:100%;background:#161616;font-family:Inter,system-ui,sans-serif}
.volter-model-cover{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:#161616;color:#e6e6e6}
.volter-model-cover-mark{width:132px;height:132px;margin-bottom:4px;overflow:visible;animation:bob 3.2s ease-in-out 1.6s infinite}
.volter-model-cover-mark .part{fill:none;stroke:#e6e6e6;stroke-opacity:.9;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1;animation:plot .55s ease-out calc(var(--i) * 75ms) forwards}
.volter-model-cover-mark .accent{stroke:#d8eb6a;stroke-opacity:1}
@keyframes plot{to{stroke-dashoffset:0}}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
.volter-model-cover-title{font-size:26px;font-weight:600;letter-spacing:.02em}
.volter-model-cover-folder{font-size:12px;color:#969696}
.volter-model-cover-rail{position:relative;width:220px;height:2px;margin-top:6px;overflow:hidden;background:#3d3d3d}
.volter-model-cover-rail::after{content:"";position:absolute;top:0;bottom:0;width:40%;background:#d8eb6a;animation:travel 1.25s ease-in-out infinite}
@keyframes travel{0%{left:-40%}100%{left:100%}}
.volter-model-cover-state{font-size:11px;min-height:14px;color:#969696}
@media (prefers-reduced-motion: reduce){.volter-model-cover-mark{animation:none}.volter-model-cover-mark .part{animation:none;stroke-dashoffset:0}}
</style></head><body>
<div class="volter-model-cover">
<svg class="volter-model-cover-mark" viewBox="0 0 240 240" aria-hidden="true">
${paths}
</svg>
<div class="volter-model-cover-title">Cyclotron</div>
<div class="volter-model-cover-folder">my-race</div>
<div class="volter-model-cover-rail"></div>
<div class="volter-model-cover-state">Starting Blender…</div>
</div></body></html>
`);
console.log('parts', parts.length, 'bytes', readFileSync(outPath).length);
