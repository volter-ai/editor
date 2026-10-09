// Cyclotron boot as a gacha card pull. Writes a self-contained prototype page next to the site's
// three.js machine modules (dist/proto). Everything runs off ONE clock, t (ms), so any moment can be
// seeked for an eye test: window.__seek(t) freezes the page at t.
// node make-gacha.mjs <out.html>
import { readFileSync, writeFileSync } from 'node:fs';

const out = process.argv[2];
const silhouette = readFileSync('C:/Users/porta/Desktop/volter/sites-home/model-editor/dist/proto/silhouette.txt', 'utf8');

const html = String.raw`<!doctype html><html><head><meta charset="utf-8"><title>Cyclotron boot · gacha</title>
<style>
:root{--paper:#f7f6f1;--ink:#16252c;--lilac:#dcd5e9;--lime:#e4f09c;--lime-strong:#d8eb6a;--bg:#141414}
html,body{margin:0;height:100%;background:var(--bg);overflow:hidden;font-family:Inter,"Segoe UI",system-ui,sans-serif}
.cover{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:radial-gradient(ellipse 70% 60% at 50% 46%,#1c1c1f 0,#141414 62%,#0f0f10 100%);color:#e6e6e6}
.fx{position:absolute;inset:0;pointer-events:none}
.rays{position:absolute;left:50%;top:44%;width:1400px;height:1400px;margin:-700px 0 0 -700px;opacity:0;
  background:repeating-conic-gradient(from 0deg,rgba(216,235,106,.16) 0deg 3deg,rgba(216,235,106,0) 3deg 15deg);
  -webkit-mask:radial-gradient(circle,#000 0,rgba(0,0,0,.6) 18%,transparent 52%);mask:radial-gradient(circle,#000 0,rgba(0,0,0,.6) 18%,transparent 52%)}
.halo{position:absolute;left:50%;top:44%;width:720px;height:720px;margin:-360px 0 0 -360px;border-radius:50%;opacity:0;
  background:radial-gradient(circle,rgba(216,235,106,.42) 0,rgba(220,213,233,.16) 32%,rgba(20,20,20,0) 62%)}
.ring{position:absolute;left:50%;top:44%;width:200px;height:200px;margin:-100px 0 0 -100px;border-radius:50%;border:2px solid rgba(228,240,156,.9);opacity:0;box-shadow:0 0 24px rgba(216,235,106,.6)}
.flash{position:absolute;inset:0;background:radial-gradient(circle at 50% 44%,#fffdf0 0,rgba(255,253,240,.85) 30%,rgba(255,253,240,0) 70%);opacity:0}
canvas.sparks{position:absolute;inset:0;width:100%;height:100%}
.stage{position:relative;perspective:1100px;width:300px;height:420px;margin-top:-30px}
.card{position:absolute;inset:0;transform-style:preserve-3d;will-change:transform}
.face{position:absolute;inset:0;border-radius:16px;backface-visibility:hidden;-webkit-backface-visibility:hidden;overflow:hidden}
.back{transform:rotateY(180deg);background:
  radial-gradient(ellipse at 50% 40%,#243840 0,#16252c 55%,#0f1a1f 100%);box-shadow:0 30px 60px rgba(0,0,0,.55)}
.back .edge{position:absolute;inset:0;border-radius:16px;box-shadow:inset 0 0 0 1.5px var(--edge,rgba(220,213,233,.65)),0 0 var(--glow,0px) var(--edge,rgba(220,213,233,.65))}
.back .inner{position:absolute;inset:12px;border-radius:10px;border:1px solid rgba(220,213,233,.25);
  background:repeating-linear-gradient(135deg,rgba(220,213,233,.06) 0 1px,transparent 1px 9px)}
.back svg{position:absolute;left:50%;top:50%;width:210px;height:210px;margin:-112px 0 0 -105px}
.back .mark{position:absolute;left:0;right:0;bottom:26px;text-align:center;font:600 10px ui-monospace,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.32em;color:rgba(220,213,233,.7)}
.front{background:var(--paper);box-shadow:0 34px 70px rgba(0,0,0,.6)}
.front .plane{position:absolute;left:58px;top:62px;width:184px;height:262px;background:var(--lilac);transform:rotate(-6deg) translate(10px,8px);opacity:.75}
.front .plane-line{position:absolute;left:44px;top:50px;width:206px;height:286px;border:1px solid rgba(22,37,44,.35);transform:rotate(-6deg)}
.front .frame{position:absolute;inset:10px;border:1px solid rgba(22,37,44,.55);border-radius:9px}
.front .head{position:absolute;left:22px;right:22px;top:20px;display:flex;justify-content:space-between;font:600 9.5px ui-monospace,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.2em;color:var(--ink)}
.front .head span:last-child{font-weight:400;letter-spacing:.08em;color:rgba(22,37,44,.6)}
.front canvas.machine{position:absolute;left:14px;top:44px;width:272px;height:312px}
.front .foot{position:absolute;left:22px;right:22px;bottom:18px;display:flex;justify-content:space-between;align-items:center;font:10px ui-monospace,"SF Mono",Menlo,Consolas,monospace;color:rgba(22,37,44,.65);letter-spacing:.06em}
.front .stars{font-size:13px;letter-spacing:.12em;color:var(--ink)}
.front .stars i{font-style:normal;color:#b8cc3a;text-shadow:0 0 6px rgba(216,235,106,.9)}
.holo{position:absolute;inset:0;border-radius:16px;mix-blend-mode:color-dodge;opacity:0;
  background:linear-gradient(115deg,transparent 20%,rgba(228,240,156,.55) 36%,rgba(220,213,233,.6) 44%,rgba(140,220,255,.45) 52%,rgba(228,240,156,.5) 60%,transparent 76%);background-size:260% 260%}
.glare{position:absolute;inset:0;border-radius:16px;mix-blend-mode:soft-light;opacity:0;background:radial-gradient(circle at var(--gx,50%) var(--gy,30%),rgba(255,255,255,.9) 0,rgba(255,255,255,0) 45%)}
.sweep{position:absolute;inset:-40%;opacity:0;background:linear-gradient(105deg,transparent 42%,rgba(255,255,255,.95) 49%,rgba(228,240,156,.9) 51%,transparent 58%);mix-blend-mode:screen}
.under{position:relative;margin-top:34px;display:flex;flex-direction:column;align-items:center;opacity:0}
.folder{font:11px ui-monospace,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.08em;color:#8a8a8a}
.rail{position:relative;width:220px;height:2px;margin-top:12px;overflow:hidden;background:#2a2a2a}
.rail::after{content:"";position:absolute;top:0;bottom:0;width:34%;background:linear-gradient(90deg,rgba(216,235,106,0),#d8eb6a 70%,#f4fbd0);animation:travel 1.3s ease-in-out infinite}
.state{margin-top:9px;min-height:14px;font:11px ui-monospace,"SF Mono",Menlo,Consolas,monospace;color:#8a8a8a}
@keyframes travel{0%{left:-34%}100%{left:100%}}
</style></head><body>
<div class="cover">
  <div class="fx"><div class="halo"></div><div class="rays"></div><div class="ring"></div><canvas class="sparks"></canvas></div>
  <div class="stage"><div class="card">
    <div class="face back"><div class="inner"></div>
      <svg viewBox="0 0 240 240"><path d="${silhouette}" fill="none" stroke="rgba(228,240,156,.85)" stroke-width="1.4" stroke-linejoin="round"/>
      <path d="${silhouette}" fill="rgba(220,213,233,.07)" stroke="none"/></svg>
      <div class="mark">CYCLOTRON</div><div class="edge"></div></div>
    <div class="face front"><div class="plane"></div><div class="plane-line"></div><canvas class="machine"></canvas><div class="frame"></div>
      <div class="head"><span>CYCLOTRON</span><span>BLENDER · THREE.JS</span></div>
      <div class="foot"><span class="stars">★★★★<i>★</i></span><span>my-race</span></div>
      <div class="holo"></div><div class="glare"></div><div class="sweep"></div></div>
  </div></div>
  <div class="under"><div class="folder">my-race</div><div class="rail"></div><div class="state">Starting Blender…</div></div>
  <div class="fx"><div class="flash"></div></div>
</div>
<script type="module">
import { createAssembly } from './scene.mjs';
const tokens = await (await fetch('./tokens.json')).json();
const $ = (s) => document.querySelector(s);
const card = $('.card'), back = $('.back .edge'), rays = $('.rays'), halo = $('.halo'), ring = $('.ring'), flash = $('.flash');
const holo = $('.holo'), glare = $('.glare'), sweep = $('.sweep'), under = $('.under'), state = $('.state');
const sparks = $('canvas.sparks'), sctx = sparks.getContext('2d');
const machineCanvas = $('canvas.machine');
const scene = await createAssembly(machineCanvas, { tokens });

// The pull's beats (ms).
const B = { rise: 0, charge: 450, flip: 1500, flipEnd: 1950, settle: 2500, assemble: 1750 };
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const outBack = (x) => { x = clamp(x); const c = 1.7; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const outExpo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(x)));
const inCubic = (x) => clamp(x) ** 3;

// Sparks: a fixed set, so every frame is a function of t.
const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
const inbound = Array.from({ length: 70 }, () => ({ a: rnd() * Math.PI * 2, r: 260 + rnd() * 340, start: B.charge + rnd() * 900, life: 380 + rnd() * 260, size: .8 + rnd() * 1.8 }));
const burst = Array.from({ length: 110 }, () => ({ a: rnd() * Math.PI * 2, v: .25 + rnd() * .75, life: 700 + rnd() * 900, size: .8 + rnd() * 2.4, lime: rnd() < .7 }));
const glints = Array.from({ length: 16 }, () => ({ x: rnd(), y: rnd(), period: 2200 + rnd() * 2600, phase: rnd() * 4000 }));

function size() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  sparks.width = innerWidth * dpr; sparks.height = innerHeight * dpr; sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  scene.resize();
}
addEventListener('resize', size); size();

function frame(t) {
  const cx = innerWidth / 2, cy = innerHeight * .44;
  // CARD: rise, charge (tremble that grows), flip with a swell, settle with overshoot, then float and tilt.
  const rise = outExpo((t - B.rise) / 650);
  const charge = clamp((t - B.charge) / (B.flip - B.charge));
  const shakeAmp = t < B.flip ? 0.4 + 5.5 * inCubic(charge) : 0;
  const sx = Math.sin(t * .083) * shakeAmp + Math.sin(t * .131) * shakeAmp * .5;
  const sy = Math.cos(t * .097) * shakeAmp * .6;
  const flip = ease((t - B.flip) / (B.flipEnd - B.flip));
  const swell = Math.sin(Math.PI * clamp((t - B.flip) / (B.flipEnd - B.flip))) * .16;
  const settle = outBack((t - B.flipEnd) / (B.settle - B.flipEnd));
  const idle = clamp((t - B.settle) / 800);
  const tiltX = idle * (Math.sin(t / 1900) * 5) + (t < B.flip ? -6 * (1 - rise) : 0);
  const tiltY = idle * (Math.sin(t / 2600 + 1) * 8);
  const floatY = idle * Math.sin(t / 1500) * 5;
  const angle = 180 + flip * 180 + (1 - settle) * (t > B.flipEnd ? -8 : 0);
  const scale = (0.86 + 0.14 * rise) * (1 + swell) * (t > B.flipEnd ? 1 + (1 - settle) * .05 : 1) * (1 + charge * .03 * (t < B.flip ? 1 : 0));
  const lift = (1 - rise) * 70;
  card.style.transform = 'translate3d(' + sx.toFixed(2) + 'px,' + (sy + lift + floatY).toFixed(2) + 'px,0) rotateX(' + tiltX.toFixed(2) + 'deg) rotateY(' + (angle + tiltY).toFixed(2) + 'deg) rotateZ(' + ((1 - flip) * -3 + flip * 0).toFixed(2) + 'deg) scale(' + scale.toFixed(4) + ')';
  card.style.opacity = rise.toFixed(3);
  // RARITY TELL on the back's edge: lilac, then lime as it charges.
  const tell = inCubic(charge);
  back.style.setProperty('--edge', 'rgba(' + Math.round(220 + (216 - 220) * tell) + ',' + Math.round(213 + (235 - 213) * tell) + ',' + Math.round(233 + (106 - 233) * tell) + ',' + (.65 + .35 * tell) + ')');
  back.style.setProperty('--glow', (tell * 28).toFixed(1) + 'px');
  // LIGHT: halo builds through the charge and blooms at the flip; rays burst at the flip and then turn slowly.
  const bloom = Math.exp(-Math.max(0, t - B.flip - 200) / 500) * (t > B.flip ? 1 : 0);
  halo.style.opacity = (tell * .55 + bloom * .6 + idle * .18).toFixed(3);
  halo.style.transform = 'scale(' + (.7 + tell * .3 + bloom * .35).toFixed(3) + ')';
  const raysOn = t > B.flip ? Math.min(1, (t - B.flip) / 200) : tell * .25;
  rays.style.opacity = (raysOn * (.35 + .65 * Math.exp(-Math.max(0, t - B.flip - 300) / 900)) * (1 - .55 * idle)).toFixed(3);
  rays.style.transform = 'rotate(' + (t * .006).toFixed(2) + 'deg) scale(' + (1 + bloom * .15).toFixed(3) + ')';
  const wave = clamp((t - B.flip - 180) / 700);
  ring.style.opacity = (t > B.flip + 180 ? (1 - wave) * .9 : 0).toFixed(3);
  ring.style.transform = 'scale(' + (0.6 + outExpo(wave) * 5.5).toFixed(3) + ')';
  flash.style.opacity = (t > B.flip + 150 ? Math.max(0, 1 - (t - B.flip - 150) / 380) * .85 : 0).toFixed(3);
  // FOIL: one bright sweep at the reveal, then a holo sheen that follows the tilt, and a glare.
  const sw = clamp((t - B.flipEnd + 120) / 650);
  sweep.style.opacity = (sw > 0 && sw < 1 ? Math.sin(Math.PI * sw) : 0).toFixed(3);
  sweep.style.transform = 'translateX(' + (-60 + sw * 120).toFixed(1) + '%)';
  holo.style.opacity = (clamp((t - B.flipEnd) / 500) * (.22 + .1 * Math.sin(t / 900))).toFixed(3);
  holo.style.backgroundPosition = (50 + tiltY * 6 + Math.sin(t / 1700) * 18).toFixed(1) + '% ' + (50 + tiltX * 6).toFixed(1) + '%';
  glare.style.opacity = (idle * .55).toFixed(3);
  glare.style.setProperty('--gx', (50 - tiltY * 5).toFixed(1) + '%'); glare.style.setProperty('--gy', (30 + tiltX * 5).toFixed(1) + '%');
  under.style.opacity = clamp((t - B.settle + 200) / 600).toFixed(3);
  // MACHINE: the site's assembly, compressed: base machine at the reveal, then the swapped-in parts fly in.
  const mt = window.__mt ?? (t < B.assemble ? 0 : Math.min(21.4, (t - B.assemble) / 1000 * 2.4));
  scene.draw(mt, mt, { clock: t / 1000, impulse: 0 });
  // SPARKS.
  sctx.clearRect(0, 0, innerWidth, innerHeight);
  for (const p of inbound) {
    const k = (t - p.start) / p.life; if (k < 0 || k > 1) continue;
    const r = p.r * (1 - outExpo(k)) + 30;
    const x = cx + Math.cos(p.a) * r, y = cy + Math.sin(p.a) * r * .8;
    sctx.globalAlpha = Math.sin(Math.PI * k) * .9; sctx.fillStyle = k > .6 ? '#e4f09c' : '#dcd5e9';
    sctx.beginPath(); sctx.arc(x, y, p.size, 0, 7); sctx.fill();
    sctx.globalAlpha *= .35; sctx.strokeStyle = sctx.fillStyle; sctx.lineWidth = p.size * .8; sctx.beginPath(); sctx.moveTo(x, y);
    sctx.lineTo(cx + Math.cos(p.a) * (r + 26), cy + Math.sin(p.a) * (r + 26) * .8); sctx.stroke();
  }
  for (const p of burst) {
    const k = (t - B.flip - 160) / p.life; if (k < 0 || k > 1) continue;
    const r = 40 + outExpo(k) * 520 * p.v;
    const x = cx + Math.cos(p.a) * r, y = cy + Math.sin(p.a) * r * .85 + k * k * 60;
    sctx.globalAlpha = (1 - k) * .95; sctx.fillStyle = p.lime ? '#e4f09c' : '#ffffff';
    sctx.beginPath(); sctx.arc(x, y, p.size * (1 - k * .5), 0, 7); sctx.fill();
  }
  for (const g of glints) {
    const k = ((t + g.phase) % g.period) / g.period; if (idle <= 0 || k > .18) continue;
    const a = Math.sin(Math.PI * k / .18) * idle;
    const x = cx - 150 + g.x * 300, y = cy - 200 + g.y * 400;
    sctx.globalAlpha = a * .9; sctx.strokeStyle = '#f6fbd8'; sctx.lineWidth = 1;
    sctx.beginPath(); sctx.moveTo(x - 6 * a, y); sctx.lineTo(x + 6 * a, y); sctx.moveTo(x, y - 6 * a); sctx.lineTo(x, y + 6 * a); sctx.stroke();
  }
  sctx.globalAlpha = 1;
}

// Prototype narration: the editor says these as it loads.
const states = [[0, 'Starting Blender…'], [5200, 'Opening the first model…'], [8200, 'Drawing…']];
let start = performance.now(), frozen = null;
function loop(now) {
  const t = frozen ?? now - start;
  frame(t);
  for (const [at, text] of states) if (t >= at) state.textContent = text;
  if (frozen === null && new URLSearchParams(location.search).has('loop') && t > 11000) start = now;
  requestAnimationFrame(loop);
}
window.__seek = (t) => { frozen = t; frame(t); return t; };
requestAnimationFrame(loop);
</script>
</body></html>
`;
writeFileSync(out, html);
console.log('wrote', out, html.length);
