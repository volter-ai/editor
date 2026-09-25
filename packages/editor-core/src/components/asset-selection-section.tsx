/**
 * §5.1 asset-selection inspection (W2 — inventory row R6's "single-click
 * selects → Inspector preview/metadata" half).
 *
 * A single click in the Assets browser (`asset-selection.ts`) is a click like
 * any other, so it names a SUBJECT: {@link describeAssetSelectionSubject} is
 * the producer `inspection/active-subject.ts` consults, and what it returns
 * goes through the ONE composer into the same box a scene node gets. An open
 * document still wins — browser selection is navigator state and must not
 * displace a document's own subject — which is the whole of the producer's
 * `null` case. The full viewer lives in a center document
 * (`asset-documents.tsx`, double-click/Enter).
 *
 * Per the §5.1 table, compact metadata only: image dimensions/format/size,
 * model thumbnail + size (the summary reuses the existing
 * `model-thumbnail.ts` renderer), audio duration/format, input-map binding
 * summary (reusing `InputMapViewer`'s exported validation), and plain
 * name/path/size for the rest.
 */

import { faCircleInfo, faImage } from '@fortawesome/free-solid-svg-icons';
import { Button, bg, border, text } from '@volter/editor-sdk/widgets';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { assetInspectorActionsFor } from '../asset-inspector-actions';
import { getSelectedAsset, type SelectedAsset } from '../asset-selection';
import {
  assetSelectionViewerFor,
  assetSelectionViewersVersion,
  subscribeAssetSelectionViewers,
} from '../asset-selection-viewer-registry';
import { assetDocumentKind } from '@volter/editor-sdk/kit/asset-capabilities';
import {
  type PixiSpritesheetFrame,
  parsePixiSpritesheet,
  sidecarPathForSheet,
  splitSpritesheetAssetPath,
} from '@volter/editor-sdk/kit/asset-workflow/pixi-spritesheet';
import { PROJECT_ASSET_COMMANDS } from '../asset-workflow/project-asset-commands';
import {
  contentEntryForComponent,
  contentEntrySourceRegistryVersion,
  subscribeContentEntrySources,
} from '@volter/editor-sdk/kit/content-entry-source-registry';
import type { InspectionAction } from '@volter/editor-sdk/kit/inspection-model';
import {
  PREVIEW_SECTION_ID,
  PREVIEW_SECTION_ORDER,
  PROPERTIES_SECTION_ORDER,
} from '@volter/editor-sdk/kit/inspection-model';
import type { NullInspectionSubject } from '@volter/editor-sdk/kit/inspection/null-subject';
import {
  getAssetInspectorToolContributions,
  getGlobalToolContributions,
  subscribeToolContributions,
} from '../tool-loader';
import { activeWorkspaceDocumentSelection } from '@volter/editor-sdk/kit/workspace-document-registry';
import { AssetInspectorToolSection } from './AssetInspectorToolSection';
import { ModelThumbnail, TypedAssetThumbnail } from './asset-thumbnails';
import { SpritesheetSpriteView } from './asset-viewers/SpritesheetSpriteView';
import { MediaProperties } from './MediaProperties';

const labelStyle: React.CSSProperties = { fontSize: 11, color: text[3], marginBottom: 2 };
const valueStyle: React.CSSProperties = { fontSize: 11, color: text[1], wordBreak: 'break-all' };

function AssetToolSections({ asset }: { asset: SelectedAsset }) {
  useSyncExternalStore(
    subscribeToolContributions,
    getGlobalToolContributions,
    getGlobalToolContributions,
  );
  const contributionAsset = {
    path: asset.path,
    name: asset.name,
    kind: asset.kind,
    origin: asset.origin ?? ('project' as const),
    ...(asset.sourcePath ? { sourcePath: asset.sourcePath } : {}),
  };
  return getAssetInspectorToolContributions().map((item) => {
    let matches = false;
    try {
      matches = item.match(contributionAsset);
    } catch (error) {
      // biome-ignore lint/suspicious/noConsole: broken project matchers must teach without taking down the Inspector
      console.error(`[tool contributions] ${item.file}'s asset match() threw.`, error);
    }
    return matches ? (
      <AssetInspectorToolSection
        key={`${item.id}:${item.version}`}
        id={item.id}
        title={item.title}
        file={item.file}
        tool={item.tool}
        Component={item.Component}
      />
    ) : null;
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <div style={valueStyle}>{value}</div>
    </div>
  );
}

/**
 * The selected asset AS THE PREVIEW SECTION's body — the same square box a
 * scene node's live preview fills, with the thumbnail the asset already has.
 * It fills its host at any size, which is what lets the section body and the
 * minimized card's round thumb be one function (`inspection/model.ts`'s
 * `preview` body).
 */
export function AssetSelectionThumbnail({ asset }: { asset: SelectedAsset }) {
  const environment = asset.capabilities?.editor === 'environment';
  // The picture of a COMPONENT is the same question the Content grid asks, about
  // one component instead of the index (`content-entry-source-registry.ts`):
  // whichever source admits it also paints it, and this panel learns nothing
  // about why it is content.
  useSyncExternalStore(
    subscribeContentEntrySources,
    contentEntrySourceRegistryVersion,
    contentEntrySourceRegistryVersion,
  );
  const componentPreview = asset.componentPreview;
  const componentPicture = componentPreview
    ? contentEntryForComponent({
        name: asset.name,
        path: componentPreview.sourcePath,
        surface: componentPreview.surface,
      })
    : null;
  return (
    <div
      data-testid="inspector-asset-preview"
      style={{
        position: 'absolute',
        inset: 0,
        background: bg.inset,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {componentPicture ? (
        <componentPicture.source.Thumbnail entry={componentPicture.entry} previewRevision={0} />
      ) : environment ? (
        <TypedAssetThumbnail kind="image" name={asset.name} variant="cell" />
      ) : asset.kind === 'image' ? (
        <SelectedImagePreview path={asset.path} name={asset.name} />
      ) : asset.kind === 'video' ? (
        <SelectedVideoPreview path={asset.path} />
      ) : asset.kind === 'model' ? (
        <ModelThumbnail url={asset.path} />
      ) : (
        <TypedAssetThumbnail kind={asset.kind} name={asset.name} variant="cell" />
      )}
    </div>
  );
}

function SelectedVideoPreview({ path }: { path: string }) {
  return (
    <video
      src={path}
      muted
      preload="metadata"
      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
    />
  );
}

function SelectedImagePreview({ path, name }: { path: string; name: string }) {
  const { sheetPath, frameName } = splitSpritesheetAssetPath(path);
  const [frame, setFrame] = useState<PixiSpritesheetFrame | null>(null);
  useEffect(() => {
    if (!frameName) {
      setFrame(null);
      return;
    }
    let cancelled = false;
    void fetch(`/${sidecarPathForSheet(sheetPath)}`)
      .then((response) => (response.ok ? response.text() : null))
      .then((source) => {
        if (cancelled || !source) return;
        const sheet = parsePixiSpritesheet(source);
        setFrame(sheet?.frames.find((entry) => entry.name === frameName) ?? null);
      })
      .catch(() => {
        if (!cancelled) setFrame(null);
      });
    return () => {
      cancelled = true;
    };
  }, [frameName, sheetPath]);
  if (frame) {
    return <SpritesheetSpriteView sheetUrl={`/${sheetPath}`} frame={frame} maxEdge={96} />;
  }
  return (
    <img
      src={path.split('#')[0]}
      alt={name}
      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
    />
  );
}

/** An image's intrinsic size (§5.1 "dimensions"), measured off the decoded
 *  bitmap rather than off a rendered `<img>` — the preview is a section of its
 *  own now, and a metadata row must not depend on which tab is showing. */
function ImageDimensionsRow({ asset }: { asset: SelectedAsset }) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const { sheetPath, frameName } = splitSpritesheetAssetPath(asset.path);
  useEffect(() => {
    setDims(null);
    // Native HDR/EXR loaders own these dimensions in the full document; an
    // HTML Image cannot decode them and must not be used as a silent probe.
    if (asset.kind !== 'image' || asset.capabilities?.editor === 'environment') return;
    let cancelled = false;
    if (frameName) {
      void fetch(`/${sidecarPathForSheet(sheetPath)}`)
        .then((response) => (response.ok ? response.text() : null))
        .then((source) => {
          if (cancelled || !source) return;
          const frame = parsePixiSpritesheet(source)?.frames.find(
            (entry) => entry.name === frameName,
          );
          if (frame) setDims({ w: frame.sourceWidth, h: frame.sourceHeight });
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }
    const image = new Image();
    image.onload = () => {
      if (!cancelled) setDims({ w: image.naturalWidth, h: image.naturalHeight });
    };
    image.src = asset.path.split('#')[0] ?? asset.path;
    return () => {
      cancelled = true;
    };
  }, [asset.capabilities?.editor, asset.kind, asset.path, frameName, sheetPath]);
  return dims ? <MetaRow label="Dimensions" value={`${dims.w} × ${dims.h}`} /> : null;
}

/** The registered section body — renders ONLY while an asset is selected
 *  (the registration's `match` gates on the same store read). */
export function AssetSelectionSection() {
  // Subscribed, not read once: a package's viewer registers behind the first
  // viewport frame, after this section may already be on screen.
  useSyncExternalStore(
    subscribeAssetSelectionViewers,
    assetSelectionViewersVersion,
    assetSelectionViewersVersion,
  );
  const asset = getSelectedAsset();
  if (!asset) return null;
  const viewer = assetSelectionViewerFor(asset);
  const ext = asset.name.includes('.') ? (asset.name.split('.').pop() ?? '') : '';
  // WHO DRAWS *THIS* ASSET is a registry question. The branch that stood
  // here read `asset.online` and rendered the external catalog's own detail
  // view, which is how a base library for making IDEs came to import a
  // managed-service client (`asset-selection-viewer-registry.ts`).
  if (viewer) {
    return (
      <div
        data-testid="inspector-asset-selection"
        style={{
          pointerEvents: 'auto',
          borderBottom: `1px solid ${border[1]}`,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <viewer.View asset={asset} />
        <AssetToolSections asset={asset} />
      </div>
    );
  }
  if (
    (asset.selectionCount ?? 1) === 1 &&
    ((asset.kind === 'image' &&
      !asset.path.includes('#') &&
      asset.capabilities?.editor !== 'environment') ||
      asset.kind === 'video' ||
      asset.kind === 'audio')
  ) {
    return (
      <>
        <MediaProperties
          assetPath={asset.path}
          kind={asset.kind as 'image' | 'video' | 'audio'}
          sizeBytes={asset.sizeBytes}
        />
        <div style={{ padding: '0 8px', display: 'grid', gap: 6 }}>
          {asset.health && asset.health !== 'healthy' && (
            <MetaRow label="Health" value={asset.health} />
          )}
          {Boolean(asset.healthCodes?.length) && (
            <MetaRow label="Issues" value={asset.healthCodes!.join(', ')} />
          )}
          {asset.sourcePath && <MetaRow label="Imported from" value={asset.sourcePath} />}
          {Boolean(asset.dependencies?.length) && (
            <MetaRow label="Dependencies" value={asset.dependencies!.join(', ')} />
          )}
          {Boolean(asset.references?.length) && (
            <MetaRow
              label="References"
              value={asset.references!.map((ref) => `${ref.ownerPath} ${ref.jsonPath}`).join(', ')}
            />
          )}
        </div>
        <AssetToolSections asset={asset} />
      </>
    );
  }
  return (
    <div
      data-testid="inspector-asset-selection"
      style={{
        pointerEvents: 'auto',
        padding: 8,
        borderBottom: `1px solid ${border[1]}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <ImageDimensionsRow asset={asset} />
      <div style={{ ...labelStyle, marginBottom: 0, textTransform: 'uppercase' }}>Asset</div>
      {/* §8: source-owned name, as authored. */}
      <div style={{ fontWeight: 600, fontSize: 12, color: text[1], wordBreak: 'break-all' }}>
        {asset.name}
      </div>
      <MetaRow label="Path" value={asset.path} />
      {asset.componentPreview && (
        <MetaRow
          label="Surface"
          value={
            asset.componentPreview.surface === 'canvas'
              ? '2D / Pixi'
              : asset.componentPreview.surface === 'three'
                ? '3D / Three'
                : asset.componentPreview.surface
          }
        />
      )}
      {asset.selectionCount && asset.selectionCount > 1 && (
        <>
          <MetaRow label="Selection" value={`${asset.selectionCount} assets`} />
          {asset.selectionTotalBytes !== undefined && (
            <MetaRow label="Total size" value={formatSize(asset.selectionTotalBytes)} />
          )}
          {asset.selectionFormats && (
            <MetaRow label="Formats" value={asset.selectionFormats.join(', ')} />
          )}
        </>
      )}
      {ext && <MetaRow label="Format" value={ext.toUpperCase()} />}
      {asset.sizeBytes !== undefined && (
        <MetaRow label="Size" value={formatSize(asset.sizeBytes)} />
      )}
      {asset.capabilities && (
        <>
          <MetaRow
            label="Runtime readiness"
            value={
              asset.capabilities.runtimeReady ? 'Runtime-ready' : 'Import or conversion required'
            }
          />
          <MetaRow
            label="Preview"
            value={asset.capabilities.previewable ? 'Available' : 'Unsupported'}
          />
          <MetaRow
            label="Placement"
            value={asset.capabilities.placeable ? 'Placeable' : 'Not placeable'}
          />
          <MetaRow label="Editor" value={assetDocumentKind(asset.capabilities) ?? 'No editor'} />
        </>
      )}
      {asset.health && <MetaRow label="Health" value={asset.health} />}
      {asset.healthCodes && <MetaRow label="Issues" value={asset.healthCodes.join(', ')} />}
      {asset.dependencies && (
        <MetaRow label="Dependencies" value={asset.dependencies.join(', ') || 'None'} />
      )}
      {asset.references && (
        <MetaRow
          label="References"
          value={
            asset.references
              .map((reference) => `${reference.ownerPath} ${reference.jsonPath}`)
              .join(', ') || 'None'
          }
        />
      )}
      {asset.sourcePath && <MetaRow label="Imported from" value={asset.sourcePath} />}
      {!asset.componentPreview && (
        <div style={{ display: 'flex', gap: 6 }}>
          <Button
            type="button"
            data-command-id={PROJECT_ASSET_COMMANDS.open.id}
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent('editor:open-project-asset', { detail: { path: asset.path } }),
              )
            }
          >
            Open
          </Button>
          {asset.selectionCount && asset.selectionCount > 1 && (
            <>
              <Button
                type="button"
                data-command-id={PROJECT_ASSET_COMMANDS.move.id}
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent('editor:project-asset-command', {
                      detail: { id: PROJECT_ASSET_COMMANDS.move.id },
                    }),
                  )
                }
              >
                Move selected
              </Button>
              <Button
                type="button"
                data-command-id={PROJECT_ASSET_COMMANDS.delete.id}
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent('editor:project-asset-command', {
                      detail: { id: PROJECT_ASSET_COMMANDS.delete.id },
                    }),
                  )
                }
              >
                Delete selected
              </Button>
            </>
          )}
        </div>
      )}
      <div style={{ fontSize: 10, color: text[3] }}>
        Double-click (or press Enter) in the asset browser to open the full viewer.
      </div>
      <AssetToolSections asset={asset} />
    </div>
  );
}

/**
 * The selected asset as a SUBJECT — a producer, like every other thing you
 * can click on (`inspection/active-subject.ts` consults it first).
 *
 * A single click in the browser is a click, and the box shows what you
 * clicked: the asset's own name and path on the identity row, its thumbnail
 * in the Preview section, its §5.1 metadata in the Asset section. It used to
 * be a contribution bolted onto whatever ELSE was selected, which is why the
 * card showed the asset while `editor.inspect` reported the stale scene
 * entity — two answers to one question.
 *
 * `null` means the asset selection is not what the human is looking at: no
 * asset is selected, or an open document owns the inspection context (browser
 * selection is navigator state and must not displace a document's subject).
 */
/**
 * The verbs the matching `asset.inspector` sections have PUBLISHED for this
 * asset (`asset-inspector-actions.ts` says why they are published rather
 * than declared): they land in the subject's `quickActions`, so the identity
 * row shows them and `editor.runAction(id)` runs the same function the
 * section's own button calls.
 */
function contributedAssetActions(assetPath: string): InspectionAction[] {
  return assetInspectorActionsFor(assetPath).map((action) => ({
    id: action.id,
    title: action.title,
    ...(action.label === undefined ? {} : { label: action.label }),
    placement: 'identity' as const,
    ...(action.disabled === undefined ? {} : { disabled: action.disabled }),
    run: action.run,
  }));
}

export function describeAssetSelectionSubject(): NullInspectionSubject | null {
  const asset = getSelectedAsset();
  if (asset === null) return null;
  // A document with authoring of its own (a scene, a 3D asset document)
  // answers for what is picked INSIDE it; a document that only selects
  // itself (a source file, a JSON) does not stand between the person and the
  // asset they picked in Content — that is where a model's own inspector
  // (the mesh capability's, with its Edit mesh door) lives.
  const documentSelection = activeWorkspaceDocumentSelection();
  if (
    documentSelection &&
    (documentSelection.adapter !== null || documentSelection.nodeId !== null)
  ) {
    return null;
  }
  return {
    quickActions: contributedAssetActions(asset.path),
    id: `asset:${asset.path}`,
    title: asset.name,
    kindLabel: asset.online ? `${asset.kind} · ${asset.online.source}` : asset.kind,
    note: { text: asset.sourcePath ?? asset.path, testId: 'inspector-asset-path' },
    sections: [
      {
        id: PREVIEW_SECTION_ID,
        title: 'Preview',
        icon: faImage,
        order: PREVIEW_SECTION_ORDER,
        body: { kind: 'preview', render: () => <AssetSelectionThumbnail asset={asset} /> },
      },
      {
        id: 'asset-selection',
        title: 'Asset',
        icon: faCircleInfo,
        order: PROPERTIES_SECTION_ORDER,
        body: { kind: 'custom', render: () => <AssetSelectionSection /> },
        // Hosts the `asset.inspector` contributions, whose verbs (a model's
        // Edit mesh) exist only while they render.
        keepMounted: true,
      },
    ],
  };
}
