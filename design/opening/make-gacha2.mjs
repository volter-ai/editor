// Cyclotron boot as a gacha card pull. Writes a self-contained prototype page next to the site's
// three.js machine modules (dist/proto). Everything runs off ONE clock, t (ms), so any moment can be
// seeked for an eye test: window.__seek(t) freezes the page at t.
// node make-gacha.mjs <out.html>
import { readFileSync, writeFileSync } from 'node:fs';

const [out, dataPath] = process.argv.slice(2);
const data = JSON.parse(readFileSync(dataPath, 'utf8'));
const machinePaths = data.parts.map((p, i) => `<path class="mp${p.accent ? ' acc' : ''}" data-i="${i}" d="${p.d}"/>`).join('');
const partsJson = JSON.stringify(data.parts.map((p) => ({ e: p.explode, o: p.order, a: p.accent })));
const silhouette = readFileSync(new URL('./silhouette.txt', import.meta.url), 'utf8');

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
.stage{position:relative;perspective:1100px;width:300px;height:420px;margin-top:-10px}
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
.fa{position:absolute;inset:0;border-radius:16px;overflow:hidden}
.fa img.scene{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;clip-path:inset(100% 0 0 0)}
.fa-top,.fa-stars,.fa-bottom{display:none!important}
.fa-id{position:absolute;left:0;right:0;bottom:0;padding:44px 20px 20px;background:linear-gradient(0deg,rgba(8,12,15,.78),rgba(8,12,15,.38) 55%,rgba(8,12,15,0))}
.fa-idstars{font-size:21px;letter-spacing:.06em;line-height:1}
.fa-idstars b{display:inline-block;font-weight:400;color:rgba(255,255,255,.16);transform-origin:50% 55%}
.fa-idstars b.lit{color:#e4f09c;text-shadow:0 0 8px rgba(216,235,106,.95),0 0 18px rgba(216,235,106,.5),0 1px 2px rgba(0,0,0,.6)}
.fa-idname{margin-top:6px;font:800 25px Inter,"Segoe UI",system-ui,sans-serif;letter-spacing:.01em;color:#fbfaf6;text-shadow:0 1px 3px rgba(0,0,0,.6);opacity:0}
.fa-top{position:absolute;left:0;right:0;top:0;padding:16px 18px 34px;background:linear-gradient(180deg,rgba(10,16,20,.72),rgba(10,16,20,.35) 55%,rgba(10,16,20,0))}
.fa-name{font:800 21px Inter,"Segoe UI",system-ui,sans-serif;letter-spacing:.06em;color:#fbfaf6;text-shadow:0 1px 2px rgba(0,0,0,.6),0 0 12px rgba(0,0,0,.35)}
.fa-sub{margin-top:3px;font:600 10px ui-monospace,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.16em;color:#e4f09c;text-shadow:0 1px 2px rgba(0,0,0,.7)}
.fa-stars{position:absolute;right:16px;top:18px;font-size:15px;letter-spacing:.06em;line-height:1}
.fa-stars b{display:inline-block;font-weight:400;color:rgba(255,255,255,.18);transform-origin:50% 55%;text-shadow:0 1px 2px rgba(0,0,0,.5)}
.fa-stars b.lit{color:#e4f09c;text-shadow:0 0 6px rgba(216,235,106,.95),0 1px 2px rgba(0,0,0,.6)}
.fa-bottom{position:absolute;left:0;right:0;bottom:0;padding:30px 18px 14px;display:flex;justify-content:space-between;align-items:flex-end;
  background:linear-gradient(0deg,rgba(10,16,20,.7),rgba(10,16,20,.3) 55%,rgba(10,16,20,0));font:600 9.5px ui-monospace,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.1em;color:rgba(251,250,246,.85)}
.fa-credit{font-weight:400;color:rgba(251,250,246,.6)}
.keyline{position:absolute;inset:6px;border-radius:11px;border:1px solid rgba(255,255,255,.28);pointer-events:none}
.etch{position:absolute;inset:0;mix-blend-mode:color-dodge;opacity:0;pointer-events:none;
  background:repeating-linear-gradient(115deg,rgba(255,255,255,0) 0 3px,rgba(255,255,255,.55) 3px 4px),linear-gradient(115deg,rgba(228,240,156,.0) 10%,rgba(228,240,156,.7) 35%,rgba(220,213,233,.75) 50%,rgba(140,220,255,.6) 65%,rgba(228,240,156,0) 90%);
  background-size:auto,300% 300%;-webkit-mask:linear-gradient(115deg,transparent 15%,#000 40%,#000 60%,transparent 85%);-webkit-mask-size:300% 300%;mask:linear-gradient(115deg,transparent 15%,#000 40%,#000 60%,transparent 85%);mask-size:300% 300%}
.front.full .rim{inset:-1px;border-radius:17px;padding:1.5px}
.front.full{background:#0f1a1f}
.collect{margin-top:6px;font:600 10.5px ui-monospace,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.14em;color:#8a8a8a}
.collect .new{color:#141414;background:#d8eb6a;padding:2px 7px;border-radius:3px;letter-spacing:.14em}
.collect{margin-top:10px}
.front img.art{position:absolute;left:0;right:0;top:0;bottom:68px;width:100%;height:calc(100% - 68px);object-fit:cover;clip-path:inset(100% 0 0 0)}
.front.has-art .head{background:linear-gradient(180deg,rgba(247,246,241,.92),rgba(247,246,241,0));left:0;right:0;top:0;padding:12px 22px 22px}
.front .glowbg{position:absolute;inset:0;background:radial-gradient(ellipse 62% 48% at 50% 50%,rgba(220,213,233,.95) 0,rgba(220,213,233,.45) 45%,rgba(220,213,233,0) 75%),repeating-linear-gradient(0deg,rgba(22,37,44,.045) 0 1px,transparent 1px 14px),repeating-linear-gradient(90deg,rgba(22,37,44,.045) 0 1px,transparent 1px 14px)}
.front .unused-plane{position:absolute;left:58px;top:62px;width:184px;height:262px;background:var(--lilac);transform:rotate(-6deg) translate(10px,8px);opacity:.75}
.front .plane-line{position:absolute;left:44px;top:50px;width:206px;height:286px;border:1px solid rgba(22,37,44,.35);transform:rotate(-6deg)}
.front .frame{position:absolute;inset:10px;border:1px solid rgba(22,37,44,.55);border-radius:9px}
.front .head{position:absolute;left:22px;right:22px;top:20px;display:flex;justify-content:space-between;font:600 9.5px ui-monospace,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.2em;color:var(--ink)}
.front .head span:last-child{font-weight:400;letter-spacing:.08em;color:rgba(22,37,44,.6)}
.front svg.machine{position:absolute;left:4px;top:34px;width:292px;height:342px;overflow:visible}
.mp{fill:none;stroke:var(--ink);stroke-width:.95;stroke-linecap:round;stroke-linejoin:round;opacity:0}
.mp.acc{stroke:#8fa31f;stroke-width:1.15}
.printscan{position:absolute;left:14px;right:14px;height:2px;top:0;opacity:0;background:linear-gradient(90deg,transparent,#c9de4f 15%,#e4f09c 50%,#c9de4f 85%,transparent);box-shadow:0 0 12px 2px rgba(216,235,106,.75)}
.backscan{position:absolute;left:12px;right:12px;height:2px;top:0;opacity:0;background:linear-gradient(90deg,transparent,#d8eb6a 20%,#f4fbd0 50%,#d8eb6a 80%,transparent);box-shadow:0 0 16px 3px rgba(216,235,106,.8)}
.back .fill{position:absolute;left:12px;right:12px;bottom:12px;height:0;border-radius:0 0 10px 10px;background:linear-gradient(0deg,rgba(216,235,106,.16),rgba(216,235,106,0))}
.plate{position:absolute;left:10px;right:10px;bottom:10px;height:58px;border-radius:0 0 9px 9px;background:linear-gradient(180deg,#1d2f37,#16252c);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;overflow:hidden}
.plate::before{content:"";position:absolute;left:0;right:0;top:0;height:1px;background:linear-gradient(90deg,transparent,#d8eb6a,transparent);opacity:.8}
.pstars{font-size:14px;letter-spacing:.18em;line-height:1}
.pstars b,.bigstars b{display:inline-block;font-weight:400;color:rgba(228,240,156,.14);transform-origin:50% 55%}
.pstars b.lit{color:#e4f09c;text-shadow:0 0 6px rgba(216,235,106,.9),0 0 14px rgba(216,235,106,.5)}
.pname{font:700 17px Inter,"Segoe UI",system-ui,sans-serif;letter-spacing:.34em;margin-left:.34em;color:#f7f6f1}
.reveal{position:relative;margin-top:26px;display:flex;flex-direction:column;align-items:center}
.reveal[hidden]{display:none}
.bigstars{font-size:30px;letter-spacing:.14em;margin-left:.14em;line-height:1}
.bigstars b.lit{color:#e4f09c;text-shadow:0 0 10px rgba(216,235,106,.95),0 0 26px rgba(216,235,106,.55)}
.bigname{margin-top:10px;font:600 40px Inter,"Segoe UI",system-ui,sans-serif;letter-spacing:-.01em;line-height:1;color:transparent;
  background:linear-gradient(100deg,#f4f4ef 0 40%,#ffffff 46%,#e4f09c 50%,#ffffff 54%,#f4f4ef 60% 100%);background-size:300% 100%;background-position:100% 0;-webkit-background-clip:text;background-clip:text;opacity:0}
.front .unused-foot{position:absolute;left:22px;right:22px;bottom:18px;display:flex;justify-content:space-between;align-items:center;font:10px ui-monospace,"SF Mono",Menlo,Consolas,monospace;color:rgba(22,37,44,.65);letter-spacing:.06em}
.front .stars{font-size:13px;letter-spacing:.12em;color:var(--ink)}
.front .stars b{display:inline-block;font-weight:400;color:rgba(22,37,44,.16);transform-origin:50% 60%}
.front .stars b.lit{color:var(--ink)}
.front .stars b.five.lit{color:#b8cc3a;text-shadow:0 0 8px rgba(216,235,106,.95)}
.rim{position:absolute;inset:-1.5px;border-radius:17.5px;opacity:0;padding:1.5px;background:conic-gradient(from var(--rim,0deg),#e4f09c,#dcd5e9,#8cdcff,#e4f09c,#dcd5e9,#e4f09c);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude}
.holo{position:absolute;inset:0;border-radius:16px;mix-blend-mode:color-dodge;opacity:0;
  background:linear-gradient(115deg,transparent 20%,rgba(228,240,156,.55) 36%,rgba(220,213,233,.6) 44%,rgba(140,220,255,.45) 52%,rgba(228,240,156,.5) 60%,transparent 76%);background-size:260% 260%}
.glare{position:absolute;inset:0;border-radius:16px;mix-blend-mode:soft-light;opacity:0;background:radial-gradient(circle at var(--gx,50%) var(--gy,30%),rgba(255,255,255,.9) 0,rgba(255,255,255,0) 45%)}
.sweep{position:absolute;inset:-40%;opacity:0;background:linear-gradient(105deg,transparent 42%,rgba(255,255,255,.95) 49%,rgba(228,240,156,.9) 51%,transparent 58%);mix-blend-mode:screen}
.under{position:relative;margin-top:30px;display:flex;flex-direction:column;align-items:center;opacity:0}
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
      <div class="mark">CYCLOTRON</div><div class="fill"></div><div class="backscan"></div><div class="edge"></div></div>
    <div class="face front"><div class="glowbg"></div><img class="art" alt="" hidden>
      <div class="fa" hidden>
        <img class="scene" alt="">
        <div class="fa-top"><div class="fa-name">CYCLOTRON</div><div class="fa-sub"></div></div>
        <div class="fa-stars"><b>★</b><b>★</b><b>★</b><b>★</b><b>★</b></div>
        <div class="fa-bottom"><span class="fa-no"></span><span class="fa-credit">Made with Cyclotron</span></div>
        <div class="fa-id"><div class="fa-idstars"><b>★</b><b>★</b><b>★</b><b>★</b><b>★</b></div><div class="fa-idname"></div></div>
        <div class="etch"></div><div class="keyline"></div>
      </div><svg class="machine" viewBox="${data.viewBox.join(' ')}">${machinePaths}</svg><div class="printscan"></div><div class="frame"></div>
      <div class="head"><span>No. 001</span><span>BLENDER · THREE.JS · REACT</span></div>
      <div class="plate"><div class="pstars"><b>★</b><b>★</b><b>★</b><b>★</b><b>★</b></div><div class="pname">CYCLOTRON</div></div>
      <div class="holo"></div><div class="glare"></div><div class="sweep"></div><div class="rim"></div></div>
  </div></div>
  <div class="reveal" hidden><div class="bigstars"><b>★</b><b>★</b><b>★</b><b>★</b><b>★</b></div><div class="bigname">Cyclotron</div><div class="collect" hidden><span class="new">NEW</span><span class="count"></span></div></div>
  <div class="under"><div class="folder">my-race</div><div class="rail"></div><div class="state">Starting Blender…</div></div>
  <div class="fx"><div class="flash"></div></div>
</div>
<script type="module">
const $ = (s) => document.querySelector(s);
const card = $('.card'), back = $('.back .edge'), rays = $('.rays'), halo = $('.halo'), ring = $('.ring'), flash = $('.flash');
const holo = $('.holo'), glare = $('.glare'), sweep = $('.sweep'), under = $('.under'), state = $('.state');
const sparks = $('canvas.sparks'), sctx = sparks.getContext('2d');
const params = new URLSearchParams(location.search);
const iconSrc = params.get('icon'), gameName = params.get('name');
const sceneSrc = params.get('scene'), setting = params.get('setting') || 'Canyon Run', number = params.get('no') || '003', total = params.get('of') || '008';
const fa = $('.fa');
if (sceneSrc) {
  $('.front').classList.add('full'); fa.hidden = false; fa.querySelector('img.scene').src = sceneSrc;
  for (const sel of ['.glowbg', 'svg.machine', '.plate', '.head', '.frame', '.printscan']) { const el = $(sel); if (el) el.style.display = 'none'; }
  fa.querySelector('.fa-sub').textContent = setting.toUpperCase();
  fa.querySelector('.fa-idname').textContent = setting;
  fa.querySelector('.fa-no').textContent = 'No. ' + number + ' / ' + total;
  $('.bigname').textContent = setting;
  const c = $('.collect'); c.hidden = false; c.querySelector('.count').textContent = ''; document.querySelectorAll('.folder').forEach((el) => { el.style.display = 'none'; });
}
const art = $('img.art'), front = $('.front');
if (iconSrc) { art.src = iconSrc; art.hidden = false; front.classList.add('has-art'); $('svg.machine').style.display = 'none'; }
if (gameName) { $('.pname').textContent = gameName.toUpperCase(); $('.bigname').textContent = gameName; document.querySelectorAll('.folder').forEach((el) => { el.textContent = 'Made with Cyclotron'; }); }
const machine = [...document.querySelectorAll('.mp')];
const PARTS = ${partsJson};
const pstarsAll = sceneSrc ? [...document.querySelectorAll('.fa-idstars b')] : [...document.querySelectorAll('.pstars b')];
const pstars = pstarsAll, bigstars = [...document.querySelectorAll('.bigstars b')], bigname = $('.bigname'), rim = $('.rim'), cover = $('.cover');
const printscan = $('.printscan'), backscan = $('.backscan'), backfill = $('.back .fill'), stage = $('.stage');
const VB = ${JSON.stringify(data.viewBox)};
// Each part's height on the card, from its path's box: the print scan lands it as it passes.
const heights = machine.map((el) => { const b = el.getBBox(); return (b.y + b.height / 2 - VB[1]) / VB[3]; });

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
const starBursts = [];
const starSpark = Array.from({ length: 14 }, (_, i) => ({ a: i / 14 * Math.PI * 2 + rnd() * .3, v: .6 + rnd() * .6 }));
const glints = Array.from({ length: 16 }, () => ({ x: rnd(), y: rnd(), period: 2200 + rnd() * 2600, phase: rnd() * 4000 }));

function size() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  sparks.width = innerWidth * dpr; sparks.height = innerHeight * dpr; sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
  stage.style.opacity = rise.toFixed(3);
  const climb = ease((t - B.charge) / (B.flip - B.charge - 60));
  backscan.style.opacity = (t > B.charge && t < B.flip ? 1 : 0).toFixed(2);
  backscan.style.top = (12 + (1 - climb) * 392).toFixed(1) + 'px';
  backfill.style.height = (climb * 392).toFixed(1) + 'px';
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
  // RARITY: the stars light one by one after the machine lands; the fifth in lime, and the foil flares.
  const S0 = B.flipEnd - 150 + 1500 + 520;
  starBursts.length = 0;
  bigstars.forEach((el, i) => {
    const at = S0 + i * 190, k = (t - at) / 320;
    el.classList.toggle('lit', k >= 0); pstars[i].classList.toggle('lit', k >= 0);
    // Slam: in from big and bright, overshoot, settle.
    const sc = k < 0 ? .4 : k < 1 ? 2.2 - 1.2 * outBack(k) : 1;
    el.style.transform = 'scale(' + sc.toFixed(3) + ')';
    pstars[i].style.transform = sceneSrc ? 'scale(' + sc.toFixed(3) + ')' : 'scale(' + (k >= 0 && k < 1 ? 1 + Math.sin(Math.PI * k) * .6 : 1).toFixed(3) + ')';
    if (k >= 0 && k < 2.2) { const r = (sceneSrc ? pstars[i] : el).getBoundingClientRect(); starBursts.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, k: k / 2.2 }); }
  });
  const nk = clamp((t - (S0 - 250)) / 600);
  bigname.style.opacity = ease(nk).toFixed(3);
  if (sceneSrc) { const nm = fa.querySelector('.fa-idname'); const k2 = clamp((t - (S0 + 5 * 190 + 60)) / 500); nm.style.opacity = ease(k2).toFixed(3); nm.style.transform = 'translateY(' + ((1 - outExpo(k2)) * 10).toFixed(1) + 'px)'; }
  bigname.style.transform = 'translateY(' + ((1 - outExpo(nk)) * 14).toFixed(1) + 'px)';
  const shine = clamp((t - (S0 + 5 * 190 + 150)) / 900);
  bigname.style.backgroundPosition = (100 - shine * 100).toFixed(1) + '% 0';
  const flare = Math.exp(-Math.max(0, t - (S0 + 950)) / 700) * (t > S0 + 950 ? 1 : 0);
  holo.style.opacity = (parseFloat(holo.style.opacity || 0) + flare * .35).toFixed(3);
  rim.style.opacity = (clamp((t - S0 - 1000) / 500) * (.55 + .25 * Math.sin(t / 700))).toFixed(3);
  rim.style.setProperty('--rim', ((t / 18) % 360).toFixed(1) + 'deg');
  // IMPACT: a short shake of the whole screen at the burst.
  const hit = clamp((t - B.flip - 150) / 260);
  const amp = t > B.flip + 150 && hit < 1 ? (1 - hit) * 7 : 0;
  cover.style.transform = amp ? 'translate(' + (Math.sin(t * .9) * amp).toFixed(2) + 'px,' + (Math.cos(t * 1.3) * amp * .7).toFixed(2) + 'px)' : '';
  under.style.opacity = clamp((t - (S0 + 5 * 190 + 300)) / 600).toFixed(3);
  const collect = $('.collect'); if (collect) { const ck = clamp((t - (S0 + 5 * 190 + 100)) / 450); collect.style.opacity = ease(ck).toFixed(3); collect.style.transform = 'translateY(' + ((1 - outExpo(ck)) * 8).toFixed(1) + 'px)'; }
  // MACHINE: the site's assembly, compressed: base machine at the reveal, then the swapped-in parts fly in.
  const A0 = B.flipEnd - 150, PRINT = 1500, FLY = 520;
  const scanK = clamp((t - A0) / PRINT);
  printscan.style.opacity = (scanK > 0 && scanK < 1 ? 1 : 0).toFixed(2);
  printscan.style.top = (40 + 318 * (1 - scanK)).toFixed(1) + 'px';
  if (sceneSrc) {
    const sc = fa.querySelector('img.scene'); sc.style.clipPath = 'inset(' + ((1 - scanK) * 100).toFixed(2) + '% 0 0 0)';
    const etch = fa.querySelector('.etch');
    etch.style.opacity = (clamp((t - B.flipEnd - 300) / 600) * (.28 + .12 * Math.sin(t / 800))).toFixed(3);
    const pos = (50 + tiltY * 7 + Math.sin(t / 1600) * 22).toFixed(1) + '% ' + (50 + tiltX * 7).toFixed(1) + '%';
    etch.style.backgroundPosition = '0 0, ' + pos; etch.style.webkitMaskPosition = pos; etch.style.maskPosition = pos;
  }
  if (iconSrc) art.style.clipPath = 'inset(' + ((1 - scanK) * 100).toFixed(2) + '% 0 0 0)';
  machine.forEach((el, i) => {
    const P = PARTS[i];
    const land = P.a ? A0 + PRINT + 120 + (P.o % 4) * 110 : A0 + PRINT * (1 - heights[i]) + (P.o % 5) * 18;
    const k = (t - (land - FLY)) / FLY;
    const p = outBack(k), q = clamp(k * 1.6);
    el.style.opacity = q.toFixed(3);
    el.setAttribute('transform', 'translate(' + (P.e[0] * (1 - p)).toFixed(2) + ' ' + (P.e[1] * (1 - p)).toFixed(2) + ')');
    if (P.a) el.style.filter = k > 0.85 && k < 1.6 ? 'drop-shadow(0 0 ' + (4 * Math.sin(Math.PI * clamp((k - .85) / .75))).toFixed(2) + 'px rgba(216,235,106,.95))' : 'none';
  });
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
  for (const b of starBursts) for (const p of starSpark) {
    const r = 6 + outExpo(b.k) * 42 * p.v;
    sctx.globalAlpha = (1 - b.k) * .95; sctx.fillStyle = '#eef7b8';
    sctx.beginPath(); sctx.arc(b.x + Math.cos(p.a) * r, b.y + Math.sin(p.a) * r, 1.6 * (1 - b.k * .6), 0, 7); sctx.fill();
  }
  sctx.globalAlpha = 1;
}

// Prototype narration: the editor says these as it loads.
const states = [[0, 'Opening my-race…'], [5200, 'Opening my-race…'], [8200, 'Opening my-race…']];
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
