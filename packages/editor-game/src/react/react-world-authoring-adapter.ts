/**
 * ReactRootAuthoringAdapter — the editor's {@link AuthoringAdapter} for a react-kind
 * world (T6.2 slice 2).
 *
 * A react world has no ticking and no mirror (D8) — its authoring
 * entities ARE the `data-oid`-stamped elements of its rendered DOM (the OID
 * instrumentation from the UI visual-edit program, `../ui-source/oid-transform.ts`,
 * whose vite-plugin include this slice widens from the `editable-components` fixture
 * dir to project scope — see `@volter/editor-react`'s `serving/ui-oid-plugin.ts`). This adapter derives
 * its hierarchy from the shared DOM projector (`../projection/dom.ts`) under the
 * OID identity, over the world's live DOM root (`RootInstance.reactRoot()`);
 * there is no cached/mirrored state to fall out of sync — every `hierarchy`
 * call re-projects the live DOM.
 *
 * Writes (style/className/delete) reuse the EXISTING T3.2-slice-3 source-write seam
 * verbatim (`../ui-source/source-write-backend.ts`'s `SourceWriteBackend`, the same
 * `/__ui-source/write` + `/__ui-source/struct` dev-server endpoints
 * `@volter/editor-react`'s `serving/ui-oid-plugin.ts` serves for `UIAuthoringAdapter`/`SourceEditPanel`) — this
 * file does NOT invent a second source-writer. Every edit prepares complete next-file
 * text and commits it through one checksum-guarded source history resource. Style,
 * text, prop, and structural changes therefore share exact-byte undo/redo semantics.
 *
 * Persistence mirrors `UIAuthoringAdapter`'s de-stubbed pattern exactly: writes are
 * immediate (server-side, on commit), so `save()` is an honest no-op; `destination`
 * reports whether a source-write backend even exists in this session (absent in a
 * hosted/no-dev-server build — selection/inspection still work, writes report
 * unavailable via a loud console warning instead of silently no-op'ing).
 */

import { activeBreakpoint } from '@volter/editor-sdk/kit/breakpoint-state';
import {
  cssTextForStyleValue,
  numericStyleValue,
  preserveNumericStyleUnit,
} from '@volter/editor-sdk/css-numeric-style';
import { WORLD_SCOPE_NODE_ID } from '@volter/editor-sdk/kit/stories-scope';
import { createStructWritePipe, type StructOpOptions } from '../host/authoring/struct-write-pipe';
import { getRootPan } from '@volter/editor-sdk/kit/world-pan-state';
import {
  resolvesLiveOnly,
  runWritePipe,
  type WriteAck,
  type WriteResolution,
} from '@volter/editor-sdk/kit/write-pipe';
import { guideClientEdges } from '@volter/editor-core/components/board-guides';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import type { ShellStore } from '@volter/editor-sdk/kit/shell-store';
import { withProjectSourceHistory } from '@volter/editor-sdk/kit/history/source-history-backend';
import { DomProjector, oidDomIdentity, projectOidDom } from '../host/projection/dom';
import { storyArgPropertyDescriptors } from '../host/stories/story-arg-descriptors';
import { storyDiscoveryUnavailable } from '@volter/editor-sdk/kit/stories/story-discovery';
import { deriveStoryGroupPath, formatStoryGroupPath } from '@volter/editor-sdk/kit/stories/story-grouping';
import type { StoryPresentationIndex } from '@volter/editor-core/stories/story-presentation';
import { subscribeProjectStoryModules } from '@volter/editor-sdk/kit/stories/story-registry';
import { showTransientHint } from '@volter/editor-sdk/kit/transient-hint';
import {
  browserOrInlineResolver,
  type ComputedStyleResolver,
  camelToKebab,
  type DesignToken,
  type EmptyCandidate,
  findClassRuleSource,
  findEmptyContainers,
  firstPartyStylesheetFiles,
  getComponentProps,
  getComputedStyleValue,
  getDesignTokens,
  getMatchedCssRules,
  getReactComponentName,
  type MatchableElement,
} from '@volter/editor-sdk/kit/ui-source/inspect';
import type { ComponentPropSpec, OidEntry } from '@volter/editor-react/source/oid-transform';
import { relativeImportSpecifier } from '@volter/editor-react/source/relative-import-specifier';
import type { SourceWriteBackend } from '@volter/editor-sdk/kit/ui-source/source-write-backend';
import { writeCsfStory, writeNamedStyle } from '@volter/editor-sdk/kit/ui-source/source-write-backend';
import {
  type CssRuleTarget,
  namedStyleRuleFor,
  pickCssRuleTarget,
  tokenReferenceGuardText,
} from '@volter/editor-react/source/writer';
import { UI_COMPONENTS_DOCUMENT_ID } from '@volter/editor-sdk/kit/workspace-document-ids';
import { activateWorkspaceDocument } from '@volter/editor-sdk/kit/workspace-document-registry';
import type {
  AssetDropContext,
  AssetDropProvider,
  AssetSubjectProvider,
  AuthoringAdapter,
  AuthoringAssetSubject,
  AuthoringCapabilities,
  AuthoringProvenance,
  BoxEditProvider,
  ColorSampleProvider,
  ComponentInstanceApplyResult,
  ComponentInstancesProvider,
  DOMRectLike,
  EditorNode,
  HierarchyProvider,
  InspectorProvider,
  NodeCreationSite,
  PersistenceProvider,
  PickProvider,
  PropertyDescriptor,
  RectProvider,
  RelatedSubjectsProvider,
  SelectionProvider,
  StoriesProvider,
  StoryRef,
  StructureProvider,
  TextProvider,
  TruthProvider,
  WriteAnchorKind,
} from '@volter/editor-project/adapter';

/**
 * The minimal structural shape this adapter needs from a live DOM element —
 * deliberately NOT `HTMLElement` so it stays testable with a plain-object fixture
 * headlessly (this repo's vitest environment is `node`, no jsdom — use the
 * repo's DOM-stub + fixture patterns instead). A real `HTMLElement` satisfies
 * this structurally: `tagName`
 * (uppercase, per the DOM spec — lower-cased for labels/kind below), `children`
 * (an `HTMLCollection`, `Array.from`-able), and `getAttribute` reading the REAL
 * `data-oid="…"` attribute `transformSource` stamped into the JSX (a genuine DOM
 * attribute at runtime, not a mirror).
 */
export interface OidElementLike {
  readonly tagName: string;
  /** Real DOM nodes expose this. Optional keeps headless fixtures minimal. */
  readonly namespaceURI?: string | null;
  readonly children: ArrayLike<OidElementLike>;
  getAttribute(name: string): string | null;
  /**
   * `unknown` rather than a structural record — a real `CSSStyleDeclaration` has
   * NO string index signature (TS models it as a fixed set of named properties
   * plus methods), so it can't structurally satisfy `Record<string, unknown>`.
   * Read through {@link styleProp} below, which handles both shapes.
   */
  readonly style?: unknown;
  /**
   * D12 (B4) — the element's live viewport rect, for `pickable.pick`'s
   * geometric hit-test (see that provider's doc comment for why NOT
   * `elementFromPoint`). Optional so existing plain-object test fixtures
   * (which never provide one) keep type-checking unchanged — a node with no
   * `getBoundingClientRect` simply never wins a pick (its rect is treated as
   * absent, never a fabricated 0×0 that could win a tie).
   */
  getBoundingClientRect?(): {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  /**
   * T0 (spec 27 §2) — the element's rendered text, read for `TextProvider.get`'s
   * "has child elements" gate below. Optional so pre-existing `OidElementLike`
   * fixtures (none of which set it) keep satisfying the interface unchanged.
   */
  readonly textContent?: string | null;
  /** Present on real DOM/SVG elements; used only for atomic inline-SVG assets. */
  readonly outerHTML?: string;
}

const MAX_ELEMENT_LABEL_LENGTH = 64;

/** Compact the browser's semantic text into a stable hierarchy-row label. */
function normalizeElementText(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (text.length <= MAX_ELEMENT_LABEL_LENGTH) return text;
  return `${text.slice(0, MAX_ELEMENT_LABEL_LENGTH - 1).trimEnd()}…`;
}

/** Read one style property off an `OidElementLike.style` of either shape (a real
 *  `CSSStyleDeclaration` or a plain-object test fixture). */
export function styleProp(style: unknown, prop: string): unknown {
  return style ? (style as Record<string, unknown>)[prop] : undefined;
}

const RGB_RE = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/;

/**
 * Normalize a CSS color VALUE into `#rrggbb` for a `type: 'color'`
 * {@link PropertyDescriptor} (`<input type="color">` only accepts exactly
 * that shape — an unparseable value makes the browser silently coerce the
 * input to black). A real `CSSStyleDeclaration` always serializes an inline
 * color property as `rgb(r, g, b)`/`rgba(r, g, b, a)` — EVEN WHEN the author
 * wrote a hex literal in JSX (`el.style.color = '#3ddc65'` reads back as
 * `"rgb(61, 220, 101)"`, verified empirically against a real Chromium page,
 * not assumed) — never hex. Without this normalization every color-typed
 * style field would show black regardless of its real value against a real
 * browser DOM (the plain-object test fixtures never caught this: a
 * hand-built fixture's `style` can hold the author's hex string directly,
 * which real CSSOM never does). An already-hex value (a fixture, or a
 * property this repo's CSSOM happens to serialize as hex) passes through
 * unchanged; a value matching neither shape returns `undefined` (the
 * generic inspector's own '#ffffff' fallback) rather than handing the input
 * an invalid string.
 */
export function cssColorToHex(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined;
  if (raw.startsWith('#')) return raw;
  const m = RGB_RE.exec(raw);
  if (!m) return undefined;
  const toHex = (n: string) => Number.parseInt(n, 10).toString(16).padStart(2, '0');
  return `#${toHex(m[1]!)}${toHex(m[2]!)}${toHex(m[3]!)}`;
}

/** One resolved `BoxEditProvider` patch-key mapping (spec 27 §4, B1). */
export interface BoxEditPropMapping {
  /** The CSS style prop to write (already the target, e.g. `x` → `left`). */
  prop: string;
  /** Live-preview CSS VALUE for a raw patch number — always px-suffixed for
   *  spatial/spacing props, the `rotate(<deg>deg)` transform string for `rotate`. */
  cssValue: (v: number) => string;
}

/**
 * `BoxEditProvider` patch-key → CSS-prop mapping (spec 27 B1), shared by BOTH
 * authoring adapters' `boxEdit.apply/end` (`dom-authoring-adapter.ts`
 * imports this rather than redefining it — same DRY reuse as
 * {@link cssColorToHex}/{@link numericStyleValue}/{@link styleProp} below).
 * `width`/`height`/`margin*`/`padding*` map 1:1 to their same-named style
 * prop. `x`/`y` map to `left`/`top` ONLY when the node is
 * absolutely/fixed-positioned (there is no `left`/`top` to move on a
 * static/relative node) — `isPositioned` is a caller-resolved boolean (each
 * adapter reads its own computed-style resolver) — a mismatched key returns
 * `null` to mean "drop this key"; the CALLER does its own loud
 * `console.warn` so the adapter's own name appears in the message. `rotate`
 * (deg) maps to the `transform` prop as a `rotate(<deg>deg)` string.
 */
export function mapBoxEditPatchKey(key: string, isPositioned: boolean): BoxEditPropMapping | null {
  switch (key) {
    case 'width':
    case 'height':
    case 'marginTop':
    case 'marginRight':
    case 'marginBottom':
    case 'marginLeft':
    case 'paddingTop':
    case 'paddingRight':
    case 'paddingBottom':
    case 'paddingLeft':
      return { prop: key, cssValue: (v) => `${v}px` };
    case 'x':
      return isPositioned ? { prop: 'left', cssValue: (v) => `${v}px` } : null;
    case 'y':
      return isPositioned ? { prop: 'top', cssValue: (v) => `${v}px` } : null;
    case 'rotate':
      return { prop: 'transform', cssValue: (v) => `rotate(${v}deg)` };
    default:
      return null;
  }
}

const OID_ATTR = 'data-oid';
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const VOID_HTML_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** Empty-layout hints are for HTML elements that could receive content.
 * SVG geometry (especially zero-width `line`/`path` bounds) and HTML void
 * elements are leaves by definition, not collapsed layout containers. */
function canContainDomChildren(el: OidElementLike, tag: string): boolean {
  const namespace = el.namespaceURI;
  if (namespace !== undefined && namespace !== null && namespace !== HTML_NAMESPACE) return false;
  return !VOID_HTML_ELEMENTS.has(tag);
}

function projectSourcePath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  const marker = normalized.lastIndexOf('/src/');
  return marker >= 0 ? normalized.slice(marker + 1) : normalized;
}

/** One OID-tagged DOM element resolved into the adapter's internal tree. */
interface OidNode {
  /** Disambiguated entity id — see {@link walkOidTree}'s doc comment. */
  id: string;
  /** The raw OID (may repeat across sibling `OidNode`s — see below). */
  oid: string;
  tag: string;
  el: OidElementLike;
  parentId: string | null;
  childIds: string[];
}

export interface OidTree {
  /** Every OID-tagged node, keyed by its (disambiguated) entity id. */
  nodes: Map<string, OidNode>;
  /** Top-level entity ids (no OID-tagged ancestor) in DOM/tree order. */
  rootIds: string[];
}

/**
 * Walk a react world's live DOM root for `data-oid`-carrying elements.
 *
 * This is the adapter-facing view over {@link projectOidDom}: the projector
 * owns identity, nesting, and the SVG-atomic rule; this wrapper keeps the
 * `OidNode` shape existing callers (tests, ingest sibling probe, play-live
 * authoring) already read — `oid` and `tag` are derived from the live
 * element the projector handed back.
 *
 * OID → entity id disambiguation lives on the projector (`oidDomIdentity`):
 * the first element carrying a given oid keeps `id === oid`; the Nth repeat
 * gets `id === "${oid}#${n}"`. An unstamped wrapper is transparent — its
 * children attach to the nearest stamped ancestor.
 */
export function walkOidTree(root: OidElementLike): OidTree {
  return oidTreeFromProjection(projectOidDom(root));
}

function oidTreeFromProjection(projection: {
  readonly nodes: ReadonlyMap<
    string,
    { object: OidElementLike; parentId: string | null; childIds: readonly string[] }
  >;
  readonly rootIds: readonly string[];
}): OidTree {
  const nodes = new Map<string, OidNode>();
  for (const [id, node] of projection.nodes) {
    nodes.set(id, {
      id,
      oid: node.object.getAttribute(OID_ATTR) ?? id,
      tag: node.object.tagName.toLowerCase(),
      el: node.object,
      parentId: node.parentId,
      childIds: [...node.childIds],
    });
  }
  return { nodes, rootIds: [...projection.rootIds] };
}

/**
 * Cap 6 (React visual-edit parity): the RICH GROUPED inspector model — the figma-style
 * panels (Layout / Position / Spacing / Type / Fill / Stroke / Effects / Transform), each
 * property tagged with a `group` the generic inspector renders as a titled sub-section
 * (`PropertyDescriptor.group`). Every property here is covered by the writer's broadened
 * `ARB_MAP`/`ENUM_UTILITIES` class routing (or inline style), so a set writes real source.
 * (Bespoke widgets — HSV picker, scrub inputs, gradient/multi-shadow editors — are the
 * one descoped part of Cap 6; the generic color/number/enum/string inputs render each of
 * these functionally.)
 */
const STYLE_PROPERTIES: ReadonlyArray<{
  prop: string;
  label: string;
  type: PropertyDescriptor['type'];
  group: string;
  options?: string[];
}> = [
  // -- Layout --
  {
    prop: 'display',
    label: 'Display',
    type: 'enum',
    group: 'Layout',
    options: ['block', 'flex', 'grid', 'inline', 'inline-block', 'inline-flex', 'none'],
  },
  {
    prop: 'flexDirection',
    label: 'Direction',
    type: 'enum',
    group: 'Layout',
    options: ['row', 'column', 'row-reverse', 'column-reverse'],
  },
  {
    prop: 'flexWrap',
    label: 'Wrap',
    type: 'enum',
    group: 'Layout',
    options: ['nowrap', 'wrap', 'wrap-reverse'],
  },
  {
    prop: 'justifyContent',
    label: 'Justify',
    type: 'enum',
    group: 'Layout',
    options: ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'],
  },
  {
    prop: 'alignItems',
    label: 'Align',
    type: 'enum',
    group: 'Layout',
    options: ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'],
  },
  { prop: 'gap', label: 'Gap', type: 'number', group: 'Layout' },
  // -- Grid (design ledger: grid authoring). Figma's GridLayoutMixin is a
  // strict subset of CSS Grid (counts/sizes/gaps/placement), so the carriers
  // ARE the CSS properties: templates as strings (repeat()/minmax()/fr all
  // legal — nothing dumbed down), gaps split per axis, placement on the
  // child. SemanticLayout renders the container set when display is grid,
  // and the grid-item set behind its own disclosure. --
  { prop: 'gridTemplateColumns', label: 'Columns', type: 'string', group: 'Layout' },
  { prop: 'gridTemplateRows', label: 'Rows', type: 'string', group: 'Layout' },
  {
    prop: 'gridAutoFlow',
    label: 'Flow',
    type: 'enum',
    group: 'Layout',
    options: ['row', 'column', 'row dense', 'column dense'],
  },
  { prop: 'rowGap', label: 'Row Gap', type: 'number', group: 'Layout' },
  { prop: 'columnGap', label: 'Col Gap', type: 'number', group: 'Layout' },
  { prop: 'gridColumn', label: 'Grid Col', type: 'string', group: 'Layout' },
  { prop: 'gridRow', label: 'Grid Row', type: 'string', group: 'Layout' },
  {
    prop: 'justifySelf',
    label: 'Justify Self',
    type: 'enum',
    group: 'Layout',
    options: ['auto', 'start', 'center', 'end', 'stretch'],
  },
  {
    prop: 'overflow',
    label: 'Overflow',
    type: 'enum',
    group: 'Layout',
    options: ['visible', 'hidden', 'scroll', 'auto'],
  },
  { prop: 'width', label: 'Width', type: 'number', group: 'Layout' },
  { prop: 'height', label: 'Height', type: 'number', group: 'Layout' },
  { prop: 'minWidth', label: 'Min W', type: 'number', group: 'Layout' },
  { prop: 'minHeight', label: 'Min H', type: 'number', group: 'Layout' },
  { prop: 'maxWidth', label: 'Max W', type: 'number', group: 'Layout' },
  { prop: 'maxHeight', label: 'Max H', type: 'number', group: 'Layout' },
  // -- Position --
  {
    prop: 'position',
    label: 'Position',
    type: 'enum',
    group: 'Position',
    options: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
  },
  { prop: 'top', label: 'Top', type: 'number', group: 'Position' },
  { prop: 'right', label: 'Right', type: 'number', group: 'Position' },
  { prop: 'bottom', label: 'Bottom', type: 'number', group: 'Position' },
  { prop: 'left', label: 'Left', type: 'number', group: 'Position' },
  { prop: 'zIndex', label: 'Z Index', type: 'number', group: 'Position' },
  { prop: 'flexGrow', label: 'Grow', type: 'number', group: 'Position' },
  { prop: 'flexShrink', label: 'Shrink', type: 'number', group: 'Position' },
  { prop: 'flexBasis', label: 'Basis', type: 'string', group: 'Position' },
  {
    prop: 'alignSelf',
    label: 'Self Align',
    type: 'enum',
    group: 'Position',
    options: ['auto', 'stretch', 'flex-start', 'center', 'flex-end', 'baseline'],
  },
  // -- Spacing (per-side) --
  { prop: 'marginTop', label: 'Margin T', type: 'number', group: 'Spacing' },
  { prop: 'marginRight', label: 'Margin R', type: 'number', group: 'Spacing' },
  { prop: 'marginBottom', label: 'Margin B', type: 'number', group: 'Spacing' },
  { prop: 'marginLeft', label: 'Margin L', type: 'number', group: 'Spacing' },
  { prop: 'paddingTop', label: 'Padding T', type: 'number', group: 'Spacing' },
  { prop: 'paddingRight', label: 'Padding R', type: 'number', group: 'Spacing' },
  { prop: 'paddingBottom', label: 'Padding B', type: 'number', group: 'Spacing' },
  { prop: 'paddingLeft', label: 'Padding L', type: 'number', group: 'Spacing' },
  // -- Type --
  { prop: 'color', label: 'Color', type: 'color', group: 'Type' },
  { prop: 'fontSize', label: 'Size', type: 'number', group: 'Type' },
  { prop: 'fontWeight', label: 'Weight', type: 'string', group: 'Type' },
  { prop: 'lineHeight', label: 'Line H', type: 'string', group: 'Type' },
  { prop: 'letterSpacing', label: 'Spacing', type: 'string', group: 'Type' },
  {
    prop: 'textAlign',
    label: 'Align',
    type: 'enum',
    group: 'Type',
    options: ['left', 'center', 'right', 'justify'],
  },
  {
    prop: 'textTransform',
    label: 'Transform',
    type: 'enum',
    group: 'Type',
    options: ['none', 'uppercase', 'lowercase', 'capitalize'],
  },
  { prop: 'fontStyle', label: 'Style', type: 'enum', group: 'Type', options: ['normal', 'italic'] },
  { prop: 'fontFamily', label: 'Font', type: 'string', group: 'Type' },
  {
    prop: 'textDecoration',
    label: 'Decoration',
    type: 'enum',
    group: 'Type',
    options: ['none', 'underline', 'line-through', 'overline'],
  },
  // -- Fill --
  { prop: 'backgroundColor', label: 'Background', type: 'color', group: 'Fill' },
  // Cap 6 (§5 gap-fill): computed style never round-trips the `background`
  // shorthand — `backgroundImage` is the prop that actually reads back
  // (see `inspector.get`'s computed-style path below), so the gradient
  // widget for a STYLE property must key off it, not `background`.
  { prop: 'backgroundImage', label: 'Fills', type: 'string', group: 'Fill' },
  // Image-fill companions (design ledger: fill-as-list) — global, not
  // per-layer, in v1; SemanticFill shows them only when an image layer exists.
  {
    prop: 'backgroundSize',
    label: 'Size',
    type: 'enum',
    group: 'Fill',
    options: ['auto', 'cover', 'contain'],
  },
  { prop: 'backgroundPosition', label: 'Pos', type: 'string', group: 'Fill' },
  {
    prop: 'backgroundRepeat',
    label: 'Repeat',
    type: 'enum',
    group: 'Fill',
    options: ['repeat', 'no-repeat', 'repeat-x', 'repeat-y'],
  },
  // -- Stroke --
  { prop: 'borderColor', label: 'Border Color', type: 'color', group: 'Stroke' },
  { prop: 'borderWidth', label: 'Border Width', type: 'number', group: 'Stroke' },
  {
    prop: 'borderStyle',
    label: 'Border Style',
    type: 'enum',
    group: 'Stroke',
    options: ['none', 'solid', 'dashed', 'dotted', 'double'],
  },
  { prop: 'borderRadius', label: 'Radius', type: 'number', group: 'Stroke' },
  // -- Effects --
  { prop: 'opacity', label: 'Opacity', type: 'number', group: 'Effects' },
  { prop: 'boxShadow', label: 'Box Shadow', type: 'string', group: 'Effects' },
  {
    prop: 'mixBlendMode',
    label: 'Blend',
    type: 'enum',
    group: 'Effects',
    options: [
      'normal',
      'multiply',
      'screen',
      'overlay',
      'darken',
      'lighten',
      'color-dodge',
      'color-burn',
      'hard-light',
      'soft-light',
      'difference',
      'exclusion',
      'hue',
      'saturation',
      'color',
      'luminosity',
    ],
  },
  { prop: 'filter', label: 'Filter', type: 'string', group: 'Effects' },
  { prop: 'backdropFilter', label: 'Backdrop', type: 'string', group: 'Effects' },
  { prop: 'textShadow', label: 'Text Shadow', type: 'string', group: 'Effects' },
  {
    prop: 'cursor',
    label: 'Cursor',
    type: 'enum',
    group: 'Effects',
    options: [
      'auto',
      'default',
      'pointer',
      'text',
      'move',
      'wait',
      'help',
      'crosshair',
      'not-allowed',
      'grab',
      'grabbing',
      'zoom-in',
      'zoom-out',
      'col-resize',
      'row-resize',
      'none',
    ],
  },
  // -- Transform --
  { prop: 'transform', label: 'Transform', type: 'string', group: 'Transform' },
];
const STYLE_PATH_PREFIX = 'style.';
/** Where this adapter's writes land — the ONE spelling, read by both the
 *  save-status provider and the per-edit ack the pipe returns, so the two can
 *  never name different places. */
const JSX_SOURCE_DESTINATION =
  'component source (JSX, via /__ui-source — writes are immediate; nothing pending to flush)';
/** …and the honest floor when no writer is bound. */
const NO_BACKEND_DESTINATION = 'component source (JSX) — no source-write backend in this session';
/** Cap 4: inspector path prefix for a component's editable props (`prop.<name>`). */
const PROP_PATH_PREFIX = 'prop.';
/** Cap 7: inspector path prefix for the document's design tokens (`token.<name>`). */
const TOKEN_PATH_PREFIX = 'token.';
const PORTABLE_STORY_ARG_PATH_PREFIX = 'story.arg.';
/** D3.R1 (spec 27 §2/§5 U4 precedent, reopen fix) — the `guardedPaths` key for
 *  Cap 3's text edit (`editText`), so a dynamic-body refusal is recorded and
 *  surfaced through the SAME session-scoped after-touch mechanism the
 *  style/prop U4 widgets use — not a real inspector path (text has no
 *  `properties()` descriptor), just a stable key for `` `${id}|${TEXT_PATH}` ``. */
const TEXT_PATH = 'text';
/** The dynamic-expression guard's ONE sentence — the console warning and the
 *  field's read-only reason are the same string, so an author reads the same
 *  thing wherever they meet it (`tokenReferenceGuardText` is its var() twin). */
/**
 * The selection-repair watch: 30 × 40ms ≈ 1.2s after an HMR update.
 * MEASURED: the first drop lands 100-150ms after the update, and one edit can
 * produce more than one update — so the window covers the whole remount storm
 * without outliving the gesture that caused it.
 */
const SELECTION_REPAIR_ATTEMPTS = 30;
/**
 * The REPAIRED case is named ONCE PER SESSION, the `reportUndeclaredStoryMedium`
 * idiom: it is a real open defect and has to be visible, but it fires on every
 * source edit in this lane, and a console that is permanently non-empty is a
 * console nobody can use to find the next real thing. A repair that CANNOT be
 * made stays loud every time — there the author actually lost something.
 */
let reportedSelectionRepair = false;
const SELECTION_REPAIR_INTERVAL_MS = 40;

const DYNAMIC_EXPRESSION_GUARD =
  'The source value is a dynamic expression, so replacing it with a literal is guarded.';

/**
 * WHICH LONGHANDS EACH CSS SHORTHAND OWNS — the table behind
 * {@link ReactRootAuthoringAdapter.expandShorthandsFor}.
 *
 * React refuses to hold both halves of one property at once: writing
 * `paddingTop` beside an authored `padding: 16` raises its own "Removing a
 * style property during rerender (paddingTop) when a conflicting property is
 * set (padding) can lead to styling bugs", and which of the two wins becomes
 * key-order dependent.
 *
 * The combo widgets already solved the UNIFORM direction by REMOVING the
 * longhands (`RadiusRow`/`ComboRow` call `inspector.remove` for every corner
 * and side). This is that same gesture in the other direction: on the first
 * per-side write, the shorthand is EXPANDED into its longhands and removed, so
 * the element is authored in exactly one vocabulary either way.
 *
 * Nested on purpose — `border` owns three shorthands that each own four
 * longhands — so an expansion walks outermost-in and each level is one entry.
 */
const SHORTHAND_LONGHANDS: Readonly<Record<string, readonly string[]>> = {
  border: ['borderWidth', 'borderStyle', 'borderColor'],
  borderWidth: ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'],
  borderStyle: ['borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle'],
  borderColor: ['borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor'],
  borderRadius: [
    'borderTopLeftRadius',
    'borderTopRightRadius',
    'borderBottomRightRadius',
    'borderBottomLeftRadius',
  ],
  padding: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'],
  margin: ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'],
  inset: ['top', 'right', 'bottom', 'left'],
};

/** Longhand -> its immediate shorthand, derived from the table above so the
 *  two directions cannot disagree. */
const SHORTHAND_OF: ReadonlyMap<string, string> = new Map(
  Object.entries(SHORTHAND_LONGHANDS).flatMap(([shorthand, longhands]) =>
    longhands.map((longhand) => [longhand, shorthand] as const),
  ),
);

/** The shorthands covering `prop`, OUTERMOST FIRST — `borderTopWidth` gives
 *  `['border', 'borderWidth']`. Empty for a property no shorthand owns. */
function shorthandChain(prop: string): readonly string[] {
  const chain: string[] = [];
  for (let cursor = SHORTHAND_OF.get(prop); cursor; cursor = SHORTHAND_OF.get(cursor)) {
    chain.unshift(cursor);
  }
  return chain;
}
/** D20 — fallback id for callers that supply portable stories without the
 * richer per-CSF-document projection. Story ids remain Storybook-owned. */
const PORTABLE_DOCUMENT_ID = 'portable-document';
/** Name of a portable document that has neither an explicit label nor a
 *  module path to derive a group path from. */
const PORTABLE_DOCUMENT_LABEL = 'React Preview';
/** `prop -> declared type`, so `inspector.get()` knows when to run a style
 *  value through {@link numericStyleValue} instead of handing it back raw
 *  (a real CSSOM length value is always a unit-suffixed string). */
const STYLE_PROPERTY_TYPE: ReadonlyMap<string, PropertyDescriptor['type']> = new Map(
  STYLE_PROPERTIES.map(({ prop, type }) => [prop, type]),
);

/**
 * U2 (spec 27 §5 C2) — a per-side/per-corner CSS LONGHAND → the SHORTHAND that
 * governs it in the longhand's absence. Used by `inspector.remove` (below): when
 * a uniform border/radius edit removes a stale longhand override, the removed
 * longhand's optimistic echo is set to the shorthand's current (just-committed)
 * value — so an `inspector.get(longhand)` right after removal reports the value
 * the corner actually renders at (the shorthand), not a stale override or an
 * empty computed read, and it stays consistent once HMR clears the echo (the
 * longhand is gone from source, so the shorthand cascades to it). Purely the
 * longhands the C2 combo rows can write — the shorthand set itself is uniform.
 */
const LONGHAND_TO_SHORTHAND: Readonly<Record<string, string>> = {
  borderTopLeftRadius: 'borderRadius',
  borderTopRightRadius: 'borderRadius',
  borderBottomLeftRadius: 'borderRadius',
  borderBottomRightRadius: 'borderRadius',
  borderTopWidth: 'borderWidth',
  borderRightWidth: 'borderWidth',
  borderBottomWidth: 'borderWidth',
  borderLeftWidth: 'borderWidth',
  borderTopStyle: 'borderStyle',
  borderRightStyle: 'borderStyle',
  borderBottomStyle: 'borderStyle',
  borderLeftStyle: 'borderStyle',
  borderTopColor: 'borderColor',
  borderRightColor: 'borderColor',
  borderBottomColor: 'borderColor',
  borderLeftColor: 'borderColor',
};

/**
 * D3.e (spec 27 §2 T0 leftover, §6 D3 "Insert-child submenu") — the kinds
 * `structure.create`'s `wrapperTag` genuinely inserts. `insertChildElement`
 * (`ui-source/writer.ts:1036`) writes `<tag />` VERBATIM for whatever tag
 * string it is given — it has no allow-list of its own, and no void/non-void
 * element distinction (every insert is self-closing, syntactically valid
 * JSX for every one of these real HTML element names). So this is a CURATED
 * subset, not a writer-enforced ceiling. A React root node's native kind is
 * its literal HTML tag name.
 */
const CREATABLE_KINDS: ReadonlyArray<{ kind: string; label: string }> = [
  { kind: 'div', label: 'Container' },
  { kind: 'span', label: 'Text' },
  { kind: 'p', label: 'Paragraph' },
  { kind: 'button', label: 'Button' },
  { kind: 'a', label: 'Link' },
  { kind: 'img', label: 'Image' },
  { kind: 'ul', label: 'List' },
  { kind: 'li', label: 'List Item' },
];

const IMAGE_ASSET_RE = /\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i;

type DomAssetDropPlan =
  | {
      ok: true;
      parentId: string;
      snippet: string;
      ensureImport?: { name: string; module: string; kind: 'default' | 'named' };
    }
  | { ok: false; reason: string };

function serializedComponentValue(value: unknown, spec: ComponentPropSpec): string {
  if (spec.type === 'number') return String(Number(value));
  if (spec.type === 'boolean') return value === true || value === 'true' ? 'true' : 'false';
  if (spec.type === 'vec3' && Array.isArray(value)) {
    return `[${value.map((entry) => Number(entry)).join(', ')}]`;
  }
  if (spec.type === 'json') return JSON.stringify(value);
  return JSON.stringify(String(value));
}

export interface ReactRootAuthoringOptions {
  /** Optional wider DOM root used only for atomic asset discovery. The
   * hierarchy still walks the constructor root; a multi-story board can thus
   * expose assets from every mounted frame without mixing their node trees. */
  assetRoot?: OidElementLike | undefined;
  /** T3.2 slice-3 write seam. Absent ⇒ no dev-server backend in this session (a
   *  hosted/browser build) — selection/inspection still work; writes report
   *  unavailable (see the class doc comment). */
  writeBackend?: SourceWriteBackend | undefined;
  /** Cap 1 (React visual-edit parity): resolves an element to its COMPUTED style so
   *  `inspector.get` reflects class- and CSS-file-styled properties, not just inline
   *  style. Defaults to `window.getComputedStyle` in a browser, or the element's inline
   *  `.style` under vitest's `node` env (so headless fixtures work). Injectable for
   *  headless tests that want to drive the real computed-value path. */
  computedStyle?: ComputedStyleResolver | undefined;
  /** Cap 2 (React visual-edit parity): resolves an element to the first-party CSS rules
   *  that match it (source file + selector + declared properties), so a style edit whose
   *  property lives in a CSS FILE routes to that file instead of inline/class. Defaults to
   *  `inspect.ts`'s `getMatchedCssRules` against the live document. Injectable for headless
   *  tests. */
  matchedCssRules?: ((el: unknown) => CssRuleTarget[]) | undefined;
  /** Cap 7 (React visual-edit parity): the document's design tokens (`:root` custom
   *  properties). Defaults to `inspect.ts`'s `getDesignTokens` against the live `:root`
   *  (empty under vitest's `node` env). Injectable for headless tests. */
  designTokens?: (() => DesignToken[]) | undefined;
  /** D20 — portable Storybook CSF stories associated with this native React
   * root. They are the canonical provider exposed to the shell. */
  portableStories?: ReadonlyArray<PortableStoryRef> | undefined;
  /** Source documents projected above their own portable CSF stories. A
   *  document with no explicit `label` is named by its GROUP PATH — the one
   *  presentation-only grouping model (`stories/story-grouping.ts`): the
   *  CSF meta `title` when authored, else the module path relative to the
   *  project `src/`. Grouping is labels only here; ids, roles, kinds, and
   *  which stories a document owns are unchanged by it. */
  portableDocuments?:
    | ReadonlyArray<{
        id: string;
        label?: string | undefined;
        path?: string | undefined;
        /** Composed CSF meta title when the module authored one. */
        title?: string | undefined;
        storyIds: ReadonlyArray<string>;
      }>
    | undefined;
  /** Native Storybook Category → Folder → Component index. When present,
   *  both the hierarchy and the board consume this same derived projection;
   *  CSF remains the only authored data. */
  portableHierarchy?: StoryPresentationIndex | undefined;
  /** Initially mounted portable story id (normally the explicit/default CSF
   * story selected by the design-time layer). */
  activePortableStoryId?: string | undefined;
  /** Re-render hook for a portable CSF selection. The design-time layer owns
   * Storybook mounting; this adapter owns only selection/provider routing. */
  onPortableStoryApplied?: ((storyId: string | null) => void) | undefined;
  /** Session-scoped Storybook Controls write. The design-time layer remounts
   * the same composed story with these args; CSF remains the canonical
   * definition and Reset restores its composed defaults. */
  onPortableStoryArgsChanged?:
    | ((storyId: string, args: Record<string, unknown>) => void)
    | undefined;
  /**
   * Overrides the JSX-source provenance below. The one caller is play mode
   * (`react-play-live-authoring.ts`), whose `writeBackend` writes the LIVE DOM
   * rather than source — the badge/tooltip must say so, exactly as the adopted
   * three scene and the live Pixi stage do. Absent ⇒ the source-code provenance
   * every authoring session gets.
   */
  provenance?: AuthoringProvenance | undefined;
}

export interface PortableStoryRef extends StoryRef {
  args?: Readonly<Record<string, unknown>>;
  /** The CSF export name — what the story WRITE half (save-as/rename/delete)
   *  addresses in source. Optional so fixtures stay minimal; a ref without it
   *  simply cannot be written. */
  name?: string;
  /** Project-relative `*.stories.tsx` path — the write half's file. */
  modulePath?: string;
}

/** The default: this adapter's own truth is the component's JSX source. */
const JSX_SOURCE_PROVENANCE: AuthoringProvenance = {
  source: 'source-code',
  label: 'jsx',
  detail: 'The JSX source is the document — edits write back to the component source file.',
};

/** The element's literal class tokens, off the live DOM `class` attribute. */
function classTokensOf(el: unknown): string[] {
  const e = el as { getAttribute?(name: string): string | null };
  const raw = typeof e?.getAttribute === 'function' ? (e.getAttribute('class') ?? '') : '';
  return raw.split(/\s+/).filter(Boolean);
}

/** Does the LIVE inline style declare this property? Deliberately the live
 *  read, not the source: a preview-patched inline value also wins the cascade,
 *  so the conservative answer keeps a class-routed write from landing a
 *  declaration that never paints. */
function liveInlineDeclares(el: unknown, prop: string): boolean {
  const style = (el as { style?: { getPropertyValue?(name: string): string } }).style;
  if (typeof style?.getPropertyValue !== 'function') return false;
  return style.getPropertyValue(camelToKebab(prop)) !== '';
}

export class ReactRootAuthoringAdapter implements AuthoringAdapter {
  readonly capabilities: AuthoringCapabilities;

  /** Assigned in the constructor (an option may override it — see
   *  {@link ReactRootAuthoringOptions.provenance}), never re-assigned after. */
  readonly provenance: AuthoringProvenance;
  private readonly writeBackend: SourceWriteBackend | undefined;
  /** The shared DOM projector under the OID identity. */
  private readonly projector = new DomProjector(oidDomIdentity<OidElementLike>());
  private hierarchySnapshotCache: OidTree | null = null;
  private hierarchySnapshotClearQueued = false;
  private readonly computedStyle: ComputedStyleResolver;
  private readonly matchedCssRules: (el: unknown) => CssRuleTarget[];
  private readonly designTokens: () => DesignToken[];
  private readonly designTokenValue: (name: string) => string | undefined;
  /** OID → {component, tag, …} labels, fetched once (if a backend exists) from the
   *  SAME `/__ui-source/index` the OID store already serves — see `index()` on
   *  `SourceWriteBackend`. Absent/unresolved ⇒ nodes label from the DOM tag alone
   *  (honest degradation, not a second index). */
  private oidIndex: Map<string, OidEntry> = new Map();
  private dirty = false;
  /**
   * A4 (spec 27 §3) — the optimistic value echo. `inspector.set` writes the just-committed
   * value here BEFORE its async source-write returns; `inspector.get` reads THROUGH it (a
   * hit wins over the live-DOM walk), so an edited field shows the NEW value within one
   * frame of commit instead of snapping back to the old value until the source-write + Vite
   * HMR re-render land (that timing WAS the desync bug). Keyed by OID-signature entity id
   * (which survives the react remount — see {@link walkOidTree}) → full inspector path →
   * value. Cleared per-entry the instant a write is refused/coerced-away (so it can't go
   * stale showing a value the source never took), and wholesale once HMR actually lands
   * ({@link reconcileEchoAfterReload}) so the now-updated live DOM is authoritative again.
   */
  private readonly valueEcho = new Map<string, Map<string, unknown>>();
  /**
   * U4 (spec 27 §5 "Widgets: dynamic-expression read-only indicator") — the
   * smallest honest version of the indicator: no new backend literality
   * PROBE (that's real new `SourceWriteBackend` surface, deferred to Phase-E
   * scale). Instead this surfaces the write path's EXISTING refusal signal —
   * `writeStyleEntry`/`writePropEdit` already set `res.dynamic` when the
   * backend refuses because the target is a dynamic `{expression}`, clearing
   * the optimistic echo and warning. Once THAT has happened for a given
   * `id|path`, `properties()` marks its descriptor `readonly: true` on every
   * subsequent call, so the widget disables itself (`KindRowProps.disabled`)
   * instead of silently re-offering an edit the source will refuse again.
   * This is PREDICTIVE-AFTER-TOUCH, not predictive-BEFORE-touch (the field is
   * still editable — and will visibly refuse once — the very first time);
   * a pre-touch indicator needs the backend probe noted above. Session-scoped
   * (never persisted) — cleared for an id on `dispose()`-adjacent resets only
   * via normal adapter lifetime, same scope as `valueEcho`.
   */
  private readonly guardedPaths = new Map<string, string>();
  /**
   * D4 (spec27 §6 D4, layer-tree "lock" toggle) — SESSION-LOCAL node ids the
   * layer tree/overlay has marked locked. Deliberately NOT persisted/written
   * to source: a react
   * component has no lock schema field, and authoring one with no
   * runtime reader would violate this repo's "no described field without a
   * consumer" rule (CLAUDE.md; the SAME reason `ui.ts` dropped its dead
   * `locked` field). Mirrors `world-session-state.ts`'s per-world pick-lock.
   * D4.R1 — now READ by `pickable.pick` below (a locked node is skipped by
   * canvas click/marquee pick, matching the first-party three raycast's
   * own locked-skip in `viewport-raycast.ts`) and by
   * `RootSelectionOverlay.collectMarqueeCandidates` (via
   * `inspector.get(id, 'locked')`, which reads this Set — see the
   * `inspector.get`/`set` `'locked'` case below) for the marquee pool.
   * Deliberately NOT consulted by `hierarchy`/`selection.set` — a locked
   * node stays selectable/unlockable from the layer tree, mirroring the
   * first-party adapter's own "locked blocks the raycast, not the
   * hierarchy" behavior. Cleared only by adapter disposal (new Set per
   * adapter instance/mount).
   */
  private readonly lockedIds = new Set<string>();
  private readonly assetRoot: OidElementLike;
  /**
   * D3.R4 (reopen fix), widened by D3.R5 — a COUNTER (not a boolean) of source writes
   * whose own pre-HMR `notifyIngestEdit()` carries no fresh DOM shape, still awaiting
   * their post-HMR "reload landed" reconcile. Incremented by every SUCCESSFUL write on
   * a path with no `valueEcho` of its own: structural writes and `editText`.
   * A successful text write flips `hasText`, itself a
   * `findEmptyContainers` hint-eligibility criterion — text populates no `valueEcho`,
   * so neither existing reconcile branch fired for it).
   *
   * A structural/text op's own `notifyIngestEdit()` (right after the write response
   * lands) fires BEFORE the HMR remount that actually changes the DOM — so a memoized
   * hover-render cache keyed on that notify's `storeVersion`
   * (`RootSelectionOverlay`'s `emptyHintsCacheRef`) pins the PRE-HMR tree shape.
   * `reconcileEchoAfterReload` is the "HMR actually landed" signal; it used to no-op
   * whenever `valueEcho` was empty — true for every one of the sites above, since only
   * A4's value-echo path (style/prop) ever populates it.
   *
   * COUNTER, not boolean (the D3.R5 shape): a boolean cleared unconditionally on the
   * FIRST reconcile after it was set, so two rapid writes each of whose OWN HMR fires a
   * separate `vite:afterUpdate` would reconcile once and then no-op on the second
   * reload-landed signal — the second write's hint delta going stale forever (a
   * residual the boolean shape left undocumented). Each successful qualifying write
   * increments this counter; `reconcileEchoAfterReload` notifies and decrements by
   * exactly one whenever it is above zero (in addition to notifying whenever `valueEcho`
   * is non-empty), so N pending writes need N reconciles to fully drain — matching N
   * real `vite:afterUpdate` events in production.
   */
  private pendingSourceReconcile = 0;
  /**
   * The last non-empty selection this adapter's tree served — the input to
   * {@link repairSelectionAfterReprojection}.
   */
  private lastResolvedSelection: readonly string[] = [];
  /** One repair watcher per re-projection; see {@link scheduleSelectionRepair}. */
  private selectionRepairWatching = false;
  /** A4 — unsubscribes this adapter's `vite:afterUpdate` reconcile hook (see the constructor);
   *  `undefined` when there is no HMR context. */
  private readonly disposeReloadSignal: (() => void) | undefined;
  // Mutable on purpose: `writeStory` keeps this list truthful about the file
  // it just rewrote (rename updates the addressed entry, delete drops it) —
  // see the blind-walk finding in that method.
  private readonly portableStories: PortableStoryRef[];
  private readonly portableStoryArgs = new Map<string, Record<string, unknown>>();
  private readonly portableDocuments: ReadonlyArray<{
    id: string;
    label: string;
    path?: string | undefined;
    storyIds: ReadonlyArray<string>;
  }>;
  private readonly portableHierarchy: StoryPresentationIndex | null;
  private readonly portableDefaultStoryId: string | null;
  private readonly onPortableStoryApplied: ((storyId: string | null) => void) | undefined;
  private readonly onPortableStoryArgsChanged:
    | ((storyId: string, args: Record<string, unknown>) => void)
    | undefined;
  /** The currently applied portable story, or `null` when this root has no
   * portable CSF document. */
  private activeStoryId: string | null = null;
  /**
   * T0 (spec 27 §4, B1) — the currently-open `boxEdit` begin/apply×N/end gesture (a
   * drag), or `null` between gestures. `touched` maps the RESOLVED CSS prop (already
   * patch-key-mapped, e.g. `x` → `left`) to the FINAL value `end` should commit — a
   * `Map` so the last `apply` in the gesture wins, matching an in-flight drag's most
   * recent pointer position. `priorInline` captures each touched prop's ORIGINAL inline
   * value, LAZILY on the prop's first `apply` in this gesture (i.e. BEFORE `apply`
   * mutates the live style) — `apply` writes the live DOM directly for zero-latency
   * preview, which would otherwise corrupt `writeStyleEntry`'s own prior-value capture
   * (it reads `n.el.style` fresh, and by `end` time that already holds the LAST applied
   * preview value, not the true pre-gesture one) — this is why `writeStyleEntry` takes
   * an explicit override rather than re-deriving `prev` itself for a box-edit commit.
   */
  private boxEditSession: {
    id: string;
    touched: Map<string, string | number>;
    priorInline: Map<string, string>;
    /** The one hint this gesture already showed for a move it cannot write. */
    hinted?: boolean;
  } | null = null;

  /**
   * Serializes {@link commitBoxEdit} runs so two gestures never overlap.
   *
   * `boxEdit.end()` fire-and-forgets an ASYNC commit (it cannot await — the
   * gesture API is synchronous, driven straight from pointer/key handlers), and
   * `editor-hotkeys.ts` drives `apply()`+`end()` on EVERY keypress. Hold an
   * arrow key, or align a multi-selection, and the second commit calls
   * a second source-history gesture while the first is still awaiting its
   * writes. Chaining here keeps adapter preview/echo updates ordered too; the
   * scoped history backend independently serializes each complete callback.
   */
  private boxEditTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly root: OidElementLike,
    private readonly store: ShellStore,
    opts: ReactRootAuthoringOptions = {},
  ) {
    this.assetRoot = opts.assetRoot ?? root;
    this.provenance = opts.provenance ?? JSX_SOURCE_PROVENANCE;
    this.writeBackend = withProjectSourceHistory(opts.writeBackend, store.projectHistory);
    this.computedStyle = opts.computedStyle ?? browserOrInlineResolver;
    this.matchedCssRules =
      opts.matchedCssRules ??
      ((el) => getMatchedCssRules(el as MatchableElement) as CssRuleTarget[]);
    // Game CSS is SCOPED (`@scope ([data-vgai-game-styles])`, measured:
    // a project stylesheet's `:root { --x }` never reaches the editor page's
    // root), so the document root sees no game token — the adapter's OWN
    // mounted root is inside the scope and inherits them all. Fall back to
    // the page root for a fixture root that is not a real element.
    const tokenStyle = () => {
      const root = this.root as unknown as Element;
      // Tokens inherit DOWNWARD from each game-CSS scope root
      // (`[data-vgai-game-styles]`), which sits BELOW this adapter's layer —
      // so read the first scope root's computed style, not the layer's
      // (measured: the layer sees none of the game's custom properties).
      const el =
        typeof Element !== 'undefined' && root instanceof Element
          ? (root.querySelector('[data-vgai-game-styles]') ??
            root.closest?.('[data-vgai-game-styles]') ??
            root)
          : typeof document !== 'undefined'
            ? document.documentElement
            : null;
      const computed =
        typeof getComputedStyle === 'function' && el instanceof Element
          ? (getComputedStyle(el) as unknown as Parameters<typeof getDesignTokens>[0])
          : undefined;
      return computed;
    };
    this.designTokens = opts.designTokens ?? (() => getDesignTokens(tokenStyle()));
    // A field read is ONE computed custom property. Re-enumerating and tracing
    // the entire token catalog for each field made coverage/selection quadratic
    // (3,324 reads cost 6.6s under Code-OSS). Read live so same-turn CSS changes
    // remain visible; this is not a stale-value cache.
    this.designTokenValue = opts.designTokens
      ? (name) => opts.designTokens!().find((token) => token.name === name)?.value
      : (name) => tokenStyle()?.getPropertyValue(name).trim() || undefined;
    this.portableStories = [...(opts.portableStories ?? [])];
    for (const story of this.portableStories) {
      this.portableStoryArgs.set(story.id, { ...(story.args ?? {}) });
    }
    const declaredPortableDocuments =
      opts.portableDocuments ??
      (this.portableStories.length > 0
        ? [
            {
              id: PORTABLE_DOCUMENT_ID,
              label: PORTABLE_DOCUMENT_LABEL,
              storyIds: this.portableStories.map((story) => story.id),
            },
          ]
        : []);
    const knownStoryIds = new Set(this.portableStories.map((story) => story.id));
    const claimedStoryIds = new Set<string>();
    const documentIds = new Set<string>();
    const portableDocuments = declaredPortableDocuments.flatMap((document) => {
      if (documentIds.has(document.id)) return [];
      documentIds.add(document.id);
      const storyIds = document.storyIds.filter((storyId) => {
        if (!knownStoryIds.has(storyId) || claimedStoryIds.has(storyId)) return false;
        claimedStoryIds.add(storyId);
        return true;
      });
      if (storyIds.length === 0) return [];
      return [
        {
          id: document.id,
          // The group path IS the document's name when the caller doesn't
          // impose one — an authored CSF title, else the module's own path
          // under the project `src/` (which degrades to the per-module
          // grouping this hierarchy already had).
          label:
            document.label ??
            (document.path
              ? formatStoryGroupPath(
                  deriveStoryGroupPath({ modulePath: document.path, title: document.title }),
                )
              : PORTABLE_DOCUMENT_LABEL),
          ...(document.path ? { path: document.path } : {}),
          storyIds,
        },
      ];
    });
    const unassignedStoryIds = this.portableStories
      .map((story) => story.id)
      .filter((storyId) => !claimedStoryIds.has(storyId));
    if (unassignedStoryIds.length > 0) {
      portableDocuments.push({
        id: documentIds.has(PORTABLE_DOCUMENT_ID)
          ? `${PORTABLE_DOCUMENT_ID}:unassigned`
          : PORTABLE_DOCUMENT_ID,
        label: PORTABLE_DOCUMENT_LABEL,
        storyIds: unassignedStoryIds,
      });
    }
    this.portableDocuments = portableDocuments;
    this.portableHierarchy = opts.portableHierarchy ?? null;
    this.portableDefaultStoryId = this.portableStories.some(
      (story) => story.id === opts.activePortableStoryId,
    )
      ? (opts.activePortableStoryId ?? null)
      : (this.portableStories[0]?.id ?? null);
    this.onPortableStoryApplied = opts.onPortableStoryApplied;
    this.onPortableStoryArgsChanged = opts.onPortableStoryArgsChanged;
    this.activeStoryId = this.portableDefaultStoryId;
    this.capabilities = {
      transform: false, // no 3D gizmo — DOM has no Object3D pose (§1.F)
      inspectorFields: true,
      persist: true,
    };
    // A4 (spec 27 §3) — re-sync the optimistic echo once HMR has actually re-rendered the
    // react tree. Vite fires `vite:afterUpdate` after it applies an HMR update — here, the
    // dev-server source-write this adapter triggered (→ file watcher → react-refresh
    // re-render) — so that event IS the "reload landed" signal (the adapter otherwise never
    // learns about reloads; play-mode.ts owns the component-class HMR handler, not this
    // per-world adapter). Absent under a hosted/no-dev-server build and under vitest's `node`
    // env (no `import.meta.hot`), where the unit test drives `reconcileEchoAfterReload()`
    // directly to simulate a landed reload.
    const hot = import.meta.hot;
    if (hot) {
      const onAfterUpdate = (): void => this.reconcileEchoAfterReload();
      hot.on('vite:afterUpdate', onAfterUpdate);
      this.disposeReloadSignal = () => hot.off('vite:afterUpdate', onAfterUpdate);
    } else {
      // THE HOSTED TIER'S "RELOAD LANDED" SIGNAL. No HMR here: a source write
      // re-projects this root when the story registry re-publishes (the
      // content-write refresh in `project-story-discovery.ts` reloads the
      // story modules the write reached and the board re-renders its
      // frames). That re-projection drops the selection exactly like the
      // HMR one, and with no signal the repair above never ran — measured on
      // production build 57: drag a HUD element on the board, the write
      // lands, and the selection box, hierarchy row and Inspector all go
      // empty until the author clicks again. The registry's publish is the
      // moment to watch.
      const unsubscribe = subscribeProjectStoryModules(() => this.reconcileEchoAfterReload());
      this.disposeReloadSignal = unsubscribe;
    }
    if (this.writeBackend?.index) {
      this.writeBackend
        .index()
        .then((idx) => {
          this.oidIndex = new Map(Object.entries(idx));
          this.store.notifyIngestEdit();
        })
        .catch(() => {
          // Honest degradation: labels stay tag-only if the index can't be fetched.
        });
    }
  }

  private snapshot(): OidTree {
    this.projector.project(this.root);
    return oidTreeFromProjection({
      nodes: this.projector.nodes,
      rootIds: [...this.projector.rootIds],
    });
  }

  /**
   * One coherent tree for a synchronous hierarchy consumer. Composite roots
   * walk every child adapter by calling `node(id)` once per row; projecting the
   * complete DOM on every lookup turns that ordinary walk into O(rows²).
   * Inspector and write paths keep using {@link snapshot} directly, so only
   * hierarchy reads share this task-bounded view and every later task sees the
   * current DOM.
   */
  private hierarchySnapshot(): OidTree {
    this.hierarchySnapshotCache ??= this.snapshot();
    if (!this.hierarchySnapshotClearQueued) {
      this.hierarchySnapshotClearQueued = true;
      queueMicrotask(() => {
        this.hierarchySnapshotCache = null;
        this.hierarchySnapshotClearQueued = false;
      });
    }
    return this.hierarchySnapshotCache;
  }

  private async refreshOidIndex(): Promise<void> {
    const index = await this.writeBackend?.index?.();
    if (!index) return;
    this.oidIndex = new Map(Object.entries(index));
    this.store.notifyIngestEdit();
  }

  // --- A4: optimistic value echo (see {@link valueEcho}) ---

  /** Record the value just committed by `inspector.set`, so `inspector.get(id, path)`
   *  returns it immediately (before the async source-write + HMR land). */
  private setEcho(id: string, path: string, value: unknown): void {
    let byPath = this.valueEcho.get(id);
    if (!byPath) {
      byPath = new Map();
      this.valueEcho.set(id, byPath);
    }
    byPath.set(path, value);
  }

  /** Drop one echoed entry — used the instant a write is refused/no-op'd, so the field
   *  reverts to the live-DOM (unchanged) value rather than sticking on a value the source
   *  never took (the "stale in the other direction" guard for rejected writes). */
  private clearEcho(id: string, path: string): void {
    const byPath = this.valueEcho.get(id);
    if (!byPath) return;
    byPath.delete(path);
    if (byPath.size === 0) this.valueEcho.delete(id);
  }

  /** U4 — record that `id`'s `path` was REFUSED BY A SOURCE GUARD, with the
   *  guard's own sentence, so the NEXT `properties()` call marks its descriptor
   *  `readonly` and shows that sentence. The reason is carried rather than
   *  re-derived because the guards differ: a dynamic `{expression}` and a
   *  `var(--token)` reference are both un-overwritable literals to the writer
   *  and completely different facts to the author. */
  private markGuarded(id: string, path: string, reason: string): void {
    this.guardedPaths.set(`${id}|${path}`, reason);
  }

  /** Read-through for `inspector.get`: `{hit:true}` when this id+path was optimistically
   *  echoed and not yet reconciled; `{hit:false}` otherwise (fall back to the live DOM). A
   *  distinct `hit` flag (not a sentinel value) so a legitimately-`undefined` echoed value
   *  still wins over the live-DOM walk. */
  private readEcho(id: string, path: string): { hit: boolean; value: unknown } {
    const byPath = this.valueEcho.get(id);
    if (byPath?.has(path)) return { hit: true, value: byPath.get(path) };
    return { hit: false, value: undefined };
  }

  /**
   * A4 — the "HMR reload landed" reconcile (fired by the constructor's `vite:afterUpdate`
   * hook, or called directly to simulate a landed reload). The echo held the freshly-set
   * values while the async source-write + HMR re-render were in flight; once HMR has
   * re-rendered the react tree the LIVE DOM is authoritative again — including any
   * server-side value coercion — so drop the whole echo and notify, and every open inspector
   * re-reads the now-updated DOM. (An unrelated module's `afterUpdate` that fires before THIS
   * edit's HMR is a benign race: the field momentarily re-reads the old DOM, then this
   * edit's own `afterUpdate` reconciles it — the echo self-heals on the next tick.)
   *
   * SELECTION IS NOT UNTOUCHED, and this comment used to say it was. The ids ARE
   * OID-signature ids in the store, re-resolvable against the remounted tree — but
   * MEASURED 2026-08-30 the remount empties the edit tab's selection set anyway, ~100-150ms
   * after the update lands, for a remount from ANY source (a hand edit of the file does it
   * with no inspector write involved). {@link scheduleSelectionRepair} is the repair, and
   * its doc comment carries the measurement and what is still unknown about the cause.
   *
   * D3.R4 (reopen fix), widened by D3.R5 — ALSO the "landed" signal for every pending
   * source write counted by {@link pendingSourceReconcile} (see its doc comment for the
   * full site list and the counter-vs-boolean rationale): each of those writes' own
   * `notifyIngestEdit()` fires before the HMR remount lands, so it never carries fresh
   * DOM shape on its own; this reconcile is what does, once the remount has actually
   * happened. Decrements the counter by exactly one per call (never resets it to zero)
   * so N pending writes drain over N reconciles, each one notifying — not just the
   * first.
   */
  reconcileEchoAfterReload(): void {
    // BEFORE the early return: a re-projection triggered by a source edit this
    // adapter did NOT make (a hand edit, another lane's write) has neither an
    // echo nor a pending reconcile, and it drops the selection exactly the
    // same way.
    this.scheduleSelectionRepair();
    if (this.valueEcho.size === 0 && this.pendingSourceReconcile === 0) return;
    this.valueEcho.clear();
    if (this.pendingSourceReconcile > 0) this.pendingSourceReconcile--;
    this.store.notifyIngestEdit();
  }

  /**
   * WATCH ONE RE-PROJECTION for the selection it drops, and put it back.
   *
   * MEASURED 2026-08-30, on a scaffolded project's dom root: any HMR remount
   * of the project's source empties the edit tab's selection set ~100-150ms
   * after the update lands — including a remount triggered by APPENDING A
   * COMMENT to the file, with no inspector write anywhere in the picture. The
   * ids themselves are stable across the remount (the same oid resolves
   * before and after), so nothing about the selection was invalidated; it was
   * simply lost. The reported symptom — a second inspector write "degrading"
   * to `live-only (not saved)`, or throwing "No Inspector subject is active."
   * — is that loss arriving at the write door.
   *
   * Which line empties the set is NOT yet pinned: `select(null)`,
   * `selectMultiple([])` and `applySelectionBeforePresentation([])` were each
   * traced live through a reproduction and NONE of them fires. So this repairs
   * the observable rather than the cause, and says so out loud when it does —
   * a selection that vanishes under an author's cursor is not something to fix
   * quietly.
   *
   * It is deliberately NOT a write QUEUE. Queueing the second write behind the
   * re-projection would not help: the selection is already gone when that
   * write is issued, so a queued write resolves against the same empty
   * subject. The seam that needs repairing is the selection, not the ordering.
   *
   * SELF-LIMITING, three ways: one watcher per re-projection, a bounded window
   * (the measured loss lands inside it), and a repair that only restores ids
   * which STILL RESOLVE in the remounted tree — so it can never fabricate a
   * selection, and never fights a legitimate deselect that happened outside
   * the window.
   */
  private scheduleSelectionRepair(): void {
    if (this.selectionRepairWatching) return;
    if (this.lastResolvedSelection.length === 0) return;
    this.selectionRepairWatching = true;
    let attempts = 0;
    let reported = false;
    const tick = (): void => {
      attempts++;
      // The watcher runs the WHOLE window rather than stopping at the first
      // repair: one edit can produce several update events, and a repair
      // followed by a second remount that drops it again is the shape the
      // measurement showed. It reports once per watch, so a repeat is a
      // restore, not a second wall of console.
      reported = this.repairSelectionAfterReprojection(reported) || reported;
      if (attempts >= SELECTION_REPAIR_ATTEMPTS) {
        this.selectionRepairWatching = false;
        return;
      }
      setTimeout(tick, SELECTION_REPAIR_INTERVAL_MS);
    };
    setTimeout(tick, SELECTION_REPAIR_INTERVAL_MS);
  }

  /**
   * One repair attempt. Returns whether it SAID something, so the watcher can
   * report once and restore as many times as the re-projection needs.
   *
   * The remembered set is NOT consumed: `selection.get` overwrites it with
   * every non-empty selection it serves, so it always names the last selection
   * the author actually had, and a second drop inside the same window is
   * repaired from the same truth.
   */
  private repairSelectionAfterReprojection(alreadyReported: boolean): boolean {
    const remembered = this.lastResolvedSelection;
    if (remembered.length === 0) return false;
    if (this.store.selectedEntityIds.size > 0) return false; // not lost (yet)
    const tree = this.snapshot();
    const alive = remembered.filter((id) => tree.nodes.has(id));
    if (alive.length === 0) {
      if (!alreadyReported) {
        console.warn(
          '[ReactRootAuthoringAdapter] the re-projection dropped the selection ' +
            `(${remembered.join(', ')}) and none of those ids resolve in the remounted tree, so ` +
            'it cannot be restored. An inspector write issued now has no subject — re-select.',
        );
      }
      this.lastResolvedSelection = [];
      return true;
    }
    if (!alreadyReported && !reportedSelectionRepair) {
      reportedSelectionRepair = true;
      console.warn(
        '[ReactRootAuthoringAdapter] OPEN DEFECT, repaired: an HMR re-projection drops this ' +
          "root's selection, and the editor is putting it back — restoring " +
          `${alive.length} of ${remembered.length} id(s) that still resolve in the remounted ` +
          `tree (${alive.join(', ')}). A write issued in that window has no subject. Named once ` +
          'per session; the repair runs on every re-projection.',
      );
    }
    this.store.selectMultiple([...alive]);
    return true;
  }

  /** A4 — release the `vite:afterUpdate` reconcile subscription. Idempotent; safe when no
   *  HMR context was present (the disposer is `undefined`). */
  disposeReactRootAdapter(): void {
    this.disposeReloadSignal?.();
  }

  private componentName(n: OidNode): string | null {
    const entry = this.oidIndex.get(n.oid);
    return entry?.component ?? getReactComponentName(n.el) ?? null;
  }

  private elementLabel(n: OidNode, tree: OidTree): string {
    // Preserve the explicit escape hatch, but make ordinary DOM semantics
    // sufficient by default. Authored React should not need component splits
    // or `data-vgai-name` merely to produce a legible hierarchy.
    const editorLabel = normalizeElementText(n.el.getAttribute('data-vgai-name'));
    if (editorLabel) return editorLabel;

    const labelledBy = n.el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labels = labelledBy
        .split(/\s+/)
        .map((id) =>
          Array.from(tree.nodes.values()).find(
            (candidate) => candidate.el.getAttribute('id') === id,
          ),
        )
        .map((candidate) => normalizeElementText(candidate?.el.textContent))
        .filter((label): label is string => label !== null);
      const combinedLabel = normalizeElementText(labels.join(' '));
      if (combinedLabel) return combinedLabel;
    }

    const accessibleLabel = normalizeElementText(n.el.getAttribute('aria-label'));
    if (accessibleLabel) return accessibleLabel;

    // A semantic section without explicit ARIA normally takes its identity
    // from its heading. Restrict this to direct children so a large nested
    // subtree cannot accidentally lend an unrelated heading to its parent.
    if (['section', 'article', 'aside', 'nav', 'main', 'header', 'footer'].includes(n.tag)) {
      const heading = n.childIds
        .map((id) => tree.nodes.get(id))
        .find((child) => child !== undefined && /^h[1-6]$/.test(child.tag));
      const headingText = normalizeElementText(heading?.el.textContent);
      if (headingText) return headingText;
    }

    // Text-bearing HTML elements are already named by their content in the
    // browser/accessibility model. Use the same identity, with a short cap so
    // a paragraph cannot turn into an unbounded hierarchy row.
    if (
      /^(h[1-6]|p|span|label|button|a|time|output|dt|dd|li|legend|caption|summary)$/.test(n.tag)
    ) {
      const text = normalizeElementText(n.el.textContent);
      if (text) return text;
    }

    for (const attribute of ['alt', 'title', 'placeholder', 'name']) {
      const value = normalizeElementText(n.el.getAttribute(attribute));
      if (value) return value;
    }

    const id = n.el.getAttribute('id');
    if (id) return `#${id}`;
    // A styled anonymous element names itself by its first class — the same
    // identity a stylesheet addresses it by. `.reticle-dot` beats a fifth
    // bare "span" row (blind-walk beat 2: finding the crosshair's dot meant
    // clicking five identical rows and reading W/H off each).
    const firstClass = (n.el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)[0];
    if (firstClass) return `${n.tag}.${firstClass}`;
    return n.tag;
  }

  private toEditorNode(n: OidNode, tree: OidTree = this.snapshot()): EditorNode {
    // A component name marks only the boundary where that component enters the
    // native tree. Descendants owned by the same component use their own DOM
    // identity, avoiding the old `Game2048Page:div` repeated on every row.
    const component = this.componentName(n);
    const parent = n.parentId ? tree.nodes.get(n.parentId) : null;
    const parentComponent = parent ? this.componentName(parent) : null;
    const isComponentBoundary = component !== null && component !== parentComponent;
    const crossSurfaceId = n.el.getAttribute('data-vgai-hierarchy-id');
    const crossSurfaceParentId = n.el.getAttribute('data-vgai-hierarchy-parent-id');
    const crossSurfaceOrderAttribute = n.el.getAttribute('data-vgai-hierarchy-order');
    const crossSurfaceGroupLabel = n.el.getAttribute('data-vgai-hierarchy-group-label');
    const crossSurfaceOrder =
      crossSurfaceOrderAttribute === null ? undefined : Number(crossSurfaceOrderAttribute);
    const node: EditorNode = {
      id: n.id,
      label: isComponentBoundary ? component : this.elementLabel(n, tree),
      ...(isComponentBoundary ? { secondaryLabel: `<${n.tag}>` } : {}),
      role: isComponentBoundary ? 'component' : 'element',
      kind: n.tag,
      parentId: n.parentId,
      childIds: n.childIds,
      ...(crossSurfaceId === null ? {} : { crossSurfaceId }),
      ...(crossSurfaceParentId === null ? {} : { crossSurfaceParentId }),
      ...(crossSurfaceOrder === undefined || !Number.isInteger(crossSurfaceOrder)
        ? {}
        : { crossSurfaceOrder }),
      ...(crossSurfaceGroupLabel === null ? {} : { crossSurfaceGroupLabel }),
    };
    if (this.portableStories.length > 0 && node.parentId === null) {
      return { ...node, parentId: this.activeStoryId };
    }
    return node;
  }

  /** Exact DOM-native input signature for the composite's semantic join.
   * Shell notifications unrelated to this root leave it unchanged. The
   * nearest semantic ancestor and traversal order are included because
   * transparent DOM wrappers fold between explicitly identified rows. */
  private crossSurfaceStructureSignature(): string | null {
    const tree = this.hierarchySnapshot();
    const semanticIds = new Set<string>();
    for (const node of tree.nodes.values()) {
      if (
        node.el.getAttribute('data-vgai-hierarchy-id') !== null ||
        node.el.getAttribute('data-vgai-hierarchy-parent-id') !== null ||
        node.el.getAttribute('data-vgai-hierarchy-order') !== null ||
        node.el.getAttribute('data-vgai-hierarchy-group-label') !== null
      ) {
        semanticIds.add(node.id);
      }
    }
    if (semanticIds.size === 0) return null;
    return JSON.stringify(
      [...tree.nodes.values()].flatMap((node) => {
        if (!semanticIds.has(node.id)) return [];
        let parentId = node.parentId;
        while (parentId !== null && !semanticIds.has(parentId)) {
          parentId = tree.nodes.get(parentId)?.parentId ?? null;
        }
        return [
          [
            node.id,
            parentId,
            node.el.getAttribute('data-vgai-hierarchy-id'),
            node.el.getAttribute('data-vgai-hierarchy-parent-id'),
            node.el.getAttribute('data-vgai-hierarchy-order'),
            node.el.getAttribute('data-vgai-hierarchy-group-label'),
          ],
        ];
      }),
    );
  }

  private portableDocumentNode(document: (typeof this.portableDocuments)[number]): EditorNode {
    return {
      id: document.id,
      label: document.label,
      ...(document.path ? { secondaryLabel: document.path } : {}),
      role: 'document',
      kind: 'tsx',
      parentId: null,
      childIds: [...document.storyIds],
    };
  }

  private portableDocumentForStory(storyId: string) {
    return this.portableDocuments.find((document) => document.storyIds.includes(storyId)) ?? null;
  }

  private portableHierarchyNode(id: string) {
    return this.portableHierarchy?.nodes.find((node) => node.id === id) ?? null;
  }

  private portableStoriesForNode(nodeId: string): StoryRef[] {
    // The empty id is NOT a node — it is the world-level question
    // ({@link WORLD_SCOPE_NODE_ID}), and this provider's answer to it is its
    // whole list, because its WRITES are world-level: `active`/`apply` ignore
    // the node id, so applying any story remounts the whole react root. Left to
    // the per-node path below it fell into the "unrecognized node" branch and
    // answered whatever the ACTIVE story's component owns — a scope answer that
    // changed with UI state, so the shell's probe classified this adapter
    // differently depending on what was mounted.
    if (nodeId === WORLD_SCOPE_NODE_ID) return [...this.portableStories];
    if (!this.portableHierarchy) return [...this.portableStories];
    const hierarchyNode = this.portableHierarchyNode(nodeId);
    if (hierarchyNode && hierarchyNode.role !== 'component') return [];
    const componentId =
      hierarchyNode?.role === 'component'
        ? hierarchyNode.id
        : (this.portableHierarchy.storyParentIds.get(nodeId) ??
          this.portableHierarchy.storyParentIds.get(this.activeStoryId ?? ''));
    if (!componentId) return [];
    const component = this.portableHierarchyNode(componentId);
    const storyIds = new Set(component?.childIds ?? []);
    return this.portableStories.filter((story) => storyIds.has(story.id));
  }

  private portableStoryNode(story: StoryRef, rootIds: string[]): EditorNode {
    const active = story.id === this.activeStoryId;
    return {
      id: story.id,
      label: story.label,
      role: 'story',
      kind: 'story',
      parentId:
        this.portableHierarchy?.storyParentIds.get(story.id) ??
        this.portableDocumentForStory(story.id)?.id ??
        PORTABLE_DOCUMENT_ID,
      childIds: active ? rootIds : [],
    };
  }

  readonly hierarchy: HierarchyProvider = {
    crossSurfaceStructureSignature: () => this.crossSurfaceStructureSignature(),
    roots: () => {
      const tree = this.hierarchySnapshot();
      const { nodes, rootIds } = tree;
      if (this.portableStories.length > 0) {
        if (this.portableHierarchy) {
          return this.portableHierarchy.rootIds.flatMap((id) => {
            const node = this.portableHierarchy?.nodes.find((candidate) => candidate.id === id);
            return node ? [{ ...node, childIds: [...node.childIds] }] : [];
          });
        }
        return this.portableDocuments.map((document) => this.portableDocumentNode(document));
      }
      return rootIds.map((id) => this.toEditorNode(nodes.get(id)!, tree));
    },
    node: (id) => {
      if (this.portableStories.length > 0) {
        const hierarchyNode = this.portableHierarchy?.nodes.find(
          (candidate) => candidate.id === id,
        );
        if (hierarchyNode) return { ...hierarchyNode, childIds: [...hierarchyNode.childIds] };
        const document = this.portableDocuments.find((candidate) => candidate.id === id);
        if (document) return this.portableDocumentNode(document);
        const story = this.portableStories.find((candidate) => candidate.id === id);
        if (story) return this.portableStoryNode(story, this.hierarchySnapshot().rootIds);
      }
      const tree = this.hierarchySnapshot();
      const n = tree.nodes.get(id);
      return n ? this.toEditorNode(n, tree) : null;
    },
    // No `object3D`/`idForObject3D`: react entities are DOM, not Object3D —
    // the concept does not apply here (no 3D gizmo binding).
  };

  readonly selection: SelectionProvider = {
    get: () => {
      const ids = [...this.store.selectedEntityIds];
      // Remember the last NON-EMPTY selection so a re-projection that drops it
      // can be repaired — see `repairSelectionAfterReprojection`. Recorded on
      // the read because that is the one call every projection of the
      // selection already makes; the adapter has no store subscription of its
      // own and adding one to observe a value it is handed anyway would be a
      // second source of the same fact.
      if (ids.length > 0) this.lastResolvedSelection = ids;
      return ids;
    },
    set: (ids) => this.store.selectMultiple(ids),
    resolve: (rawId, options) => {
      const raw = this.hierarchy.node(rawId);
      if (!raw) return null;

      const innerToOuter: EditorNode[] = [];
      let cursor: EditorNode | null = raw;
      let guard = 0;
      while (cursor && guard++ < 1000) {
        if (
          cursor.role === 'component' ||
          cursor.role === 'instance' ||
          cursor.role === 'boundary'
        ) {
          innerToOuter.push(cursor);
        }
        cursor = cursor.parentId ? this.hierarchy.node(cursor.parentId) : null;
      }
      const chain = innerToOuter.reverse();
      if (chain.length === 0) {
        return { id: rawId };
      }

      const scopeIndex = options?.scopeId
        ? chain.findIndex((candidate) => candidate.id === options.scopeId)
        : -1;
      let resolvedIndex = scopeIndex >= 0 ? scopeIndex + 1 : 0;
      if (options?.intent === 'deep') resolvedIndex += 1;

      // Unlike the R3F projection, React keeps authored host elements in the
      // hierarchy. Once every component boundary on the route is open, the
      // exact DOM element becomes the honest selection subject.
      const subject = chain[resolvedIndex] ?? raw;
      return { id: subject.id };
    },
  };

  readonly truth: TruthProvider = {
    resolve: (id): { site: NodeCreationSite; writeAnchorKind: WriteAnchorKind | undefined } => {
      const node = this.snapshot().nodes.get(id);
      if (!node) {
        return {
          site: { anchored: false, reason: 'This row is a design document, not a JSX element.' },
          writeAnchorKind: undefined,
        };
      }
      const entry = this.oidIndex.get(node.oid);
      const writeAnchorKind = this.writeBackend ? 'source-prop' : 'live-only';
      if (!entry) {
        return {
          site: { anchored: false, reason: 'Source metadata is still loading or unavailable.' },
          writeAnchorKind,
        };
      }
      const file = projectSourcePath(entry.file);
      return {
        site: {
          anchored: true,
          kind: 'source',
          file,
          line: entry.line,
          col: entry.col,
          display: `${file}:${entry.line}`,
        },
        writeAnchorKind,
      };
    },
  };

  readonly related: RelatedSubjectsProvider = {
    links: (id) => {
      const node = this.hierarchy.node(id);
      if (node?.role !== 'component' || this.stories.storiesFor(id).length === 0) return [];
      return [
        {
          // `definition:` marks this as the subject's OPEN-FOR-EDIT target (the
          // component's own UI Components document), so the inspector surfaces it
          // as the labeled Edit button by kind, never by list position.
          id: `definition:${UI_COMPONENTS_DOCUMENT_ID}`,
          title: 'Open in UI Components',
          open: () => {
            void activateWorkspaceDocument(UI_COMPONENTS_DOCUMENT_ID);
          },
        },
      ];
    },
  };

  private instanceSource(id: string): {
    node: OidNode;
    callSiteOid: string;
    callSite: OidEntry;
    props: Record<string, string>;
  } | null {
    const node = this.snapshot().nodes.get(id);
    if (!node || this.hierarchy.node(id)?.role !== 'component') return null;
    const component = getComponentProps(node.el);
    if (!component) return null;
    const callSite = this.oidIndex.get(component.callSiteOid);
    if (!callSite || !/^[A-Z]/.test(callSite.tag)) return null;
    return {
      node,
      callSiteOid: component.callSiteOid,
      callSite,
      props: component.props,
    };
  }

  private instanceProp(
    id: string,
    path: string,
  ): {
    source: NonNullable<ReturnType<ReactRootAuthoringAdapter['instanceSource']>>;
    prop: string;
    spec: ComponentPropSpec;
    authored: NonNullable<OidEntry['authoredProps']>[number];
  } | null {
    if (!path.startsWith(PROP_PATH_PREFIX)) return null;
    const source = this.instanceSource(id);
    if (!source) return null;
    const prop = path.slice(PROP_PATH_PREFIX.length);
    const spec = source.callSite.props?.find((candidate) => candidate.name === prop);
    const authored = source.callSite.authoredProps?.find((candidate) => candidate.name === prop);
    return spec && authored ? { source, prop, spec, authored } : null;
  }

  private affectedInstances(id: string, prop: string): number {
    const selected = this.instanceSource(id);
    if (!selected) return 0;
    let count = 0;
    for (const candidate of this.snapshot().nodes.values()) {
      const component = getComponentProps(candidate.el);
      if (!component) continue;
      const entry = this.oidIndex.get(component.callSiteOid);
      if (!entry || entry.tag !== selected.callSite.tag) continue;
      if (candidate.id === id || !entry.authoredProps?.some((item) => item.name === prop)) count++;
    }
    return Math.max(1, count);
  }

  readonly instances: ComponentInstancesProvider = {
    openComponent: () => {
      void activateWorkspaceDocument(UI_COMPONENTS_DOCUMENT_ID);
    },
    describe: (id) => {
      const source = this.instanceSource(id);
      if (!source || this.stories.storiesFor(id).length === 0) return null;
      const overrides = Object.entries(source.props).flatMap(([prop, value]) => {
        const path = `${PROP_PATH_PREFIX}${prop}`;
        const detail = this.instanceProp(id, path);
        if (!detail) return [];
        const canApplyToComponent =
          detail.authored.literal &&
          detail.spec.defaultValue !== undefined &&
          source.node.oid !== source.callSiteOid &&
          !!this.writeBackend?.runGesture &&
          !!this.writeBackend.writeComponentDefault &&
          !!this.writeBackend.removeProp;
        return [
          {
            path,
            label: prop,
            value,
            ...(detail.spec.defaultText === undefined
              ? {}
              : { defaultText: detail.spec.defaultText }),
            canApplyToComponent,
            affectedInstanceCount: this.affectedInstances(id, prop),
            ...(canApplyToComponent
              ? {}
              : {
                  applyUnavailableReason: !detail.authored.literal
                    ? 'The callsite value is a dynamic expression, so it cannot become a component literal.'
                    : detail.spec.defaultValue === undefined
                      ? 'The component default is computed or absent, so source cannot be changed safely.'
                      : 'This session cannot atomically update the component and its callsite.',
                }),
          },
        ];
      });
      return {
        componentName: source.callSite.tag,
        sourcePath: projectSourcePath(source.callSite.file),
        overrides,
      };
    },
    revert: async (id, paths) => {
      const source = this.instanceSource(id);
      const backend = this.writeBackend;
      if (!source || !backend?.removeProp) return;
      const props = paths
        .map((path) => this.instanceProp(id, path)?.prop)
        .filter((prop): prop is string => !!prop);
      let changed = false;
      const remove = async (selected: SourceWriteBackend): Promise<void> => {
        for (const prop of props) {
          const result = await selected.removeProp?.(source.callSiteOid, prop);
          changed ||= result?.changed === true;
        }
      };
      if (props.length > 1 && backend.runGesture) {
        await backend.runGesture(`Revert ${props.length} Overrides`, remove);
      } else {
        await remove(backend);
      }
      if (!changed) return;
      this.dirty = true;
      this.pendingSourceReconcile++;
      await this.refreshOidIndex();
      return { destination: JSX_SOURCE_DESTINATION, persisted: true };
    },
    applyToComponent: async (id, path): Promise<ComponentInstanceApplyResult> => {
      const detail = this.instanceProp(id, path);
      const backend = this.writeBackend;
      if (
        !detail ||
        !detail.authored.literal ||
        detail.spec.defaultValue === undefined ||
        detail.source.node.oid === detail.source.callSiteOid ||
        !backend?.runGesture ||
        !backend.writeComponentDefault ||
        !backend.removeProp
      ) {
        return {
          changed: false,
          message: 'Apply was refused because both literal source writes are not available.',
        };
      }
      const value = detail.source.props[detail.prop];
      await backend.runGesture(
        `Apply ${detail.prop} to ${detail.source.callSite.tag}`,
        async (scoped) => {
          const applied = await scoped.writeComponentDefault?.(
            detail.source.node.oid,
            detail.prop,
            serializedComponentValue(value, detail.spec),
          );
          if (!applied?.changed) {
            throw new Error(applied?.error ?? 'The component default did not change.');
          }
          const reverted = await scoped.removeProp?.(detail.source.callSiteOid, detail.prop);
          if (!reverted?.changed) {
            throw new Error(reverted?.error ?? 'The callsite override was not removed.');
          }
        },
      );
      this.dirty = true;
      this.pendingSourceReconcile++;
      await this.refreshOidIndex();
      return {
        changed: true,
        message: `${detail.prop} now defaults to ${String(value)} in ${detail.source.callSite.tag}.`,
        write: { destination: JSX_SOURCE_DESTINATION, persisted: true },
      };
    },
  };

  /**
   * D12 (B4) — GEOMETRIC rect hit-test over the live OID tree, NOT
   * `document.elementFromPoint` (which SKIPS a `pointer-events:none` wrapper —
   * this layer's resting CSS state at design time, `design-time-layers.ts`'s
   * `applySessionStyle`). Reuses `ui-editor/react-store.ts`'s established
   * `hitTestAttr` ranking rule (smallest-area element containing the point
   * wins — the deepest/most-specific node; ties broken by later tree-walk
   * order — the topmost) over each OID node's own `getBoundingClientRect()`,
   * inlined here rather than sharing that function directly since this walks
   * `OidNode`s already resolved by `walkOidTree`, not a live `querySelectorAll`
   * over a DOM attribute string.
   *
   * An element that EXPLICITLY opts out with inline `pointer-events:none` is
   * skipped. The design-time host itself is `pointer-events:none`, so checking
   * computed style would incorrectly inherit that host policy into every
   * authorable descendant. Reading the node's own declaration instead preserves
   * click-to-author descendants while making an authored full-viewport
   * click-through wrapper behave as click-through here too.
   *
   * The winning id is the SAME disambiguated id `hierarchy`/`selection`
   * already use (this IS `walkOidTree`'s own id space) — a hit routes
   * straight into `composite.selection.set([id])` with no translation. A
   * catalog node (`catalog:<key>`) has no DOM element behind it at all, so it
   * can never be a candidate here — only ordinary OID nodes are walked
   * (correct: nothing on screen corresponds to a bare catalog entry).
   */
  readonly pickable: PickProvider = {
    pick: (clientX, clientY) => {
      const { nodes } = this.snapshot();
      let bestId: string | null = null;
      let bestArea = Number.POSITIVE_INFINITY;
      let bestOrder = -1;
      let order = -1;
      for (const node of nodes.values()) {
        order++;
        // D4.R1 — a locked node is SKIPPED, not returned: exactly the
        // `viewport-raycast.ts` first-party semantics ("skip locked
        // entities in viewport selection", falling through to whatever
        // unlocked node is behind/around it). See `lockedIds`'s doc
        // comment for why this Set, not a real inspector-backed field.
        if (this.lockedIds.has(node.id)) continue;
        if (styleProp(node.el.style, 'pointerEvents') === 'none') continue;
        const rect = node.el.getBoundingClientRect?.();
        if (!rect) continue; // no live rect (test fixture, or unmounted) — never a candidate
        if (
          clientX < rect.left ||
          clientX > rect.right ||
          clientY < rect.top ||
          clientY > rect.bottom
        ) {
          continue;
        }
        const area = rect.width * rect.height;
        // smallest-area (deepest) wins; ties broken by later tree-order (topmost)
        if (area < bestArea || (area === bestArea && order > bestOrder)) {
          bestId = node.id;
          bestArea = area;
          bestOrder = order;
        }
      }
      return bestId;
    },
  };

  /** Host rect to subtract for {@link rects}' HOST-RELATIVE geometry — `this.root`
   *  IS the world's own mounted DOM layer (`world.mounted.container` / the ingest
   *  sibling's `layer`, see the constructor call sites), i.e. exactly the
   *  `position:absolute; inset:0` per-world surface the overlay (Phase A3) is
   *  itself hosted over. No new constructor option is needed — reusing the
   *  proven `react-store.ts` `nodeRect` pattern (element rect minus stage/host
   *  rect) against the field this adapter already holds. */
  private hostRect(): { left: number; top: number } {
    const r = this.root.getBoundingClientRect?.();
    return { left: r?.left ?? 0, top: r?.top ?? 0 };
  }

  private toHostRelative(r: {
    left: number;
    top: number;
    width: number;
    height: number;
  }): DOMRectLike {
    const host = this.hostRect();
    const zoom = getRootPan().zoom;
    return {
      x: (r.left - host.left) / zoom,
      y: (r.top - host.top) / zoom,
      width: r.width / zoom,
      height: r.height / zoom,
    };
  }

  /**
   * T0 (spec 27 §2) — per-node screen geometry for the DOM visual editor's
   * overlay/snap/measure math. `rect`/`contextRects` return HOST-RELATIVE
   * coordinates (see {@link hostRect}'s doc comment) — the overlay this feeds
   * (Phase A3, `RootSelectionOverlay`) is itself mounted as a
   * `position:absolute; inset:0` layer over the same per-world DOM host, so a
   * host-relative rect is exactly what it can draw against with no further
   * translation (matching the established `ui-editor/react-store.ts`
   * `nodeRect` pattern this reuses).
   */
  readonly rects: RectProvider = {
    rect: (id) => {
      const n = this.snapshot().nodes.get(id);
      const r = n?.el.getBoundingClientRect?.();
      return r ? this.toHostRelative(r) : null;
    },
    contextRects: (id) => {
      const { nodes } = this.snapshot();
      const n = nodes.get(id);
      if (!n) return {};
      const parentNode = n.parentId ? nodes.get(n.parentId) : undefined;
      const parentRect = parentNode?.el.getBoundingClientRect?.();
      const siblingIds = (parentNode ? parentNode.childIds : this.snapshot().rootIds).filter(
        (sid) => sid !== id,
      );
      const siblings = siblingIds
        .map((sid) => nodes.get(sid)?.el.getBoundingClientRect?.())
        .filter((r): r is NonNullable<typeof r> => r != null)
        .map((r) => this.toHostRelative(r));
      // Padding box (CSS box model, inside the border) — border widths read off
      // the same computed-style resolver the inspector uses; absent/unparsable
      // border widths degrade to 0 (padding box === border box), never thrown.
      const el = n.el;
      const rect = el.getBoundingClientRect?.();
      let paddingBox: DOMRectLike | undefined;
      if (rect) {
        const bt =
          numericStyleValue(getComputedStyleValue(el, 'borderTopWidth', this.computedStyle)) ?? 0;
        const br =
          numericStyleValue(getComputedStyleValue(el, 'borderRightWidth', this.computedStyle)) ?? 0;
        const bb =
          numericStyleValue(getComputedStyleValue(el, 'borderBottomWidth', this.computedStyle)) ??
          0;
        const bl =
          numericStyleValue(getComputedStyleValue(el, 'borderLeftWidth', this.computedStyle)) ?? 0;
        paddingBox = this.toHostRelative({
          left: rect.left + bl,
          top: rect.top + bt,
          width: Math.max(0, rect.width - bl - br),
          height: Math.max(0, rect.height - bt - bb),
        });
      }
      // Persistent board guides (board-guides.ts), converted from client
      // space into the same host-relative units as every rect above.
      const guideClients = guideClientEdges();
      const host = this.hostRect();
      const zoom = getRootPan().zoom;
      const guideEdges =
        guideClients.x.length > 0 || guideClients.y.length > 0
          ? {
              x: guideClients.x.map((cx) => (cx - host.left) / zoom),
              y: guideClients.y.map((cy) => (cy - host.top) / zoom),
            }
          : undefined;
      return {
        ...(parentRect ? { parent: this.toHostRelative(parentRect) } : {}),
        ...(siblings.length ? { siblings } : {}),
        ...(paddingBox ? { paddingBox } : {}),
        ...(guideEdges ? { guideEdges } : {}),
      };
    },
    // D3.c (spec 27 §6) — every currently-empty OID container: no visible
    // (OID or non-OID) child ELEMENT, no text, feeding the pure
    // `findEmptyContainers` math (`ui-source/inspect.ts:463`) unchanged. Rule
    // zero stays intact — the DOM READ happens HERE, in the adapter; the
    // overlay/shell only ever sees the already-filtered `{id, rect,
    // displayName}` result.
    emptyContainers: () => {
      const { nodes } = this.snapshot();
      const candidates: EmptyCandidate[] = [];
      for (const n of nodes.values()) {
        const r = n.el.getBoundingClientRect?.();
        if (!r || !canContainDomChildren(n.el, n.tag)) continue;
        candidates.push({
          oid: n.id,
          rect: this.toHostRelative(r),
          displayName: n.tag,
          hasVisibleChildren: n.el.children.length > 0,
          hasText: (n.el.textContent ?? '').trim().length > 0,
        });
      }
      return findEmptyContainers(candidates).map((c) => ({
        id: c.oid,
        rect: c.rect,
        displayName: c.displayName,
      }));
    },
  };

  /**
   * D3.d (spec 27 §6) — the eyedropper FALLBACK color-sample path: pick the
   * topmost OID node at the point (reusing this adapter's OWN `pickable.pick`,
   * never `elementFromPoint`), then walk its ancestor chain collecting each
   * node's RAW (un-normalized) computed `background-color` — hit-element
   * first, matching `effectiveColorFromChain`'s expected order. Raw, not
   * `cssColorToHex`-normalized, so a `transparent`/`rgba(0,0,0,0)` background
   * is recognizable as such by `isTransparentBackground` (the hex form would
   * lose that signal — see the contract's own doc comment on
   * `ColorSampleProvider`).
   */
  readonly colorSample: ColorSampleProvider = {
    backgroundChainAt: (clientX, clientY) => {
      const hitId = this.pickable.pick(clientX, clientY);
      if (!hitId) return null;
      const { nodes } = this.snapshot();
      const chain: string[] = [];
      let cur: OidNode | undefined = nodes.get(hitId);
      while (cur) {
        chain.push(getComputedStyleValue(cur.el, 'backgroundColor', this.computedStyle));
        cur = cur.parentId ? nodes.get(cur.parentId) : undefined;
      }
      return chain;
    },
  };

  /**
   * T0 (spec 27 §4, B1) — spatial drag-resize/move/spacing → source write, for
   * non-Object3D (DOM) nodes. `apply` is LIVE PREVIEW ONLY: it mutates the live
   * element's inline style directly, with ZERO backend traffic (acceptance:311 —
   * a resize drag must not spam the dev server with a write per frame). `end`
   * commits every touched prop ONCE through the existing {@link writeStyleEntry}
   * write pipeline (CSS-file routing + append-aware undo preserved unchanged),
   * composed into exactly ONE undo entry per gesture (acceptance:310) even when
   * the gesture touched multiple props (e.g. a corner-resize writes both `width`
   * and `height`). See {@link boxEditSession}'s doc comment for the
   * `priorInline` capture this depends on for a correct undo inverse.
   */
  readonly boxEdit: BoxEditProvider = {
    begin: (id) => {
      // A stale, never-`end`ed session (caller bug) is simply replaced — its
      // preview mutations are already live on the DOM either way.
      this.boxEditSession = { id, touched: new Map(), priorInline: new Map() };
    },
    apply: (id, patch) => {
      const session = this.boxEditSession;
      if (!session || session.id !== id) return; // no open gesture for this id
      const n = this.snapshot().nodes.get(id);
      if (!n) return; // unresolved id — no-op (per contract)
      const pos = getComputedStyleValue(n.el, 'position', this.computedStyle);
      const isPositioned = pos === 'absolute' || pos === 'fixed';
      for (const [key, v] of Object.entries(patch)) {
        const mapped = mapBoxEditPatchKey(key, isPositioned);
        if (!mapped) {
          console.warn(
            `[ReactRootAuthoringAdapter] boxEdit: dropping patch key "${key}" for "${id}" — ` +
              (key === 'x' || key === 'y'
                ? `node is not absolutely/fixed positioned (computed position: "${pos}"), ` +
                  'no left/top to move'
                : 'unrecognized box-edit patch key'),
          );
          // SAY IT WHERE THE HAND IS. A drag on a flow-positioned element
          // writes nothing — the board moves only absolutely/fixed positioned
          // nodes (spec:322) — and the console line above was the only
          // account of it: "I can't move this" was a tester's verdict on the
          // health bar (runhuman pass 133). Once per gesture.
          if ((key === 'x' || key === 'y') && !session.hinted) {
            session.hinted = true;
            showTransientHint(
              `${n.tag} flows in its layout (position: ${pos}), so a drag ` +
                'cannot move it. Set Position to "abs" in the Inspector to place it freely; ' +
                'drag a handle to resize.',
            );
          }
          continue;
        }
        // Lazily snapshot the TRUE pre-gesture inline value the first time THIS
        // prop is touched in this gesture — before mutating it — see
        // `boxEditSession`'s doc comment for why this can't be re-derived later.
        if (!session.priorInline.has(mapped.prop)) {
          const prevRaw = styleProp(n.el.style, mapped.prop);
          session.priorInline.set(mapped.prop, prevRaw == null ? '' : String(prevRaw));
        }
        // x/y arrive HOST-RELATIVE (the rect provider's space), but CSS
        // left/top are OFFSET-PARENT-relative. They only coincide when the
        // offset parent sits at the host origin — which a story-frame child
        // never does, so a board drag used to write BOARD coordinates into
        // the element's source (left:'2968px' on a 1280-wide frame; found by
        // the blind walk, the element vanished outside its own frame).
        // parentOrigin = rect − offsetLeft is constant through the gesture
        // (both shift together as we mutate), and an element positioned via
        // translate() cancels exactly: rect includes the transform, so the
        // written left lands the VISUAL box at the requested position.
        let write = v;
        if ((key === 'x' || key === 'y') && typeof v === 'number') {
          const el = n.el as unknown as {
            getBoundingClientRect?: () => {
              left: number;
              top: number;
              width: number;
              height: number;
            };
            offsetLeft?: number;
            offsetTop?: number;
          };
          const rect = el.getBoundingClientRect?.();
          if (rect && typeof el.offsetLeft === 'number' && typeof el.offsetTop === 'number') {
            const hostRel = this.toHostRelative(rect);
            const parentOrigin = key === 'x' ? hostRel.x - el.offsetLeft : hostRel.y - el.offsetTop;
            // Whole-pixel, like every other gesture write (see the spacing
            // scrub's own doc comment): the patch is grid/edge-snapped, but
            // edge targets and this origin are MEASURED (rect ÷ zoom), so
            // without rounding a 65%-zoom drag authors `left:
            // '215.00005607057415px'` — measurement noise, not intent.
            write = Math.round(v - parentOrigin);
          }
        }
        const cssValue = mapped.cssValue(write);
        if (n.el.style) (n.el.style as Record<string, unknown>)[mapped.prop] = cssValue;
        // Commit numerics as plain numbers (matching every other numeric style
        // write in this adapter — see `writeStyle`'s callers), transform as a
        // string — NOT the px-suffixed preview string, which is preview-only.
        session.touched.set(mapped.prop, mapped.prop === 'transform' ? cssValue : write);
      }
    },
    end: (id) => {
      const session = this.boxEditSession;
      this.boxEditSession = null;
      if (!session || session.id !== id || session.touched.size === 0) return;
      // Queue behind any still-running commit — see `boxEditTail`. A failed
      // commit must not poison the chain for every later gesture, so the tail
      // absorbs the rejection (commitBoxEdit reports its own failures).
      this.boxEditTail = this.boxEditTail.then(
        () => this.commitBoxEdit(id, session.touched, session.priorInline),
        () => this.commitBoxEdit(id, session.touched, session.priorInline),
      );
      void this.boxEditTail.catch((error) => {
        console.error('[ReactRootAuthoringAdapter] box edit failed and was not committed.', error);
      });
    },
  };

  /**
   * T0 (spec 27 §4, B1) — commit every prop touched by one `boxEdit` gesture, each
   * through {@link writeStyleEntry} (so CSS-file routing / append-aware undo are
   * unchanged), then compose all resulting entries into exactly ONE undo entry
   * (acceptance:310) whose inverse runs in REVERSE order and whose redo runs in
   * gesture order — mirroring how a multi-statement edit undoes as one unit
   * elsewhere in this adapter.
   */
  private async commitBoxEdit(
    id: string,
    touched: Map<string, string | number>,
    priorInline: Map<string, string>,
  ): Promise<void> {
    const wasDirty = this.dirty;
    // A4 — echo every touched prop BEFORE any write, so the inspector field shows
    // the dragged value at once (same discipline as `inspector.set`). The echo holds
    // the BARE numeric (a `type:'number'` descriptor's `Inspector` field needs an
    // actual number — see `inspector.get`'s `numericStyleValue` note), NOT the
    // px-suffixed source form D1 writes below.
    for (const [prop, value] of touched) {
      this.setEcho(id, `${STYLE_PATH_PREFIX}${prop}`, value);
    }
    // A GESTURE THAT WROTE NOTHING SAYS SO. Every refusal below only warned in
    // the browser console, so a drag whose commit was refused looked done —
    // the element sat where the hand left it (live preview), the history had
    // an "Edit 2 Styles" entry to undo, and undo reverted nothing because
    // nothing had been written; a normal reload then showed the element back
    // where it was (runhuman passes 135/137/138/140, all on Windows Chrome —
    // the macOS instrument writes and undoes the same gesture cleanly). The
    // refusal is now an editor-console ERROR and a hint, naming the reason.
    let applied = 0;
    this.lastStyleWriteRefusal = null;
    const commit = async (backend: SourceWriteBackend | undefined): Promise<void> => {
      for (const [prop, value] of touched) {
        // D1 (spec 27 §4 B2/B3 reload-safety) — a numeric length-prop value must
        // persist to JSX SOURCE in a form React honors on REMOUNT. React 19 DROPS a
        // bare UNITLESS numeric STRING (the writer quotes `String(152)` → `width:
        // '152'`) on reload — the element collapses to content size (verified in real
        // Chromium + React 19) — but HONORS a quoted CSS length (`width: '152px'`).
        // `boxEdit.apply` stores length props as bare NUMBERS and CSS-string props
        // (`transform` → `'rotate(90deg)'`) as strings, so a numeric value here is
        // EXACTLY the set of length props (width/height/left/top/margin*/padding*)
        // needing a `px` unit — suffix only those, leaving `transform` untouched.
        // (The live-preview `el.style` path already applied a px-suffixed string via
        // `mapBoxEditPatchKey.cssValue`; only the persisted-source form was unitless.)
        // Localized to this box-edit commit — the color/`inspector.set` write path is
        // deliberately NOT changed.
        const writeValue = typeof value === 'number' ? `${value}px` : value;
        if (await this.writeStyleEntry(id, prop, writeValue, priorInline.get(prop), backend)) {
          applied += 1;
        }
      }
      if (applied === 0 && touched.size > 0) {
        const reason = this.lastStyleWriteRefusal ?? 'the write was refused without a reason';
        editorConsole.error(`The last edit on this element was NOT saved — ${reason}`, 'authoring');
        showTransientHint('Not saved: the edit could not be written to source — see the Console.');
      }
    };
    // The history-managed backend supplies an explicit scoped writer. Holding
    // the callback as one queue entry makes the gesture failure-atomic and
    // prevents unrelated inspector writes from being absorbed/interleaved.
    try {
      if (this.writeBackend?.runGesture) {
        await this.writeBackend.runGesture(`Edit ${touched.size} Styles`, commit);
      } else {
        await commit(this.writeBackend);
      }
    } catch (error) {
      const node = this.snapshot().nodes.get(id);
      for (const [prop, prior] of priorInline) {
        this.clearEcho(id, `${STYLE_PATH_PREFIX}${prop}`);
        if (node?.el.style) (node.el.style as Record<string, unknown>)[prop] = prior;
      }
      this.dirty = wasDirty;
      this.store.notifyIngestEdit();
      throw error;
    }
  }

  /**
   * T0 (spec 27 §2) — brings the react adapter's existing off-contract `editText`
   * (below) onto the contract. `get` is a best-effort CLIENT-side read: the live
   * DOM can only rule out "has child elements" (`el.children.length > 0`), not a
   * dynamic `{expression}` body — that guard is source-side and already enforced
   * at write time (`editText`'s `res.dynamic`, surfaced as a loud console warning
   * on refusal). `set` fires the existing undo-tracked write path unchanged.
   */
  readonly text: TextProvider = {
    get: (id) => {
      // D3.R1 — a node already refused once as a dynamic-body text edit
      // (`markGuarded(id, TEXT_PATH)`, set from `editText`'s `res.dynamic`
      // refusal below) reports null from here on this session, mirroring
      // U4's style/prop after-touch marker — so a SECOND double-click reports
      // the refusal immediately instead of re-opening the textarea only to
      // have the source refuse it again.
      if (this.guardedPaths.has(`${id}|${TEXT_PATH}`)) return null;
      const n = this.snapshot().nodes.get(id);
      if (!n || n.el.children.length > 0) return null;
      const raw = n.el.textContent;
      if (raw == null) return null;
      const trimmed = raw.trim();
      return trimmed ? trimmed : null;
    },
    set: (id, text) => {
      void this.editText(id, text);
    },
  };

  readonly inspector: InspectorProvider = {
    properties: (id: string): PropertyDescriptor[] => {
      const portableHierarchyNode = this.portableHierarchyNode(id);
      if (portableHierarchyNode) {
        return portableHierarchyNode.secondaryLabel
          ? [
              {
                path: 'document.path',
                label: 'Source',
                type: 'string',
                readonly: true,
                group: 'Document',
              },
            ]
          : [];
      }
      const portableDocument = this.portableDocuments.find((document) => document.id === id);
      if (portableDocument) {
        return portableDocument.path
          ? [
              {
                path: 'document.path',
                label: 'Source',
                type: 'string',
                readonly: true,
                group: 'Document',
              },
            ]
          : [];
      }
      if (this.portableStories.some((story) => story.id === id))
        return this.portableStoryArgDescriptors(id);
      const style = STYLE_PROPERTIES.map(({ prop, label, type, group, options }) => ({
        path: `${STYLE_PATH_PREFIX}${prop}`,
        label,
        type,
        group,
        ...(options ? { options } : {}),
      }));
      // Cap 4 (React visual-edit parity): append a "Props" section for this node's component
      // call site — its editable primitive props, read live off the React fiber
      // (`getComponentProps`). A write is guarded server-side (a dynamic prop is refused),
      // so surfacing every primitive prop here is safe. Cap 7 appends a read-only "Tokens"
      // section — the document's design tokens (`:root` custom properties).
      const all = [...style, ...this.propDescriptors(id), ...this.tokenDescriptors()];
      // U4 — a path already refused once by a source GUARD (`markGuarded`, set
      // from `writeStyleEntry`/`writePropEdit`'s refusal) reports
      // `readonly: true` from here on, carrying that guard's OWN sentence, so
      // the widget disables itself instead of re-offering an edit the source
      // will refuse again. See `guardedPaths`'s doc comment for why this is
      // after-touch, not a pre-touch predictor.
      if (this.guardedPaths.size === 0) return all;
      return all.map((p) => {
        const reason = this.guardedPaths.get(`${id}|${p.path}`);
        return reason ? { ...p, readonly: true, readonlyReason: reason } : p;
      });
    },
    get: (id, path) => {
      const portableHierarchyNode = this.portableHierarchyNode(id);
      if (portableHierarchyNode) {
        return path === 'document.path' ? portableHierarchyNode.secondaryLabel : undefined;
      }
      const portableDocument = this.portableDocuments.find((document) => document.id === id);
      if (portableDocument) {
        return path === 'document.path' ? portableDocument.path : undefined;
      }
      if (this.portableStories.some((story) => story.id === id)) {
        if (path === 'story.active') return id === this.activeStoryId;
        if (path.startsWith(PORTABLE_STORY_ARG_PATH_PREFIX)) {
          return this.portableStoryArgs.get(id)?.[
            path.slice(PORTABLE_STORY_ARG_PATH_PREFIX.length)
          ];
        }
        return undefined;
      }
      // A4 — read THROUGH the optimistic echo: a value just set (style/prop) wins over the
      // live-DOM walk until the source-write + HMR land, so the field never snaps back.
      const echoed = this.readEcho(id, path);
      if (echoed.hit) return echoed.value;
      // D4 (spec27 §6 D4, layer-tree visibility/lock) — the two reserved
      // paths GameHierarchy's row reads generically off ANY adapter's
      // `inspector`. `locked` is session-local (see `lockedIds`'s doc
      // comment — no source-backed equivalent). `visible` IS source-backed:
      // sugar for the `style.visibility` prop (read THROUGH that same prop's
      // own optimistic echo, so the eye icon never snap-backs while the
      // async write is in flight — same A4 discipline every other style
      // path gets).
      if (path === 'locked') return this.lockedIds.has(id);
      if (path === 'visible') {
        const echoedStyle = this.readEcho(id, `${STYLE_PATH_PREFIX}visibility`);
        if (echoedStyle.hit) return echoedStyle.value !== 'hidden';
        const n = this.snapshot().nodes.get(id);
        if (!n) return undefined;
        const raw = getComputedStyleValue(n.el, 'visibility', this.computedStyle);
        return raw !== 'hidden';
      }
      if (path.startsWith(TOKEN_PATH_PREFIX)) {
        const name = path.slice(TOKEN_PATH_PREFIX.length);
        return this.designTokenValue(name);
      }
      if (path.startsWith(PROP_PATH_PREFIX)) {
        const n = this.snapshot().nodes.get(id);
        const cp = n ? getComponentProps(n.el) : null;
        return cp?.props[path.slice(PROP_PATH_PREFIX.length)];
      }
      if (!path.startsWith(STYLE_PATH_PREFIX)) return undefined;
      const prop = path.slice(STYLE_PATH_PREFIX.length);
      const n = this.snapshot().nodes.get(id);
      if (!n) return undefined;
      // Cap 1 (React visual-edit parity): read the COMPUTED value via the resolver, so a
      // property styled through a className utility (F5's class routing) OR a CSS file
      // resolves too — fixing the "class-styled props show blank" read-back gap. Under
      // vitest's `node` env the default resolver falls back to the element's inline
      // `.style`, so headless fixtures keep working unchanged.
      // THE AUTHORED VALUE WINS THE FIELD when the element carries one inline:
      // an author who typed 257 into W and reads back 247.262 — the computed
      // width of an inline element that ignores `width`, or of a flex item
      // its parent shrank — concludes the edit "reverted" (runhuman pass 137,
      // twice). The field shows what the source says; the computed value
      // remains the fallback for class- and stylesheet-styled props, which is
      // what the resolver read below exists for.
      const authored = styleProp(n.el.style, prop);
      const raw =
        typeof authored === 'string' && authored !== ''
          ? authored
          : typeof authored === 'number'
            ? String(authored)
            : getComputedStyleValue(n.el, prop, this.computedStyle);
      const declaredType = STYLE_PROPERTY_TYPE.get(prop);
      // A `type: 'number'` descriptor (fontSize/width/height/padding/margin/
      // borderRadius/gap) needs an actual number for the generic numeric
      // input to render/edit correctly — a REAL `CSSStyleDeclaration` always
      // hands these back as a unit-suffixed STRING (e.g. `"16px"`, never a
      // bare `16`), which `Inspector.tsx`'s `typeof v === 'number'` check
      // would otherwise silently read as `0` (this repo's own
      // `react-world-authoring-adapter.test.ts` fixtures never caught this —
      // a hand-built plain-object `style: {}` can hold a bare JS number
      // directly, which a real DOM element's `style` never does). A
      // `type: 'color'` descriptor needs `#rrggbb` for the same reason —
      // see `cssColorToHex`'s doc comment.
      if (declaredType === 'number') return numericStyleValue(raw);
      if (declaredType === 'color') return cssColorToHex(raw);
      return raw || undefined; // an unset computed value reads '' — surface as blank
    },
    set: (id, path, value) => {
      if (this.portableHierarchyNode(id)) return;
      if (this.portableDocuments.some((document) => document.id === id)) return;
      if (this.portableStories.some((story) => story.id === id)) {
        if (!path.startsWith(PORTABLE_STORY_ARG_PATH_PREFIX)) return;
        const name = path.slice(PORTABLE_STORY_ARG_PATH_PREFIX.length);
        const current = this.portableStoryArgs.get(id);
        if (!current || !(name in current)) return;
        const next = { ...current, [name]: value };
        this.portableStoryArgs.set(id, next);
        this.onPortableStoryArgsChanged?.(id, { ...next });
        this.store.notifyIngestEdit();
        return;
      }
      // D4 — see the matching `get` branch's doc comment.
      if (path === 'locked') {
        if (value) this.lockedIds.add(id);
        else this.lockedIds.delete(id);
        this.store.notifyIngestEdit();
        return;
      }
      if (path === 'visible') {
        const cssValue = value ? 'visible' : 'hidden';
        this.setEcho(id, `${STYLE_PATH_PREFIX}visibility`, cssValue);
        return this.pipedSourceWrite(() => this.writeStyle(id, 'visibility', cssValue));
      }
      if (path.startsWith(PROP_PATH_PREFIX)) {
        // A4 — echo BEFORE the async write so `inspector.get` shows the new value at once.
        this.setEcho(id, path, value);
        return this.pipedSourceWrite(() =>
          this.writePropEdit(id, path.slice(PROP_PATH_PREFIX.length), String(value)),
        );
      }
      if (path.startsWith(TOKEN_PATH_PREFIX)) {
        // Tokens-as-noun: a token declared by a project stylesheet is EDITED
        // AT ITS DECLARATION (`writeCss` on the traced rule) — the one write
        // that moves every binding at once. Undeclared tokens (script-set)
        // refuse with the pointer; their descriptor is read-only anyway.
        this.setEcho(id, path, value);
        return this.pipedSourceWrite(() =>
          this.writeTokenValue(id, path.slice(TOKEN_PATH_PREFIX.length), String(value)),
        );
      }
      if (!path.startsWith(STYLE_PATH_PREFIX)) return;
      const prop = path.slice(STYLE_PATH_PREFIX.length);
      // A4 — echo BEFORE the async write (the desync fix): the field reflects the commit
      // within one frame; the write path clears this echo if the write is refused, and HMR
      // clears it once the re-render lands.
      this.setEcho(id, path, value);
      return this.pipedSourceWrite(() => this.writeStyle(id, prop, value as string | number));
    },
    remove: (id, path) => {
      // U2 — remove a stale CSS longhand override so its shorthand actually
      // wins (a uniform border/radius edit clears the per-side/per-corner
      // longhands a prior non-uniform edit wrote; without this the longhand
      // silently overrides the shorthand on reload — the D1 defect). Style
      // paths only; a `prop.`/`token.` path has no removable-override
      // meaning here (no-op). `removeStyle` is itself a source no-op when the
      // longhand isn't authored, so calling this unconditionally for all four
      // corners / twelve side-props is safe and never pollutes clean source.
      if (!path.startsWith(STYLE_PATH_PREFIX)) return;
      const prop = path.slice(STYLE_PATH_PREFIX.length);
      // Point the removed longhand's echo at the value it actually renders at
      // once the override is gone — the shorthand's current (just-committed)
      // value — so `inspector.get(longhand)` reports the resolved corner value,
      // not a stale override or an empty computed read, and stays consistent
      // after HMR clears the echo (the shorthand then cascades to it).
      const shorthand = LONGHAND_TO_SHORTHAND[prop];
      if (shorthand)
        this.setEcho(id, path, this.inspector.get(id, `${STYLE_PATH_PREFIX}${shorthand}`));
      else this.clearEcho(id, path);
      // Through the SAME pipe `set` uses, so a removal answers for itself with
      // an awaited per-edit ack instead of being fired into the void. It is the
      // only door that can express byte-ABSENCE — `set` writes a value, and a
      // longhand set back to the shorthand's value is still a longhand in the
      // file.
      return this.pipedSourceWrite(() => this.removeStyleProp(id, prop));
    },
  };

  readonly assetSubject: AssetSubjectProvider = {
    get: (id) => this.assetSubjectForNode(this.snapshot(), id),
    entries: () => {
      const tree = walkOidTree(this.assetRoot);
      return [...tree.nodes.keys()].flatMap((id) => {
        const subject = this.assetSubjectForNode(tree, id);
        return subject ? [{ id, subject }] : [];
      });
    },
  };

  private assetSubjectForNode(tree: OidTree, id: string): AuthoringAssetSubject | null {
    const node = tree.nodes.get(id);
    if (!node || node.tag !== 'svg' || !node.el.outerHTML) return null;
    const source = this.oidIndex.get(node.oid);
    return {
      kind: 'image',
      name: this.componentName(node) ?? this.elementLabel(node, tree),
      mediaType: 'image/svg+xml',
      text: node.el.outerHTML,
      ...(source?.file ? { sourcePath: projectSourcePath(source.file) } : {}),
    };
  }

  /** Storybook Controls descriptors for an ordinary CSF story node. Functions
   * and other non-serializable implementation values stay out of the form;
   * they remain present in the complete args object passed to the composed
   * story. The rule itself lives in `stories/story-arg-descriptors.ts` — the
   * three-story gallery's per-story document describes its args through the
   * same function. */
  private portableStoryArgDescriptors(storyId: string): PropertyDescriptor[] {
    return storyArgPropertyDescriptors(
      this.portableStoryArgs.get(storyId) ?? {},
      PORTABLE_STORY_ARG_PATH_PREFIX,
    );
  }

  /** Current complete args for a portable story, including callbacks omitted
   * from the visual Controls list. Returned as a copy so inspector UI cannot
   * mutate adapter state behind the provider contract. */
  portableArgs(storyId: string): Record<string, unknown> | null {
    const args = this.portableStoryArgs.get(storyId);
    return args ? { ...args } : null;
  }

  /**
   * The CSF WRITE half (design ledger: stories were composed and framed
   * everywhere, written nowhere). Three verbs over the story's OWN module
   * through the csf-story door; every planner refusal surfaces as the
   * returned error string, loudly, never a silent no-op. `saveStoryAs`
   * writes the story's CURRENT SESSION ARGS — the "save what I am looking
   * at" gesture the board's arg controls set up.
   */
  /**
   * The element's classes as NAMED-STYLE facts (design ledger: named styles,
   * Webflow prior art): each class token the element wears, how many elements
   * in its own game-CSS scope share it (Webflow's "N elements share this
   * class" feedback loop), and — when a first-party stylesheet declares a
   * single-class rule for it — the stylesheet it lives in (which is what makes
   * it an editable named style rather than a utility/generated class).
   */
  elementClasses(id: string): { name: string; count: number; styledIn: string | null }[] {
    const n = this.snapshot().nodes.get(id);
    const el = n?.el as unknown as Element | undefined;
    if (!el || typeof el.getAttribute !== 'function') return [];
    const tokens = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    // Shared-count scope: the element's own game-CSS scope root — the same
    // boundary the scoped stylesheet paints — falling back to the document
    // for a fixture element outside any scope.
    const scope =
      (typeof el.closest === 'function' ? el.closest('[data-vgai-game-styles]') : null) ??
      el.ownerDocument;
    return tokens.map((name) => {
      let count = 0;
      try {
        count = scope?.querySelectorAll?.(`.${CSS.escape(name)}`).length ?? 0;
      } catch {
        // A fixture scope without querySelectorAll — count stays 0.
      }
      return { name, count, styledIn: findClassRuleSource(name)?.sourceFile ?? null };
    });
  }

  /**
   * The named-style write: APPLY when any first-party stylesheet already
   * declares `.className` (the class is an existing style — adding the token
   * is the whole gesture), else CREATE — mint the rule in the element's own
   * stylesheet (the last matched first-party rule's file, else the first
   * first-party stylesheet in the document), moving the element's literal
   * inline declarations into it. `remove` strips the token. Refusals are
   * returned AND logged, so the calling UI can show the sentence.
   */
  async writeNamedStyle(
    id: string,
    op: { kind: 'set' | 'remove'; className: string },
  ): Promise<{ changed: boolean; created?: boolean; error?: string }> {
    const n = this.snapshot().nodes.get(id);
    if (!n) return { changed: false, error: `"${id}" no longer resolves in this root` };
    const refuse = (error: string): { changed: false; error: string } => {
      console.warn(`[ReactRootAuthoringAdapter] named-style ${op.kind} refused: ${error}`);
      return { changed: false, error };
    };
    if (op.kind === 'remove') {
      const res = await writeNamedStyle({ op: 'remove', oid: n.oid, className: op.className });
      if (!res.changed) return refuse(res.error ?? 'no change');
      this.dirty = true;
      this.store.notifyIngestEdit();
      return { changed: true };
    }
    const existing = findClassRuleSource(op.className);
    if (existing) {
      const res = await writeNamedStyle({ op: 'apply', oid: n.oid, className: op.className });
      if (!res.changed) return refuse(res.error ?? 'the element already wears this class');
      this.dirty = true;
      this.store.notifyIngestEdit();
      return { changed: true };
    }
    // The rule's home: the last matched first-party rule's own file, else any
    // first-party stylesheet in the document — and with NEITHER, omit `file`
    // and the server MINTS a stylesheet beside the element's module (adding
    // the bare css import), so the first named style in a css-less project
    // works instead of refusing.
    // Candidate homes are the GAME's stylesheets. The dev-id enumeration also
    // sees the editor's own vite-served CSS, and offering one of those as the
    // home would (rightly) bounce off the server's scope guard — so mirror the
    // guard's exclusions here and let a css-less project fall through to the
    // server's minting path instead.
    const gameCss = (f: string | undefined): boolean =>
      f !== undefined &&
      !f.includes('/packages/editor/') &&
      !f.includes('/node_modules/') &&
      !f.includes('/vendor/');
    const matched = this.matchedCssRules(n.el).filter((rule) => gameCss(rule.sourceFile));
    const cssFile =
      matched[matched.length - 1]?.sourceFile ?? firstPartyStylesheetFiles().find(gameCss);
    const res = await writeNamedStyle({
      op: 'create',
      oid: n.oid,
      className: op.className,
      ...(cssFile !== undefined ? { file: cssFile } : {}),
    });
    if (!res.changed) return refuse(res.error ?? 'no change');
    this.dirty = true;
    this.store.notifyIngestEdit();
    return { changed: true, created: true };
  }

  async writeStory(
    storyId: string,
    op:
      | { kind: 'save-as'; name: string }
      | { kind: 'rename'; newName: string }
      | { kind: 'delete' },
  ): Promise<{ changed: boolean; error?: string }> {
    const story = this.portableStories.find((candidate) => candidate.id === storyId);
    if (!story) return { changed: false, error: `unknown portable story '${storyId}'` };
    if (!story.name || !story.modulePath) {
      return {
        changed: false,
        error: `story '${story.label}' carries no source address (name/modulePath) — it is not writable from this session`,
      };
    }
    const request =
      op.kind === 'save-as'
        ? {
            op: 'save' as const,
            file: story.modulePath,
            name: op.name,
            args: this.portableStoryArgs.get(storyId) ?? {},
          }
        : op.kind === 'rename'
          ? { op: 'rename' as const, file: story.modulePath, name: story.name, newName: op.newName }
          : { op: 'delete' as const, file: story.modulePath, name: story.name };
    const result = await writeCsfStory(request);
    if (!result.changed) {
      console.warn(
        `[ReactRootAuthoringAdapter] csf-story ${op.kind} refused for '${story.label}': ` +
          `${result.error ?? 'no change'}`,
      );
      return { changed: false, ...(result.error !== undefined ? { error: result.error } : {}) };
    }
    // Keep the IN-MEMORY story list truthful about the file it just rewrote
    // (blind-walk finding: rename left the old identity live, so the very
    // next delete refused with "no story export named '<old>'" until a full
    // page reload). Rename updates the entry it addressed; delete drops it.
    // Save-as visibility still needs the discovery refresh — recorded, not
    // silently claimed.
    if (op.kind === 'rename') {
      story.name = op.newName;
      story.label = op.newName.replace(/([a-z])([A-Z])/g, '$1 $2');
    } else if (op.kind === 'delete') {
      const index = this.portableStories.indexOf(story);
      if (index >= 0) this.portableStories.splice(index, 1);
      if (this.activeStoryId === storyId) this.activeStoryId = null;
    }
    this.dirty = true;
    this.store.notifyIngestEdit();
    return { changed: true };
  }

  /** Restore the selected story's composed CSF defaults. */
  resetPortableArgs(storyId: string): void {
    const story = this.portableStories.find((candidate) => candidate.id === storyId);
    if (!story) return;
    const next = { ...(story.args ?? {}) };
    this.portableStoryArgs.set(storyId, next);
    this.onPortableStoryArgsChanged?.(storyId, { ...next });
    this.store.notifyIngestEdit();
  }

  /** Cap 4: PropertyDescriptors for a node's editable component props (read off the fiber). */
  private propDescriptors(id: string): PropertyDescriptor[] {
    const n = this.snapshot().nodes.get(id);
    const cp = n ? getComponentProps(n.el) : null;
    if (!cp) return [];
    return Object.keys(cp.props).map((name) => ({
      path: `${PROP_PATH_PREFIX}${name}`,
      label: name,
      type: 'string' as const,
      group: 'Props',
    }));
  }

  /** Cap 7: read-only PropertyDescriptors for the document's design tokens (`:root` custom
   *  properties, incl. Tailwind v4 @theme/oklch), shown under a "Tokens" section. */
  private tokenDescriptors(): PropertyDescriptor[] {
    // Tokens-as-noun: a token whose `:root` declaration traces to a project
    // stylesheet is WRITABLE (the edit lands on that declaration through the
    // css door and every binding moves at once); one set by script — a theme
    // data module mirroring itself onto `:root`, or inherited host style —
    // stays read-only, because its truth lives in that source, not in a rule
    // the css writer can reach.
    return this.designTokens().map((t) => ({
      path: `${TOKEN_PATH_PREFIX}${t.name}`,
      label: t.name,
      type: 'string' as const,
      group: 'Tokens',
      readonly: !t.declaredIn,
    }));
  }

  /**
   * The token-edit write: `writeCss` on the token's TRACED `:root`
   * declaration. Refusals are loud and name the remedy — an untraced token's
   * edit door is its declaring source (plain data), not this path.
   */
  private async writeTokenValue(id: string, name: string, value: string): Promise<boolean> {
    const echoPath = `${TOKEN_PATH_PREFIX}${name}`;
    const token = this.designTokens().find((t) => t.name === name);
    if (!token) {
      this.clearEcho(id, echoPath);
      console.warn(`[ReactRootAuthoringAdapter] unknown design token "${name}".`);
      return false;
    }
    if (!token.declaredIn) {
      this.clearEcho(id, echoPath);
      console.warn(
        `[ReactRootAuthoringAdapter] token "${name}" has no stylesheet declaration to edit — ` +
          'it is set by script (a theme data module mirroring itself onto :root, or host ' +
          'style). Edit that source; it is plain data.',
      );
      return false;
    }
    const backend = this.writeBackend;
    if (!backend?.writeCss) {
      this.clearEcho(id, echoPath);
      console.warn(
        `[ReactRootAuthoringAdapter] cannot write token "${name}": no css-capable ` +
          'source-write backend in this session (hosted/no dev server).',
      );
      return false;
    }
    const res = await backend.writeCss(
      token.declaredIn.sourceFile,
      token.declaredIn.selector,
      name,
      value,
    );
    if (!res.changed) {
      this.clearEcho(id, echoPath);
      console.warn(
        `[ReactRootAuthoringAdapter] token write refused/no-op for "${name}" at ` +
          `${token.declaredIn.sourceFile} (${token.declaredIn.selector}): ${res.error ?? 'no change'}`,
      );
      return false;
    }
    this.dirty = true;
    this.store.notifyIngestEdit();
    return true;
  }

  /**
   * Portable Storybook CSF stories. `active`/`apply` are world-level because
   * applying a story remounts the whole React root. `storiesFor` narrows
   * presentation to the stories of the node's own component
   * (`portableStoriesForNode`) — but the world question, `WORLD_SCOPE_NODE_ID`,
   * is still answered with the whole list, because that is the id the shell
   * probes this provider's SCOPE with and the scope is world-level.
   * `apply` validates the id, updates `activeStoryId`, asks the design-time
   * layer to render that composed CSF story, and notifies the shell.
   */
  readonly stories: StoriesProvider = {
    storiesFor: (nodeId): StoryRef[] =>
      this.portableStories.length > 0 ? this.portableStoriesForNode(nodeId) : [],
    active: (_nodeId) => this.activeStoryId,
    apply: (_nodeId, storyId) => {
      if (storyId !== null && !this.portableStories.some((story) => story.id === storyId)) {
        console.warn(
          `[ReactRootAuthoringAdapter] stories.apply: unknown portable CSF story id "${storyId}" — ignoring.`,
        );
        return;
      }
      // Portable CSF always renders a design state. Clearing the picker means
      // "restore the document's default", not "orphan the live DOM roots
      // outside every story row".
      this.activeStoryId = storyId ?? this.portableDefaultStoryId;
      this.onPortableStoryApplied?.(storyId);
      this.store.notifyIngestEdit();
    },
    // This provider's states ARE the project's portable CSF, so it is the one
    // that can say whether discovery ran at all. Without this the section that
    // draws the empty list had to reach into the CSF registry itself, which is
    // one particular provider's private business.
    unavailable: () => storyDiscoveryUnavailable(),
  };

  readonly structure: StructureProvider = {
    // Every structural op journals complete next-file text. Undo never needs to
    // address a moved or deleted element by an OID that may no longer exist.
    // The new element's OID is minted by the server on the next index, so the
    // id half is '' and the ack half is the write itself (`StructuralIdWrite`).
    create: (kind, parentId) => ({
      id: '',
      ack: this.structOp(parentId ?? '', 'create', { wrapperTag: kind }),
    }),
    // Returns `removeElement`'s own `Promise<void>` (not `void this....`) so
    // `deleteSelection` (`editor-hotkeys.ts`) can `await` each id's write
    // before firing the next — see the CORRECTNESS INVARIANT comment below
    // for why that serialization (plus deletion ORDER) is what makes the
    // per-id fallback loop sound for an adapter WITHOUT `removeMany` (any
    // adapter override lacking `structure.removeMany` — `deleteSelection`
    // always prefers a batched `removeMany` when present, see below).
    remove: (id) => this.removeElement(id),
    // delete-order-residual fix (bug-panel follow-up to the multi-delete
    // corruption fix, 50f90a6d) — SOUND batched delete, ONE undo entry for
    // the whole selection. D4.R2 originally investigated and REJECTED
    // `removeMany` here as unsound because the OBVIOUS implementation is N
    // separate `structOp`-style calls, each targeting its OID's `{file,
    // line, col}` from the SERVER's `OidStore.index`
    // (`@volter/editor-react`'s `serving/ui-oid-plugin.ts`'s `handleStruct`) — exactly the per-id
    // `remove` loop's own stale-offset hazard (see the CORRECTNESS INVARIANT
    // comment below), just without the ordering discipline that loop needs
    // to stay sound. This implementation is NOT that: `removeManyElements`
    // posts every id's raw oid in ONE request to `/__ui-source/struct-many`
    // (`handleStructMany`, `@volter/editor-react`'s `serving/ui-oid-plugin.ts`), which resolves every
    // oid's offset against a SINGLE shared `readFileSync` snapshot (never a
    // per-id re-read, so no write-to-write staleness is even possible) and
    // applies them highest-offset-first in one pass, one write. That is also
    // why this is the fix for the DOM-reordered-vs-source residual the
    // per-id fallback below still carries: this batch never consults
    // `collectAllNodeIds`/hierarchy-walk order at all, so it is correct
    // regardless of whether the live DOM's child order matches the .tsx
    // source order. (Explicitly NOT a live re-transform/re-scan per id
    // either — see `deleteElements`'s doc comment in `writer.ts` for why
    // that would reopen a DIFFERENT unsoundness: occurrence-index-based oid
    // identity churns when same-tag siblings are removed mid-batch.)
    // Returns `removeManyElements`'s own `Promise<void>` (not `void
    // this....`) so `deleteSelection` can `await` the whole batch's write
    // landing before it returns, same reason `remove` above does.
    removeMany: (ids) => this.removeManyElements(ids),
    //
    // CORRECTNESS INVARIANT for the per-id `remove` loop (bug-panel reopen,
    // post-D4.R2) — `deleteSelection` (`editor-hotkeys.ts`) falls back to
    // this loop only when `removeMany` is ABSENT (a different adapter
    // override); for THIS adapter `removeMany` above is always preferred, so
    // this loop is dead code for react-world today, kept sound and
    // documented for any future override without a batched delete. It is
    // safe ONLY under TWO conditions `deleteSelection` enforces together —
    // neither held before the 50f90a6d fix (an unsorted, unawaited loop was
    // a real source-corruption hazard, reachable by an ordinary top-first
    // marquee/multi-select delete) — AND both assume the caller's walk order
    // (`collectAllNodeIds`, DOM order for this adapter) matches true SOURCE
    // order (the DOM-reordered-vs-source residual this file's `removeMany`
    // fixes for THIS adapter specifically):
    //   1. REVERSE (walk-)DOCUMENT ORDER — delete the bottom-most element
    //      first, per the caller's own hierarchy walk. Every element's
    //      `{line, col}` in `OidStore.index` is a snapshot from the LAST
    //      real parse and is never refreshed between same-file writes (only
    //      by a real Vite `transform()` re-run — the async HMR round trip
    //      `pendingSourceReconcile` already tracks). Deleting bottom-up
    //      means every write only ever removes source that sits BELOW every
    //      id still queued — nothing ABOVE a queued id's own offset ever
    //      shifts, so that offset stays valid no matter how many of its
    //      later-walked siblings/descendants have already been removed. A
    //      descendant is later in DFS pre-order than its ancestor, so this
    //      same reverse-pre-order rule also deletes a selected descendant
    //      before a selected ancestor — required, since deleting the
    //      ancestor first would remove the descendant's own source out from
    //      under it before its turn. This is sound ONLY when walk order ==
    //      source order (true for ordinary JSX; false when a component's
    //      live DOM child order is a runtime permutation of its JSX source,
    //      e.g. `{[...els].reverse()}` over an array of DISTINCT element
    //      values).
    //   2. SERIALIZED WRITES — `deleteSelection` `await`s each `remove(id)`
    //      (this method returns `removeElement`'s promise instead of firing
    //      it `void`) before starting the next. `writeStruct` is a real
    //      network POST in production (`source-write-backend.ts`); two
    //      in-flight, un-awaited requests for the SAME file can each read it
    //      BEFORE either has written back, so whichever write lands second
    //      silently clobbers (loses) the first — a lost-update race
    //      independent of ordering. Awaiting each id in turn guarantees
    //      request N only starts once request N-1's write has landed.
    // Together, every write in the sequence reads a file that already
    // reflects every prior delete in the sequence, and targets an offset
    // still valid against that file — the "safe" claim this comment used to
    // make unconditionally, which was FALSE for the raw (unsorted, top-first)
    // selection order `deleteSelection` used to iterate in
    // (the structural-undo cases' own "offset-staleness
    // hazard" case, reachable through the real `deleteSelection` path, not
    // just a hand-picked unsafe direct-adapter call).
    // Hands the write's promise back for the same reason `remove` does (the
    // CORRECTNESS INVARIANT above): `duplicateSelection` awaits each id so two
    // same-file writes can never be in flight together.
    duplicate: (id) => ({ id, ack: this.structOp(id, 'duplicate') }),
    reparent: (id, newParentId) => {
      const parentOid = newParentId ? this.oidOf(newParentId) : undefined;
      if (!parentOid) {
        return this.structRefusal(
          `reparent refused: "${newParentId ?? 'the document root'}" has no authored source element to move into.`,
        );
      }
      return this.structOp(id, 'reparent', { parentOid });
    },
    // T0 (spec 27 §2): bring the pre-existing off-contract `reorder(id, beforeId,
    // parentId)` method (below) onto the contract. D2.b (spec 27 §6) fix: a
    // `null` `beforeSiblingId` means "move to the end of id's OWN current
    // parent" (this contract method's own doc comment) — that needs a REAL
    // `parentOid` to target (`reorder`'s own `parentStart != null` end-of-list
    // branch), so resolve `id`'s CURRENT parent from the live snapshot for
    // that case. A non-null `beforeSiblingId` already fully determines the
    // target position via `targetOid` alone, so `parentId` stays `null` there
    // (matching this method's pre-D2 behavior — no other caller of this
    // contract method existed before D2.b's canvas drag-to-reorder, which is
    // the first to actually exercise the null/"move to end" case).
    reorder: (id, beforeSiblingId) => {
      const parentId =
        beforeSiblingId === null ? (this.snapshot().nodes.get(id)?.parentId ?? null) : null;
      return this.reorder(id, beforeSiblingId, parentId);
    },
    // D3.e (spec 27 §2 T0 leftover) — the generic HTML kinds `create`
    // genuinely supports (see `CREATABLE_KINDS`'s doc comment below).
    // `parentId` is ignored: every OID node accepts any of these as a plain
    // child, mirroring `ui-authoring-adapter.ts`'s identically-parentId-
    // agnostic `creatableKinds`.
    creatableKinds: () => [...CREATABLE_KINDS],
    // D3.a (spec 27 §6) — bring the pre-existing off-contract `wrap`/`unwrap`
    // methods (below) onto the contract so the canvas context menu can reach
    // them through the adapter interface alone (rule zero).
    wrap: (id, wrapperTag) => this.wrap(id, wrapperTag),
    unwrap: (id) => this.unwrap(id),
  };

  readonly assetDrop: AssetDropProvider = {
    accepts: (nodeId, assetPath, context) => this.assetDropPlan(nodeId, assetPath, context).ok,
    drop: (nodeId, assetPath, context) => {
      const plan = this.assetDropPlan(nodeId, assetPath, context);
      if (!plan.ok) return this.structRefusal(`asset drop refused — ${plan.reason}`);
      return this.structOp(plan.parentId, 'create', {
        snippet: plan.snippet,
        ...(plan.ensureImport ? { ensureImport: plan.ensureImport } : {}),
      });
    },
  };

  private assetDropPlan(
    nodeId: string,
    assetPath: string,
    context?: AssetDropContext,
  ): DomAssetDropPlan {
    if (!this.writeBackend) {
      return { ok: false, reason: 'This session has no source writer, so nothing can be added.' };
    }
    const node = this.snapshot().nodes.get(nodeId);
    if (!node) return { ok: false, reason: 'That row has no authored JSX element.' };
    if (!canContainDomChildren(node.el, node.tag)) {
      return { ok: false, reason: `<${node.tag}> cannot contain child elements.` };
    }
    const component = context?.item?.kind === 'component' ? context.item : null;
    if (component) {
      if (component.surface !== 'dom') {
        return {
          ok: false,
          reason: `${component.name} is a ${component.surface} component, not a React UI component.`,
        };
      }
      const from = this.sourceLocation(nodeId)?.file;
      if (!from) {
        return { ok: false, reason: 'The target source location has not loaded yet.' };
      }
      return {
        ok: true,
        parentId: nodeId,
        snippet: `<${component.name} />`,
        ensureImport: {
          name: component.name,
          module: this.relativeProjectModule(from, component.sourcePath),
          kind: component.exportKind,
        },
      };
    }
    if (!IMAGE_ASSET_RE.test(assetPath)) {
      return {
        ok: false,
        reason: `${assetPath} is not a browser image asset and has no DOM element to become.`,
      };
    }
    return {
      ok: true,
      parentId: nodeId,
      snippet: `<img src=${JSON.stringify(assetPath)} alt="" />`,
    };
  }

  private relativeProjectModule(fromFile: string, targetFile: string): string {
    return relativeImportSpecifier(projectSourcePath(fromFile), projectSourcePath(targetFile));
  }
  /** Wrap the element in a new container (Cap 5). */
  wrap(id: string, wrapperTag = 'div'): Promise<WriteAck> {
    return this.structOp(id, 'wrap', { wrapperTag });
  }

  /** Replace the element with its children (Cap 5). */
  unwrap(id: string): Promise<WriteAck> {
    return this.structOp(id, 'unwrap');
  }

  /** Reorder the element before a sibling (`beforeId`), or to the end of `parentId` when
   *  `beforeId` is null (Cap 5, layer-tree drag-to-reorder). */
  reorder(id: string, beforeId: string | null, parentId: string | null): Promise<WriteAck> {
    const opts: { targetOid?: string; parentOid?: string } = {};
    const targetOid = beforeId ? this.oidOf(beforeId) : undefined;
    const parentOid = parentId ? this.oidOf(parentId) : undefined;
    if (targetOid) opts.targetOid = targetOid;
    if (parentOid) opts.parentOid = parentOid;
    return this.structOp(id, 'reorder', opts);
  }

  /** The underlying (component-global) OID for an entity id (strips the `#n` repeat tag). */
  private oidOf(id: string): string | undefined {
    return this.snapshot().nodes.get(id)?.oid;
  }

  /**
   * C4 (spec §9): map an entity id to its component/source location, when available —
   * the read side of `oidIndex` (populated from `SourceWriteBackend.index()`, same as
   * `toEditorNode`'s label lookup). Returns `undefined` when the id has no OID (e.g. a
   * catalog node) or the index hasn't resolved (no dev-server backend, or the index
   * fetch hasn't landed yet) — an honest "unavailable", never a guess. The editor UI
   * (`@volter/editor-game/react/react-inspector-section.tsx`'s `LaneDisclosure`) uses this to offer copy-path /
   * go-to-line without ever exposing a write surface.
   */
  sourceLocation(id: string): OidEntry | undefined {
    const oid = this.oidOf(id);
    if (!oid) return undefined;
    return this.oidIndex.get(oid);
  }

  /** Run a structural op through the persistence pipe (loud degradation without
   *  a writer). */
  private structOp(id: string, op: string, opts?: StructOpOptions): Promise<WriteAck> {
    return this.structPipe.structOp(this.oidOf(id), id, op, opts, JSX_SOURCE_DESTINATION);
  }

  /**
   * T0 (spec 27 §4, B1) — the write body extracted from {@link writeStyle}, returning
   * whether source changed so a multi-property box gesture can reconcile once.
   * `priorInlineOverride`, when given, is used as the captured
   * PRE-gesture inline value instead of re-reading `n.el.style` — needed because
   * `boxEdit.apply` already mutated the live inline style for live preview before
   * `end` gets here, so a fresh DOM read would see the LAST previewed value, not the
   * true original (see {@link boxEditSession}'s doc comment). Unused by the plain CSS
   * cascade branch below (`pickCssRuleTarget`'s own `prevValue` comes from the matched
   * rule's text, not inline style, and is unaffected either way).
   */
  /** The last style write this adapter refused, for the gesture that ends
   *  with nothing written to say WHY where the author is looking. */
  private lastStyleWriteRefusal: string | null = null;
  private refuseStyleWrite(message: string): void {
    this.lastStyleWriteRefusal = message;
    console.warn(message);
  }

  private async writeStyleEntry(
    id: string,
    prop: string,
    value: string | number,
    priorInlineOverride?: string,
    backend: SourceWriteBackend | undefined = this.writeBackend,
  ): Promise<boolean> {
    // A4 — the echo key `inspector.set` populated for this write; cleared on any failure
    // return below so a refused/unbacked write can't leave the field stuck on a value the
    // source never took.
    const echoPath = `${STYLE_PATH_PREFIX}${prop}`;
    const n = this.snapshot().nodes.get(id);
    if (!n) {
      this.clearEcho(id, echoPath);
      // THE ONE SILENT LOSS on this path, and the one the write-race report is
      // made of: the pipe turns a `false` here into an ack of
      // `live-only (not saved)` / `persisted: false`, which reads exactly like
      // the honest live-only floor while in fact NOTHING was attempted. Every
      // other refusal below names its gate; this one must too.
      this.refuseStyleWrite(
        `[ReactRootAuthoringAdapter] cannot write "${prop}": "${id}" no longer resolves in this ` +
          'root (the tree was re-projected — an HMR remount — between the selection and the ' +
          'write). Nothing was written. Re-select and retry.',
      );
      return false;
    }
    if (!backend) {
      this.clearEcho(id, echoPath);
      this.refuseStyleWrite(
        `[ReactRootAuthoringAdapter] cannot write "${prop}" on "${id}": no source-write ` +
          'backend in this session (hosted/no dev server) — selection/inspection still work.',
      );
      return false;
    }
    // A per-side longhand cannot share a style object with the shorthand that
    // owns it — React raises its own conflicting-property error and the winner
    // becomes key-order dependent. Expand the shorthand first, so the element
    // is authored in ONE vocabulary. A source no-op on a clean element.
    await this.expandShorthandsFor(id, prop, backend);
    // Cap 2 (React visual-edit parity): if a first-party CSS RULE declares this property,
    // edit that CSS FILE (cascade-correct: the last matched rule wins) instead of writing
    // inline/class. A `generated: true` response means the selector isn't in source
    // (Tailwind/styled-components) — fall through to the inline/class path below.
    // BREAKPOINT MODE: with an active breakpoint the edit lands in
    // `@media <bp>` for the element's NAMED STYLE — the only honest carrier
    // (an inline style cannot be responsive). No class, no css door ⇒ a
    // guarded refusal naming the remedy, never a base write that
    // misrepresents the gesture.
    const breakpoint = activeBreakpoint();
    if (breakpoint !== null) {
      const named = namedStyleRuleFor(this.matchedCssRules(n.el), classTokensOf(n.el));
      const guard = !backend.writeCss
        ? 'breakpoint edits need the dev-server css door (a hosted session cannot write @media).'
        : named
          ? null
          : 'no style class carries this element — create one in the Style class row first ' +
            '(inline styles cannot be responsive, so a breakpoint edit needs a class rule).';
      if (guard !== null || !named || !backend.writeCss) {
        this.clearEcho(id, echoPath);
        if (guard) {
          this.markGuarded(id, echoPath, guard);
          // The refusal must be SEEN where the gesture happened (blind-walk
          // finding: the guarded-readonly state alone read as a silent no-op
          // — the value just snapped back with no visible reason).
          showTransientHint(guard);
        }
        this.store.notifyIngestEdit();
        this.refuseStyleWrite(`[ReactRootAuthoringAdapter] breakpoint edit refused: ${guard}`);
        return false;
      }
      const res = await backend.writeCss(
        named.sourceFile,
        named.selectorText,
        prop,
        cssTextForStyleValue(prop, value),
        breakpoint,
      );
      if (!res.changed) {
        this.clearEcho(id, echoPath);
        this.refuseStyleWrite(
          `[ReactRootAuthoringAdapter] breakpoint css write refused/no-op for ` +
            `"${named.selectorText}" ${prop} at ${breakpoint}: ${res.error ?? 'no change'}`,
        );
        return false;
      }
      this.dirty = true;
      this.store.notifyIngestEdit();
      return true;
    }
    if (backend.writeCss) {
      const matchedRules = this.matchedCssRules(n.el);
      const cssTarget = pickCssRuleTarget(matchedRules, prop);
      // Named-style routing (design ledger: named styles, Webflow prior art).
      // No matched rule declares this property yet — but the element WEARS a
      // named style (a first-party single-class rule), and it has no live
      // inline declaration of the property (inline would beat the class in
      // cascade, making the write a dead declaration). Land the NEW
      // declaration in the class rule (`surgicalCssEdit` appends absent
      // properties), so the named style stays the element's one style home
      // instead of every later edit forking back to inline.
      const namedTarget =
        !cssTarget && !liveInlineDeclares(n.el, prop)
          ? namedStyleRuleFor(matchedRules, classTokensOf(n.el))
          : null;
      const routedRule = cssTarget?.rule ?? namedTarget;
      if (routedRule) {
        const cssRoutedTarget = { rule: routedRule };
        const { rule } = cssRoutedTarget;
        // A CSS FILE declaration is CSS TEXT, so a numeric value needs its unit
        // spelled here (`300` -> `300px`) — unlike the JSX object below, where
        // React does the px-ifying. `css-numeric-style.ts` owns that rule once.
        const res = await backend.writeCss(
          rule.sourceFile,
          rule.selectorText,
          prop,
          cssTextForStyleValue(prop, value),
        );
        if (res.changed) {
          this.dirty = true;
          this.store.notifyIngestEdit();
          return true;
        }
        if (!res.generated) {
          this.clearEcho(id, echoPath);
          this.refuseStyleWrite(
            `[ReactRootAuthoringAdapter] CSS write refused/no-op for selector ` +
              `"${rule.selectorText}" prop "${prop}": ${res.error ?? 'no change'}`,
          );
          return false;
        }
        // res.generated ⇒ selector is generated CSS — fall through to inline/class routing.
      }
    }
    value = preserveNumericStyleUnit(value, styleProp(n.el.style, prop));
    // NOT `String(value)`. A pixel-valued numeric descriptor must reach the writer as a
    // NUMBER so the JSX carries a bare `300`, which React px-ifies at render;
    // the quoted `'300'` this used to write is passed through verbatim by React
    // and REJECTED by the CSSOM, which keeps the previous value — a source
    // write with no rendered effect, acked `persisted: true`.
    const res = await backend.writeStyle(n.oid, prop, value);
    if (!res.changed) {
      this.clearEcho(id, echoPath);
      // Two guards, two sentences. A dynamic `{expression}` and a
      // `var(--token)` reference are both literals the writer will not
      // overwrite, and completely different facts to the author — so the
      // refusal that reaches the field carries the guard's own words.
      const guard = res.tokenRef
        ? tokenReferenceGuardText(prop, res.tokenRef)
        : res.dynamic
          ? DYNAMIC_EXPRESSION_GUARD
          : null;
      if (guard) this.markGuarded(id, echoPath, guard);
      // D2 — notify so the refusal actually RE-RENDERS: the cleared echo (field
      // snaps back off the stale value) and, for a guarded refusal, the now
      // `readonly: true` descriptor only reach the UI on a store tick. Without
      // this the widget keeps showing the refused value, enabled, until some
      // unrelated event happens to re-render.
      this.store.notifyIngestEdit();
      this.refuseStyleWrite(
        `[ReactRootAuthoringAdapter] style write refused/no-op for oid "${n.oid}" ` +
          `prop "${prop}": ${guard ?? res.error ?? 'no change'}`,
      );
      return false;
    }
    this.dirty = true;
    // D-A4: if this write took the writer's APPEND branch (no prior
    // literal for `prop`, e.g. spread-derived `style={{ ...vars }}`), undo must
    // REMOVE the appended prop rather than replay the write with `prev` — replaying
    // would find the NOW-appended literal and REPLACE it with a hardcoded runtime
    // value, baking a literal into a spot the source never had one. Redo is a plain
    // write either way (a re-append is just a write). B1-parity live preview for
    // single-prop inspector writes. The `boxEdit` gesture patches `n.el.style` live
    // during the drag (see `boxEdit.apply`), but a plain single-prop write (a color
    // / any inspector field) only wrote SOURCE — so the live element didn't repaint
    // until HMR/reload, which never lands in a headless harness (a color edit's
    // element stays the old color forever). Optimistically apply the
    // committed value to the live inline style here — mirroring
    // `dom-authoring-adapter`'s own `applyStyleToElement` — so the edit is
    // visible immediately; HMR then converges on the same value from source and the
    // A4 echo re-syncs. Skipped for the box-edit caller (`priorInlineOverride`
    // set), which already applied its own live preview and whose committed `value`
    // can differ from the inline CSS (e.g. a unitless length vs the `px` string it
    // painted). INLINE branch only — the CSS-cascade branch above returns early;
    // patching inline there would shadow the rule and stick past later edits.
    // The inline patch is CSS TEXT (a live `CSSStyleDeclaration`), so the unit
    // is spelled HERE while the source above keeps the bare number: assigning
    // `'300'` to `el.style.width` is rejected by the CSSOM exactly the way the
    // source string was, and the screen would not move until HMR landed.
    if (priorInlineOverride === undefined && n.el.style) {
      (n.el.style as Record<string, unknown>)[prop] = cssTextForStyleValue(prop, value);
    }
    this.store.notifyIngestEdit();
    return true;
  }

  private async writeStyle(id: string, prop: string, value: string | number): Promise<boolean> {
    return this.writeStyleEntry(id, prop, value);
  }

  /**
   * Make room for a per-side write by EXPANDING every shorthand that owns it.
   *
   * `SemanticSpacing` offers eight per-side rows on an element authored
   * `padding: 16`, and writing one of them used to leave BOTH in the style
   * object — React's own "don't mix shorthand and non-shorthand properties for
   * the same value" error, with an order-dependent result.
   *
   * The direction the combo widgets already handle is the mirror of this one:
   * going UNIFORM, `RadiusRow`/`ComboRow` remove the longhands so the shorthand
   * wins cleanly (`inspector.remove`). Going PER-SIDE, this removes the
   * shorthand and writes its resolved value into each sibling longhand first,
   * so nothing moves on screen and the element ends up authored in exactly one
   * vocabulary. Refusing instead was the alternative and it is strictly worse:
   * the per-side rows are offered, so refusing them would make the widget lie.
   *
   * Outermost shorthand first, because `border` owns `borderWidth` which owns
   * `borderTopWidth` — expanding one level authors the next, which the next
   * pass then expands. `removeStyleProp` is a source no-op when the shorthand
   * is not authored on this element, which is what gates the whole thing: a
   * clean element pays one no-op removal and keeps its source untouched.
   *
   * Values come from the element's COMPUTED style, the same read
   * `inspector.get` uses — the resolved value is what the author sees, and the
   * siblings are written to exactly what they already render at.
   */
  private async expandShorthandsFor(
    id: string,
    prop: string,
    backend: SourceWriteBackend | undefined,
  ): Promise<void> {
    const chain = shorthandChain(prop);
    if (chain.length === 0) return;
    const n = this.snapshot().nodes.get(id);
    if (!n || !backend) return;
    for (const shorthand of chain) {
      const longhands = SHORTHAND_LONGHANDS[shorthand] ?? [];
      // Read BEFORE the removal — the removal drops the live inline override,
      // so a read afterwards would see the cascade without it.
      const resolved = longhands.map((longhand) =>
        getComputedStyleValue(n.el, longhand, this.computedStyle),
      );
      // The SAME backend the caller writes through — a box-edit commit hands
      // in a scoped writer for atomicity, and an expansion that reached around
      // it would split one gesture across two transactions.
      if (!(await this.removeStyleProp(id, shorthand, backend))) continue; // not authored here
      for (const [index, longhand] of longhands.entries()) {
        if (longhand === prop) continue; // the caller writes this one itself
        const value = resolved[index];
        if (!value) continue;
        await this.writeStyleEntry(id, longhand, value, undefined, backend);
      }
    }
  }

  /**
   * U2 (spec 27 §5 C2) — surgically REMOVE a style property's source override
   * (`inspector.remove`'s style path). Captures the prior source literal first
   * so the removal is undoable (undo re-writes it, redo re-removes); a source
   * no-op (`changed: false`, e.g. the prop wasn't authored) pushes NO undo
   * entry and touches nothing — which is what makes it safe to call for every
   * corner/side unconditionally on a uniform edit. Also drops the live inline
   * override so the element re-cascades to the shorthand immediately (mirrors
   * `writeStyleEntry`'s inline live-preview, inverse direction).
   */
  private async removeStyleProp(
    id: string,
    prop: string,
    backend: SourceWriteBackend | undefined = this.writeBackend,
  ): Promise<boolean> {
    const n = this.snapshot().nodes.get(id);
    if (!n || !backend) return false;
    const res = await backend.removeStyle(n.oid, prop);
    if (!res.changed) return false; // longhand wasn't authored — nothing removed, no undo
    this.dirty = true;
    if (n.el.style) delete (n.el.style as Record<string, unknown>)[prop];
    this.store.notifyIngestEdit();
    return true;
  }

  /**
   * Cap 3 (React visual-edit parity): replace a leaf element's pure-text content in source
   * (double-click-to-edit). Refused (guarded) when the body has an expression or child
   * elements. Undoable: the prior text (returned by the backend) is written back on undo.
   */
  async editText(id: string, newText: string): Promise<void> {
    const n = this.snapshot().nodes.get(id);
    if (!n) return;
    if (!this.writeBackend?.writeText) {
      console.warn(
        `[ReactRootAuthoringAdapter] cannot edit text on "${id}": no source-write backend ` +
          'with text support in this session (hosted/no dev server).',
      );
      return;
    }
    const res = await this.writeBackend.writeText(n.oid, newText);
    if (!res.changed) {
      // D3.R1 (reopen fix) — a dynamic-body refusal marks this id readonly for
      // text edits (U4's session-scoped `guardedPaths`, read by `text.get`
      // above) and — mirroring D2's style/prop precedent — notifies the store
      // UNCONDITIONALLY so the refusal (and the overlay's refused indicator,
      // which polls `text.get` off this same notify) renders at refusal time
      // instead of silently vanishing until an unrelated event ticks the store.
      if (res.dynamic) {
        this.markGuarded(
          id,
          TEXT_PATH,
          'The body has an expression or child elements, so replacing it with text is guarded.',
        );
      }
      this.store.notifyIngestEdit();
      console.warn(
        `[ReactRootAuthoringAdapter] text edit refused/no-op for oid "${n.oid}": ` +
          `${res.dynamic ? 'body has an expression/children (guarded)' : (res.error ?? 'no change')}`,
      );
      return;
    }
    this.dirty = true;
    // D3.R5 (reopen fix) — a successful text write flips `hasText`, itself a
    // `findEmptyContainers` hint-eligibility criterion (`ui-source/inspect.ts`), yet
    // populates no `valueEcho` (echo is only ever set by the inspector style/prop
    // paths) — same pre-HMR-notify timing gap as a structural op (see
    // `pendingSourceReconcile`'s doc comment): queue a pending reconcile.
    this.pendingSourceReconcile++;
    this.store.notifyIngestEdit();
  }

  /**
   * Cap 4 (React visual-edit parity): write a component prop at its CALL SITE (the
   * `<Component …>` tag), resolved from the live fiber (`getComponentProps` → callSiteOid).
   * Refused (guarded) when the prop is a dynamic expression. Undoable via the prior fiber
   * value.
   */
  private async writePropEdit(id: string, prop: string, value: string): Promise<boolean> {
    // A4 — the echo key `inspector.set` populated for this prop write; cleared on any
    // failure return so a refused write can't leave the field stuck.
    const echoPath = `${PROP_PATH_PREFIX}${prop}`;
    const n = this.snapshot().nodes.get(id);
    if (!n) {
      this.clearEcho(id, echoPath);
      return false;
    }
    if (!this.writeBackend?.writeProp) {
      this.clearEcho(id, echoPath);
      console.warn(
        `[ReactRootAuthoringAdapter] cannot write prop "${prop}" on "${id}": no source-write ` +
          'backend with prop support in this session (hosted/no dev server).',
      );
      return false;
    }
    const cp = getComponentProps(n.el);
    if (!cp) {
      this.clearEcho(id, echoPath);
      console.warn(
        `[ReactRootAuthoringAdapter] "${id}" is not a component call site with props — ` +
          `cannot write prop "${prop}".`,
      );
      return false;
    }
    const res = await this.writeBackend.writeProp(cp.callSiteOid, prop, value);
    if (!res.changed) {
      this.clearEcho(id, echoPath);
      if (res.dynamic) this.markGuarded(id, echoPath, DYNAMIC_EXPRESSION_GUARD);
      // D2 — notify so the cleared echo + (dynamic) new `readonly: true`
      // descriptor render at refusal time, not on the next unrelated event.
      this.store.notifyIngestEdit();
      console.warn(
        `[ReactRootAuthoringAdapter] prop write refused/no-op for oid "${cp.callSiteOid}" ` +
          `prop "${prop}": ${res.dynamic ? 'value is a dynamic expression (guarded)' : (res.error ?? 'no change')}`,
      );
      return false;
    }
    this.dirty = true;
    this.store.notifyIngestEdit();
    return true;
  }

  private removeElement(id: string): Promise<WriteAck> {
    const n = this.snapshot().nodes.get(id);
    if (!n) return this.structRefusal(`cannot delete "${id}": no such node in this world.`);
    // Whole-file source history restores deletion without fabricating an inverse
    // element insertion from an OID that no longer exists.
    return this.structPipe.structOp(n.oid, id, 'delete', undefined, JSX_SOURCE_DESTINATION);
  }

  /**
   * delete-order-residual fix — the `structure.removeMany` backing. Resolves every
   * `id` to its raw (non-disambiguated) oid, dedupes (a repeated-OID `.map` list's
   * `#n` siblings share ONE raw oid — deleting it once is correct, per
   * `walkOidTree`'s own disambiguation comment), and posts them ALL in ONE
   * `writeStructMany` call — see that method's doc comment on `SourceWriteBackend`
   * (`source-write-backend.ts`) and `handleStructMany`'s (`@volter/editor-react`'s `serving/ui-oid-plugin.ts`)
   * for the soundness argument (one shared file snapshot, highest-offset-first,
   * caller-order-independent). Degrades to a loud no-op — never a silent partial
   * delete — when this session's backend hasn't implemented `writeStructMany` (a
   * hosted/no-dev-server session, or an incomplete backend): `deleteSelection`
   * (`editor-hotkeys.ts`) only reaches this method because `structure.removeMany`
   * is present at all, so there is no further per-id fallback to drop into here.
   */
  private removeManyElements(ids: readonly string[]): Promise<WriteAck> {
    const snapshot = this.snapshot();
    const oids = [
      ...new Set(
        ids.map((id) => snapshot.nodes.get(id)?.oid).filter((oid): oid is string => !!oid),
      ),
    ];
    if (oids.length === 0) {
      return this.structRefusal('batch delete reached no source-addressable element.');
    }
    // One prepared batch source write becomes one history transaction.
    return this.structPipe.structMany(oids, 'delete', undefined, JSX_SOURCE_DESTINATION);
  }

  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener);
  }

  // A class GETTER, not a field initializer — see `ui-authoring-adapter.ts`/
  // `vgai-scene-authoring-adapter.ts` for why (field initializers run before the
  // constructor body assigns `this.writeBackend`).
  get persistence(): PersistenceProvider {
    const backend = this.writeBackend;
    return {
      isDirty: () => this.dirty,
      save: async () => {
        // Immediate-write architecture (same as UIAuthoringAdapter/
        // SourceWriteBackend's doc comment) — every edit already landed on disk
        // the instant it was made; nothing is pending to flush.
      },
      destination: backend ? JSX_SOURCE_DESTINATION : NO_BACKEND_DESTINATION,
    };
  }

  /**
   * EVERY SOURCE WRITE this adapter performs, through the persistence pipe.
   *
   * One dialect here (the JSX/CSS source writer behind `/__ui-source`), so the
   * resolution is one question — is a writer bound in this session — and the
   * writer's own per-edit refusals (a dynamic expression, an unauthored prop, a
   * generated selector) come back as `false` with their reason on the console.
   * That is why they are a WRITE outcome rather than a resolution: the echo is
   * cleared and the field re-reads source, so the honest ack is the live-only
   * floor and the pipe supplies it.
   *
   * `record` does nothing because the source-write backend already carries the
   * whole-file history transaction; journaling here would double the undo.
   */
  private pipedSourceWrite(write: () => Promise<boolean>): Promise<WriteAck> {
    return runWritePipe({
      resolve: (): WriteResolution =>
        this.writeBackend
          ? {
              reaches: 'writer',
              anchorKind: 'source-prop',
              destination: JSX_SOURCE_DESTINATION,
              write,
            }
          : resolvesLiveOnly(NO_BACKEND_DESTINATION),
      record: () => undefined,
      // A session with no writer degrades LOUDLY — the same warning the write
      // helpers raised when they were the ones discovering it. Resolution moved
      // that discovery earlier; the sentence has to move with it or the lane
      // goes quiet for a whole class of edits.
      report: (reason) =>
        console.warn(`[ReactRootAuthoringAdapter] this edit stays live-only — ${reason}.`),
    });
  }

  /**
   * EVERY STRUCTURAL SOURCE WRITE this adapter performs, through the pipe.
   *
   * A second plug point beside {@link pipedSourceWrite} rather than a reuse of
   * it, because a structural edit resolves on a DIFFERENT DOOR: `writeStruct` /
   * `writeStructMany`, not `writeStyle`/`writeProp`. That is why it acks
   * `source-structure` and not the value lane's `source-prop` — resolving a
   * delete on the attribute writer's presence, or naming the attribute lane in
   * its ack, is the classifier/writer split the pipe exists to make impossible.
   *
   * `record` does nothing: the backend is wrapped in `withProjectSourceHistory`
   * (`:957`), so the sha-guarded whole-file transaction that carries the bytes
   * IS the undo entry.
   */
  /**
   * THE STRUCT DIALECT, one producer (`struct-write-pipe.ts`) shared with the
   * r3f and canvas source lanes. This lane's on-changed hook carries the
   * D3.R4 reconcile: the immediate notify's `storeVersion` still reflects the
   * PRE-HMR DOM (see `pendingSourceReconcile`'s doc comment), so a pending
   * reconcile is queued for the upcoming `vite:afterUpdate` to notify AGAIN
   * once the remount has actually happened.
   */
  private readonly structPipe = createStructWritePipe({
    // biome-ignore lint/suspicious/noConsole: a refused source write must be visible
    report: (message) => console.warn(`[ReactRootAuthoringAdapter] ${message}`),
    noWriterReason: NO_BACKEND_DESTINATION,
    backend: () => this.writeBackend,
    onChanged: () => {
      this.dirty = true;
      this.pendingSourceReconcile++;
      this.store.notifyIngestEdit();
    },
  });

  /** The shared pipe's live-only floor, under this lane's own label. */
  private structRefusal(reason: string): Promise<WriteAck> {
    return this.structPipe.structRefusal(reason);
  }
}
