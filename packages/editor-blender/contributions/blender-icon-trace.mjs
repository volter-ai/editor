/**
 * TRACING BLENDER'S OWN ICON SOURCES — the half of `blender-icons.source.mjs`
 * that turns one of Blender's per-icon SVGs into a path on this set's 16-unit
 * grid (WORK.md §Blender in the tab is Blender, "Inspection parity", I2
 * decision 2).
 *
 * ## Why a trace and not a drawing
 *
 * The Properties rail's sixteen tabs used to be OUR marks in Blender's idiom,
 * and I1 measured what that cost: thirteen of the sixteen were a distinct NAME
 * over a neighbouring silhouette this set already drew (a globe for World, a
 * magnet for Constraints, a palette for Material), not a measurement of
 * Blender's mark. The north star is "the reference is Blender's SOURCE as well
 * as its frames" (ARCHITECTURE-CORE §Blender north star), and for an icon the
 * source is literally a vector file: `release/datafiles/icons_svg/<name>.svg`
 * in the Blender checkout at the engine's pin. Tracing it is a MEASUREMENT;
 * drawing a lookalike is a guess with a citation stapled to it.
 *
 * ## Licence
 *
 * Blender's icon sources are GPL-2.0-or-later, like the rest of the Blender
 * tree, and a trace of one is a derivative of it. `@vgai/blender` therefore
 * carries BOTH licences — its SPDX expression is
 * `AGPL-3.0-only AND GPL-3.0-or-later` (`packages/blender/LICENSE`): our code
 * AGPL-3.0-only, Blender's traced artwork conveyed under GPL-3.0-or-later on
 * Blender's own "or later", and AGPL §13 / GPL §13 permitting the
 * combination. So a GPL icon PATH may live inside this package, and that is
 * deliberate, stated in the package's LICENSE and recorded per glyph in
 * `blender.icons.traced.json` (source file + sha256). Nothing traced here may
 * be copied into an Apache-2.0 or MIT part of this repo — `packages/editor`'s
 * own icon set included.
 *
 * ## The geometry
 *
 * Blender authors each icon on a 16-unit grid and Inkscape writes it out
 * inside a 1600x1600 viewBox with a `matrix(100 0 0 100 tx ty)` on the path —
 * so the trace is: compose the element's transforms, scale by
 * `16 / viewBox width`, and the result is already this set's coordinate
 * system. Nothing is re-proportioned, re-stroked or re-centred; a traced
 * glyph is Blender's own outline.
 *
 * Not every icon is that simple, which is why this is a general affine
 * transform rather than a scale-and-offset: `material.svg` carries a
 * REFLECTION (`matrix(-99.99 0 0 99.99 …)`), `particles.svg` a quarter
 * ROTATION (`matrix(0 100 -100 0 …)`) with a second matrix on the path inside
 * it, and `pointcloud_data.svg` a NON-UNIFORM scale. Under any of those an
 * elliptical arc's radii and x-axis rotation change, and a reflection flips
 * its sweep — {@link transformArc} does that properly instead of assuming the
 * matrix is a scale.
 */

// ------------------------------------------------------------------ matrices

/** An SVG affine, `[a, b, c, d, e, f]` — x' = a·x + c·y + e, y' = b·x + d·y + f. */
const IDENTITY = [1, 0, 0, 1, 0, 0];

function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** A POINT moves by the whole matrix. There is deliberately no delta helper:
 *  every relative command is absolutized before it is transformed, which is
 *  the only way `S`/`T`'s reflected control points survive an affine. */
const applyPoint = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** `transform="matrix(…) translate(…) scale(…) rotate(…)"`, left to right. */
function parseTransform(text) {
  if (!text) return IDENTITY;
  let matrix = IDENTITY;
  const each = /(matrix|translate|scale|rotate)\s*\(([^)]*)\)/g;
  for (let hit = each.exec(text); hit !== null; hit = each.exec(text)) {
    const n = hit[2]
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (hit[1] === 'matrix') matrix = multiply(matrix, [n[0], n[1], n[2], n[3], n[4], n[5]]);
    else if (hit[1] === 'translate') matrix = multiply(matrix, [1, 0, 0, 1, n[0], n[1] ?? 0]);
    else if (hit[1] === 'scale') matrix = multiply(matrix, [n[0], 0, 0, n[1] ?? n[0], 0, 0]);
    else {
      const t = (n[0] * Math.PI) / 180;
      const rotate = [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0];
      const [cx, cy] = [n[1] ?? 0, n[2] ?? 0];
      matrix = multiply(multiply(multiply(matrix, [1, 0, 0, 1, cx, cy]), rotate), [
        1,
        0,
        0,
        1,
        -cx,
        -cy,
      ]);
    }
  }
  return matrix;
}

/**
 * AN ARC UNDER AN AFFINE. The ellipse an arc segment lies on is
 * `R(φ)·diag(rx, ry)` applied to the unit circle; pushing it through `m`
 * gives `m₂·R(φ)·diag(rx, ry)`, and the new `(rx', ry', φ')` are that 2x2
 * matrix's singular-value decomposition. The sweep flag flips when the
 * determinant is negative (a reflection reverses which way is "clockwise");
 * the large-arc flag is invariant.
 */
function transformArc(m, rx, ry, rotation, largeArc, sweep) {
  const t = (rotation * Math.PI) / 180;
  const e = [Math.cos(t) * rx, Math.sin(t) * rx, -Math.sin(t) * ry, Math.cos(t) * ry];
  // m₂ · E, both column-major 2x2.
  const a = m[0] * e[0] + m[2] * e[1];
  const b = m[1] * e[0] + m[3] * e[1];
  const c = m[0] * e[2] + m[2] * e[3];
  const d = m[1] * e[2] + m[3] * e[3];
  // Singular values of [[a, c], [b, d]], closed form.
  const e1 = (a * a + b * b + c * c + d * d) / 2;
  const e2 = Math.hypot(a * a + b * b - c * c - d * d, 2 * (a * c + b * d)) / 2;
  const nextRx = Math.sqrt(Math.max(0, e1 + e2));
  const nextRy = Math.sqrt(Math.max(0, e1 - e2));
  // The major axis' direction is the first left-singular vector.
  const phi =
    Math.abs(a * c + b * d) < 1e-12 && Math.abs(a * a + b * b - (c * c + d * d)) < 1e-12
      ? 0
      : (Math.atan2(2 * (a * c + b * d), a * a + b * b - c * c - d * d) / 2) * (180 / Math.PI);
  const determinant = m[0] * m[3] - m[1] * m[2];
  return [nextRx, nextRy, phi, largeArc, determinant < 0 ? 1 - sweep : sweep];
}

// --------------------------------------------------------------- path tokens

const NUMBER = /[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g;
const ARGUMENTS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** `d` as a list of `{ command, values }`, every implicit repeat expanded. */
function tokenize(d) {
  const out = [];
  const each = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
  for (let hit = each.exec(d); hit !== null; hit = each.exec(d)) {
    const command = hit[1];
    const arity = ARGUMENTS[command.toUpperCase()];
    const numbers = (hit[2].match(NUMBER) ?? []).map(Number);
    if (arity === 0) {
      out.push({ command, values: [] });
      continue;
    }
    for (let i = 0; i < numbers.length; i += arity) {
      // An implicit repeat of `M` is `L` (and of `m` is `l`) — the spec's one
      // command whose repeat is a different command.
      const repeated = i > 0 && command === 'M' ? 'L' : i > 0 && command === 'm' ? 'l' : command;
      out.push({ command: repeated, values: numbers.slice(i, i + arity) });
    }
  }
  return out;
}

/**
 * Absolutize, then transform. Smooth curves (`S`/`T`) are expanded into their
 * explicit forms first: the reflected control point is defined against the
 * PREVIOUS segment, and carrying that relation through an affine is only
 * correct if it is written out.
 */
function transformPath(d, m) {
  const out = [];
  let [x, y] = [0, 0];
  let [startX, startY] = [0, 0];
  // The last cubic's and quadratic's control points, for `S` and `T`.
  let [cubicX, cubicY] = [0, 0];
  let [quadX, quadY] = [0, 0];
  let previous = '';
  const emit = (command, ...values) => out.push({ command, values });
  const point = (px, py) => applyPoint(m, px, py);

  for (const { command, values } of tokenize(d)) {
    const relative = command === command.toLowerCase() && command !== 'Z';
    const upper = command.toUpperCase();
    const ax = (i) => (relative ? x + values[i] : values[i]);
    const ay = (i) => (relative ? y + values[i] : values[i]);
    if (upper === 'Z') {
      emit('Z');
      [x, y] = [startX, startY];
      previous = 'Z';
      continue;
    }
    if (upper === 'M' || upper === 'L' || upper === 'H' || upper === 'V' || upper === 'T') {
      const [nx, ny] =
        upper === 'H'
          ? [relative ? x + values[0] : values[0], y]
          : upper === 'V'
            ? [x, relative ? y + values[0] : values[0]]
            : [ax(0), ay(1)];
      if (upper === 'T') {
        // A smooth quadratic: the control point is the previous one mirrored
        // about the current point (or the current point, after anything else).
        const [qx, qy] = 'QT'.includes(previous) ? [2 * x - quadX, 2 * y - quadY] : [x, y];
        emit('Q', ...point(qx, qy), ...point(nx, ny));
        [quadX, quadY] = [qx, qy];
      } else {
        emit(upper === 'M' ? 'M' : 'L', ...point(nx, ny));
      }
      if (upper === 'M') [startX, startY] = [nx, ny];
      [x, y] = [nx, ny];
      previous = upper;
      continue;
    }
    if (upper === 'C' || upper === 'S') {
      const [c1x, c1y] =
        upper === 'S'
          ? 'CS'.includes(previous)
            ? [2 * x - cubicX, 2 * y - cubicY]
            : [x, y]
          : [ax(0), ay(1)];
      const [c2x, c2y] = upper === 'S' ? [ax(0), ay(1)] : [ax(2), ay(3)];
      const [nx, ny] = upper === 'S' ? [ax(2), ay(3)] : [ax(4), ay(5)];
      emit('C', ...point(c1x, c1y), ...point(c2x, c2y), ...point(nx, ny));
      [cubicX, cubicY] = [c2x, c2y];
      [x, y] = [nx, ny];
      previous = 'C';
      continue;
    }
    if (upper === 'Q') {
      const [qx, qy] = [ax(0), ay(1)];
      const [nx, ny] = [ax(2), ay(3)];
      emit('Q', ...point(qx, qy), ...point(nx, ny));
      [quadX, quadY] = [qx, qy];
      [x, y] = [nx, ny];
      previous = 'Q';
      continue;
    }
    // A.
    const [nx, ny] = [relative ? x + values[5] : values[5], relative ? y + values[6] : values[6]];
    const [rx, ry, phi, large, sweep] = transformArc(
      m,
      values[0],
      values[1],
      values[2],
      values[3],
      values[4],
    );
    emit('A', rx, ry, phi, large, sweep, ...point(nx, ny));
    [x, y] = [nx, ny];
    previous = 'A';
  }
  return out;
}

// ------------------------------------------------------------------- the door

const round = (n) => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};

function serialize(segments) {
  return segments
    .map(({ command, values }) =>
      values.length === 0 ? command : `${command}${values.map(round).join(' ')}`,
    )
    .join('');
}

/** The ink's bounding box, from the ON-CURVE points and control points. A
 *  control point can lie outside the curve, so this is an upper bound — which
 *  is exactly what a "does this fill its 16 box" check wants to be. */
function boundsOf(segments) {
  let box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { command, values } of segments) {
    const points = command === 'A' ? [values.slice(5)] : chunk(values, 2);
    for (const [px, py] of points) {
      box = [
        Math.min(box[0], px),
        Math.min(box[1], py),
        Math.max(box[2], px),
        Math.max(box[3], py),
      ];
    }
  }
  return box.map(round);
}

function chunk(values, size) {
  const out = [];
  for (let i = 0; i + size <= values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/**
 * THE AUTHORED UNIT, WHICH IS NOT THE ARTBOARD. Blender's icons are drawn on
 * an Inkscape canvas whose grid the file itself declares —
 * `<inkscape:grid spacingx="100" spacingy="100">` — and one square of that
 * grid is one unit of the 16-unit icon grid. So the scale from a file's user
 * units to this set's is `1 / spacing`, and the viewBox does not enter it.
 *
 * MEASURED at the engine's pin (v5.2.0, 790 files in
 * `release/datafiles/icons_svg/`): 755 declare `spacingx="100"`, two
 * (`key_shift*.svg`) declare 50, and 33 declare no grid at all — those 33 are
 * machine-written with a `matrix(100 …)` on the group and take the default
 * below. The viewBox is NOT square with the grid: only **536 of the 790 are
 * 1600 wide**, and the rest run from 48 to 5236. A mark authored on a
 * 14-unit-wide canvas is fourteen units wide, not sixteen, so scaling it by
 * `16 / 1400` inflated it by a seventh and pushed its ink off the bottom of
 * the cell — `light_data.svg` traced to a box 18.29 tall. That was the defect
 * this constant replaces (WORK.md §Blender in the tab is Blender, I5,
 * orchestrator ruling 2 of 2026-09-19: "the icon trace scales by the authored
 * unit, not the artboard").
 */
const DEFAULT_GRID_SPACING = 100;

/**
 * AND THE ARTBOARD IS A CROP, so the mark is CENTRED in the cell rather than
 * pinned to the artboard's corner.
 *
 * This is the other half of the same measurement, and the data states it
 * plainly: rescaled by the authored unit, **every one of the 197 traced marks
 * has its ink box starting at exactly (1, 1)** and ending exactly one unit
 * short of the artboard — `mod_particle_instance.svg` 1600×1600 → [1, 1, 15,
 * 15], `light_data.svg` 1400×1700 → [1, 1, 13, 16], `dot.svg` 600×600 →
 * [1, 1, 5, 5]. That is Inkscape's "resize page to drawing" with a one-grid
 * margin, run per file. So the page carries the mark's SIZE and nothing about
 * where it sits in a 16-unit cell, and reading its top-left corner as the
 * cell's corner is what put the 4-unit dot and the 10-unit checkbox in the
 * top-left eighth of their cells.
 *
 * Centring the PAGE (not the ink) keeps the authored margins symmetric, and
 * it is exactly zero for a 1600×1600 artboard — which is why this leaves the
 * 158 glyphs authored on that page byte-identical and moves only the 39 that
 * are not.
 */
const centreOffset = (extent, spacing) => (16 - extent / spacing) / 2;

/** Compose one element's own `transform` onto the matrix in force. */
const withOwn = (matrix, tag) =>
  multiply(matrix, parseTransform(/\btransform="([^"]+)"/.exec(tag)?.[1] ?? ''));

/**
 * ONE OF BLENDER'S ICON SVGs, as a path on this set's 16-unit grid.
 *
 * Returns `{ path, box }` — the concatenated `d` of every `<path>` in the
 * file (Blender's icons are one `<g fill="#fff">` of one to three subpaths,
 * nonzero winding, which is how a knockout reads) and the ink's bounding box,
 * so the caller can state how much of the box the mark fills rather than
 * assume it.
 *
 * THE GROUPS ARE WALKED AS A TREE, not sampled. This trace used to take the
 * FIRST `<g>` carrying a transform and apply it to every path in the file, on
 * the stated belief that "nesting never goes deeper than that in this data
 * set". Measured at the pin: **21 of the 790 files nest two or more
 * transformed groups**, and `mod_particle_instance.svg` — a `matrix(0 -1 -1 0
 * 558.008 761.005)` quarter turn INSIDE a `matrix(100 0 0 -100 …)` flip —
 * traced to a box at [273, −60], seventeen grid units clear of the canvas. A
 * single-sample read cannot see an inner transform at all, so this keeps a
 * STACK: a `<g>` pushes the matrix in force times its own, `</g>` pops, and a
 * `<path>` draws under whatever is on top.
 */
export function traceBlenderIcon(svg) {
  const viewBox = /viewBox="([^"]+)"/.exec(svg);
  if (viewBox === null) throw new Error('Blender icon SVG has no viewBox');
  const [, , width, height] = viewBox[1]
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const spacing = Number(/\bspacingx="([0-9.]+)"/.exec(svg)?.[1] ?? DEFAULT_GRID_SPACING);
  if (!Number.isFinite(spacing) || spacing <= 0)
    throw new Error(`Blender icon SVG declares an unusable grid spacing: ${spacing}`);
  const toGrid = [
    1 / spacing,
    0,
    0,
    1 / spacing,
    centreOffset(width, spacing),
    centreOffset(height, spacing),
  ];
  const segments = [];
  const stack = [toGrid];
  // The document, tag by tag. Blender's icon SVGs are machine-written and
  // well-formed, so a scanner over `<g>` / `</g>` / `<path>` is the whole
  // parser this needs; every other element it meets (`<svg>`,
  // `<sodipodi:namedview>`, `<inkscape:grid/>`) carries no geometry.
  const each = /<(\/?)(g|path)\b([^>]*)>/g;
  for (let hit = each.exec(svg); hit !== null; hit = each.exec(svg)) {
    const [, closing, tag, attributes] = hit;
    if (tag === 'g') {
      if (closing) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      // A self-closing `<g/>` opens and closes in one tag, so it never enters
      // the stack; every other `<g>` does.
      if (!attributes.trimEnd().endsWith('/'))
        stack.push(withOwn(stack[stack.length - 1], attributes));
      continue;
    }
    if (closing) continue;
    const d = /\bd="([^"]+)"/.exec(attributes)?.[1];
    if (d === undefined) continue;
    segments.push(...transformPath(d, withOwn(stack[stack.length - 1], attributes)));
  }
  if (segments.length === 0) throw new Error('Blender icon SVG has no path data');
  return { path: serialize(segments), box: boundsOf(segments) };
}
