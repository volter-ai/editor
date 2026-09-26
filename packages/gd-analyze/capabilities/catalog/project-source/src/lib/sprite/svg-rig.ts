/**
 * THE RIG MODEL — an SVG document with named groups, posed by a phase.
 *
 * A rig is a tree of GROUPS (named, pivoted) holding SHAPES (a path `d` plus a
 * fill and/or a stroke), and a `pose(phase)` that returns per-group TRANSFORMS.
 * `poseToSvg(rig, phase)` applies them and hands back a standard SVG document
 * string. Nothing here rasterizes, packs, or writes a file.
 *
 * WHY SVG IS THE SOURCE. One vector document serves all three consumers a 2D
 * game has: headless rasterization into a sprite atlas (`raster.ts` /
 * `atlas.ts` — no GPU, no editor session, no browser), inline into a dom UI
 * root (the icon pipeline and the character pipeline become one pipeline), and
 * Pixi's own `Assets` SVG texture load for live parts. A runtime drawing API
 * (Pixi `Graphics`, canvas2d) is none of those things: it is a set of calls
 * that only exist while a renderer is alive.
 *
 * WHY POSE = TRANSFORMS ONLY, extracted from the donor's rig contract
 * (`examples/top-down-survivor/src/tools/sprite-bake/rigs.ts:11-18`): drawing
 * every part ONCE and animating only position/rotation/scale/skew/alpha is
 * what makes the animation readable AS animation — squash-and-stretch is a
 * scale about a contact point, a walk bob is a translation of the torso, a
 * cloak sway is a skew about the shoulders. A redraw-per-frame rig hides all
 * three inside arithmetic on vertex coordinates.
 *
 * THE TRANSFORM ALGEBRA IS PIXI'S, deliberately. `groupMatrix` below is the
 * same composition Pixi's `Transform` uses (pivot, position, rotation, skew,
 * scale), because the donor's poses were authored and reviewed against exactly
 * those semantics — in particular `skew.x`, which shears x by y so a cape's
 * shoulders stay put while its hem swings
 * (`rigs.ts:170-174`). Emitting `matrix(...)` rather than a
 * `translate/rotate/scale` chain is what keeps skew expressible at all: SVG has
 * no skew-about-a-pivot shorthand.
 *
 * COORDINATES. A rig is authored in BAKED pixels around an origin the rig
 * declares: `'center'` for a character (the cell's middle, ground contact
 * below it) or `'top-left'` for a tile. The atlas places the cell; the rig
 * never knows where it landed (`rigs.ts:30-32`).
 *
 * DETERMINISM. A phase in [0, 1) must be the only input a pose reads — no
 * clock, no RNG — so the same source always bakes the same frames.
 */

/** A fill or stroke colour: 24-bit RGB, plus an optional alpha in [0, 1]. */
export interface Paint {
  readonly color: number;
  readonly alpha?: number;
}

/**
 * A stroke. `join`/`cap` default to ROUND, and that default is load-bearing
 * rather than taste: a miter join projects a spike past a sharp vertex by up to
 * `miterLimit` times the line width, which grew invisible 20px whiskers on the
 * donor's brute spikes and broke them out of their atlas cell
 * (`rigs.ts:80-88`). The cell-overflow guard in `raster.ts` is what caught it;
 * round joins are what fixed it.
 */
export interface StrokeStyle {
  readonly width: number;
  readonly color: number;
  readonly alpha?: number;
  readonly join?: 'round' | 'miter' | 'bevel';
  readonly cap?: 'round' | 'butt' | 'square';
  readonly miterLimit?: number;
}

export interface SvgShapeNode {
  readonly kind: 'shape';
  /** SVG path data. Multiple subpaths in one `d` share one fill, as a Pixi
   *  `Graphics` shares one `fill()` across every shape queued before it. */
  readonly d: string;
  readonly fill?: Paint;
  readonly stroke?: StrokeStyle;
  /** `nonzero` (the default, and Pixi's) or `evenodd`. */
  readonly fillRule?: 'nonzero' | 'evenodd';
}

export interface SvgGroupNode {
  readonly kind: 'group';
  /** The name a pose addresses this group by. Unique within one rig. */
  readonly name: string;
  /**
   * The point this group rotates, scales and skews ABOUT, in the PARENT's
   * coordinates — and, unless `position` says otherwise, the point it sits at.
   * Setting both to the same value is what lets every child shape be written
   * in plain rig-space numbers with no compensating offsets
   * (`rigs.ts:68-77`, `pivotAt`).
   */
  readonly pivot?: readonly [number, number];
  /** Where the pivot lands in the parent. Defaults to `pivot`. */
  readonly position?: readonly [number, number];
  /**
   * The group's REST transform — what it looks like when the pose says nothing
   * about it. A part that is permanently angled (a held weapon) declares its
   * angle here instead of having every frame of every cycle restate it.
   */
  readonly rest?: GroupTransform;
  readonly children: readonly SvgNode[];
  /** A clip applied to this group's subtree, as a path `d` in group space. */
  readonly clip?: string;
}

/**
 * A soft radial light — a real gradient, which is the thing a runtime drawing
 * API cannot give you without a shader.
 *
 * The donor faked every glow as TWO stacked flat-alpha ellipses, a wide "bloom"
 * pass and a tight "heat" pass (`rigs.ts:275-282`, `rigs.ts:595-599`), because
 * `Graphics` has no soft fill. Two flat plates is what it looks like: at 8× the
 * gem's halo is a disc with a visible edge, not a glow. SVG has had radial
 * gradients since 1.0 and resvg renders them, so a glow here is one node.
 */
export interface SvgGlowNode {
  readonly kind: 'glow';
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry?: number;
  readonly color: number;
  /** Opacity at the centre. It falls to zero at the edge. */
  readonly alpha: number;
  /** Fraction of the radius held at full strength before the falloff. */
  readonly core?: number;
}

export type SvgNode = SvgShapeNode | SvgGroupNode | SvgGlowNode;

/** What a pose may change about one group. Everything omitted keeps its rest value. */
export interface GroupTransform {
  readonly x?: number;
  readonly y?: number;
  readonly rotation?: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
  readonly skewX?: number;
  readonly skewY?: number;
  readonly alpha?: number;
}

/** One frame's per-group transforms, keyed by group name. */
export type Pose = Readonly<Record<string, GroupTransform>>;

export interface SvgRig {
  /** Where (0, 0) sits inside the cell. */
  readonly origin: 'center' | 'top-left';
  readonly root: SvgGroupNode;
  /** Cycle position in [0, 1) → the transforms that frame needs. */
  pose(phase: number): Pose;
}

/** Build a rig from its parts. A rig with no motion passes `() => ({})`. */
export function rig(options: {
  origin?: 'center' | 'top-left';
  children: readonly SvgNode[];
  pose?: (phase: number) => Pose;
}): SvgRig {
  return {
    origin: options.origin ?? 'center',
    root: { kind: 'group', name: 'root', children: options.children },
    pose: options.pose ?? (() => ({})),
  };
}

/** A named, pivoted group. */
export function group(
  name: string,
  options: {
    pivot?: readonly [number, number];
    position?: readonly [number, number];
    rest?: GroupTransform;
    clip?: string;
    children: readonly SvgNode[];
  },
): SvgGroupNode {
  const node: {
    kind: 'group';
    name: string;
    children: readonly SvgNode[];
    pivot?: readonly [number, number];
    position?: readonly [number, number];
    rest?: GroupTransform;
    clip?: string;
  } = { kind: 'group', name, children: options.children };
  if (options.pivot) node.pivot = options.pivot;
  if (options.position) node.position = options.position;
  if (options.rest) node.rest = options.rest;
  if (options.clip) node.clip = options.clip;
  return node;
}

/** A soft radial light. See {@link SvgGlowNode}. */
export function glow(options: {
  x: number;
  y: number;
  rx: number;
  ry?: number;
  color: number;
  alpha: number;
  core?: number;
}): SvgGlowNode {
  const node: {
    kind: 'glow';
    x: number;
    y: number;
    rx: number;
    color: number;
    alpha: number;
    ry?: number;
    core?: number;
  } = {
    kind: 'glow',
    x: options.x,
    y: options.y,
    rx: options.rx,
    color: options.color,
    alpha: options.alpha,
  };
  if (options.ry !== undefined) node.ry = options.ry;
  if (options.core !== undefined) node.core = options.core;
  return node;
}

/** A filled and/or stroked path. */
export function shape(
  d: string,
  options: { fill?: Paint; stroke?: StrokeStyle; fillRule?: 'nonzero' | 'evenodd' } = {},
): SvgShapeNode {
  const node: {
    kind: 'shape';
    d: string;
    fill?: Paint;
    stroke?: StrokeStyle;
    fillRule?: 'nonzero' | 'evenodd';
  } = { kind: 'shape', d };
  if (options.fill) node.fill = options.fill;
  if (options.stroke) node.stroke = options.stroke;
  if (options.fillRule) node.fillRule = options.fillRule;
  return node;
}

// ---------------------------------------------------------------------------
// Path construction — the same primitive vocabulary a Pixi `Graphics` offers,
// emitting SVG path data. A port from a `Graphics` rig is then line-for-line.
// ---------------------------------------------------------------------------

const NUM = (value: number): string => {
  // Six decimals: far below a rasterized pixel at any bake scale we ship, and
  // it keeps a re-bake's SVG byte-identical rather than drifting in the 15th
  // digit of a trig result.
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? '0' : String(rounded);
};

export class PathBuilder {
  private parts: string[] = [];

  moveTo(x: number, y: number): this {
    this.parts.push(`M${NUM(x)} ${NUM(y)}`);
    return this;
  }

  lineTo(x: number, y: number): this {
    this.parts.push(`L${NUM(x)} ${NUM(y)}`);
    return this;
  }

  quadraticCurveTo(cx: number, cy: number, x: number, y: number): this {
    this.parts.push(`Q${NUM(cx)} ${NUM(cy)} ${NUM(x)} ${NUM(y)}`);
    return this;
  }

  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): this {
    this.parts.push(`C${NUM(c1x)} ${NUM(c1y)} ${NUM(c2x)} ${NUM(c2y)} ${NUM(x)} ${NUM(y)}`);
    return this;
  }

  closePath(): this {
    this.parts.push('Z');
    return this;
  }

  /** An ellipse as two half arcs — the subpath a `Graphics.ellipse` draws. */
  ellipse(x: number, y: number, rx: number, ry: number): this {
    this.parts.push(
      `M${NUM(x - rx)} ${NUM(y)}` +
        `A${NUM(rx)} ${NUM(ry)} 0 1 0 ${NUM(x + rx)} ${NUM(y)}` +
        `A${NUM(rx)} ${NUM(ry)} 0 1 0 ${NUM(x - rx)} ${NUM(y)}Z`,
    );
    return this;
  }

  circle(x: number, y: number, r: number): this {
    return this.ellipse(x, y, r, r);
  }

  rect(x: number, y: number, width: number, height: number): this {
    return this.moveTo(x, y)
      .lineTo(x + width, y)
      .lineTo(x + width, y + height)
      .lineTo(x, y + height)
      .closePath();
  }

  roundRect(x: number, y: number, width: number, height: number, radius: number): this {
    const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
    if (r === 0) return this.rect(x, y, width, height);
    const arc = (ex: number, ey: number) => `A${NUM(r)} ${NUM(r)} 0 0 1 ${NUM(ex)} ${NUM(ey)}`;
    this.parts.push(
      `M${NUM(x + r)} ${NUM(y)}L${NUM(x + width - r)} ${NUM(y)}` +
        arc(x + width, y + r) +
        `L${NUM(x + width)} ${NUM(y + height - r)}` +
        arc(x + width - r, y + height) +
        `L${NUM(x + r)} ${NUM(y + height)}` +
        arc(x, y + height - r) +
        `L${NUM(x)} ${NUM(y + r)}` +
        arc(x + r, y) +
        'Z',
    );
    return this;
  }

  /** A closed polygon from a flat `[x, y, x, y, …]` list — `Graphics.poly`. */
  poly(points: readonly number[]): this {
    if (points.length < 4) return this;
    const x0 = points[0] ?? 0;
    const y0 = points[1] ?? 0;
    this.moveTo(x0, y0);
    for (let i = 2; i + 1 < points.length; i += 2) {
      this.lineTo(points[i] ?? 0, points[i + 1] ?? 0);
    }
    return this.closePath();
  }

  /** An open polyline — `Graphics`' moveTo/lineTo chain, for stroked glyphs. */
  polyline(points: readonly number[]): this {
    if (points.length < 4) return this;
    this.moveTo(points[0] ?? 0, points[1] ?? 0);
    for (let i = 2; i + 1 < points.length; i += 2) {
      this.lineTo(points[i] ?? 0, points[i + 1] ?? 0);
    }
    return this;
  }

  /** Append already-built path data (a verb's output, a mirrored copy). */
  append(d: string): this {
    if (d) this.parts.push(d);
    return this;
  }

  d(): string {
    return this.parts.join('');
  }
}

export function path(): PathBuilder {
  return new PathBuilder();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** `#rrggbb` for a 24-bit integer colour — the form SVG attributes take. */
export function cssHex(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}

/**
 * Pixi's local-transform composition, as an SVG `matrix(...)`.
 *
 * Restated here rather than approximated with translate/rotate/scale because
 * SKEW has no SVG shorthand and the donor's cloth motion is skew
 * (`rigs.ts:403`, `rigs.ts:406`).
 */
function groupMatrix(node: SvgGroupNode, transform: GroupTransform | undefined): string | null {
  const [pivotX, pivotY] = node.pivot ?? [0, 0];
  const [homeX, homeY] = node.position ?? node.pivot ?? [0, 0];
  const rest = node.rest;
  const x = transform?.x ?? rest?.x ?? homeX;
  const y = transform?.y ?? rest?.y ?? homeY;
  const rotation = transform?.rotation ?? rest?.rotation ?? 0;
  const scaleX = transform?.scaleX ?? rest?.scaleX ?? 1;
  const scaleY = transform?.scaleY ?? rest?.scaleY ?? 1;
  const skewX = transform?.skewX ?? rest?.skewX ?? 0;
  const skewY = transform?.skewY ?? rest?.skewY ?? 0;

  const a = Math.cos(rotation + skewY) * scaleX;
  const b = Math.sin(rotation + skewY) * scaleX;
  const c = -Math.sin(rotation - skewX) * scaleY;
  const d = Math.cos(rotation - skewX) * scaleY;
  const tx = x - (pivotX * a + pivotY * c);
  const ty = y - (pivotX * b + pivotY * d);

  if (a === 1 && b === 0 && c === 0 && d === 1 && tx === 0 && ty === 0) return null;
  return `matrix(${NUM(a)} ${NUM(b)} ${NUM(c)} ${NUM(d)} ${NUM(tx)} ${NUM(ty)})`;
}

function paintAttributes(node: SvgShapeNode): string {
  const attributes: string[] = [];
  if (node.fill) {
    attributes.push(`fill="${cssHex(node.fill.color)}"`);
    if (node.fill.alpha !== undefined && node.fill.alpha < 1) {
      attributes.push(`fill-opacity="${NUM(node.fill.alpha)}"`);
    }
  } else {
    attributes.push('fill="none"');
  }
  if (node.fillRule === 'evenodd') attributes.push('fill-rule="evenodd"');
  const stroke = node.stroke;
  if (stroke) {
    attributes.push(`stroke="${cssHex(stroke.color)}"`, `stroke-width="${NUM(stroke.width)}"`);
    attributes.push(`stroke-linejoin="${stroke.join ?? 'round'}"`);
    attributes.push(`stroke-linecap="${stroke.cap ?? 'round'}"`);
    if (stroke.join === 'miter' && stroke.miterLimit !== undefined) {
      attributes.push(`stroke-miterlimit="${NUM(stroke.miterLimit)}"`);
    }
    if (stroke.alpha !== undefined && stroke.alpha < 1) {
      attributes.push(`stroke-opacity="${NUM(stroke.alpha)}"`);
    }
  }
  return attributes.join(' ');
}

interface RenderState {
  readonly pose: Pose;
  /** Clip paths and gradients this fragment needs, in emission order. */
  readonly defs: string[];
  readonly idPrefix: string;
}

function renderNode(node: SvgNode, state: RenderState): string {
  if (node.kind === 'shape') return `<path d="${node.d}" ${paintAttributes(node)}/>`;

  if (node.kind === 'glow') {
    const id = `${state.idPrefix}def${state.defs.length}`;
    const core = Math.min(0.95, Math.max(0, node.core ?? 0));
    state.defs.push(
      `<radialGradient id="${id}">` +
        `<stop offset="${NUM(core)}" stop-color="${cssHex(node.color)}" stop-opacity="${NUM(node.alpha)}"/>` +
        `<stop offset="1" stop-color="${cssHex(node.color)}" stop-opacity="0"/>` +
        '</radialGradient>',
    );
    return (
      `<ellipse cx="${NUM(node.x)}" cy="${NUM(node.y)}" rx="${NUM(node.rx)}" ` +
      `ry="${NUM(node.ry ?? node.rx)}" fill="url(#${id})"/>`
    );
  }

  const transform = state.pose[node.name];
  const attributes: string[] = [];
  const matrix = groupMatrix(node, transform);
  if (matrix) attributes.push(`transform="${matrix}"`);
  const alpha = transform?.alpha ?? node.rest?.alpha;
  if (alpha !== undefined && alpha < 1) attributes.push(`opacity="${NUM(alpha)}"`);
  if (node.clip) {
    const id = `${state.idPrefix}def${state.defs.length}`;
    state.defs.push(`<clipPath id="${id}"><path d="${node.clip}"/></clipPath>`);
    attributes.push(`clip-path="url(#${id})"`);
  }
  const open = attributes.length > 0 ? `<g ${attributes.join(' ')}>` : '<g>';
  return `${open}${node.children.map((child) => renderNode(child, state)).join('')}</g>`;
}

/**
 * One posed frame as an SVG FRAGMENT, in the rig's own coordinates.
 *
 * This is what the atlas composer embeds (translated to the frame's cell) and
 * what `poseToSvg` wraps in a document. `idPrefix` namespaces any clip ids so
 * many fragments can share one document without colliding.
 */
export function poseToSvgFragment(svgRig: SvgRig, phase: number, idPrefix = ''): string {
  const state: RenderState = { pose: svgRig.pose(phase), defs: [], idPrefix };
  const body = renderNode(svgRig.root, state);
  return state.defs.length > 0 ? `<defs>${state.defs.join('')}</defs>${body}` : body;
}

/**
 * One posed frame as a standalone SVG DOCUMENT sized to `cell`.
 *
 * The rig's origin decides where its (0, 0) lands: a character rig is authored
 * around the cell's centre, a tile around its top-left.
 */
export function poseToSvg(
  svgRig: SvgRig,
  phase: number,
  options: { cell: number; scale?: number; background?: string },
): string {
  const scale = options.scale ?? 1;
  const size = options.cell * scale;
  const offset = svgRig.origin === 'center' ? options.cell / 2 : 0;
  const background = options.background
    ? `<rect x="0" y="0" width="${NUM(options.cell)}" height="${NUM(options.cell)}" fill="${options.background}"/>`
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${NUM(size)}" height="${NUM(size)}" ` +
    `viewBox="0 0 ${NUM(options.cell)} ${NUM(options.cell)}">` +
    background +
    `<g transform="translate(${NUM(offset)} ${NUM(offset)})">` +
    poseToSvgFragment(svgRig, phase) +
    '</g></svg>'
  );
}

// ---------------------------------------------------------------------------
// The bake SPEC — what a project's rig module hands the bake tool.
// ---------------------------------------------------------------------------

export interface SpriteAnimationPlan {
  /** Animation name, as it appears in the spritesheet's `animations` map. */
  readonly name: string;
  /** How many frames the cycle has. Frame `i` is posed at `i / frames`. */
  readonly frames: number;
  /** Square cell edge in BAKED pixels. */
  readonly cell: number;
  readonly rig: SvgRig;
  /**
   * This animation TILES: it must cover its cell edge to edge, is exempt from
   * the cell-border guard, is clipped to its cell when composed, and its
   * wrap-around join is MEASURED (`atlas.ts`, `measureSeam`).
   */
  readonly tiles?: boolean;
}

/**
 * A project's whole bake, as data.
 *
 * `src/tools/sprite-bake.tool.ts` imports this from the project's own
 * `src/tools/sprite-bake/rigs.ts` by convention — the capability owns the
 * machinery, the project owns the art.
 */
export interface SpriteBakeSpec {
  /** Project-relative destination of the atlas PNG. */
  readonly image: string;
  /** Project-relative destination of the spritesheet JSON. */
  readonly sheet: string;
  readonly animations: readonly SpriteAnimationPlan[];
  /**
   * THE PROJECT'S OWN SIGHT LOOP, if it has one.
   *
   * `project.sprites.bake --preview` writes a contact sheet per animation by
   * default, which is the right picture for a posed vector rig. It is the wrong
   * one for other crafts: a pixel cycle wants 8× nearest-neighbour, an onion
   * skin and a frame diff (`pixel-preview.ts`), and a tile wants its 2×2
   * self-tiling. A project that declares this hands back exactly the images its
   * art pass needs to LOOK at, and the tool writes them through the same
   * generated-output door.
   */
  previews?(): readonly SpritePreviewImage[];
}

/** One sight-loop image, written to `<atlas dir>/preview/<name>.png`. */
export interface SpritePreviewImage {
  readonly name: string;
  readonly png: Uint8Array;
}

/** The shape of the project rig module the bake tool loads. */
export interface SpriteRigModule {
  spriteBakeSpec(): SpriteBakeSpec;
}
