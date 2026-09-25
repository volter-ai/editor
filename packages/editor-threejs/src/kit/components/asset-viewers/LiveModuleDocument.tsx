/**
 * THE LIVE MODELING VIEW (docs/BLENDER-PARITY.md §Live modeling view, Gap 1):
 * a project TypeScript module that builds an `Object3D`, opened as an Asset
 * Lab document that RE-EXECUTES ON EVERY SAVE with the camera untouched —
 * "watch it model".
 *
 * WHAT IS NEW HERE IS ONE THING: the re-execution. Everything else is the
 * surface every other Object3D document already opens on
 * (`StageHost.tsx`'s `Object3DDocumentViewport` — orbit, pick,
 * framing, the document toolbar, the ordinary Object3D inspector subject), and
 * the contract it resolves is the bake lane's, unchanged
 * (`live-module-source.ts`).
 *
 * ## Why the camera survives a rebuild: ONE ROOT, SWAPPED CHILDREN
 *
 * `Object3DDocumentViewport` re-runs its whole lifetime effect — renderer,
 * scene, camera, adapter — whenever the `build` callback's IDENTITY changes.
 * That is how the parametric Builder documents rebuild
 * (`catalog/project-source/src/tools/builder-document.tsx`: a param edit makes
 * a new `build`, the viewport tears down and stands back up), and it is
 * exactly why those documents snap the camera back to `cameraDirection` on
 * every slider nudge. A modeling loop cannot do that: the whole point is to
 * keep looking at the model from where you put yourself while it changes
 * underneath you.
 *
 * So `build` here is STABLE FOR THE DOCUMENT'S LIFETIME. It returns a
 * container `THREE.Group` this component owns, and a rebuild swaps that
 * container's single CHILD. The viewport never learns a rebuild happened; the
 * camera, the renderer and the GPU state are never touched. This is the
 * "OWNED graph" shape `ToolObject3DAuthoringProps.build` documents (the same
 * one the 3D board and the story turntable take, for the same reason: the
 * graph is async to create), so the returned `dispose` is deliberately empty
 * and THIS component's effect is the one teardown path.
 *
 * ## The probe decides which document this is
 *
 * Detection is structural, never a filename convention — the quarks precedent
 * (`JsonAssetDocument.tsx`). The module is imported and its export resolved
 * ONCE before anything mounts; only an `Object3D` gets the live viewport, and
 * anything else falls through to the `fallback` the caller passed (the
 * ordinary source viewer). Mounting the viewport first and retreating would
 * flash a 3D panel at every `.ts` file in the project.
 *
 * ## A broken save is never a blank pane
 *
 * Once live, a failing rebuild KEEPS THE LAST GOOD MODEL on screen, dimmed,
 * under a banner carrying the message and stack. The document does not
 * unmount, the workspace does not crash, and the next good save clears the
 * banner in place. A failure at FIRST open has no last-good root to keep, so
 * it shows the source viewer with the same banner above it and recovers to the
 * live view when the module compiles.
 */

import { beginLiveModuleRevision } from '@volter/editor-sdk/session/project-module-url';
import { themeVars } from '@volter/editor-sdk/widgets';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { disposeProjectAssetModel } from '../../asset-preview';
import {
  object3DDocumentSession,
  registerObject3DDocumentPreparation,
} from '../../authoring/object3d-document-session-registry';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import {
  buildLiveModuleObject3D,
  LiveModuleError,
  type LiveModuleRefusal,
} from '../../live-module-source';
import {
  clearProjectModuleTransformError,
  projectModuleChangeMatches,
  projectModuleTransformError,
  subscribeProjectModuleChange,
} from '@volter/editor-sdk/kit/project-module-changes';
import { notifyWorkspaceDocumentSelectionChanged } from '@volter/editor-sdk/kit/workspace-document-registry';
import { Object3DDocumentViewport } from '../Object3DDocumentViewport';
import { STANDARD_COMPONENT_CAMERA_DIRECTION } from '../standard-viewport-dressing';

/**
 * The asset-document host (`components/asset-documents.tsx`) hands its content
 * a plain BLOCK container of the panel's full height, not a flex parent — so
 * `flex: 1` on this component's own root measures ZERO and the viewport
 * canvas comes up 1241×0 (measured, 2026-08-29). Height 100% is what fills it;
 * the flex column below it is this component's own layout.
 */
const FILL = {
  height: '100%',
  width: '100%',
  minHeight: 0,
  display: 'flex',
  position: 'relative',
} as const;

/** The one growing child inside {@link FILL}. Both axes, because a flex ROW
 *  child with no grow measures 1×388 (also measured) — the mirror of the
 *  block-parent trap above. */
const FILL_CHILD = { flex: 1, minWidth: 0, minHeight: 0, display: 'flex' } as const;

/** A project module is a live-model document, a plain source file, or not
 *  decided yet. `fallback` covers the last two the same way — the caller's
 *  ordinary viewer — and `reason` is why. */
type ProbeState =
  | { readonly status: 'probing' }
  | { readonly status: 'live'; readonly exportName: string }
  | { readonly status: 'fallback'; readonly reason: string };

interface BuildFailure {
  readonly message: string;
  readonly stack?: string | undefined;
}

/**
 * What the banner says. A transform failure PREFERS the server's own reason:
 * the browser's `import()` rejection for a module the dev server refused to
 * transform is the opaque `Failed to fetch dynamically imported module: <url>`
 * (measured), while Vite reported `Unexpected ";"` at line:col with a source
 * frame on the HMR channel — and the second one is the only one a person
 * mid-edit can act on. The rejection then becomes the detail line, because it
 * is still the truth about what this document tried to do.
 */
function describeRefusal(refusal: LiveModuleRefusal, modulePath: string): BuildFailure {
  if (refusal.kind !== 'import-failed') return { message: refusal.message };
  const transform = projectModuleTransformError(modulePath);
  if (transform) return { message: transform, stack: refusal.message };
  return { message: refusal.message, stack: refusal.stack };
}

export function LiveModuleDocument({
  documentId,
  projectRoot,
  modulePath,
  displayName,
  active,
  fallback,
}: {
  readonly documentId: string;
  /** Absolute path of the open project — the `/@fs/` import url's root. */
  readonly projectRoot: string;
  /** Project-relative module path, e.g. `src/prefabs/probe.ts`. */
  readonly modulePath: string;
  readonly displayName: string;
  readonly active: boolean;
  /** Shown when this module is not a model module (and while one that WAS is
   *  failing to import at first open). */
  readonly fallback: React.ReactNode;
}) {
  const [probe, setProbe] = useState<ProbeState>({ status: 'probing' });
  const [failure, setFailure] = useState<BuildFailure | null>(null);

  /** The one graph the viewport ever sees. Created per document/module, never
   *  per rebuild — see this module's header. */
  const container = useMemo(() => {
    const group = new THREE.Group();
    group.name = modulePath.split('/').pop() ?? modulePath;
    return group;
  }, [modulePath]);

  const framedRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let revision = 0;
    let mounted: THREE.Object3D | null = null;
    let pending: Promise<void> = Promise.resolve();
    let captureFailure: Error | null = null;
    // The BUILDER's own teardown for what is mounted, when its export returned
    // a build result carrying one. A rig's mixers, actions and cached
    // materials are invisible to the generic graph walk, so the builder's
    // disposer runs INSTEAD of it — never both, which is how a double-free
    // starts.
    let mountedDispose: (() => void) | null = null;

    const unmount = (): void => {
      if (!mounted) return;
      container.remove(mounted);
      container.animations = [];
      if (mountedDispose) mountedDispose();
      else disposeProjectAssetModel(mounted);
      mounted = null;
      mountedDispose = null;
    };

    const swapIn = (root: THREE.Object3D, dispose: (() => void) | null): void => {
      unmount();
      mounted = root;
      mountedDispose = dispose;
      container.add(root);
      // THE CLIPS RIDE THE CONTAINER TOO. `live-module-source.ts` writes a
      // build result's `animations` onto the built root "so the clip list
      // travels with the graph the document mounts and every reader downstream
      // (the Object3D document session, its animation transport) finds it where
      // it finds a GLTF's" — but the graph this document MOUNTS is the stable
      // container, and every one of those readers reads `root.animations` on
      // the document root exactly (`ToolObject3DAuthoring`'s
      // `source.root.animations.length > 0` gate builds the mixer and the
      // transport; `model-inspection.ts`'s `root.animations.map` builds the
      // Animation section). Measured on a rigged module with two looping clips:
      // no transport, no Animation section, `editor.inspect()` listing only
      // Preview/Geometry/Rig/Materials/Source. Copying the reference
      // here is what makes the container the same subject the child is.
      container.animations = root.animations;
      // The hierarchy/inspector project the live graph on every render, so the
      // swap is visible the moment the panels re-render — but nothing else
      // notifies for a graph the document mutated behind the viewport's back.
      notifyWorkspaceDocumentSelectionChanged(documentId);
    };

    const fail = (refusal: LiveModuleRefusal, hasLastGood: boolean): void => {
      // Not a model module, and never was: this is an ordinary source file.
      // Silent by design — the project is full of them.
      if (refusal.kind === 'not-a-model' && !hasLastGood) {
        setProbe({ status: 'fallback', reason: refusal.message });
        return;
      }
      const described = describeRefusal(refusal, modulePath);
      setFailure(described);
      // A project module that does not build is a real defect the session must
      // surface, not document-local noise. It retires on the next page load
      // that does not reproduce it (`server/console-ledger.ts`).
      editorConsole.error(`${modulePath}: ${described.message}`, 'live-module');
      if (!hasLastGood) setProbe({ status: 'fallback', reason: refusal.message });
    };

    /** A save that lands mid-import supersedes this one; its own swap wins. */
    const superseded = (attempt: number): boolean => disposed || attempt !== revision;

    const buildOnce = async (): Promise<void> => {
      revision += 1;
      const attempt = revision;
      const importRevision = beginLiveModuleRevision();
      let built: Awaited<ReturnType<typeof buildLiveModuleObject3D>>;
      try {
        built = await buildLiveModuleObject3D(projectRoot, modulePath, importRevision);
      } catch (error) {
        if (superseded(attempt)) return;
        if (!(error instanceof LiveModuleError)) throw error;
        captureFailure = error;
        fail(error.refusal, mounted !== null);
        return;
      }
      if (superseded(attempt)) {
        if (built.dispose) built.dispose();
        else disposeProjectAssetModel(built.root);
        return;
      }
      swapIn(built.root, built.dispose ?? null);
      captureFailure = null;
      clearProjectModuleTransformError(modulePath);
      setFailure(null);
      setProbe({ status: 'live', exportName: built.exportName });
    };

    const rebuild = (): Promise<void> => {
      pending = buildOnce();
      return pending;
    };
    const unregisterPreparation = registerObject3DDocumentPreparation(documentId, async () => {
      let current = rebuild();
      for (;;) {
        await current;
        if (disposed) throw new Error(`Document closed while rebuilding: ${modulePath}`);
        if (current === pending) break;
        current = pending;
      }
      if (captureFailure) throw captureFailure;
    });

    void rebuild();
    const unsubscribe = subscribeProjectModuleChange((changed) => {
      if (projectModuleChangeMatches(changed, modulePath)) void rebuild();
    });

    return () => {
      disposed = true;
      unregisterPreparation();
      unsubscribe();
      unmount();
    };
  }, [container, documentId, modulePath, projectRoot]);

  /**
   * FRAME ONCE, on the first model this document ever shows — a rebuild must
   * never move the camera, which is the one thing this document exists to
   * avoid. The viewport registers its session in its own mount effect, a
   * render AFTER the state flip that mounts it, so this waits for the session
   * rather than assuming it: bounded, because "no session after a second" is a
   * mount failure, not something to poll forever.
   */
  useEffect(() => {
    if (probe.status !== 'live' || framedRef.current) return;
    let frame = 0;
    let attempts = 0;
    const tick = (): void => {
      const session = object3DDocumentSession(documentId);
      if (session) {
        framedRef.current = true;
        // An empty authored scene is valid. Keep its initial camera instead
        // of invoking a frame operation that has no geometric subject.
        if (!new THREE.Box3().setFromObject(container).isEmpty()) session.frame();
        return;
      }
      if (++attempts > 60) return;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [container, documentId, probe.status]);

  const build = useCallback(
    () => ({
      root: container,
      // Deliberately empty: the effect above owns this graph's whole lifetime.
      // Two disposers for one graph is how a double-free starts.
      dispose(): void {},
    }),
    [container],
  );

  if (probe.status === 'probing') {
    return (
      <div style={{ padding: 20, color: themeVars.content.muted }}>Inspecting {displayName}…</div>
    );
  }
  if (probe.status === 'fallback') {
    return (
      <div style={FILL}>
        {failure ? <BuildFailureBanner failure={failure} /> : null}
        <div style={{ ...FILL_CHILD, overflow: 'auto' }}>{fallback}</div>
      </div>
    );
  }
  return (
    <div style={FILL}>
      <div
        style={{
          ...FILL_CHILD,
          // The last good model stays visible while a save is broken; dimming
          // is what says "this is not what your file says right now".
          opacity: failure ? 0.35 : 1,
        }}
      >
        <Object3DDocumentViewport
          documentId={documentId}
          sourcePath={modulePath}
          displayName={displayName}
          build={build}
          active={active}
          assetType="model module"
          cameraDirection={STANDARD_COMPONENT_CAMERA_DIRECTION}
          modelSource={{ kind: 'project-file', path: modulePath }}
        />
      </div>
      {failure ? <BuildFailureBanner failure={failure} /> : null}
    </div>
  );
}

/** The in-document failure report: what broke, and where. Never a blank pane
 *  and never a toast — the document itself has to say why it is stale. */
function BuildFailureBanner({ failure }: { readonly failure: BuildFailure }) {
  return (
    <div
      role="alert"
      data-testid="live-module-error"
      style={{
        position: 'absolute',
        top: 8,
        left: 8,
        right: 8,
        zIndex: 2,
        maxHeight: '60%',
        overflow: 'auto',
        padding: '8px 10px',
        borderRadius: themeVars.shape.small,
        background: themeVars.surface.raised,
        border: `1px solid ${themeVars.semantic.danger}`,
        color: themeVars.semantic.danger,
        fontFamily: themeVars.typography.mono,
        fontSize: 11,
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        pointerEvents: 'auto',
      }}
    >
      <div style={{ fontWeight: 600 }}>
        This module did not build — showing the last good model.
      </div>
      <div style={{ marginTop: 4 }}>{failure.message}</div>
      {failure.stack ? (
        <div style={{ marginTop: 6, color: themeVars.content.muted }}>{failure.stack}</div>
      ) : null}
    </div>
  );
}
