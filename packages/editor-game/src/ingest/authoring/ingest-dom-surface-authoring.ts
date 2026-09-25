/**
 * Turns a readable canvas game's own DOM UI into an ordinary nested authoring
 * surface. Detection stays at the mount boundary; once built, the editor sees
 * only AuthoringAdapter/CompositeAuthoringAdapter currency.
 */

import { CompositeAuthoringAdapter } from '@volter/editor-sdk/kit/authoring/composite-authoring-adapter';
import {
  findCanvasUiElements,
  findPrimaryCanvas,
  type OverlayElement,
} from '../../host/coverage/capability-coverage';
import type { EditorShellStore } from '@volter/editor-threejs/kit/editor-shell-store';
import { authoringJournal } from '../../host/history/json-history-resource';
import { sourceWriteBackendIfPrimed } from '@volter/editor-core/ui-source/tier-source-write-backend';
import { DomAuthoringAdapter, type DomElementLike } from '../../react/dom-authoring-adapter';
import {
  type OidElementLike,
  ReactRootAuthoringAdapter,
  walkOidTree,
} from '../../react/react-world-authoring-adapter';
import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import type { VgaiGameContract } from '@volter/editor-project/adapter/ingest/game-contract';

type ReadableDomRoot = OverlayElement & DomElementLike & { readonly ownerDocument?: Document };

function isReadableDomRoot(value: unknown): value is ReadableDomRoot {
  const candidate = value as Partial<ReadableDomRoot> | null;
  return (
    candidate !== null &&
    typeof candidate === 'object' &&
    typeof candidate.tagName === 'string' &&
    candidate.children !== undefined &&
    typeof candidate.getBoundingClientRect === 'function'
  );
}

function iframeDocumentRoot(hostEl: HTMLElement): ReadableDomRoot | null {
  try {
    const iframe =
      hostEl.tagName.toLowerCase() === 'iframe'
        ? (hostEl as HTMLIFrameElement)
        : (hostEl.querySelector('iframe') as HTMLIFrameElement | null);
    const body = iframe?.contentDocument?.body;
    return isReadableDomRoot(body) ? body : null;
  } catch {
    return null;
  }
}

function resolveGameDomRoot(
  hostEl: HTMLElement,
  declaredRoot: VgaiGameContract['root'] | undefined,
): ReadableDomRoot | null {
  if (isReadableDomRoot(declaredRoot)) return declaredRoot;
  return iframeDocumentRoot(hostEl) ?? (isReadableDomRoot(hostEl) ? hostEl : null);
}

function withMutationSubscription(
  adapter: DomAuthoringAdapter | ReactRootAuthoringAdapter,
  gameRoot: ReadableDomRoot,
): AuthoringAdapter {
  const subscribe = (listener: () => void): (() => void) => {
    const unsubscribe = adapter.subscribe(listener);
    const Observer = gameRoot.ownerDocument?.defaultView?.MutationObserver;
    if (!Observer) return unsubscribe;
    const observer = new Observer(() => listener());
    observer.observe(gameRoot as unknown as Node, {
      childList: true,
      subtree: true,
    });
    return () => {
      observer.disconnect();
      unsubscribe();
    };
  };
  return new Proxy(adapter, {
    get(target, property) {
      if (property === 'subscribe') return subscribe;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * Which authoring adapter this mount's DOM UI gets — decided by ONE probe, the
 * same probe and the same two outcomes `ingest-siblings.ts`'s
 * `mountReactSibling` already uses for a react sibling layer: does the live DOM
 * actually carry `data-oid` stamps?
 *
 * - **Stamped** ⇒ {@link ReactRootAuthoringAdapter} over the OID tree, with the
 *   dev-server source-write backend. Node ids are OID-derived, so the HUD's own
 *   JSX — the component the elements came from — is the subject, and a
 *   className/style/text edit prepares next-file text and commits it through
 *   `/__ui-source/write`. For a REPO-VENDORED game that endpoint's
 *   `writeEditableSource` routes the write through
 *   `server/vendored-lock-recorder.ts`, exactly as a three root's writes are
 *   routed — the choke point is the endpoint, not the adapter, so this lane
 *   inherits lock recording without knowing anything about vendoring.
 * - **Unstamped** ⇒ {@link DomAuthoringAdapter} unchanged: structural ids
 *   over the live DOM and no write seam at all. That is the honest answer for
 *   DOM the stamping pipeline declined to instrument (a bundled/minified ingest,
 *   a foreign game excluded by identity) — never a write seam over source the
 *   editor cannot address.
 *
 * A PARTIALLY stamped tree counts as stamped: `walkOidTree` already skips
 * untagged elements transparently and attaches their children to the nearest
 * tagged ancestor, so this stays a single "any node at all?" question rather
 * than a completeness one.
 *
 * The ROUTE gates the backend, not the adapter choice (`../ui-source/tier-
 * source-write-backend.ts`): on a host that serves no `/__ui-source/*`
 * recorder the OID lane still gives correct selection/inspection and reports
 * its writes unavailable through `persistence.destination`.
 */
function domSurfaceAdapter(
  liveUiRoot: DomElementLike & OidElementLike,
  store: EditorShellStore,
  /** The detected surface's own id — a held surface, so its journal is the
   *  world's and survives the ingest remounting (see the ownership block in
   *  `../history/json-history-resource.ts`). */
  domUiJournalId: string,
): DomAuthoringAdapter | ReactRootAuthoringAdapter {
  if (walkOidTree(liveUiRoot).nodes.size === 0) {
    return new DomAuthoringAdapter(liveUiRoot, store, {
      journal: authoringJournal(domUiJournalId),
    });
  }
  const writeBackend = sourceWriteBackendIfPrimed('An ingested game’s DOM UI surface');
  return new ReactRootAuthoringAdapter(liveUiRoot, store.shell, {
    ...(writeBackend ? { writeBackend } : {}),
  });
}

/**
 * Preserve `primary` byte-for-byte when this mount has no readable canvas/UI
 * split. Otherwise expose Canvas as the runtime surface and DOM UI as its
 * nested document. The UI root's children are getters over live geometry, so
 * menus that appear later enter the same surface without a mirror tree.
 */
export function withDetectedDomSurface(args: {
  primary: AuthoringAdapter;
  worldId: string;
  hostEl: HTMLElement;
  declaredRoot?: VgaiGameContract['root'];
  store: EditorShellStore;
}): AuthoringAdapter {
  const gameRoot = resolveGameDomRoot(args.hostEl, args.declaredRoot);
  if (!gameRoot) return args.primary;
  const canvas = findPrimaryCanvas(gameRoot);
  if (!canvas || findCanvasUiElements(gameRoot, canvas).length === 0) return args.primary;

  const domUiId = `${args.worldId}:dom-ui`;
  // Composite world ids are editor identity and legitimately use `:`. A
  // history resource id is a project-relative path and must not: conflating
  // the two made ResourceRegistry parse `world:dom-ui/...` as a URL scheme and
  // refuse every detected DOM sibling before the ingest could mount.
  const domUiJournalId = `${args.worldId}/dom-ui`;
  const liveUiRoot: DomElementLike & OidElementLike = {
    tagName: 'vgai-dom-surface',
    id: '',
    className: '',
    get children() {
      const currentCanvas = findPrimaryCanvas(gameRoot);
      return currentCanvas
        ? (findCanvasUiElements(gameRoot, currentCanvas) as DomElementLike[] & OidElementLike[])
        : [];
    },
    // A synthetic container the host manufactured, not a rendered element —
    // it carries no oid of its own, and `walkOidTree` transparently skips an
    // untagged node, attaching the game's real HUD elements as tree roots.
    getAttribute: () => null,
  };
  const dom = withMutationSubscription(
    domSurfaceAdapter(liveUiRoot, args.store, domUiJournalId),
    gameRoot,
  );
  const canvasId = `${args.worldId}:canvas`;
  return new CompositeAuthoringAdapter([
    { worldId: canvasId, kind: 'canvas', adapter: args.primary },
    {
      worldId: domUiId,
      kind: 'dom',
      role: 'surface',
      label: 'DOM UI',
      parentRootId: canvasId,
      adapter: dom,
    },
  ]);
}
