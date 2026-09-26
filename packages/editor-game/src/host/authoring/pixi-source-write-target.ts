/**
 * The TSX-SOURCE half of the canvas surface's persistence axis
 * ({@link CanvasWriteTarget}) — a first-party `@pixi/react` world, whose
 * document IS its source file.
 *
 * Model, and it is the three lane's ({@link
 * ../../three/authoring/r3f-source-authoring-adapter}): the live display tree is truth
 * for STRUCTURE and TRANSFORMS (projected directly, no fabricated document);
 * the project's `.tsx` is truth for PERSISTENCE. A row whose container carries
 * an oid is SOURCE-ADDRESSABLE — its JSX props read from the real source text
 * and write back through the SAME `/__ui-source/*` seam the dom and three
 * lanes use, wrapped in `withProjectSourceHistory` so every write is a
 * checksum-guarded undo/redo entry for free.
 *
 * The literal-vs-dynamic guard is sacred: an expression-bound prop
 * (`x={grunt.x}` — the survivor example's actors are positioned by their sim
 * every tick) is surfaced READ-ONLY and never written, and a gizmo edit on
 * such a channel is refused AND the live object reverts to its pre-drag
 * snapshot. Never a silent two-truths divergence.
 *
 * Local component callsites are projected as native prefab instances. The
 * source transform stamps their callsite identity onto the first Pixi host
 * element, while that host keeps its own definition-side oid. The pair is the
 * same source-derived contract the Three lane uses: callsite props are the
 * instance overrides, declared props are the defaults, and no override sidecar
 * exists.
 */

import type {
  CanvasWriteContext,
  CanvasWriteTarget,
} from './pixi-authoring-adapter';
import {
  authoringOidForContainer,
  isCanvasComponentInstanceRoot,
  oidOfPixiId,
  readContainerOid,
} from './pixi-source-identity';
import {
  formatSourceNumber,
  planChannelWrite,
  transform2DChanged,
} from './pixi-transform-channels';
import { createStructWritePipe, type StructOpOptions } from './struct-write-pipe';
import {
  clipboardOutcome,
  LIVE_ONLY_ACK,
  resolvesLiveOnly,
  runWritePipe,
  type WriteAck,
  type WriteResolution,
} from '@volter/editor-sdk/kit/write-pipe';
import type { CanvasPixiNamespace } from '../canvas-entry-runtime';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { withProjectSourceHistory } from '@volter/editor-sdk/kit/history/source-history-backend';
import { showTransientHint } from '@volter/editor-sdk/kit/transient-hint';
import {
  type ComponentPropSpec,
  lineColToOffset,
  type OidEntry,
} from '@volter/editor-react/source/oid-transform';
import { relativeImportSpecifier } from '@volter/editor-react/source/relative-import-specifier';
import type { SourceWriteBackend } from '@volter/editor-sdk/kit/ui-source/source-write-backend';
import {
  analyzeJsxAttributes,
  findElementEnd,
  findTagEnd,
  type JsxAttrInfo,
} from '@volter/editor-react/source/writer';
import { CANVAS_COMPONENTS_DOCUMENT_ID } from '@volter/editor-sdk/kit/workspace-document-ids';
import { activateWorkspaceDocument } from '@volter/editor-sdk/kit/workspace-document-registry';
import type {
  AssetDropProvider,
  ComponentInstanceApplyResult,
  ComponentInstanceDescription,
  ComponentInstancesProvider,
  NodeCreationSite,
  PersistenceProvider,
  PropertyDescriptor,
  StructureProvider,
  TransformChannel,
  TransformEditability,
} from '@volter/editor-project/adapter';
import type { AuthoringAdapter2D, Transform2DValue } from '../../runtime/pixi/authoring';
import { getComponentPreviewStories } from '@volter/editor-sdk/kit/stories/story-registry';
import type { Container, Matrix } from 'pixi.js';
import * as shellPixi from 'pixi.js';

/** Why a write here resolves live-only — the ONE spelling for this lane. */
const NO_SOURCE_WRITER_REASON = 'this session has no source-write backend';

/** Props the JSX section never lists: the editor's own stamp, the wrapper's
 *  structural props, and the ones the panels above already own. */
const HIDDEN_PROPS = new Set(['key', 'ref', 'data-oid', 'children', 'style', 'className']);
/** Owned by the Transform section and the header's Name field. */
const PANEL_OWNED_PROPS = new Set([
  'x',
  'y',
  'rotation',
  'scale',
  'scale-x',
  'scale-y',
  'label',
  'visible',
]);
/** Props the drop snippet writes itself. */
const DROP_SNIPPET_PROPS = new Set(['x', 'y', 'name', 'children']);

const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const CREATE_SNIPPETS: Readonly<Record<string, string>> = {
  container: '<pixiContainer label="Container" />',
  sprite: '<pixiSprite label="Sprite" />',
  text: '<pixiText label="Text" text="Text" />',
  graphics: '<pixiGraphics label="Graphics" />',
};
const CREATE_LABELS: Readonly<Record<string, string>> = {
  container: 'Container',
  sprite: 'Sprite',
  text: 'Text',
  graphics: 'Graphics',
};

function isHiddenProp(name: string): boolean {
  return HIDDEN_PROPS.has(name) || /^on[A-Z]/.test(name) || name.startsWith('__vgai');
}

/** Present a source identifier the way native engine inspectors present
 *  property names, while keeping the JSX name as source truth. */
function humanizeIdentifier(value: string): string {
  const spaced = value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  return spaced ? spaced[0]!.toUpperCase() + spaced.slice(1) : value;
}

export interface SourceCanvasWriteTargetOptions {
  /** Manifest root id — the world half of every id this lane mints. */
  readonly worldId: string;
  /** Project-relative entry path, for the console messages a refusal writes. */
  readonly entryPath: string;
  /** The RAW backend; wrapped in `withProjectSourceHistory` here (the same
   *  recipe `R3fSourceAuthoringAdapter` uses). Absent ⇒ every write refuses in
   *  a sentence rather than pretending. */
  readonly writeBackend?: SourceWriteBackend | undefined;
  /**
   * THE namespace of the world this target writes for — the mount site's, the
   * same one its `PixiAuthoringAdapter` holds
   * (`../../vite-plugin-module-doorways.ts`).
   *
   * Nothing built here today ESCAPES into the world: `Matrix`/`Transform` are
   * used to decompose a reparent into numbers, which is pure value math that
   * measured correct across instances. It is a parameter anyway, because the
   * lane's rule is that a canvas surface holds ONE namespace with no exceptions
   * a reader has to hold in their head — and because the next value constructed
   * in this file may well be a display object, where the same static import
   * would be a silent bug rather than a harmless one.
   */
  readonly pixi?: CanvasPixiNamespace | undefined;
}

interface CanvasStructureClipboard {
  readonly sourceFile: string;
  readonly text: string;
  readonly count: number;
}

interface CanvasClipboardElement {
  readonly file: string;
  readonly offset: number;
  readonly text: string;
}

function dedentJsxElement(source: string, offset: number, end: number): string {
  const indent = source.slice(source.lastIndexOf('\n', offset - 1) + 1, offset);
  const raw = source.slice(offset, end);
  if (!/^\s*$/.test(indent)) return raw;
  return raw
    .split('\n')
    .map((line, index) => (index > 0 && line.startsWith(indent) ? line.slice(indent.length) : line))
    .join('\n');
}

function highestSelectedIds(
  ids: readonly string[],
  parentOf: (id: string) => string | null,
): string[] {
  const selected = new Set(ids);
  return [...selected].filter((id) => {
    let parentId = parentOf(id);
    while (parentId) {
      if (selected.has(parentId)) return false;
      parentId = parentOf(parentId);
    }
    return true;
  });
}

export function createSourceCanvasWriteTarget(
  options: SourceCanvasWriteTargetOptions,
): CanvasWriteTarget {
  const { worldId, entryPath } = options;
  const pixi = options.pixi ?? shellPixi;
  let a2d: AuthoringAdapter2D;
  let notify: () => void = () => {};
  let backend: SourceWriteBackend | undefined;
  let boundStore: CanvasWriteContext['store'] | undefined;
  let structureClipboard: CanvasStructureClipboard | null = null;

  /** OID → {file,line,col} — fetched from `/__ui-source/index`. */
  let oidIndex = new Map<string, OidEntry>();
  /** file → current source text (for client-side attr analysis). */
  let sources = new Map<string, string>();
  /** Optimistic write echo (id|path → value) until the source re-read lands. */
  const valueEcho = new Map<string, unknown>();
  /** id|channel refused as dynamic this session — rendered read-only. */
  const dynamicPaths = new Set<string>();
  /** Pre-gesture 2D poses, one per id currently under a drag. */
  const editStarts = new Map<string, Transform2DValue>();
  let commitQueue = Promise.resolve();

  const oidOf = (id: string): string | null => {
    // The LIVE object is the authority (an id can outlive a remount), with the
    // id's own encoding as the fallback for a row the walk no longer holds.
    const object = a2d.displayObject(id);
    return (object ? authoringOidForContainer(object) : undefined) ?? oidOfPixiId(worldId, id);
  };

  const liveOids = (): Set<string> => {
    const oids = new Set<string>();
    const visit = (id: string): void => {
      // BOTH addresses. `attrsOf`/`oidOf` resolve a row by its CALLSITE oid,
      // which for a component-instance root lives in the PARENT's file — a
      // file that may contribute no host element of its own (`src/world.tsx`,
      // which only renders `<SurvivorScene />`). A set built from the
      // element's own oid alone never named it, so its source was never
      // fetched and every row addressed there — including anything a drop
      // wrote into it — read "Source metadata is still loading or
      // unavailable" for good (runhuman passes 130/132; traced on a local
      // hosted tier, 2026-09-03). `onReindex`'s staleness probe shares this.
      const object = a2d.displayObject(id);
      const own = readContainerOid(object);
      if (own !== undefined) oids.add(own);
      const callsite = object ? authoringOidForContainer(object) : undefined;
      if (callsite !== undefined) oids.add(callsite);
      for (const childId of a2d.node(id)?.childIds ?? []) visit(childId);
    };
    for (const root of a2d.roots()) visit(root.id);
    return oids;
  };

  /** Refetch the OID index + the source text of every file it references. */
  const refreshSourceState = async (): Promise<void> => {
    if (!backend?.index || !backend.readSource) return;
    try {
      const index = await backend.index();
      oidIndex = new Map(Object.entries(index));
      const files = new Set<string>();
      for (const oid of liveOids()) {
        const entry = oidIndex.get(oid);
        if (entry) files.add(entry.file);
      }
      const next = new Map<string, string>();
      await Promise.all(
        [...files].map(async (file) => {
          const res = await backend!.readSource!(file);
          next.set(file, res.source);
        }),
      );
      sources = next;
      notify();
    } catch {
      // Honest degradation: rows stay live-projected (read-only) when the
      // index/source cannot be fetched.
    }
  };

  /** The node's JSX attributes, analyzed from the CURRENT source text (null
   *  when the node isn't source-addressable or the source isn't cached yet). */
  const attrsOf = (id: string): JsxAttrInfo[] | null => {
    const oid = oidOf(id);
    if (!oid) return null;
    const entry = oidIndex.get(oid);
    if (!entry) return null;
    const source = sources.get(entry.file);
    if (source === undefined) return null;
    const start = lineColToOffset(source, entry.line, entry.col);
    if (source[start] !== '<') return null; // stale index vs source — refuse honestly
    const tagEnd = findTagEnd(source, start);
    if (tagEnd < 0) return null;
    return analyzeJsxAttributes(source, start, tagEnd);
  };

  const projectRelativeSourceFile = (file: string): string => {
    const normalized = file.replaceAll('\\', '/');
    const normalizedEntry = entryPath.replaceAll('\\', '/').replace(/^\.?\//, '');
    if (!normalized.startsWith('/') && !/^[A-Za-z]:\//.test(normalized)) return normalized;
    for (const entry of oidIndex.values()) {
      const indexed = entry.file.replaceAll('\\', '/');
      if (indexed !== normalizedEntry && !indexed.endsWith(`/${normalizedEntry}`)) continue;
      const projectPrefix = indexed.slice(0, -normalizedEntry.length);
      if (normalized.startsWith(projectPrefix)) return normalized.slice(projectPrefix.length);
    }
    return normalizedEntry;
  };

  const declaredPropsOf = (id: string): readonly ComponentPropSpec[] => {
    const oid = oidOf(id);
    return (oid ? oidIndex.get(oid)?.props : undefined) ?? [];
  };

  const definitionOidOf = (id: string): string | null => {
    const object = a2d.displayObject(id);
    if (!object || !isCanvasComponentInstanceRoot(object)) return null;
    const own = readContainerOid(object);
    const callsite = authoringOidForContainer(object);
    return own && own !== callsite ? own : null;
  };

  const componentIdentityOf = (id: string): { name: string; sourcePath?: string } | null => {
    const object = a2d.displayObject(id);
    if (!object || !isCanvasComponentInstanceRoot(object)) return null;
    const definitionOid = definitionOidOf(id);
    const definition = definitionOid ? oidIndex.get(definitionOid) : undefined;
    const callsiteOid = oidOf(id);
    const callsite = callsiteOid ? oidIndex.get(callsiteOid) : undefined;
    const name = definition?.component ?? callsite?.tag;
    if (!name) return null;
    return {
      name,
      ...(definition?.file ? { sourcePath: projectRelativeSourceFile(definition.file) } : {}),
    };
  };

  const creationSiteOf = (id: string): NodeCreationSite => {
    const oid = oidOf(id);
    if (!oid) {
      return {
        anchored: false,
        reason: 'This rendered Canvas object has no authored source identity.',
      };
    }
    const entry = oidIndex.get(oid);
    if (!entry) {
      return { anchored: false, reason: 'Source metadata is still loading or unavailable.' };
    }
    const file = projectRelativeSourceFile(entry.file);
    return {
      anchored: true,
      kind: 'source',
      file,
      line: entry.line,
      col: entry.col,
      display: `${file}:${entry.line}`,
    };
  };

  const persistence: PersistenceProvider | undefined = options.writeBackend
    ? {
        isDirty: () => false,
        save: async () => undefined,
        destination: entryPath,
        lastError: () => {
          const error = boundStore?.shell.projectHistory?.getSnapshot().lastError;
          if (!error) return null;
          return error.code === 'apply-failed' ||
            error.code === 'compensation-failed' ||
            error.code === 'history-limit'
            ? error.message
            : null;
        },
      }
    : undefined;

  const read2D = (id: string): Transform2DValue =>
    a2d.getTransform(id) ?? { position: [0, 0], rotation: 0, scale: [1, 1] };

  /**
   * A channel a COMPONENT INSTANCE's own code owns: the write would need a
   * prop the component neither authors at the callsite nor declares, so the
   * byte lands in the file and never reaches the running object. The same
   * question the drop asks at creation (`declaredSpecsOf`) and the
   * gesture asks at commit — asked by `transformEditability` too, so the
   * field is disabled with the real reason instead of accepting a drag it is
   * going to revert.
   */
  const componentOwnedChannel = (
    id: string,
    channel: TransformChannel,
    attrs: readonly JsxAttrInfo[],
    value: Transform2DValue,
  ): boolean => {
    if (!componentIdentityOf(id)) return false;
    const plan = planChannelWrite(channel, value, attrs);
    if (!plan.writable) return false; // its own refusal names the reason
    const declared = declaredPropsOf(id);
    return plan.writes.some(
      (write) =>
        !attrs.some((attr) => attr.name === write.prop) &&
        !declared.some((spec) => spec.name === write.prop),
    );
  };

  const literalValueOf = (attr: JsxAttrInfo): unknown => {
    if (!attr.isLiteral) return `{${attr.rawValue}}`;
    const raw = attr.rawValue;
    if (!attr.isExpression) return raw;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (NUMBER_RE.test(raw)) return Number(raw);
    return raw.replace(/^['"]|['"]$/g, '');
  };

  const descriptorType = (attr: JsxAttrInfo): PropertyDescriptor['type'] => {
    if (!attr.isExpression) return 'string';
    if (attr.rawValue === 'true' || attr.rawValue === 'false') return 'boolean';
    if (NUMBER_RE.test(attr.rawValue)) return 'number';
    return 'string';
  };

  const serializeValue = (value: unknown): string => {
    if (typeof value === 'number') return formatSourceNumber(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return String(value);
  };

  const propValue = (
    attrs: readonly JsxAttrInfo[] | null,
    declared: readonly ComponentPropSpec[],
    prop: string,
  ): unknown => {
    const attr = attrs?.find((candidate) => candidate.name === prop);
    if (attr) return literalValueOf(attr);
    const spec = declared.find((candidate) => candidate.name === prop);
    return spec ? (spec.defaultValue ?? spec.defaultText) : undefined;
  };

  const isOverride = (
    id: string,
    attr: JsxAttrInfo | undefined,
    spec: ComponentPropSpec | undefined,
  ): boolean =>
    Boolean(
      attr?.isLiteral &&
        spec?.optional &&
        backend?.removeProp &&
        !dynamicPaths.has(`${id}|jsx.${attr.name}`),
    );

  /**
   * Gesture end → one source write per CHANGED channel.
   *
   * A refused channel (an expression-bound prop, a shape this lane cannot
   * express, no backend) reverts the live object to its pre-gesture snapshot:
   * source stays truth, and the viewport never shows a value the file does not
   * have. A multi-channel gesture goes through `runGesture` so one Ctrl+Z
   * restores the whole thing.
   */
  /** One closed gesture. Answers whether ANY byte reached the entry TSX — a
   *  gesture every channel of which was refused is `false`, and the live
   *  object has been reverted to match. */
  const commitTransform = async (id: string, before: Transform2DValue): Promise<boolean> => {
    const after = read2D(id);
    const channels = (['position', 'rotation', 'scale'] as const).filter((channel) =>
      transform2DChanged(channel, before, after),
    );
    if (channels.length === 0) return false;

    const revert = (channel: TransformChannel): void => {
      if (channel === 'position') a2d.setTransform(id, { position: before.position });
      else if (channel === 'rotation') a2d.setTransform(id, { rotation: before.rotation });
      else a2d.setTransform(id, { scale: before.scale });
      notify();
    };

    const oid = oidOf(id);
    if (!oid || !backend?.writeProp) {
      // biome-ignore lint/suspicious/noConsole: a lost write must stay diagnosable
      console.warn(
        `[canvas-source ${entryPath}] transform on "${id}" is not persistable ` +
          `(${oid ? 'no source-write backend' : 'node has no source stamp'}) — reverting.`,
      );
      for (const channel of channels) revert(channel);
      return false;
    }

    const attrs = attrsOf(id) ?? [];
    // A COMPONENT INSTANCE's transform reaches the game only through props the
    // component DECLARES — the same declared-prop gate the three lane's
    // `writeJsxProp` applies to addIfMissing. Appending x/y to a callsite whose
    // component takes no props writes dead schema while the component's own
    // code keeps driving the live object — the tester-visible "it resets on
    // its own" (runhuman pass 63, Survivor's sim-driven HeroActor). An attr
    // the tag ALREADY authors stays editable: that shape is the author's own.
    const instance = componentIdentityOf(id);
    const channelBlocked = (channel: TransformChannel): boolean =>
      componentOwnedChannel(id, channel, attrs, after);
    const writes: Array<{ channel: TransformChannel; prop: string; value: string }> = [];
    for (const channel of channels) {
      if (channelBlocked(channel)) {
        dynamicPaths.add(`${id}|${channel}`);
        // editorConsole, not console: the user watching the value snap back
        // must see WHY in the editor's own Console (the three lane's
        // writeTypedThree narrates its refusals the same way).
        // The Console alone does not reach a user watching the viewport: pass 65
        // read the snap-back as unexplained with the refusal already printed
        // three lines away. The hint says it where they are looking; the
        // Console keeps the full reason.
        showTransientHint(
          `${channel} is owned by <${instance?.name ?? 'this component'}>'s own code — see Console`,
        );
        editorConsole.warn(
          `${channel} on <${instance?.name ?? 'this component'}> is not writable — the ` +
            `component declares no prop for it, so a written value would never reach the running ` +
            `game (the component's own code owns that channel). Edit ` +
            `${instance?.sourcePath ?? 'the component definition'} instead. Reverting.`,
          'authoring',
        );
        revert(channel);
        continue;
      }
      const plan = planChannelWrite(channel, after, attrs);
      if (!plan.writable) {
        dynamicPaths.add(`${id}|${channel}`);
        // biome-ignore lint/suspicious/noConsole: the refusal reason is the whole point
        console.warn(
          `[canvas-source ${entryPath}] ${channel} on "${id}" is not writable — ${plan.reason} ` +
            'Reverting the live object.',
        );
        revert(channel);
        continue;
      }
      for (const write of plan.writes) writes.push({ channel, ...write });
    }
    if (writes.length === 0) return false;

    let persisted = false;
    const run = async (selected: SourceWriteBackend): Promise<void> => {
      for (const write of writes) {
        const res = await selected.writeProp!(oid, write.prop, write.value, {
          // Editing a channel the tag doesn't author yet APPENDS it — placing
          // an object that has never been placed is ordinary authoring, and it
          // must not need a trip to the text editor.
          addIfMissing: true,
          // `scale={1.5}` becomes `scale={{ x, y }}` when a gesture makes it non-uniform.
          ...(write.prop === 'scale' ? { allowShapeUpgrade: true } : {}),
        });
        if (res.changed) {
          persisted = true;
          continue;
        }
        // A channel can span several props. During a revert, for example,
        // x may already be the requested literal while y is the byte that
        // actually changes. That first result is satisfied, not refused: only
        // a dynamic expression or a named backend error closes the channel.
        if (!res.dynamic && !res.error) continue;
        if (res.dynamic) dynamicPaths.add(`${id}|${write.channel}`);
        // biome-ignore lint/suspicious/noConsole: a refused write must say why
        console.warn(
          `[canvas-source ${entryPath}] ${write.prop} write refused for oid "${oid}": ` +
            `${res.dynamic ? 'dynamic expression (guarded)' : (res.error ?? 'no change')} — reverting.`,
        );
        revert(write.channel);
      }
    };
    if (writes.length > 1 && backend.runGesture) {
      await backend.runGesture('Transform', (scoped) => run(scoped));
    } else {
      await run(backend);
    }
    // The file changed under us; re-read it so the next gesture plans against
    // what is now on disk rather than the pre-write text.
    await refreshSourceState();
    notify();
    return persisted;
  };

  /** Mirror a written prop onto the live object where Pixi owns a field of
   *  that name. Deliberately narrow: a redraw courtesy, not a second write
   *  path — anything Pixi does not carry simply waits for the remount. */
  /** The live object's current value for a prop `applyLiveProp` can mirror —
   *  what a refused write must be restored to. */
  const readLiveProp = (id: string, prop: string): unknown => {
    const display = a2d.displayObject(id) as (Container & Record<string, unknown>) | null;
    if (!display) return undefined;
    return prop === 'label' ? display.label : prop in display ? display[prop] : undefined;
  };

  const applyLiveProp = (id: string, prop: string, value: unknown): void => {
    const display = a2d.displayObject(id) as (Container & Record<string, unknown>) | null;
    if (!display) return;
    if (prop === 'label') display.label = String(value);
    else if (prop in display) display[prop] = value;
  };

  /** One prop edit. Answers whether a byte reached the entry TSX; every
   *  refusal has already named itself on the console before it returns. */
  const writeJsxProp = async (
    id: string,
    path: string,
    prop: string,
    value: unknown,
  ): Promise<boolean> => {
    const oid = oidOf(id);
    if (!oid || !backend?.writeProp) {
      // biome-ignore lint/suspicious/noConsole: a refused write must say why
      console.warn(
        `[canvas-source ${entryPath}] cannot write "${prop}" on "${id}": ` +
          `${oid ? 'no source-write backend in this session' : 'node has no source stamp'}.`,
      );
      return false;
    }
    const echoKey = `${id}|${path}`;
    const liveBefore = readLiveProp(id, prop);
    valueEcho.set(echoKey, value);
    // Optimistic on the LIVE object too, so the paused design frame redraws
    // with the new value instead of waiting for a remount.
    applyLiveProp(id, prop, value);
    notify();
    let res: Awaited<ReturnType<NonNullable<SourceWriteBackend['writeProp']>>>;
    try {
      res = await backend.writeProp(oid, prop, serializeValue(value), { addIfMissing: true });
    } catch (error) {
      valueEcho.delete(echoKey);
      notify();
      // biome-ignore lint/suspicious/noConsole: a failed write must stay diagnosable
      console.warn(
        `[canvas-source ${entryPath}] prop write failed for oid "${oid}" prop "${prop}": ${String(error)}`,
      );
      return false;
    }
    if (!res.changed) {
      valueEcho.delete(echoKey);
      if (res.dynamic) dynamicPaths.add(echoKey);
      // REVERT + NARRATE IN THE PRODUCT. A raw console.warn is invisible: a
      // tester renamed a component instance, watched the name stay put with no
      // explanation anywhere they could see, and reported the editor as unable
      // to change the game (runhuman pass 72). Same contract the transform path
      // above and the three lane's typed writes already keep.
      if (liveBefore !== undefined) applyLiveProp(id, prop, liveBefore);
      notify();
      const subject = componentIdentityOf(id)?.name ?? a2d.displayObject(id)?.label ?? id;
      const reason = res.dynamic
        ? `it is bound to an expression in <${subject}>'s own source, so a direct edit cannot land`
        : `the component declares no ${JSON.stringify(prop)} prop to write` +
          `${res.error ? ` (${res.error})` : ''}`;
      showTransientHint(`${prop} on <${subject}> is not writable — see Console`);
      editorConsole.warn(
        `${JSON.stringify(prop)} on <${subject}> is not writable — ${reason}. ` +
          'Edit the component definition (right-click the row → Open Component Source), or the ' +
          'prop that drives it. Reverting.',
        'authoring',
      );
      return false;
    }
    await refreshSourceState();
    return true;
  };

  /** Where THIS node's bytes land — its creation-site file, not the world
   *  entry. `writeProp` addresses an OID that may live in a scene/prefab the
   *  entry only imports; naming `entryPath` here is how a Floor edit in
   *  `SurvivorScene.tsx` acked `src/world.tsx`. */
  const destinationOf = (id: string): string => {
    const site = creationSiteOf(id);
    return site.anchored ? site.file : entryPath;
  };

  /**
   * THIS TARGET'S PLUG INTO THE ONE PERSISTENCE PIPE
   * (`resolve(anchor) → write(dialect) → record(recorder)`, `write-pipe.ts`).
   *
   * The dialect is one — `SourceWriteBackend.writeProp` against the node's
   * own source file — so the resolution is one question: is a writer bound
   * in this session. The target's own per-edit refusals (an expression-bound
   * attribute, an unstamped node, a plan this channel cannot express) are
   * WRITE outcomes rather than resolutions: they revert the live object and
   * name themselves on the console, so the edit's honest ack is the live-only
   * floor and the pipe supplies it.
   *
   * `record` is a no-op because the source-write backend is wrapped in the
   * project's own source history — the transaction that carries the bytes IS
   * the history entry, and journaling here would make one gesture two undos.
   */
  const piped = (
    write: () => Promise<boolean>,
    /** Which backend verb THIS edit's dialect needs bound. A removal is the
     *  same dialect and the same anchor as a prop write, but it needs
     *  `removeProp`; resolving on the wrong verb acks `source-prop` for a door
     *  the session does not have. */
    bound: boolean = backend?.writeProp !== undefined,
    destination: string = entryPath,
  ): Promise<WriteAck> =>
    runWritePipe({
      resolve: (): WriteResolution =>
        bound
          ? { reaches: 'writer', anchorKind: 'source-prop', destination, write }
          : resolvesLiveOnly(NO_SOURCE_WRITER_REASON),
      record: () => undefined,
      // A session with no writer degrades LOUDLY — the write helpers used to be
      // the ones discovering it, and resolution now discovers it first, so the
      // sentence has to move with it.
      report: (reason) => {
        // biome-ignore lint/suspicious/noConsole: a lane that cannot persist must say so
        console.warn(`[canvas-source ${destination}] this edit stays live-only — ${reason}.`);
      },
    });

  const reportStruct = (message: string): void => {
    // biome-ignore lint/suspicious/noConsole: source refusal must be visible
    console.warn(`[canvas-source ${entryPath}] ${message}`);
  };

  /**
   * THE STRUCT DIALECT — the shared one-producer pipe
   * (`struct-write-pipe.ts`), configured with this target's reporter, its
   * live backend and its reconcile hook. The struct verbs resolve on their
   * own door and ack `source-structure`, never the value lane's
   * `source-prop` — the shared module's header carries the full rule.
   */
  const structPipe = createStructWritePipe({
    report: reportStruct,
    noWriterReason: NO_SOURCE_WRITER_REASON,
    backend: () => backend,
    onChanged: async () => {
      await refreshSourceState();
      notify();
    },
  });
  const structRefusal = (reason: string): Promise<WriteAck> => structPipe.structRefusal(reason);

  const structOp = (
    id: string,
    op: string,
    opts?: StructOpOptions,
    oidOverride?: string,
  ): Promise<WriteAck> =>
    structPipe.structOp(oidOverride ?? oidOf(id), id, op, opts, destinationOf(id));

  const structMany = (
    ids: readonly string[],
    op: string,
    opts?: { wrapperTag?: string },
  ): Promise<WriteAck> => {
    const oids = [...new Set(ids.map(oidOf).filter((oid): oid is string => Boolean(oid)))];
    if (oids.length !== new Set(ids).size) {
      return structRefusal(`${op} refused: every selected node must be source-addressable.`);
    }
    return structPipe.structMany(oids, op, opts, destinationOf(ids[0] ?? ''));
  };

  const clipboardPayload = (ids: readonly string[]): CanvasStructureClipboard | null => {
    const topLevel = highestSelectedIds(ids, (id) => a2d.node(id)?.parentId ?? null);
    const elementFor = (id: string): CanvasClipboardElement | null => {
      const oid = oidOf(id);
      const entry = oid ? oidIndex.get(oid) : undefined;
      const source = entry ? sources.get(entry.file) : undefined;
      if (!oid || !entry || source === undefined) return null;
      const offset = lineColToOffset(source, entry.line, entry.col);
      const end = findElementEnd(source, offset);
      return source[offset] === '<' && end > offset
        ? { file: entry.file, offset, text: dedentJsxElement(source, offset, end) }
        : null;
    };
    const elements: CanvasClipboardElement[] = [];
    const seenOids = new Set<string>();
    for (const id of topLevel) {
      const oid = oidOf(id);
      if (!oid || seenOids.has(oid)) continue;
      seenOids.add(oid);
      const element = elementFor(id);
      if (!element) return null;
      elements.push(element);
    }
    if (elements.length === 0) return null;
    const sourceFile = elements[0]!.file;
    if (elements.some((element) => element.file !== sourceFile)) return null;
    elements.sort((a, b) => a.offset - b.offset);
    return {
      sourceFile,
      text: elements.map((element) => element.text).join('\n'),
      count: elements.length,
    };
  };

  const refuseClipboard = (reason: string): false => {
    reportStruct(reason);
    showTransientHint(reason);
    return false;
  };

  const copyStructure = async (ids: readonly string[]): Promise<boolean> => {
    structureClipboard = null;
    const payload = clipboardPayload(ids);
    if (!payload) {
      return refuseClipboard('Copy needs source-addressable Canvas nodes from one source file.');
    }
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard?.writeText) return refuseClipboard('The system clipboard is unavailable.');
    try {
      await clipboard.writeText(payload.text);
    } catch {
      return refuseClipboard('The system clipboard refused the Canvas copy.');
    }
    structureClipboard = payload;
    showTransientHint(`Copied ${payload.count} ${payload.count === 1 ? 'node' : 'nodes'}.`);
    return true;
  };

  const removeSourceNodes = async (ids: readonly string[]): Promise<WriteAck> => {
    if (backend?.writeStructMany) return structMany(ids, 'delete');
    // No batch door: the per-id loop IS the write, and the gesture's honest ack
    // is the last id's — one gesture, one answer, never a blanket `true`.
    let ack: WriteAck = LIVE_ONLY_ACK;
    for (const id of ids) ack = await structOp(id, 'delete');
    return ack;
  };

  const pasteTarget = (
    parentId: string | null,
  ): { id: string; oid: string; file: string; op: 'create' | 'create-sibling' } | null => {
    const targetFor = (id: string, op: 'create' | 'create-sibling', preferDefinition: boolean) => {
      const definitionOid = preferDefinition ? definitionOidOf(id) : null;
      const oid = definitionOid ?? oidOf(id);
      const entry = oid ? oidIndex.get(oid) : undefined;
      return oid && entry ? { id, oid, file: entry.file, op, definition: !!definitionOid } : null;
    };
    if (parentId) {
      return targetFor(parentId, 'create', true);
    }
    const lastRoot = a2d.roots().at(-1);
    if (!lastRoot) return null;
    const target = targetFor(lastRoot.id, 'create-sibling', true);
    return target ? { ...target, op: target.definition ? 'create' : 'create-sibling' } : null;
  };

  const canPasteStructure = (parentId: string | null): boolean => {
    const target = pasteTarget(parentId);
    return !!structureClipboard && !!target && target.file === structureClipboard.sourceFile;
  };

  const pasteStructure = async (parentId: string | null): Promise<false | WriteAck> => {
    const payload = structureClipboard;
    if (!payload) return refuseClipboard('Copy or cut a Canvas node before pasting.');
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard?.readText) return refuseClipboard('The system clipboard is unavailable.');
    try {
      if ((await clipboard.readText()) !== payload.text) {
        return refuseClipboard('The clipboard changed after the Canvas copy.');
      }
    } catch {
      return refuseClipboard('The system clipboard refused the Canvas paste.');
    }
    const target = pasteTarget(parentId);
    if (!target) return refuseClipboard('Paste needs a source-addressable Canvas parent.');
    if (target.file !== payload.sourceFile) {
      return refuseClipboard(
        'Cross-file paste is refused because the destination may not import the copied dependencies.',
      );
    }
    return clipboardOutcome(
      await structOp(target.id, target.op, { snippet: payload.text }, target.oid),
    );
  };

  const localToRootMatrix = (object: Container): Matrix => {
    const chain: Container[] = [];
    let cursor: Container | null = object;
    while (cursor) {
      chain.push(cursor);
      cursor = cursor.parent as Container | null;
    }
    const result = new pixi.Matrix();
    for (let index = chain.length - 1; index >= 0; index--) {
      const node = chain[index]!;
      node.updateLocalTransform();
      result.append(node.localTransform);
    }
    return result;
  };

  const reparentRebase = (
    id: string,
    parentId: string,
  ): {
    position: readonly number[];
    rotation: readonly number[];
    scale: readonly number[];
    scalarChannels: readonly ['rotation'];
  } | null => {
    const object = a2d.displayObject(id);
    const parent = a2d.displayObject(parentId);
    if (!object || !parent) return null;
    const local = localToRootMatrix(parent).clone().invert().append(localToRootMatrix(object));
    const decomposed = new pixi.Transform();
    local.decompose(decomposed);
    const pivot = object.pivot ?? { x: 0, y: 0 };
    return {
      position: [
        local.tx + pivot.x * local.a + pivot.y * local.c,
        local.ty + pivot.x * local.b + pivot.y * local.d,
      ],
      rotation: [decomposed.rotation],
      scale: [decomposed.scale.x, decomposed.scale.y],
      scalarChannels: ['rotation'],
    };
  };

  const oidInstanceCount = (oid: string): number => {
    let count = 0;
    const visit = (id: string): void => {
      if (readContainerOid(a2d.displayObject(id)) === oid) count++;
      for (const childId of a2d.node(id)?.childIds ?? []) visit(childId);
    };
    for (const root of a2d.roots()) visit(root.id);
    return count;
  };

  const affectedInstances = (id: string, prop: string): number => {
    const definitionOid = definitionOidOf(id);
    if (!definitionOid) return 0;
    let count = 1;
    const visit = (candidateId: string): void => {
      if (
        candidateId !== id &&
        definitionOidOf(candidateId) === definitionOid &&
        !attrsOf(candidateId)?.some((attr) => attr.name === prop)
      ) {
        count += 1;
      }
      for (const childId of a2d.node(candidateId)?.childIds ?? []) visit(childId);
    };
    for (const root of a2d.roots()) visit(root.id);
    return count;
  };

  const removeOverride = async (id: string, path: string): Promise<boolean> => {
    const oid = oidOf(id);
    const prop = path.startsWith('jsx.') ? path.slice(4) : null;
    if (!oid || !prop || !backend?.removeProp) return false;
    const result = await backend.removeProp(oid, prop);
    if (!result.changed) {
      reportStruct(`revert ${prop} refused/no-op: ${result.error ?? 'no change'}.`);
      return false;
    }
    valueEcho.delete(`${id}|${path}`);
    await refreshSourceState();
    notify();
    return true;
  };

  const authoredTransformProps = (
    channel: TransformChannel,
    attrs: readonly JsxAttrInfo[],
  ): string[] => {
    const names =
      channel === 'position'
        ? ['x', 'y']
        : channel === 'rotation'
          ? ['rotation']
          : attrs.some((attr) => attr.name === 'scale-x' || attr.name === 'scale-y')
            ? ['scale-x', 'scale-y']
            : ['scale'];
    return names.filter((name) => attrs.some((attr) => attr.name === name));
  };

  const removeTransform = async (id: string, channel: TransformChannel): Promise<boolean> => {
    const oid = oidOf(id);
    const attrs = attrsOf(id);
    if (!oid || !attrs || !backend?.removeProp) return false;
    const props = authoredTransformProps(channel, attrs);
    if (props.length === 0) return false;
    let changed = false;
    const run = async (selected: SourceWriteBackend): Promise<void> => {
      for (const prop of props) {
        const result = await selected.removeProp?.(oid, prop);
        if (result?.changed) changed = true;
        else reportStruct(`revert ${prop} refused/no-op: ${result?.error ?? 'no change'}.`);
      }
    };
    if (props.length > 1 && backend.runGesture) {
      await backend.runGesture(`Remove ${channel}`, (selected) => run(selected));
    } else {
      await run(backend);
    }
    if (!changed) return false;
    await refreshSourceState();
    notify();
    return true;
  };

  const instancesProvider: ComponentInstancesProvider = {
    openComponent: () => {
      void activateWorkspaceDocument(CANVAS_COMPONENTS_DOCUMENT_ID);
    },
    describe: (id): ComponentInstanceDescription | null => {
      const component = componentIdentityOf(id);
      if (!component) return null;
      // THE CSF GATE, and it lives HERE because this target is the one whose
      // instances ARE portable-CSF prefab instances — the same sentence
      // `r3f-source-authoring-adapter.ts`'s `instances.describe` says, in the
      // adapter that owns both halves of it. It was previously a blanket
      // wrapper in `PixiAuthoringAdapter`, asked of every target that names a
      // component; once the LIVE target learned to name a class-owned object's
      // component, that wrapper silently deleted the creation-site lane's whole
      // instances capability for any class with no matching story. A target
      // whose instance notion is the CONSTRUCTION STATEMENT has no story to
      // require, and it answers for itself.
      if (getComponentPreviewStories(component.name, component.sourcePath).length === 0) {
        return null;
      }
      const attrs = attrsOf(id);
      if (!attrs) return null;
      const declared = declaredPropsOf(id);
      const overrides = attrs
        .map((attr) => {
          const path = `jsx.${attr.name}`;
          const spec = declared.find((candidate) => candidate.name === attr.name);
          if (
            isHiddenProp(attr.name) ||
            PANEL_OWNED_PROPS.has(attr.name) ||
            !isOverride(id, attr, spec)
          ) {
            return null;
          }
          const canApplyToComponent = Boolean(
            spec?.defaultValue !== undefined &&
              definitionOidOf(id) &&
              backend?.runGesture &&
              backend.writeComponentDefault &&
              backend.removeProp,
          );
          return {
            path,
            label: humanizeIdentifier(attr.name),
            value: literalValueOf(attr),
            ...(spec?.defaultText === undefined ? {} : { defaultText: spec.defaultText }),
            canApplyToComponent,
            affectedInstanceCount: affectedInstances(id, attr.name),
            ...(canApplyToComponent
              ? {}
              : {
                  applyUnavailableReason:
                    spec?.defaultValue === undefined
                      ? 'The component default is computed or absent, so source cannot be changed safely.'
                      : 'This session cannot atomically update the component and its callsite.',
                }),
          };
        })
        .filter((override): override is NonNullable<typeof override> => override !== null);
      return {
        componentName: component.name,
        ...(component.sourcePath ? { sourcePath: component.sourcePath } : {}),
        overrides,
      };
    },
    revert: async (id, paths) => {
      let changed = false;
      const run = async (selected: SourceWriteBackend): Promise<void> => {
        const oid = oidOf(id);
        if (!oid) return;
        for (const path of paths) {
          const prop = path.startsWith('jsx.') ? path.slice(4) : null;
          if (!prop) continue;
          const result = await selected.removeProp?.(oid, prop);
          changed ||= result?.changed === true;
        }
      };
      if (paths.length > 1 && backend?.runGesture) {
        await backend.runGesture(`Revert ${paths.length} Overrides`, run);
      } else if (backend) {
        await run(backend);
      }
      await refreshSourceState();
      notify();
      return changed ? { destination: destinationOf(id), persisted: true } : undefined;
    },
    applyToComponent: async (id, path): Promise<ComponentInstanceApplyResult> => {
      const prop = path.startsWith('jsx.') ? path.slice(4) : null;
      const spec = prop
        ? declaredPropsOf(id).find((candidate) => candidate.name === prop)
        : undefined;
      const definitionOid = definitionOidOf(id);
      const callsiteOid = oidOf(id);
      const component = componentIdentityOf(id);
      if (
        !prop ||
        spec?.defaultValue === undefined ||
        !definitionOid ||
        !callsiteOid ||
        !backend?.runGesture ||
        !backend.writeComponentDefault ||
        !backend.removeProp
      ) {
        return {
          changed: false,
          message: 'Apply was refused because both literal source writes are not available.',
        };
      }
      const value = propValue(attrsOf(id), declaredPropsOf(id), prop);
      await backend.runGesture(
        `Apply ${prop} to ${component?.name ?? 'Component'}`,
        async (scoped) => {
          const applied = await scoped.writeComponentDefault?.(
            definitionOid,
            prop,
            serializeValue(value),
          );
          if (!applied?.changed)
            throw new Error(applied?.error ?? 'The component default did not change.');
          const reverted = await scoped.removeProp?.(callsiteOid, prop);
          if (!reverted?.changed)
            throw new Error(reverted?.error ?? 'The callsite override was not removed.');
        },
      );
      await refreshSourceState();
      notify();
      return {
        changed: true,
        message: `${prop} now defaults to ${String(value)} in ${component?.name ?? 'the component'}.`,
        write: {
          destination: component?.sourcePath ?? destinationOf(id),
          persisted: true,
        },
      };
    },
  };

  const sourceStructure: StructureProvider = {
    // The new element's oid is minted server-side on the remount, so the id
    // half is '' and the ack half is this creation's own piped write — handed
    // back rather than fired `void` (see `StructuralIdWrite`).
    create: (kind, parentId) => {
      const snippet = CREATE_SNIPPETS[kind];
      // Nothing was attempted (the palette is empty in both cases), so there is
      // no write to ack.
      if (!snippet || !backend?.writeStruct) return { id: '', ack: undefined };
      if (parentId) return { id: '', ack: structOp(parentId, 'create', { snippet }) };
      const lastRoot = a2d.roots().at(-1);
      if (!lastRoot) {
        return {
          id: '',
          ack: structRefusal(
            'create refused: the source needs one addressable root insertion point.',
          ),
        };
      }
      return { id: '', ack: structOp(lastRoot.id, 'create-sibling', { snippet }) };
    },
    creatableKinds: (parentId) => {
      if (!backend?.writeStruct) return [];
      if (parentId && !oidOf(parentId)) return [];
      if (!parentId && a2d.roots().length === 0) return [];
      return Object.keys(CREATE_SNIPPETS).map((kind) => ({
        kind,
        label: CREATE_LABELS[kind] ?? kind,
      }));
    },
    // Returns the promise (never `void structOp(…)`): `deleteSelection`
    // (`editor-hotkeys.ts`) awaits each id so a same-file multi-delete's writes
    // land strictly one at a time. Firing them un-awaited is the lost-update
    // race that fix exists for — every id read the file before any of them
    // wrote it back.
    remove: (id) => structOp(id, 'delete'),
    removeMany: (ids) => removeSourceNodes(ids),
    copy: (ids) => copyStructure(ids),
    canCopy: (ids) => clipboardPayload(ids) !== null,
    cut: async (ids) => {
      if (!(await copyStructure(ids))) return false;
      return clipboardOutcome(await removeSourceNodes(ids));
    },
    paste: (parentId) => pasteStructure(parentId),
    canPaste: (parentId) => canPasteStructure(parentId),
    // Same shape as `remove` above, and for the same reason: the write's promise
    // goes BACK to the caller so `duplicateSelection` can await each id's byte
    // before firing the next, instead of racing N same-file writes.
    duplicate: (id) => ({ id, ack: structOp(id, 'duplicate') }),
    wrap: (id, wrapperTag) => structOp(id, 'wrap', { wrapperTag: wrapperTag ?? 'pixiContainer' }),
    unwrap: (id) => structOp(id, 'unwrap'),
    group: (ids) => {
      const unique = [...new Set(ids)];
      if (unique.length < 2) return { id: null, ack: undefined };
      const parentId = a2d.node(unique[0]!)?.parentId ?? null;
      if (unique.some((id) => a2d.node(id)?.parentId !== parentId)) {
        return { id: null, ack: structRefusal('group refused: select two or more siblings.') };
      }
      return { id: '', ack: structMany(unique, 'group', { wrapperTag: 'pixiContainer' }) };
    },
    canUngroup: (id) => {
      const oid = oidOf(id);
      return Boolean(
        oid &&
          oidIndex.get(oid)?.tag === 'pixiContainer' &&
          (a2d.node(id)?.childIds.length ?? 0) > 0,
      );
    },
    ungroup: (id) => {
      if (!sourceStructure.canUngroup?.(id)) return { ids: [], ack: undefined };
      const children = [...(a2d.node(id)?.childIds ?? [])];
      return { ids: children, ack: structOp(id, 'unwrap') };
    },
    reparent: (id, parentId) => {
      if (!parentId) {
        return structRefusal('reparent refused: drop onto a source-addressable container.');
      }
      const parentOid = oidOf(parentId);
      const sourceOid = oidOf(id);
      const rebase = reparentRebase(id, parentId);
      if (!parentOid || !sourceOid || !rebase) {
        return structRefusal('reparent refused: the source or destination is not addressable.');
      }
      return structOp(id, 'reparent', {
        parentOid,
        rebase,
        destinationInstances: oidInstanceCount(parentOid),
        sourceInstances: oidInstanceCount(sourceOid),
      });
    },
    reorder: (id, beforeSiblingId) => {
      if (beforeSiblingId) {
        const targetOid = oidOf(beforeSiblingId);
        if (!targetOid) {
          return structRefusal('reorder refused: the target has no source identity.');
        }
        return structOp(id, 'reorder', { targetOid });
      }
      const parentId = a2d.node(id)?.parentId;
      const parentOid = parentId ? oidOf(parentId) : null;
      if (!parentOid) {
        return structRefusal('reorder-to-end refused: the parent has no source identity.');
      }
      return structOp(id, 'reorder', { parentOid });
    },
  };

  const relativeProjectModule = (fromFile: string, targetFile: string): string =>
    relativeImportSpecifier(
      projectRelativeSourceFile(fromFile),
      projectRelativeSourceFile(targetFile),
    );

  /**
   * Does this component declare a placement prop (`x`/`y`) of its own?
   * `true` yes, `false` it declares props and none of them place it, `null`
   * when the declaration could not be read at all (no backend, unreadable
   * file, or a prop surface this syntax-only pass cannot follow).
   */
  const declaredSpecsOf = async (item: {
    name: string;
    sourcePath?: string;
  }): Promise<readonly ComponentPropSpec[] | null> => {
    const file = item.sourcePath;
    if (!file || !backend?.readSource) return null;
    try {
      const { source } = await backend.readSource(file);
      const { parseAuthoringTsx } = await import('@volter/editor-react/source/ts-ast');
      const { localComponentPropSpecs } = await import('@volter/editor-react/source/syntactic-prop-specs');
      return (
        localComponentPropSpecs(parseAuthoringTsx(file, source), new Map()).get(item.name) ?? null
      );
    } catch {
      return null;
    }
  };
  /** Props the drop cannot supply: required, no default, not an enum (an
   *  enum gets its first option), not something the snippet writes. */
  const unsuppliedRequiredProps = (specs: readonly ComponentPropSpec[]): ComponentPropSpec[] =>
    specs.filter(
      (spec) =>
        !spec.optional &&
        spec.defaultText === undefined &&
        spec.type !== 'enum' &&
        !DROP_SNIPPET_PROPS.has(spec.name),
    );
  const requiredEnumAttrs = (specs: readonly ComponentPropSpec[]): string =>
    specs
      .filter(
        (spec) =>
          !spec.optional &&
          spec.defaultText === undefined &&
          spec.type === 'enum' &&
          spec.options?.[0] !== undefined,
      )
      .map((spec) => {
        const first = spec.options?.[0];
        return typeof first === 'string'
          ? ` ${spec.name}=${JSON.stringify(first)}`
          : ` ${spec.name}={${first}}`;
      })
      .join('');

  const sourceAssetDrop: AssetDropProvider = {
    accepts: (nodeId, assetPath, context) => {
      if (!backend?.writeStruct) return false;
      const target = nodeId ? oidOf(nodeId) : a2d.roots().at(-1)?.id;
      if (!target) return false;
      const item = context?.item;
      return item?.kind === 'component'
        ? item.surface === 'canvas'
        : /\.(?:png|jpe?g|webp|gif|avif|svg)$/i.test(assetPath);
    },
    // A drop that lands as an ELEMENT in the source IS a structural write, so it
    // answers with that write's ack — `AssetDropProvider.drop`'s own contract.
    // This used to `await structOp(…)` and return `undefined`, which threw the
    // answer away one frame after producing it.
    drop: async (nodeId, assetPath, context) => {
      const anchorId = nodeId || a2d.roots().at(-1)?.id || '';
      const anchorOid = oidOf(anchorId);
      const anchorEntry = anchorOid ? oidIndex.get(anchorOid) : undefined;
      if (!anchorId || !anchorEntry) {
        return structRefusal('asset drop refused: there is no source-addressable insertion point.');
      }
      const item = context?.item;
      const position = context?.position;
      const xy = position
        ? ` x={${formatSourceNumber(position[0])}} y={${formatSourceNumber(position[1])}}`
        : '';
      let snippet: string;
      let ensureImport: { name: string; module: string; kind?: 'default' | 'named' };
      if (item?.kind === 'component') {
        if (item.surface !== 'canvas') {
          return structRefusal(`${item.name} is a ${item.surface} component, not a Canvas prefab.`);
        }
        // A COMPONENT THAT PLACES ITSELF IS NOT GIVEN COORDINATES. Writing
        // `x`/`y` onto a callsite whose component declares neither is dead
        // schema — the same write `channelBlocked` above refuses for a drag,
        // in this file, for this reason: the component's own code keeps
        // driving the live object. The drop did it anyway, so a survivor
        // prefab like `<Grunt>` (props: `phase`) was created carrying
        // coordinates it ignores, landed where its sim put it, and then
        // refused every later edit with "position is owned by <Grunt>'s own
        // code" — which two testers read as the editor being broken (runhuman
        // passes 115 and 119). Say it at CREATION instead, where the author
        // is looking, and write only what the component can read. An
        // UNRESOLVABLE declaration (props from an imported alias this
        // syntax-only read cannot follow) is not an answer, so it keeps the
        // coordinates: never turn "cannot tell" into a silent omission.
        const specs = await declaredSpecsOf(item);
        // A COMPONENT THAT NEEDS WHAT NO DROP CAN GIVE IS REFUSED BY NAME. The
        // retro shooter's <Bunker> takes the sim's own `grid: PixelGrid`;
        // dropped bare it threw in its first render ("Cannot read properties
        // of undefined (reading 'width')"), the world went down, and the
        // author saw "no renderable content" (runhuman pass 148). A required
        // enum gets its first option; anything else required and defaultless
        // stops the drop here and says which props and where to fix it.
        const missing = specs ? unsuppliedRequiredProps(specs) : [];
        if (missing.length > 0) {
          const named = missing.map((spec) => `\`${spec.name}\``).join(', ');
          return structRefusal(
            `${item.name} needs ${named} — required props with no default, which a drop cannot ` +
              `supply. Place it from a story that provides them, or give them defaults in ` +
              `${item.sourcePath ?? 'its component'}.`,
          );
        }
        const placement = specs
          ? specs.some((spec) => spec.name === 'x' || spec.name === 'y')
          : null;
        const ownsPlacement = placement === false;
        if (ownsPlacement && position) {
          const said =
            `${item.name} places itself — its own code owns x/y, so the drop point was not ` +
            'written. Move it by editing that component, or give it x/y props.';
          showTransientHint(said);
          reportStruct(said);
        }
        snippet = `<${item.name}${ownsPlacement ? '' : xy}${specs ? requiredEnumAttrs(specs) : ''} />`;
        ensureImport = {
          name: item.name,
          module: relativeProjectModule(anchorEntry.file, item.sourcePath),
          kind: item.exportKind,
        };
      } else {
        if (!/\.(?:png|jpe?g|webp|gif|avif|svg)$/i.test(assetPath)) {
          return structRefusal(`${assetPath} is not an image or Canvas prefab.`);
        }
        const label =
          assetPath
            .split('/')
            .pop()
            ?.replace(/\.[^.]+$/, '') || 'Sprite';
        snippet = `<pixiSprite label="${label.replace(/["\\]/g, '')}" texture={Texture.from(${JSON.stringify(assetPath)})}${xy} />`;
        ensureImport = { name: 'Texture', module: 'pixi.js' };
      }
      return structOp(anchorId, nodeId ? 'create' : 'create-sibling', {
        snippet,
        ensureImport,
      });
    },
  };

  return {
    provenance: {
      source: 'source-code',
      label: 'Pixi source',
      detail:
        'Live @pixi/react display tree; literal JSX props write back to the .tsx source ' +
        '(expression-bound props are read-only).',
    },
    // Accepted edits auto-save through project history. The provider is still
    // the generic shell's honest destination/failure report, exactly like the
    // R3F source lane; save itself has nothing pending to flush.
    ...(persistence ? { persistence } : {}),
    structure: sourceStructure,
    assetDrop: sourceAssetDrop,

    truth: (id) => ({
      site: creationSiteOf(id),
      writeAnchorKind: backend && oidOf(id) ? 'source-prop' : 'live-only',
    }),
    componentIdentity: componentIdentityOf,
    instances: () => instancesProvider,

    bind(context: CanvasWriteContext): void {
      a2d = context.a2d;
      notify = context.notify;
      boundStore = context.store;
      backend = withProjectSourceHistory(options.writeBackend, context.store.shell.projectHistory);
      void refreshSourceState();
    },

    onReindex(): void {
      // A late subtree can live in files the first fetch never saw (the fetch
      // caches only files referenced by then-LIVE oids), so refetch when any
      // live oid is unindexed or its file uncached — otherwise the new rows'
      // props read as unaddressable rather than editable.
      for (const oid of liveOids()) {
        const entry = oidIndex.get(oid);
        if (entry === undefined || !sources.has(entry.file)) {
          void refreshSourceState();
          return;
        }
      }
    },

    transformEditability(id: string, channel: TransformChannel): TransformEditability {
      const oid = oidOf(id);
      if (!oid) {
        return { writable: false, reason: 'This rendered part has no authored source identity.' };
      }
      if (!backend?.writeProp) {
        return { writable: false, reason: 'This session has no source writer.' };
      }
      if (dynamicPaths.has(`${id}|${channel}`)) {
        return { writable: false, reason: `${channel} is controlled by a JSX expression.` };
      }
      const attrs = attrsOf(id);
      if (!attrs) {
        return { writable: false, reason: 'Source metadata is still loading or unavailable.' };
      }
      if (componentOwnedChannel(id, channel, attrs, read2D(id))) {
        const name = componentIdentityOf(id)?.name ?? 'this component';
        return {
          writable: false,
          reason: `${channel} is owned by <${name}>'s own code — it declares no prop for it.`,
        };
      }
      const plan = planChannelWrite(channel, read2D(id), attrs);
      return plan.writable
        ? {
            writable: true,
            ...(backend.removeProp && authoredTransformProps(channel, attrs).length > 0
              ? { removable: true }
              : {}),
          }
        : { writable: false, reason: plan.reason };
    },

    beginTransformEdit(id: string): void {
      if (!editStarts.has(id)) editStarts.set(id, read2D(id));
    },

    writeTransform(id: string, next: Transform2DValue): void {
      // The live tree moves first so the paused frame follows the gesture; the
      // source write happens once, at the end.
      a2d.setTransform(id, next);
      notify();
    },

    // THE GESTURE'S OWN ACK, through the pipe and AWAITED — the commit still
    // serializes behind whatever is already queued (one ordered source/history
    // transaction per gesture is why the queue exists), and the promise this
    // returns resolves only once the bytes have landed or the lane has honestly
    // reported that none did.
    endTransformEdit(id: string): void | Promise<WriteAck> {
      const before = editStarts.get(id);
      if (!before) return;
      editStarts.delete(id);
      const acked = commitQueue.then(() =>
        piped(
          () =>
            commitTransform(id, before).catch((error: unknown) => {
              // biome-ignore lint/suspicious/noConsole: a lost source write must stay diagnosable
              console.error(`[canvas-source ${destinationOf(id)}] transform commit failed`, error);
              return false;
            }),
          backend?.writeProp !== undefined,
          destinationOf(id),
        ),
      );
      // The QUEUE must never inherit a rejection — one poisoned link would
      // strand every later gesture on this world. It absorbs and says so; the
      // gesture's own caller still gets the rejection through `acked`.
      commitQueue = acked.then(
        () => undefined,
        (error: unknown) => {
          // biome-ignore lint/suspicious/noConsole: a lost source write must stay diagnosable
          console.error(`[canvas-source ${entryPath}] transform commit failed`, error);
        },
      );
      return acked;
    },

    removeTransform(id: string, channel: TransformChannel): Promise<WriteAck> {
      return piped(
        () => removeTransform(id, channel),
        backend?.removeProp !== undefined,
        destinationOf(id),
      );
    },

    // Same channel every other refusal on this lane uses, so the world's
    // authoring story is told in one voice: the `.tsx` is truth for
    // persistence, and this op did not reach it.
    reportStructureLiveOnly(label: string, reason: string): void {
      // biome-ignore lint/suspicious/noConsole: a live-only structural edit must stay diagnosable
      console.warn(`[canvas-source ${entryPath}] ${label} stayed live-only — ${reason}.`);
    },

    properties(id: string): PropertyDescriptor[] {
      if (!a2d.displayObject(id)) return [];
      // `name` is the reserved path the shell renders the hierarchy rename
      // field against; on this surface it IS Pixi's `label` prop.
      const props: PropertyDescriptor[] = [
        { path: 'name', label: 'Name', type: 'string' },
        { path: 'visible', label: 'Visible', type: 'boolean', group: 'Visibility' },
      ];
      const attrs = attrsOf(id) ?? [];
      const declared = declaredPropsOf(id);
      const attrByName = new Map(attrs.map((attr) => [attr.name, attr]));
      const names = [
        ...declared.map((spec) => spec.name),
        ...attrs
          .filter((attr) => !declared.some((spec) => spec.name === attr.name))
          .map((attr) => attr.name),
      ];
      const group = componentIdentityOf(id)?.name ?? 'Properties';
      for (const name of names) {
        if (isHiddenProp(name) || PANEL_OWNED_PROPS.has(name)) continue;
        const attr = attrByName.get(name);
        const spec = declared.find((candidate) => candidate.name === name);
        const opaqueDefault =
          !attr && spec?.defaultText !== undefined && spec.defaultValue === undefined;
        const resettable = isOverride(id, attr, spec);
        props.push({
          path: `jsx.${name}`,
          label: humanizeIdentifier(name),
          type: opaqueDefault ? 'string' : (spec?.type ?? (attr ? descriptorType(attr) : 'string')),
          ...(spec?.options ? { options: [...spec.options] } : {}),
          readonly: opaqueDefault || (attr ? !attr.isLiteral : false),
          ...(attr ? {} : { defaulted: true }),
          ...(resettable ? { resettable: true } : {}),
          ...(resettable && spec?.defaultText !== undefined ? { revertsTo: spec.defaultText } : {}),
          group,
        });
      }
      return props;
    },

    get(id: string, path: string): unknown {
      const display = a2d.displayObject(id);
      if (!display) return undefined;
      const echoed = valueEcho.get(`${id}|${path}`);
      if (echoed !== undefined) return echoed;
      if (path === 'name') return display.label ?? '';
      if (path === 'visible') return display.visible;
      if (!path.startsWith('jsx.')) return undefined;
      return propValue(attrsOf(id), declaredPropsOf(id), path.slice(4));
    },

    // Same ack contract as {@link endTransformEdit}: the pipe's answer for THIS
    // edit, awaited. A path this target owns no prop for performed no write and
    // returns nothing.
    set(id: string, path: string, value: unknown): void | Promise<WriteAck> {
      const prop =
        path === 'name'
          ? 'label'
          : path === 'visible'
            ? 'visible'
            : path.startsWith('jsx.')
              ? path.slice(4)
              : null;
      if (!prop) return;
      return piped(() => writeJsxProp(id, path, prop, value), undefined, destinationOf(id));
    },

    // Removal is a write and answers like one — the same pipe, the same
    // awaited per-edit ack. It is also the ONLY door that can restore
    // byte-absence: `set` writes a value, so reverting a prop a gesture
    // APPENDED by setting the default back leaves the attribute in the file.
    remove(id: string, path: string): void | Promise<WriteAck> {
      return piped(
        () => removeOverride(id, path),
        backend?.removeProp !== undefined,
        destinationOf(id),
      );
    },

    dispose(): void {
      valueEcho.clear();
      dynamicPaths.clear();
      editStarts.clear();
    },
  };
}
