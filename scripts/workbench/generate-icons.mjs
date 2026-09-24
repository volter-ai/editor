/*---------------------------------------------------------------------------------------------
 *  THE BLENDER LOOK'S PRODUCT ICON THEME — WORK.md §The core is Code-OSS U8.
 *
 *  The editor's own glyphs (`@vgai/blender`'s `blender.icons.json`, 346 of them, traced from
 *  Blender's `release/datafiles/icons_svg/*.svg` by `blender-icon-trace.mjs`) paint inside OUR
 *  panels through `EditorIcon`, and always did. What they never reached is the FRAME's own
 *  marks — the twisties in a tree, the close on a view, the panel's chevrons — because those
 *  are codicons the workbench draws. Under Code-OSS the door for that is a PRODUCT ICON THEME:
 *  a font plus a map from icon id to a character in it, contributed by an extension.
 *
 *  ## The rung audit (build rule 1), stated
 *
 *  The canonical chain for SVG → icon font is `svgicons2svgfont` → `svg2ttf` → `ttf2woff2`,
 *  wrapped as one package by `fantasticon`. Both take SVG FILES from a directory and do their
 *  own path parsing and y-flip. Our input is not files: it is 346 single `path` `d` strings on
 *  a 16-unit grid, already in one JSON. So the rung that fits is **`opentype.js`**, a font
 *  library that takes SVG path data directly (`Path.fromSVG`) and writes the font — one
 *  dependency instead of a three-package chain plus 346 temporary files written only to be
 *  re-parsed.
 *
 *  It needs ONE more, and the measurement says which: **283 of the 346 glyphs use elliptical
 *  ARC segments** (`A`), and `opentype.js`'s `fromSVG` supports `M L Q C Z H V` and refuses
 *  an `A` by name. Arc-to-cubic is a real library and hand-rolling it is the defect rule 1
 *  names, so the generator uses **`svgpath`** (fontello) — the same package `svg2ttf` itself
 *  normalises with — and its `.unarc()`. Both are fork devDependencies.
 *
 *  ## The geometry, and why it is exact
 *
 *  Blender authors an icon on a 16-unit grid and the trace preserves it, so the only transform
 *  here is y-flip and scale: `unitsPerEm` is 1024 and the scale is 64, which maps the 16-unit
 *  grid onto integer font units with no rounding at all. Ascender 1024, descender 0, advance
 *  1024 — the icon fills the em box above the baseline, which is how a codicon font is built.
 *  `flipY` is turned OFF in `fromSVG` because its default flips about each path's OWN bounding
 *  box, which would re-centre every glyph differently; the flip is applied here, about the
 *  grid, so a glyph keeps its place in the 16-unit square.
 *
 *  ## The MAP is the claim, and it is deliberately small
 *
 *  A product icon theme replaces icons BY ID, and an id is a codicon (or anything the fork
 *  registers with `registerIcon`). So each row below is a claim that Blender has its own mark
 *  for that frame gesture, made once and reviewable. Rows are added by MEASUREMENT — a frame
 *  beside a frame — never by picking the nearest silhouette, which is exactly the mistake I1
 *  measured and I2 fixed for the Properties rail (thirteen of sixteen tabs were a distinct NAME
 *  over a neighbouring shape). A codicon with no row keeps its own mark, which is the honest
 *  state for the several hundred marks Blender has no opinion about.
 *
 *  ## Drift
 *
 *  The artifacts carry the sha256 of the icon set they were generated from. Run without
 *  `--write` the generator RE-READS it and refuses, naming the file that moved.
 *
 *  Usage:
 *    node scripts/workbench/generate-icons.mjs [--write]
 *
 *  `opentype.js` and `svgpath` are this script's own dependencies and are declared in the
 *  repository's devDependencies; the artifacts it writes are committed, so nothing but a move
 *  in the traced icon set needs it run.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import svgpath from 'svgpath';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// The product's OWN extension: the font is traced from `@vgai/blender`'s glyphs and only the
// model editor ships a theme that selects it (P3, 2026-09-21).
const OUT_DIR = join(REPO_ROOT, 'packages/model-editor/workbench/extensions/theme-blender/producticons');
const FONT_PATH = join(OUT_DIR, 'blender-icons.otf');
const THEME_PATH = join(OUT_DIR, 'blender-product-icon-theme.json');
const ICONS_REL = 'packages/editor-blender/contributions/blender.icons.json';

/**
 * CODICON ID → the glyph in `blender.icons.json` that IS Blender's mark for it.
 *
 * Every row is a traced Blender outline standing in for a frame gesture Blender also has. The
 * arrows, the chevrons and the caret are Blender's own `back`/`forward`/`down` arrows and the
 * disclosure triangles its outliner draws; `close` is `xmark`, which is the mark on Blender's
 * own X buttons; the magnifier is the one in its search fields; the eye pair is the outliner's
 * visibility column, which is the single most recognisable mark in the whole reference.
 */
const CODICON_MAP = {
	'chevron-down': 'chevron-down',
	'chevron-left': 'chevron-left',
	'chevron-right': 'chevron-right',
	'chevron-up': 'chevron-down',
	'arrow-down': 'arrow-down',
	'arrow-left': 'arrow-left',
	'arrow-right': 'arrow-right',
	'arrow-up': 'arrow-up',
	'triangle-down': 'caret-down',
	'triangle-right': 'caret-right',
	'close': 'xmark',
	'chrome-close': 'xmark',
	'add': 'plus',
	'remove': 'minus',
	'trash': 'trash',
	'search': 'magnifying-glass',
	'zoom-in': 'magnifying-glass-plus',
	'zoom-out': 'magnifying-glass-minus',
	'eye': 'eye',
	'eye-closed': 'eye-slash',
	'check': 'check',
	'info': 'circle-info',
	'warning': 'triangle-exclamation',
	'error': 'circle-exclamation',
	'folder': 'folder',
	'folder-opened': 'folder-open',
	'file': 'file',
	'file-code': 'file-code',
	'copy': 'copy',
	'link': 'link',
	'lock': 'lock',
	'unlock': 'lock-open',
	'play': 'play',
	'debug-pause': 'pause',
	'debug-stop': 'stop',
	'list-flat': 'list',
	'ellipsis': 'ellipsis',
	// NO ROW for 'filter' or 'settings-gear': the traced set has no `filter` and no `gear`,
	// and the generator REFUSED by name when they were claimed here (which is the guard
	// working). They keep their codicon until a trace gives Blender's own mark for them.
};

function parseArgs(argv) {
	const args = { write: false };
	for (let i = 2; i < argv.length; i++) {
		if (argv[i] === '--engine') { throw new Error('--engine is gone: the icon set and the artifact both live in this repository now.'); }
		else if (argv[i] === '--write') { args.write = true; }
		else { throw new Error(`unknown argument ${argv[i]} — usage: node scripts/workbench/generate-icons.mjs [--write]`); }
	}
	return args;
}

/** The 16-unit grid → font units. 1024 / 16 = 64, so every traced coordinate stays an integer. */
const UNITS_PER_EM = 1024;
const GRID = 16;
const SCALE = UNITS_PER_EM / GRID;
/** The Private Use Area, where every icon font puts its glyphs. */
const PUA_START = 0xe000;

function glyphFor(name, d, unicode) {
	const source = new opentype.Path();
	// UNARC FIRST. 283 of the 346 glyphs carry elliptical arcs and `fromSVG` supports
	// `M L Q C Z H V` only — it throws "Unsupported path command: A" by name, which is how
	// this was found. `.unarc()` is svgpath's exact endpoint-to-centre conversion, the same one
	// `svg2ttf` runs; `.abs()` is because the transform below assumes absolute coordinates.
	//
	// `.round(4)` is NOT cosmetic, and a collapsed glyph is what proved it. `unarc()` emits
	// full double precision (`3.0000000000000004`), and `opentype.js`'s `fromSVG` then yields a
	// command whose endpoint coordinate is `null` — its "same as the pen" optimisation misfiring
	// on a value that is not quite equal to the one before it. A `null` is not `undefined`, so
	// the transform below happily arithmetic'd it into 0 and 1024 and the `stop` icon came out
	// as a single point (bounding box 192,871 → 192,871). Rounding the source removes the
	// near-equal values that trigger it; resolving the pen below removes the consequence if it
	// ever fires again; and `assertDrawable` refuses the font if a glyph collapses anyway.
	const cubic = svgpath(d).unarc().abs().round(4).toString();
	// flipY OFF: its default flips about the PATH's own bounding box, which would re-centre
	// each glyph independently. The flip belongs to the GRID and is applied below.
	source.fromSVG(cubic, { flipY: false });
	const path = new opentype.Path();
	let penX = 0;
	let penY = 0;
	path.commands = source.commands.map(command => {
		const next = { ...command };
		// Resolve an endpoint the parser left unset from the pen, BEFORE transforming: that is
		// what the coordinate means, and it is the one place a null can enter.
		if (next.type !== 'Z') {
			if (typeof next.x !== 'number') { next.x = penX; }
			if (typeof next.y !== 'number') { next.y = penY; }
			penX = next.x;
			penY = next.y;
		}
		for (const [x, y] of [['x', 'y'], ['x1', 'y1'], ['x2', 'y2']]) {
			if (typeof next[x] === 'number') { next[x] = Math.round(next[x] * SCALE); }
			if (typeof next[y] === 'number') { next[y] = Math.round((GRID - next[y]) * SCALE); }
		}
		return next;
	});
	return new opentype.Glyph({ name, unicode, advanceWidth: UNITS_PER_EM, path });
}

/**
 * A GLYPH THAT COLLAPSED IS A BLANK ICON, SILENTLY — the exact failure this unit hit and the
 * reason the generator refuses rather than warns. Every mark must have AREA; that check has no
 * tolerance, because zero area is never a design.
 *
 * The em-box check does have one, and the number is measured rather than chosen. Four of the
 * traced glyphs BLEED past the 16-unit grid a little — `folder-open` reaches 1116 of 1024
 * (9.0%), `file` 1043 and -19, `triangle-exclamation` -35 and 1059 — which is the source's own
 * drawing, not this transform. A transform that were actually wrong misses by multiples, not by
 * a tenth, so the gate is 0.15 em: it passes every real glyph today and still catches a flip,
 * a scale or a sign that went the wrong way.
 */
const EM_TOLERANCE = Math.round(UNITS_PER_EM * 0.15);
function assertDrawable(glyphs) {
	const broken = [];
	for (const glyph of glyphs) {
		if (glyph.name === '.notdef') { continue; }
		const box = glyph.getBoundingBox();
		const width = box.x2 - box.x1;
		const height = box.y2 - box.y1;
		if (!(width > 1) || !(height > 1)) {
			broken.push(`${glyph.name}: collapsed (${box.x1},${box.y1} → ${box.x2},${box.y2})`);
		} else if (box.x1 < -EM_TOLERANCE || box.y1 < -EM_TOLERANCE || box.x2 > UNITS_PER_EM + EM_TOLERANCE || box.y2 > UNITS_PER_EM + EM_TOLERANCE) {
			broken.push(`${glyph.name}: outside the em box (${box.x1},${box.y1} → ${box.x2},${box.y2})`);
		}
	}
	if (broken.length) {
		throw new Error(`${broken.length} glyph(s) did not survive the transform:\n  ${broken.join('\n  ')}`);
	}
}

function main() {
	const args = parseArgs(process.argv);
	const iconsPath = join(REPO_ROOT, ICONS_REL);
	if (!existsSync(iconsPath)) { throw new Error(`the icon set is not at ${iconsPath} — @vgai/blender is what carries it.`); }
	const raw = readFileSync(iconsPath);
	const sha = createHash('sha256').update(raw).digest('hex');
	const set = JSON.parse(raw.toString('utf8'));

	const missing = Object.entries(CODICON_MAP).filter(([, glyph]) => !set.glyphs[glyph]);
	if (missing.length) {
		// A row naming a glyph the set does not have is a stale claim, not a warning: the icon
		// it promised would silently keep its codicon and nobody would look again.
		throw new Error(`the icon map names ${missing.length} glyph(s) the traced set does not have: ${missing.map(([id, glyph]) => `${id} → ${glyph}`).join(', ')}`);
	}

	const glyphs = [new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: UNITS_PER_EM, path: new opentype.Path() })];
	const iconDefinitions = {};
	let code = PUA_START;
	// One glyph per DISTINCT source mark, shared by every codicon id that maps to it.
	const codeFor = new Map();
	for (const [codiconId, glyphName] of Object.entries(CODICON_MAP)) {
		if (!codeFor.has(glyphName)) {
			const unicode = code++;
			codeFor.set(glyphName, unicode);
			glyphs.push(glyphFor(glyphName, set.glyphs[glyphName].path, unicode));
		}
		iconDefinitions[codiconId] = { fontCharacter: `\\${codeFor.get(glyphName).toString(16)}` };
	}

	assertDrawable(glyphs);
	const font = new opentype.Font({
		familyName: 'Blender Icons',
		styleName: 'Regular',
		unitsPerEm: UNITS_PER_EM,
		ascender: UNITS_PER_EM,
		descender: 0,
		glyphs,
	});
	const ttf = Buffer.from(font.toArrayBuffer());

	const theme = {
		_generated: `scripts/workbench/generate-icons.mjs — do not edit. Source: ${ICONS_REL} sha256 ${sha}; ${Object.keys(CODICON_MAP).length} ids over ${codeFor.size} traced glyphs.`,
		// `opentype.js` writes a CFF outline table, so the @font-face format is `opentype` and the
		// file is `.otf`. Declaring `truetype` over CFF bytes is how a font silently fails to load.
		fonts: [{ id: 'blender', src: [{ path: './blender-icons.otf', format: 'opentype' }], weight: 'normal', style: 'normal' }],
		iconDefinitions,
	};

	if (!args.write) {
		if (!existsSync(THEME_PATH)) { throw new Error(`${THEME_PATH} does not exist — run with --write`); }
		const onDisk = JSON.parse(readFileSync(THEME_PATH, 'utf8'));
		if (onDisk._generated !== theme._generated) {
			throw new Error(`the product icon theme is STALE: ${ICONS_REL} has moved since it was generated. Re-run with --write.\n  on disk: ${onDisk._generated}\n  now:     ${theme._generated}`);
		}
		console.log(`product icon theme is current (${Object.keys(CODICON_MAP).length} ids over ${codeFor.size} glyphs).`);
		return;
	}

	mkdirSync(OUT_DIR, { recursive: true });
	writeFileSync(FONT_PATH, ttf);
	writeFileSync(THEME_PATH, `${JSON.stringify(theme, null, '\t')}\n`);
	console.log(`wrote ${FONT_PATH} (${ttf.length} bytes) and ${THEME_PATH}: ${Object.keys(CODICON_MAP).length} ids over ${codeFor.size} glyphs.`);
}

main();
