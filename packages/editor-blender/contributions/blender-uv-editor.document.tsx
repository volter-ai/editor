/**
 * THE UV EDITOR — Blender's UV editor over the engine's own mesh data, in a UV
 * Editing workspace (WORK.md §Blender in the tab is Blender, "Inspection
 * parity", I5; ARCHITECTURE-CORE §Blender north star).
 *
 * Every constant and colour it draws with is `./blender-uv-geometry.ts`, read
 * from Blender's source at the engine's pin and cited there; every number it
 * draws comes from `session.py`'s `rna_uv_layout` door. Blender's UI layer is
 * never run, ported or recorded: this is OUR panel over RNA.
 *
 * ## SVG, not canvas 2D
 *
 * The same reason the node view gives, measured for this data: a UV layout is
 * one `<path>` per island wash, one per island outline and one `<circle>` per
 * drawn corner, and the browser's own renderer does the transform, the
 * antialiasing and the hit testing. MEASURED on
 * `examples/first-person/src/models/arena-weapons.blend`'s largest UV mesh
 * (`LauncherMuzzleCollar`, 1,120 corners / 280 faces): 280 face paths, 280
 * outline paths and 1,120 dots. The DOT CAP below is what keeps that honest on
 * a mesh an order of magnitude larger, and the geometry lives in its own
 * module precisely so a canvas can take over behind it when a measurement says
 * so.
 *
 * ## It never edits, and every gesture that would is refused BY NAME
 *
 * Pinning, unwrapping, selecting and moving a UV all write the mesh, and
 * editing parity is not the program. The refusals are the view's own, reached
 * from the verb table and from the pointer handlers through one function
 * (`refuseUvViewGesture`), so the two cannot drift into two vocabularies.
 */

import type { BlenderUvLayout } from '@volter/blender-engine/browser/rna';
import { registerViewVerbs } from '@volter/editor-sdk/views';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  blenderRnaVersion,
  blenderUvLayout,
  subscribeBlenderRna,
} from '../host/blender-runtime-host';
import {
  refuseUvViewGesture,
  requestUvViewAll,
  setUvViewState,
  subscribeUvView,
  uvViewAllRequest,
  uvViewState,
  uvViewVersion,
} from '../src/uv-view-state';
import {
  UV_CHROME,
  UV_EDGE_DRAWN_WIDTH,
  UV_FACEDOT_SIZE,
  UV_GRID_OPEN,
  UV_GRID_SUBDIV,
  UV_LINE_STYLES,
  UV_OPACITY,
  UV_PIN_COLOR,
  UV_THEME,
  UV_TILE_GRID,
  UV_VERT_DOT_SIZE,
  UV_VERT_OUTLINE_WIDTH,
  uvBytes,
  uvFloat32,
  uvRgba,
  uvUint32,
} from './blender-uv-geometry';

export const point = 'workspace.document';
/** Blender's own name for this editor — `rna_space.cc`'s `SPACE_IMAGE` item
 *  reads "UV Editor" when `SpaceImage.mode` is `UV`, which is the mode
 *  Blender's UV Editing workspace opens it in (measured on the engine: that
 *  workspace's `IMAGE_EDITOR` area answers `mode: 'UV'`). */
export const title = 'UV Editor';

/** How many corner dots the view will draw before it stands them down and
 *  says so. A dot is an element; 20,000 of them is a DOM the browser spends
 *  more time laying out than the read took, and a silent thinning is exactly
 *  the "named grade of acceptable partiality" the anti-shim rule forbids — so
 *  the cap is a WARNING with a number in it, never a quiet decimation. */
const DOT_CAP = 8000;

const ZOOM_MIN = 16;
const ZOOM_MAX = 8192;

const REFUSALS = {
  move: (name: string) =>
    `Dragging a UV in "${name}" writes the mesh's UV attribute, which the document would save. This is Blender's UV editor as an INSPECTION surface: editing parity is not the program.`,
  select:
    "Selecting a UV writes the mesh's selection state. This view draws what the DATA carries — and at this pin a mesh outside edit mode carries no UV selection at all (MeshUVLoopLayer declares uv, pin, name, active, active_render, active_clone and nothing else), so everything draws unselected. Editing parity is not the program.",
  pin: "Pinning a UV writes `MeshUVLoopLayer.pin`, which the document would save. Existing pins ARE drawn, in Blender's own hard red. Editing parity is not the program.",
  unwrap:
    'Unwrapping runs `bpy.ops.uv.unwrap`, which rewrites every UV on the mesh. Editing parity is not the program.',
} as const;

/** THE VIEW'S VERBS, published once, here — U8's ruling 1 (2026-09-19). Under
 *  the Code-OSS frame each becomes a `vgai.blender-uv-view.<verb>` command the
 *  bridge dispatches into the view, and standalone `vgai edit` reaches the
 *  SAME table through the session. **This view adds no `blender-*` session
 *  verb at all**, which is exactly what the ruling asked the remaining I5
 *  views to stop paying for. */
registerViewVerbs({
  view: 'blender-uv-view',
  title,
  verbs: [
    { id: 'state', run: () => uvViewState() },
    {
      id: 'view-all',
      title: 'UV Editor: View All',
      run: () => {
        requestUvViewAll();
        return uvViewState();
      },
    },
    {
      id: 'zoom',
      title: 'UV Editor: Zoom',
      run: (args) => {
        const to = Number(args?.['to'] ?? args?.['zoom']);
        if (!Number.isFinite(to))
          throw new Error('zoom needs a numeric `to` — CSS pixels per UV unit, 16 … 8192.');
        const { transform } = uvViewState();
        setUvViewState({
          transform: { ...transform, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, to)) },
        });
        return uvViewState();
      },
    },
    {
      id: 'pan',
      title: 'UV Editor: Pan',
      run: (args) => {
        const du = Number(args?.['u'] ?? 0);
        const dv = Number(args?.['v'] ?? 0);
        if (!Number.isFinite(du) || !Number.isFinite(dv))
          throw new Error('pan needs numeric `u` and `v`, in UV units.');
        const { transform } = uvViewState();
        setUvViewState({
          transform: { ...transform, cx: transform.cx + du, cy: transform.cy + dv },
        });
        return uvViewState();
      },
    },
    { id: 'move-uv', run: () => refuse(REFUSALS.move('the active UV map')) },
    { id: 'select', run: () => refuse(REFUSALS.select) },
    { id: 'pin', run: () => refuse(REFUSALS.pin) },
    { id: 'unwrap', run: () => refuse(REFUSALS.unwrap) },
  ],
});

function refuse(text: string): unknown {
  refuseUvViewGesture(text);
  return uvViewState();
}

interface Prepared {
  readonly uv: Float32Array;
  readonly tris: Uint32Array;
  readonly starts: Uint32Array;
  readonly totals: Uint32Array;
  readonly pins: Uint8Array | null;
}

function prepare(layout: BlenderUvLayout | null): Prepared | null {
  if (!layout?.uvBase64 || !layout.triangleBase64) return null;
  return {
    uv: uvFloat32(layout.uvBase64),
    tris: uvUint32(layout.triangleBase64),
    starts: uvUint32(layout.loopStartBase64 ?? ''),
    totals: uvUint32(layout.loopTotalBase64 ?? ''),
    // A PIN IS ONE BYTE, not a float: the door ships `array("b")` bytes
    // straight off `MeshUVLoopLayer.pin` and answers null when nothing is
    // pinned, so an absent payload is "no pins" rather than "unknown".
    pins: layout.pinBase64 ? uvBytes(layout.pinBase64) : null,
  };
}

export default function BlenderUvEditor() {
  // THE TREE'S FRESHNESS IS THE TREE'S (ruling 3, 2026-09-19): the RNA door's
  // own version, bumped by every write and by a presented frame, rather than
  // the properties model's — which moves only when a frame ships.
  const version = useSyncExternalStore(subscribeBlenderRna, blenderRnaVersion, blenderRnaVersion);
  useSyncExternalStore(subscribeUvView, uvViewVersion, uvViewVersion);
  const framed = useRef(0);
  const canvas = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef<BlenderUvLayout | null>(null);
  const errorRef = useRef<string | null>(null);
  const { transform, refusal, size } = uvViewState();
  const [, force] = [0, useCallback(() => setUvViewState({}), [])];

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const answer = await blenderUvLayout();
        if (!live) return;
        layoutRef.current = answer;
        errorRef.current = null;
      } catch (thrown) {
        if (!live) return;
        errorRef.current = thrown instanceof Error ? thrown.message : String(thrown);
      }
      force();
    })();
    return () => {
      live = false;
    };
  }, [version, force]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const next = { w: element.clientWidth, h: element.clientHeight };
      const current = uvViewState().size;
      if (current.w !== next.w || current.h !== next.h) setUvViewState({ size: next });
    });
    observer.observe(element);
    setUvViewState({ size: { w: element.clientWidth, h: element.clientHeight } });
    return () => observer.disconnect();
  }, []);

  const layout = layoutRef.current;
  const prepared = useMemo(() => prepare(layout), [layout]);

  // VIEW ALL — Blender's `image_view_all`: fit the drawn bounds with a margin,
  // never a fixed zoom. The ASK is a counter in the store because framing
  // needs the read layout, which the verb does not have.
  const request = uvViewAllRequest();
  useEffect(() => {
    if (request === framed.current) return;
    framed.current = request;
    const bounds = layout?.bounds ?? [0, 0, 1, 1];
    const { w, h } = uvViewState().size;
    if (w === 0 || h === 0) return;
    const [u0, v0, u1, v1] = bounds;
    const spanU = Math.max(u1 - u0, 1e-3);
    const spanV = Math.max(v1 - v0, 1e-3);
    const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(w / spanU, h / spanV) * 0.9));
    setUvViewState({
      transform: { cx: (u0 + u1) / 2, cy: (v0 + v1) / 2, zoom },
      framedAt: Date.now(),
    });
  }, [request, layout]);

  // UV SPACE IS Y-UP and the screen is Y-DOWN, so the flip happens ONCE, here,
  // in the group transform — nothing downstream carries a sign.
  const toX = (u: number) => (u - transform.cx) * transform.zoom + size.w / 2;
  const toY = (v: number) => size.h / 2 - (v - transform.cy) * transform.zoom;

  const drawing = useMemo(() => {
    if (!layout || !prepared) return null;
    const { uv, tris, starts, totals, pins } = prepared;
    const faces: string[] = [];
    const outlines: string[] = [];
    const dots: { x: number; y: number; pinned: boolean }[] = [];
    const faceDots: { x: number; y: number }[] = [];
    const polygons = starts.length;
    for (let poly = 0; poly < polygons; poly++) {
      const start = starts[poly]!;
      const total = totals[poly]!;
      if (total < 3) continue;
      let d = '';
      let cu = 0;
      let cv = 0;
      for (let i = 0; i < total; i++) {
        const corner = start + i;
        const u = uv[corner * 2]!;
        const v = uv[corner * 2 + 1]!;
        cu += u;
        cv += v;
        d += `${i === 0 ? 'M' : 'L'}${toX(u).toFixed(2)} ${toY(v).toFixed(2)}`;
      }
      d += 'Z';
      faces.push(d);
      outlines.push(d);
      faceDots.push({ x: toX(cu / total), y: toY(cv / total) });
    }
    const corners = uv.length >> 1;
    for (let corner = 0; corner < corners && dots.length < DOT_CAP; corner++) {
      dots.push({
        x: toX(uv[corner * 2]!),
        y: toY(uv[corner * 2 + 1]!),
        pinned: pins ? pins[corner] !== 0 : false,
      });
    }
    return { faces, outlines, dots, faceDots, corners, triangles: tris.length / 3 };
  }, [layout, prepared, transform, size]);

  // WHAT THE VIEW DREW, published so the parity reading is a measurement of the
  // shipped drawing rather than a second run of the same arithmetic.
  useEffect(() => {
    if (!layout) return;
    const warnings: string[] = [];
    if (layout.layers.length === 0 && layout.object)
      warnings.push(`"${layout.object}" has no UV map — Blender's UV editor draws an empty tile.`);
    if (drawing && drawing.corners > DOT_CAP)
      warnings.push(
        `${drawing.corners} UV corners exceed this view's ${DOT_CAP}-dot budget; ${drawing.corners - DOT_CAP} corner marks are not drawn. The islands, their edges and the face dots are all drawn.`,
      );
    if (!layout.image)
      warnings.push(
        "No image behind the tile: the active material's node tree has no image texture with an image, so there is nothing for Blender's backdrop to show.",
      );
    warnings.push(UV_GRID_OPEN);
    warnings.push(
      "The line style is SHADOW (#707070), not Blender's stock OUTLINE: `edit_uv_line_style_from_space_image` returns OUTLINE only when `SpaceImage.mode == SI_MODE_UV`, and there is no SpaceImage here.",
    );
    setUvViewState({
      drawn: {
        object: layout.object,
        mesh: layout.mesh,
        layer: layout.active,
        layers: layout.layers,
        mode: layout.mode,
        loops: layout.loops,
        polygons: layout.polygons,
        triangles: drawing?.triangles ?? 0,
        faces: drawing?.faces.length ?? 0,
        edges: drawing?.outlines.length ?? 0,
        verts: drawing?.dots.length ?? 0,
        faceDots: drawing?.faceDots.length ?? 0,
        pinned: drawing?.dots.filter((dot) => dot.pinned).length ?? 0,
        bounds: layout.bounds ?? null,
        tiles: UV_TILE_GRID,
        subdiv: UV_GRID_SUBDIV,
        image: layout.image?.name ?? null,
        warnings,
      },
    });
  }, [layout, drawing]);

  const gridLines: {
    key: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    major: boolean;
  }[] = useMemo(() => {
    const out: typeof gridLines = [];
    const [tilesU, tilesV] = UV_TILE_GRID;
    const [subU, subV] = UV_GRID_SUBDIV;
    for (let i = 0; i <= tilesU * subU; i++) {
      const u = i / subU;
      out.push({
        key: `u${i}`,
        x1: toX(u),
        y1: toY(0),
        x2: toX(u),
        y2: toY(tilesV),
        major: i % subU === 0,
      });
    }
    for (let i = 0; i <= tilesV * subV; i++) {
      const v = i / subV;
      out.push({
        key: `v${i}`,
        x1: toX(0),
        y1: toY(v),
        x2: toX(tilesU),
        y2: toY(v),
        major: i % subV === 0,
      });
    }
    return out;
  }, [transform, size]);

  const status = layout
    ? layout.active
      ? `UV Editor · ${layout.object} · ${layout.active} · ${layout.polygons} faces, ${layout.loops} corners · ${layout.mode}`
      : `UV Editor · ${layout.object ?? 'no mesh selected'} · no UV map · ${layout.mode}`
    : (errorRef.current ?? 'UV Editor · reading…');

  return (
    <div
      data-testid="blender-uv-editor"
      style={{
        display: 'flex',
        flexDirection: 'column',
        // FILLED FROM THE HOST BOX, NOT `height: 100%`, and that is the
        // MEASURED difference between a drawer panel and an EDITOR GROUP. In
        // the drawer this view's `height: '100%'` worked, because the drawer
        // group imposes a height on its panel. As a `workspace.document` in
        // `vgai:area:uv` it resolved to ZERO against an auto-height content
        // box — measured live 2026-09-19, `vgai.blender-uv-view.state`
        // answered `size: {w: 782, h: 0}` with a fully READ subject beneath
        // it (24 corners, 6 faces, the ProbeChecker backdrop found), which is
        // a view that has everything to draw and nowhere to draw it. The node
        // view already had `position: absolute; inset: 0` for its own reason
        // and was `{w: 1294, h: 467}` in the same layout, which is what named
        // the difference.
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: UV_THEME.back,
        color: UV_CHROME.text,
        font: '11px Inter, system-ui, sans-serif',
      }}
    >
      {/* A HEIGHT IMPOSED FROM ABOVE. The node view's walk measured what the
          other way costs: an SVG at `height: 100%` inside an auto-height parent
          settles at ~30 px, because each side's height is a function of the
          other's. */}
      <div ref={canvas} style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <svg
          width={size.w}
          height={size.h}
          style={{ display: 'block' }}
          onPointerDown={() => refuseUvViewGesture(REFUSALS.select)}
          aria-label="UV layout"
        >
          <title>UV layout</title>
          {gridLines.map((line) => (
            <line
              key={line.key}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              stroke={UV_THEME.grid}
              strokeWidth={line.major ? 2 : 1}
            />
          ))}
          {drawing?.faces.map((d, index) => (
            // ONE WASH PER FACE, at `.face` #ffffff alpha 0x0a — Blender's own
            // unselected island colour, and an island reads as a wash because
            // overlapping faces each add their 4 %.
            // biome-ignore lint/suspicious/noArrayIndexKey: a face's index IS its identity here — the door answers polygons in order and nothing reorders them.
            <path
              key={`f${index}`}
              d={d}
              fill={uvRgba(UV_THEME.face, UV_THEME.faceAlpha * UV_OPACITY)}
            />
          ))}
          {drawing?.outlines.map((d, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: as above.
            <path
              key={`e${index}`}
              d={d}
              fill="none"
              stroke={UV_LINE_STYLES.shadow.inner}
              strokeWidth={UV_EDGE_DRAWN_WIDTH}
            />
          ))}
          {drawing?.faceDots.map((dot, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: as above.
            <circle
              key={`fd${index}`}
              cx={dot.x}
              cy={dot.y}
              r={UV_FACEDOT_SIZE / 2}
              fill={UV_THEME.faceDot}
            />
          ))}
          {drawing?.dots.map((dot, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: as above.
            <circle
              key={`v${index}`}
              cx={dot.x}
              cy={dot.y}
              r={UV_VERT_DOT_SIZE / 2}
              fill={dot.pinned ? UV_PIN_COLOR : UV_THEME.vertex}
              stroke={dot.pinned ? UV_PIN_COLOR : 'none'}
              strokeWidth={dot.pinned ? UV_VERT_OUTLINE_WIDTH : 0}
            />
          ))}
        </svg>
      </div>
      <div
        style={{
          borderTop: `1px solid ${UV_CHROME.rule}`,
          padding: UV_CHROME.statusPadding,
          display: 'flex',
          gap: UV_CHROME.statusGap,
          alignItems: 'center',
        }}
      >
        <span>{status}</span>
        {refusal ? <span style={{ color: UV_CHROME.refusal }}>{refusal}</span> : null}
      </div>
    </div>
  );
}
