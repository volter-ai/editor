/*---------------------------------------------------------------------------------------------
 *  THE OPENING — a card pull while Blender boots, the owner's direction of 2026-10-07
 *  (design/opening: the prototype `gacha-m.html`, its generator `make-gacha2.mjs`, and the frames
 *  the owner was shown). The card rises on a dark stage, charges, flips with a burst, prints in
 *  the setting the machine stands in, lands its stars and the setting's name, and the cover's own
 *  narration (the rail and its line) comes up beneath it.
 *
 *  "Model out the cyclotron in a real setting… a few cyclotron settings where you'll collect a
 *  new one every time you boot in" (the owner). So the card's art is a render of the machine in a
 *  setting, and each boot pulls one: the first one not seen yet, then the next in turn
 *  (`pullSetting`).
 *
 *  IT IS ELEMENTS, never markup: the page carries a Trusted Types policy and the workbench's own
 *  code never assigns HTML. Its one fetched thing is the card art, a file under the app root; the
 *  pull waits up to `ART_WAIT_MS` for it to decode before it starts, so the scene never prints in
 *  blank.
 *
 *  IT STOPS DRAWING once the card has settled (`SETTLED_MS`): the cover can stay up for tens of
 *  seconds while Blender boots in the tab's worker, and a full-screen canvas redrawn every frame
 *  for all of them would be paid for by the page that is loading underneath. Reduced motion gets
 *  the settled card at once.
 *--------------------------------------------------------------------------------------------*/

import { $ } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { localize } from '../../../../nls.js';

/** One setting a boot can pull. */
export interface OpeningSetting {
	readonly id: string;
	/** Shown on the card under its stars. */
	readonly name: string;
	/** The card art: a render of the machine standing in this setting, as a browser URL. */
	readonly art: string;
	/** Lit stars, out of five. */
	readonly stars: number;
}

export interface Opening {
	/** The cover's narration, the line under the rail. */
	say(text: string): void;
	dispose(): void;
}

const STORAGE_KEY = 'volter.cyclotron.opening';

/**
 * WHICH SETTING THIS BOOT PULLS: the first one this browser has not been shown, else the one
 * after the last shown. Remembered in this browser's storage; with none (a private window, a
 * refused write) every boot is a first boot, which is still a card.
 */
export function pullSetting(settings: readonly OpeningSetting[]): { readonly setting: OpeningSetting; readonly isNew: boolean } {
	let seen: string[] = [];
	let last: string | undefined;
	try {
		const memory: unknown = JSON.parse(mainWindow.localStorage.getItem(STORAGE_KEY) ?? '{}');
		if (memory && typeof memory === 'object') {
			const record = memory as { seen?: unknown; last?: unknown };
			if (Array.isArray(record.seen)) { seen = record.seen.filter((id): id is string => typeof id === 'string'); }
			if (typeof record.last === 'string') { last = record.last; }
		}
	} catch {
		// Nothing remembered.
	}
	const fresh = settings.find((candidate) => !seen.includes(candidate.id));
	const setting = fresh ?? settings[(settings.findIndex((candidate) => candidate.id === last) + 1) % settings.length];
	try {
		mainWindow.localStorage.setItem(STORAGE_KEY, JSON.stringify({ seen: fresh ? [...seen, fresh.id] : seen, last: setting.id }));
	} catch {
		// Not remembered: the same card next time.
	}
	return { setting, isNew: fresh !== undefined };
}

/** The machine's silhouette for the card's back, in a 240-unit box (design/opening/silhouette.txt). */
const SILHOUETTE = 'M120.6 7.1l2.5 0 1.8 .8 .2 .5 0 11.2 2.3 .8 .2-1.5 .8-.8 2-.5 2.2 .3 1 .5 .5 .7 0 4 1.8 1.8 .7 1.5 0 2 4 2 2.5 1.7 2.5 2.8 1 2.2 1 3.5 .3 2.8-1.3 3.2 0 6-1 1.8 2.5 2 0 19.2 4 1.3 6 2.7 7 4.5 4.5 5 1.5 3.3 1.3 3.2 .2 5-2.5 7-1.5 1.8 .3 4.7 1.2 2 2.3 5.5 .2 5-2.5 7-4.2 5-5 3.8-7 3.5-2.3 .7 0 3.8-1.7 1.5 1.7 1.5 0 4.2-3.5 3 0 10-1.5 1.8 0 6-1.7 3.2-2.3 1.8 0 6.5 .5 .5 3.8 1.2 2.5 2 0 10.5-3 2.8 5 2 2.5 2 0 10.2-3.8 3.3-9.7 6-1.5 .2-10-3.7-2.8-2.3-.2-7.7-2.5 .5-5 0-.3 6-4.2 3.5-9.8 6-.5 0-10.5-4-2.5-2 0-10.5 3-2.8-5-2-2.5-2 0-10.2 3-2.8 8.3-5 0-8.2-2.5-2.3-1.5-2.7 0-6.3-1-2 0-2-.5-1 0-8.5-1-.7-6.8-2.5-2.2-2 0-9.5-7.3-4.8-3-3.2-1-1.3-3-6.7-.2-5 2.5-7 1.5-1.8-.3-4.7-1-1.5-2.5-6-.2-5 2.5-7 4.2-5 5-3.8 7-3.5 5.8-2 0-22.7 1.5-1.5 0-5-1-2-.3-2.8 1.8-5.7 2.7-3.5 2-1.5 4.8-2.5 0-2 .7-1.3 0-8 .5-.5 1.5-.5 2.3 0 1.5 .5 .5 .5 .2 3.8 3.5-1 4.5-.5 0-11z';

// The pull's beats, in ms from its start (the prototype's, unchanged).
const CHARGE = 450, FLIP = 1500, FLIP_END = 1950, SETTLE = 2500;
/** The scene prints in from the bottom over `PRINT`, starting just before the flip lands. */
const PRINT_AT = FLIP_END - 150, PRINT = 1500;
/** The stars land one by one after the print, `STAR_STEP` apart; then the name, then the rail. */
const STARS_AT = PRINT_AT + PRINT + 520, STAR_STEP = 190;
const NAME_AT = STARS_AT + 5 * STAR_STEP + 60;
const UNDER_AT = STARS_AT + 5 * STAR_STEP + 300;
/** After this the card holds its pose and the loop stops. */
const SETTLED_MS = UNDER_AT + 900;
/** How long the pull waits for the card art to decode before it starts anyway. */
const ART_WAIT_MS = 400;
/** The card's travel inside the back's scan, in px (its height less the inner margin). */
const BACK_SCAN = 392;

const clamp = (x: number, low = 0, high = 1) => Math.max(low, Math.min(high, x));
const ease = (x: number) => { const k = clamp(x); return k * k * (3 - 2 * k); };
const outBack = (x: number) => { const k = clamp(x); const c = 1.7; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
const outExpo = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(x)));
const inCubic = (x: number) => clamp(x) ** 3;

// The sparks are a fixed set, so every frame is a function of its time alone.
const random = (() => { let seed = 7; return () => (seed = (seed * 16807) % 2147483647) / 2147483647; })();
const INBOUND = Array.from({ length: 70 }, () => ({ a: random() * Math.PI * 2, r: 260 + random() * 340, start: CHARGE + random() * 900, life: 380 + random() * 260, size: .8 + random() * 1.8 }));
const BURST = Array.from({ length: 110 }, () => ({ a: random() * Math.PI * 2, v: .25 + random() * .75, life: 700 + random() * 900, size: .8 + random() * 2.4, lime: random() < .7 }));
const STAR_SPARK = Array.from({ length: 14 }, (_, i) => ({ a: i / 14 * Math.PI * 2 + random() * .3, v: .6 + random() * .6 }));
const GLINTS = Array.from({ length: 16 }, () => ({ x: random(), y: random(), period: 2200 + random() * 2600, phase: random() * 4000 }));

/** `at` holds the pull at that moment instead of playing it (design/opening/preview steps
 *  through frames with it; the product never passes it). */
export function mountOpening(host: HTMLElement, setting: OpeningSetting, isNew: boolean, firstLine: string, at?: number): Opening {
	const halo = $('.volter-opening-halo');
	const rays = $('.volter-opening-rays');
	const ring = $('.volter-opening-ring');
	const sparks = $<HTMLCanvasElement>('canvas.volter-opening-sparks');

	const silhouette = $.SVG<SVGElement>('svg', { viewBox: '0 0 240 240', 'aria-hidden': 'true' },
		$.SVG<SVGElement>('path', { d: SILHOUETTE, fill: 'rgba(220,213,233,.07)', stroke: 'none' }),
		$.SVG<SVGElement>('path', { d: SILHOUETTE, fill: 'none', stroke: 'rgba(228,240,156,.85)', 'stroke-width': '1.4', 'stroke-linejoin': 'round' }));
	const backFill = $('.volter-opening-back-fill');
	const backScan = $('.volter-opening-back-scan');
	const edge = $('.volter-opening-back-edge');
	const back = $('.volter-opening-face.volter-opening-back', undefined,
		$('.volter-opening-back-inner'), silhouette, $('.volter-opening-mark', undefined, 'CYCLOTRON'), backFill, backScan, edge);

	const art = $<HTMLImageElement>('img.volter-opening-art', { alt: '' });
	art.src = setting.art;
	const stars = Array.from({ length: 5 }, () => $('b', undefined, '★'));
	const name = $('.volter-opening-name', undefined, setting.name);
	const badge = isNew ? $('.volter-opening-new', undefined, localize('volterOpeningNew', "New")) : undefined;
	const id = $('.volter-opening-id', undefined, ...(badge ? [badge] : []), $('.volter-opening-stars', undefined, ...stars), name);
	const etch = $('.volter-opening-etch');
	const holo = $('.volter-opening-holo');
	const glare = $('.volter-opening-glare');
	const sweep = $('.volter-opening-sweep');
	const rim = $('.volter-opening-rim');
	const front = $('.volter-opening-face.volter-opening-front', undefined, art, id, etch, $('.volter-opening-keyline'), holo, glare, sweep, rim);
	const card = $('.volter-opening-card', undefined, back, front);
	const stage = $('.volter-opening-stage', undefined, card);

	const state = $('.volter-opening-state', undefined, firstLine);
	const under = $('.volter-opening-under', undefined, $('.volter-opening-rail'), state);
	const flash = $('.volter-opening-flash');
	const root = $('.volter-opening', undefined,
		$('.volter-opening-fx', undefined, halo, rays, ring, sparks), stage, under, $('.volter-opening-fx', undefined, flash));
	host.appendChild(root);

	const context = sparks.getContext('2d');
	let width = 0, height = 0;

	function frame(t: number): void {
		// READS FIRST, then writes, so a frame costs one layout: the stage is never transformed
		// (the card inside it is), and the stars are read where the last frame left them.
		const box = root.getBoundingClientRect();
		const stageBox = stage.getBoundingClientRect();
		const cx = stageBox.left - box.left + stageBox.width / 2, cy = stageBox.top - box.top + stageBox.height / 2;
		const starBursts: { x: number; y: number; k: number }[] = [];
		stars.forEach((star, i) => {
			const k = (t - (STARS_AT + i * STAR_STEP)) / 320;
			if (i < setting.stars && k >= 0 && k < 2.2) {
				const r = star.getBoundingClientRect();
				starBursts.push({ x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2, k: k / 2.2 });
			}
		});
		if (box.width !== width || box.height !== height) {
			width = box.width; height = box.height;
			const dpr = Math.min(2, mainWindow.devicePixelRatio || 1);
			sparks.width = Math.round(width * dpr); sparks.height = Math.round(height * dpr);
			context?.setTransform(dpr, 0, 0, dpr, 0, 0);
		}

		// THE CARD: it rises, trembles as it charges, flips with a swell, settles with an overshoot,
		// then floats and tilts.
		const rise = outExpo(t / 650);
		const charge = clamp((t - CHARGE) / (FLIP - CHARGE));
		const shake = t < FLIP ? 0.4 + 5.5 * inCubic(charge) : 0;
		const sx = Math.sin(t * .083) * shake + Math.sin(t * .131) * shake * .5;
		const sy = Math.cos(t * .097) * shake * .6;
		const flip = ease((t - FLIP) / (FLIP_END - FLIP));
		const swell = Math.sin(Math.PI * clamp((t - FLIP) / (FLIP_END - FLIP))) * .16;
		const settle = outBack((t - FLIP_END) / (SETTLE - FLIP_END));
		const idle = clamp((t - SETTLE) / 800);
		const tiltX = idle * (Math.sin(t / 1900) * 5) + (t < FLIP ? -6 * (1 - rise) : 0);
		const tiltY = idle * (Math.sin(t / 2600 + 1) * 8);
		const floatY = idle * Math.sin(t / 1500) * 5;
		const angle = 180 + flip * 180 + (1 - settle) * (t > FLIP_END ? -8 : 0);
		const scale = (0.86 + 0.14 * rise) * (1 + swell) * (t > FLIP_END ? 1 + (1 - settle) * .05 : 1) * (1 + (t < FLIP ? charge * .03 : 0));
		card.style.transform = `translate3d(${sx.toFixed(2)}px,${(sy + (1 - rise) * 70 + floatY).toFixed(2)}px,0) rotateX(${tiltX.toFixed(2)}deg) rotateY(${(angle + tiltY).toFixed(2)}deg) rotateZ(${((1 - flip) * -3).toFixed(2)}deg) scale(${scale.toFixed(4)})`;
		stage.style.opacity = rise.toFixed(3);

		// The back fills with light from the bottom as it charges, its edge going lilac to lime.
		const climb = ease((t - CHARGE) / (FLIP - CHARGE - 60));
		backScan.style.opacity = t > CHARGE && t < FLIP ? '1' : '0';
		backScan.style.top = `${(12 + (1 - climb) * BACK_SCAN).toFixed(1)}px`;
		backFill.style.height = `${(climb * BACK_SCAN).toFixed(1)}px`;
		const tell = inCubic(charge);
		edge.style.setProperty('--edge', `rgba(${Math.round(220 - 4 * tell)},${Math.round(213 + 22 * tell)},${Math.round(233 - 127 * tell)},${(.65 + .35 * tell).toFixed(3)})`);
		edge.style.setProperty('--glow', `${(tell * 28).toFixed(1)}px`);

		// LIGHT: the halo builds through the charge and blooms at the flip; the rays burst, then turn.
		const bloom = t > FLIP ? Math.exp(-Math.max(0, t - FLIP - 200) / 500) : 0;
		halo.style.opacity = (tell * .55 + bloom * .6 + idle * .18).toFixed(3);
		halo.style.transform = `scale(${(.7 + tell * .3 + bloom * .35).toFixed(3)})`;
		const raysOn = t > FLIP ? Math.min(1, (t - FLIP) / 200) : tell * .25;
		rays.style.opacity = (raysOn * (.35 + .65 * Math.exp(-Math.max(0, t - FLIP - 300) / 900)) * (1 - .55 * idle)).toFixed(3);
		rays.style.transform = `rotate(${(t * .006).toFixed(2)}deg) scale(${(1 + bloom * .15).toFixed(3)})`;
		const wave = clamp((t - FLIP - 180) / 700);
		ring.style.opacity = t > FLIP + 180 ? ((1 - wave) * .9).toFixed(3) : '0';
		ring.style.transform = `scale(${(0.6 + outExpo(wave) * 5.5).toFixed(3)})`;
		flash.style.opacity = t > FLIP + 150 ? (Math.max(0, 1 - (t - FLIP - 150) / 380) * .85).toFixed(3) : '0';

		// FOIL: one bright sweep at the reveal, then a sheen that follows the tilt, and a glare.
		const sw = clamp((t - FLIP_END + 120) / 650);
		sweep.style.opacity = sw > 0 && sw < 1 ? Math.sin(Math.PI * sw).toFixed(3) : '0';
		sweep.style.transform = `translateX(${(-60 + sw * 120).toFixed(1)}%)`;
		const flare = t > STARS_AT + 950 ? Math.exp(-(t - STARS_AT - 950) / 700) : 0;
		holo.style.opacity = (clamp((t - FLIP_END) / 500) * (.22 + .1 * Math.sin(t / 900)) + flare * .35).toFixed(3);
		holo.style.backgroundPosition = `${(50 + tiltY * 6 + Math.sin(t / 1700) * 18).toFixed(1)}% ${(50 + tiltX * 6).toFixed(1)}%`;
		glare.style.opacity = (idle * .55).toFixed(3);
		glare.style.setProperty('--gx', `${(50 - tiltY * 5).toFixed(1)}%`);
		glare.style.setProperty('--gy', `${(30 + tiltX * 5).toFixed(1)}%`);
		rim.style.opacity = (clamp((t - STARS_AT - 1000) / 500) * (.55 + .25 * Math.sin(t / 700))).toFixed(3);
		rim.style.setProperty('--rim', `${((t / 18) % 360).toFixed(1)}deg`);

		// THE SCENE prints in from the bottom, with an etched sheen over it.
		const scan = clamp((t - PRINT_AT) / PRINT);
		art.style.clipPath = `inset(${((1 - scan) * 100).toFixed(2)}% 0 0 0)`;
		const sheen = `${(50 + tiltY * 7 + Math.sin(t / 1600) * 22).toFixed(1)}% ${(50 + tiltX * 7).toFixed(1)}%`;
		etch.style.opacity = (clamp((t - FLIP_END - 300) / 600) * (.28 + .12 * Math.sin(t / 800))).toFixed(3);
		etch.style.backgroundPosition = `0 0, ${sheen}`;
		etch.style.setProperty('mask-position', sheen);
		etch.style.setProperty('-webkit-mask-position', sheen);

		// THE STARS slam in one by one, the setting's lit ones bright; then its name rises.
		stars.forEach((star, i) => {
			const k = (t - (STARS_AT + i * STAR_STEP)) / 320;
			const lit = i < setting.stars && k >= 0;
			star.classList.toggle('lit', lit);
			star.style.transform = `scale(${(!lit ? (i < setting.stars ? .4 : 1) : k < 1 ? 2.2 - 1.2 * outBack(k) : 1).toFixed(3)})`;
		});
		const named = clamp((t - NAME_AT) / 500);
		name.style.opacity = ease(named).toFixed(3);
		name.style.transform = `translateY(${((1 - outExpo(named)) * 10).toFixed(1)}px)`;
		if (badge) { badge.style.opacity = ease(named).toFixed(3); }

		// IMPACT: a short shake of the whole cover at the burst; then the narration comes up.
		const hit = clamp((t - FLIP - 150) / 260);
		const amp = t > FLIP + 150 && hit < 1 ? (1 - hit) * 7 : 0;
		root.style.transform = amp ? `translate(${(Math.sin(t * .9) * amp).toFixed(2)}px,${(Math.cos(t * 1.3) * amp * .7).toFixed(2)}px)` : '';
		under.style.opacity = clamp((t - UNDER_AT) / 600).toFixed(3);

		// SPARKS: drawn in from the dark as it charges, a burst at the flip, glints, and a ring
		// of them round each star as it lands.
		if (!context) { return; }
		context.clearRect(0, 0, width, height);
		for (const p of INBOUND) {
			const k = (t - p.start) / p.life;
			if (k < 0 || k > 1) { continue; }
			const r = p.r * (1 - outExpo(k)) + 30;
			const x = cx + Math.cos(p.a) * r, y = cy + Math.sin(p.a) * r * .8;
			context.globalAlpha = Math.sin(Math.PI * k) * .9;
			context.fillStyle = context.strokeStyle = k > .6 ? '#e4f09c' : '#dcd5e9';
			context.beginPath(); context.arc(x, y, p.size, 0, 7); context.fill();
			context.globalAlpha *= .35; context.lineWidth = p.size * .8;
			context.beginPath(); context.moveTo(x, y);
			context.lineTo(cx + Math.cos(p.a) * (r + 26), cy + Math.sin(p.a) * (r + 26) * .8); context.stroke();
		}
		for (const p of BURST) {
			const k = (t - FLIP - 160) / p.life;
			if (k < 0 || k > 1) { continue; }
			const r = 40 + outExpo(k) * 520 * p.v;
			context.globalAlpha = (1 - k) * .95;
			context.fillStyle = p.lime ? '#e4f09c' : '#ffffff';
			context.beginPath(); context.arc(cx + Math.cos(p.a) * r, cy + Math.sin(p.a) * r * .85 + k * k * 60, p.size * (1 - k * .5), 0, 7); context.fill();
		}
		for (const g of GLINTS) {
			const k = ((t + g.phase) % g.period) / g.period;
			if (idle <= 0 || k > .18) { continue; }
			const a = Math.sin(Math.PI * k / .18) * idle;
			const x = cx - 150 + g.x * 300, y = cy - 200 + g.y * 400;
			context.globalAlpha = a * .9; context.strokeStyle = '#f6fbd8'; context.lineWidth = 1;
			context.beginPath(); context.moveTo(x - 6 * a, y); context.lineTo(x + 6 * a, y); context.moveTo(x, y - 6 * a); context.lineTo(x, y + 6 * a); context.stroke();
		}
		for (const b of starBursts) {
			for (const p of STAR_SPARK) {
				const r = 6 + outExpo(b.k) * 42 * p.v;
				context.globalAlpha = (1 - b.k) * .95; context.fillStyle = '#eef7b8';
				context.beginPath(); context.arc(b.x + Math.cos(p.a) * r, b.y + Math.sin(p.a) * r, 1.6 * (1 - b.k * .6), 0, 7); context.fill();
			}
		}
		context.globalAlpha = 1;
	}

	let disposed = false;
	let started = false;
	let animation: number | undefined;
	let wait: number | undefined;
	const play = () => {
		if (disposed || started) { return; }
		started = true;
		if (wait !== undefined) { mainWindow.clearTimeout(wait); }
		let start: number | undefined;
		const tick = (now: number) => {
			start ??= now;
			const t = Math.min(now - start, SETTLED_MS);
			frame(t);
			animation = t < SETTLED_MS && !disposed ? mainWindow.requestAnimationFrame(tick) : undefined;
		};
		animation = mainWindow.requestAnimationFrame(tick);
	};
	if (at !== undefined) {
		frame(clamp(at, 0, SETTLED_MS));
	} else if (mainWindow.matchMedia('(prefers-reduced-motion: reduce)').matches) {
		frame(SETTLED_MS);
	} else {
		frame(0);
		art.decode().then(play, play);
		wait = mainWindow.setTimeout(play, ART_WAIT_MS);
	}

	return {
		say: (text: string) => { state.textContent = text; },
		dispose: () => {
			disposed = true;
			if (animation !== undefined) { mainWindow.cancelAnimationFrame(animation); }
			if (wait !== undefined) { mainWindow.clearTimeout(wait); }
			root.remove();
		},
	};
}
