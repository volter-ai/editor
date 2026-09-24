/**
 * THE ASSET BUDGET PANEL — what the `asset-budget.document` contribution
 * draws. A project-scoped tool window IS a workspace document in this shell
 * (the frame owns all layout; utilities are for live-observation instruments).
 *
 * Renders the headless `asset-budget-model.ts` report: sortable per-asset
 * table (size, VRAM estimate, tris, reference count, provenance badge),
 * totals + per-category subtotals, unused/duplicate sections, and a per-asset
 * detail pane whose reference list IS the critique-P5 "what uses this" query.
 * All data comes from one real analysis pass over the storage seam — nothing
 * here fabricates a number the model didn't measure (VRAM lower bounds are
 * rendered with an explicit `≥`, inspection failures with their reason).
 */

import { getStorageBackend } from '@editor/storage';
import { editorHost } from '@vgai/editor-sdk/host';
import {
  accent,
  Button,
  bg,
  border,
  danger,
  fontMono,
  fontSizeVar,
  lineHeightVar,
  radius,
  Select,
  spaceVar,
  text,
  warn,
} from '@vgai/editor-sdk/widgets';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  type AssetBudgetCategory,
  type AssetBudgetEntry,
  type AssetBudgetReport,
  analyzeAssetBudget,
  collectProjectBudgetSource,
} from './asset-budget-model';
import { type GltfIOCapabilities, getGltfIO } from './gltf-io';
import {
  compressModelDraco,
  compressModelMeshopt,
  compressTexturesKtx2,
  generateLodLevels,
  type LodGenerationOutcome,
  type OptimizeOutcome,
} from './gltf-optimize';
import { applyOptimizedBytes } from './optimize-apply';

/** The document's contribution id (`asset-budget.document.tsx`), as
 *  `workspace.openContributedDocument` names it. */
export const ASSET_BUDGET_DOCUMENT_ID = 'asset-budget.document';

// Pending focus request (context-menu "Open in Asset Budget" hands a path
// over before/while the document mounts) — house useSyncExternalStore shape.
let _focusPath: string | null = null;
let _version = 0;
const _listeners = new Set<() => void>();

function notifyChanged(): void {
  _version++;
  for (const fn of _listeners) fn();
}

function subscribeFocus(fn: () => void): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}

function focusVersion(): number {
  return _version;
}

/** Consume (read + clear) the pending focus path. */
function takeFocusPath(): string | null {
  const path = _focusPath;
  if (path !== null) {
    _focusPath = null;
  }
  return path;
}

/** Open (or activate) the Asset Budget window, optionally focusing an asset
 *  (storage path or `/serving` path — both spellings resolve). The focus path
 *  is set BEFORE the open so a document that mounts fresh reads it on its
 *  first render, and one already open picks it up from the subscription. */
export function openAssetBudgetDocument(focusPath?: string): boolean {
  if (focusPath !== undefined) {
    _focusPath = focusPath;
    notifyChanged();
  }
  return editorHost().workspace.openContributedDocument(ASSET_BUDGET_DOCUMENT_ID);
}

// --- Formatting --------------------------------------------------------------

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatCount(value: number): string {
  return value >= 10000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

/** VRAM column value: model estimate (with `≥` lower-bound marker), image
 *  estimate, or an honest em dash for unmeasurable categories. */
function vramLabel(entry: AssetBudgetEntry): string {
  if (entry.model) {
    const prefix = entry.model.unknownTextureCount > 0 ? '≥ ' : '';
    return `${prefix}${formatBytes(entry.model.vramBytes)}`;
  }
  if (entry.image) return formatBytes(entry.image.gpuBytes);
  return '—';
}

function vramValue(entry: AssetBudgetEntry): number {
  return entry.model?.vramBytes ?? entry.image?.gpuBytes ?? 0;
}

// --- Sorting -----------------------------------------------------------------

type SortKey = 'path' | 'category' | 'bytes' | 'vram' | 'tris' | 'refs';

function sortValue(entry: AssetBudgetEntry, key: SortKey): number | string {
  switch (key) {
    case 'path':
      return entry.path;
    case 'category':
      return entry.category;
    case 'bytes':
      return entry.bytes;
    case 'vram':
      return vramValue(entry);
    case 'tris':
      return entry.model?.glPrimitives ?? -1;
    case 'refs':
      return entry.references.length;
  }
}

function sortEntries(
  entries: readonly AssetBudgetEntry[],
  key: SortKey,
  direction: 1 | -1,
): AssetBudgetEntry[] {
  return [...entries].sort((left, right) => {
    const a = sortValue(left, key);
    const b = sortValue(right, key);
    const order = typeof a === 'string' ? a.localeCompare(b as string) : a - (b as number);
    return order !== 0 ? order * direction : left.path.localeCompare(right.path);
  });
}

// --- The document content ----------------------------------------------------

const CATEGORY_LABEL: Record<AssetBudgetCategory, string> = {
  model: 'Models',
  image: 'Images',
  audio: 'Audio',
  data: 'Data',
  other: 'Other',
};

interface BudgetState {
  readonly report: AssetBudgetReport | null;
  readonly loading: boolean;
  readonly error: string | null;
}

function useBudgetReport(): BudgetState & { refresh: () => void; stale: boolean } {
  const [state, setState] = useState<BudgetState>({ report: null, loading: true, error: null });
  const [stale, setStale] = useState(false);
  const generation = useRef(0);

  const refresh = useCallback(() => {
    const run = ++generation.current;
    setState((prior) => ({ ...prior, loading: true, error: null }));
    setStale(false);
    void (async () => {
      try {
        const source = await collectProjectBudgetSource(getStorageBackend());
        const report = await analyzeAssetBudget(source);
        if (generation.current === run) setState({ report, loading: false, error: null });
      } catch (error) {
        if (generation.current === run) {
          setState({
            report: null,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
  }, []);

  useEffect(() => {
    refresh();
    // Project files changing mid-view: mark stale (explicit refresh, no
    // surprise full rescans while the user reads the table).
    return getStorageBackend().watch(() => setStale(true));
  }, [refresh]);

  return { ...state, refresh, stale };
}

const cellStyle: React.CSSProperties = {
  padding: `${spaceVar[2]} ${spaceVar[4]}`,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const numCellStyle: React.CSSProperties = {
  ...cellStyle,
  textAlign: 'right',
  fontFamily: fontMono,
};

function HeaderCell({
  label,
  sortKey,
  active,
  direction,
  onSort,
  align,
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  direction: 1 | -1;
  onSort: (key: SortKey) => void;
  align?: 'right';
}) {
  return (
    <th
      aria-sort={active ? (direction === 1 ? 'ascending' : 'descending') : 'none'}
      style={{ padding: 0, textAlign: align ?? 'left' }}
    >
      <Button
        type="button"
        variant="ghost"
        size="compact"
        data-testid={`asset-budget-sort-${sortKey}`}
        onClick={() => onSort(sortKey)}
        style={{
          display: 'block',
          width: '100%',
          justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
        }}
      >
        <span
          style={{
            display: 'block',
            fontSize: fontSizeVar.base,
            fontWeight: 600,
            color: active ? text[1] : text[3],
            textAlign: align ?? 'left',
          }}
        >
          {label}
          {active ? (direction === 1 ? ' ↑' : ' ↓') : ''}
        </span>
      </Button>
    </th>
  );
}

function ProvenanceBadge({ entry }: { entry: AssetBudgetEntry }) {
  if (!entry.provenance) return null;
  return (
    <span
      data-testid="asset-budget-provenance-badge"
      title={`${entry.provenance.operationName} · ${entry.provenance.createdAt}`}
      style={{
        fontSize: fontSizeVar.xs,
        fontWeight: 700,
        letterSpacing: 0.5,
        color: accent,
        border: `1px solid ${accent}`,
        borderRadius: radius.sm,
        padding: `0 ${spaceVar[2]}`,
        marginLeft: spaceVar[3],
      }}
    >
      GEN
    </span>
  );
}

function BudgetRow({
  entry,
  selected,
  onSelect,
}: {
  entry: AssetBudgetEntry;
  selected: boolean;
  onSelect: (path: string) => void;
}) {
  const name = entry.path.split('/').pop() ?? entry.path;
  const dir = entry.path.slice(0, entry.path.length - name.length);
  return (
    <tr
      data-testid="asset-budget-row"
      data-path={entry.path}
      data-selected={selected ? 'true' : undefined}
      onClick={() => onSelect(entry.path)}
      style={{
        cursor: 'pointer',
        background: selected ? bg[3] : 'transparent',
        borderTop: `1px solid ${border[1]}`,
      }}
    >
      <td style={{ ...cellStyle, maxWidth: 0, width: '40%' }} title={entry.path}>
        <span style={{ color: text[3], fontSize: fontSizeVar.sm }}>{dir}</span>
        <span style={{ color: text[1] }}>{name}</span>
        <ProvenanceBadge entry={entry} />
        {entry.inspectError ? (
          <span
            title={entry.inspectError}
            data-testid="asset-budget-inspect-error"
            style={{ color: danger, marginLeft: spaceVar[3], fontWeight: 700 }}
          >
            !
          </span>
        ) : null}
      </td>
      <td style={{ ...cellStyle, color: text[3] }}>{entry.category}</td>
      <td style={numCellStyle} data-testid="asset-budget-cell-bytes">
        {formatBytes(entry.bytes)}
      </td>
      <td style={numCellStyle}>{vramLabel(entry)}</td>
      <td style={numCellStyle}>{entry.model ? formatCount(entry.model.glPrimitives) : '—'}</td>
      <td style={numCellStyle} data-testid="asset-budget-cell-refs">
        {entry.references.length}
      </td>
    </tr>
  );
}

function SummaryChips({ report }: { report: AssetBudgetReport }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: spaceVar[3],
        padding: `${spaceVar[4]} ${spaceVar[5]}`,
      }}
    >
      <span
        data-testid="asset-budget-totals"
        style={{
          fontSize: fontSizeVar.base,
          color: text[1],
          background: bg[3],
          borderRadius: radius.sm,
          padding: `${spaceVar[1]} ${spaceVar[4]}`,
        }}
      >
        {report.entries.length} assets · {formatBytes(report.totalBytes)} · VRAM est.{' '}
        {formatBytes(report.totalVramBytes)}
      </span>
      {report.categories.map((category) => (
        <span
          key={category.category}
          data-testid={`asset-budget-category-${category.category}`}
          style={{
            fontSize: fontSizeVar.base,
            color: text[2],
            border: `1px solid ${border[1]}`,
            borderRadius: radius.sm,
            padding: `${spaceVar[1]} ${spaceVar[4]}`,
          }}
        >
          {CATEGORY_LABEL[category.category]} {category.count} · {formatBytes(category.bytes)}
        </span>
      ))}
    </div>
  );
}

function ReportSection({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div data-testid={testId} style={{ padding: `${spaceVar[3]} ${spaceVar[5]}` }}>
      <div
        style={{
          fontSize: fontSizeVar.base,
          fontWeight: 600,
          color: text[2],
          marginBottom: spaceVar[2],
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function UnusedSection({
  report,
  onSelect,
}: {
  report: AssetBudgetReport;
  onSelect: (path: string) => void;
}) {
  if (report.unused.length === 0) return null;
  return (
    <ReportSection title={`Unused assets (${report.unused.length})`} testId="asset-budget-unused">
      <div
        data-testid="asset-budget-unused-caveat"
        style={{
          fontSize: fontSizeVar.sm,
          color: warn,
          marginBottom: spaceVar[2],
          lineHeight: lineHeightVar.normal,
        }}
      >
        “Unused” = not referenced by the manifest, project code, or another asset.
        {report.codeReferencesScanned
          ? ''
          : ' Code references (src/**) are not scanned in server mode, so an asset used only from code appears here — “unused” does not mean “safe to delete”.'}
      </div>
      {report.unused.map((path) => (
        <Button
          key={path}
          type="button"
          variant="ghost"
          size="compact"
          data-testid="asset-budget-unused-item"
          data-path={path}
          onClick={() => onSelect(path)}
          style={{ display: 'block' }}
        >
          <span style={{ fontSize: fontSizeVar.base, fontFamily: fontMono, color: warn }}>
            {path}
          </span>
        </Button>
      ))}
    </ReportSection>
  );
}

function DuplicatesSection({ report }: { report: AssetBudgetReport }) {
  if (report.duplicates.length === 0) return null;
  return (
    <ReportSection
      title={`Duplicate content (${report.duplicates.length} group${report.duplicates.length > 1 ? 's' : ''})`}
      testId="asset-budget-duplicates"
    >
      {report.duplicates.map((group) => (
        <div
          key={group.sha256}
          data-testid="asset-budget-duplicate-group"
          style={{ marginBottom: spaceVar[2] }}
        >
          <span style={{ fontSize: fontSizeVar.base, color: warn }}>
            {formatBytes(group.wastedBytes)} wasted · {group.paths.length} copies
          </span>
          {group.paths.map((path) => (
            <div
              key={path}
              style={{ fontSize: fontSizeVar.base, fontFamily: fontMono, color: text[3] }}
            >
              {path}
            </div>
          ))}
        </div>
      ))}
    </ReportSection>
  );
}

function DetailPane({
  entry,
  onApplied,
  codeReferencesScanned,
}: {
  entry: AssetBudgetEntry | null;
  onApplied: () => void;
  codeReferencesScanned: boolean;
}) {
  if (!entry) {
    return (
      <div style={{ padding: spaceVar[6], fontSize: fontSizeVar.md, color: text[3] }}>
        Select an asset to see its details and references.
      </div>
    );
  }
  return (
    <div
      data-testid="asset-budget-detail"
      style={{ padding: spaceVar[6], overflow: 'auto', minHeight: 0 }}
    >
      <div
        style={{
          fontSize: fontSizeVar.md,
          fontWeight: 600,
          color: text[1],
          wordBreak: 'break-all',
        }}
      >
        {entry.path}
      </div>
      <div style={{ fontSize: fontSizeVar.base, color: text[3], marginTop: spaceVar[1] }}>
        {entry.category} · {formatBytes(entry.bytes)}
        {entry.sha256 ? ` · sha256 ${entry.sha256.slice(0, 12)}…` : ''}
      </div>
      {entry.provenance ? (
        <div style={{ fontSize: fontSizeVar.base, color: accent, marginTop: spaceVar[3] }}>
          Generated by {entry.provenance.operationName}
          <span style={{ color: text[3] }}> · {entry.provenance.createdAt}</span>
        </div>
      ) : null}
      {entry.inspectError ? (
        <div style={{ fontSize: fontSizeVar.base, color: danger, marginTop: spaceVar[3] }}>
          Inspection failed: {entry.inspectError}
        </div>
      ) : null}
      {entry.model ? <ModelStats entry={entry} /> : null}
      <OptimizeActions entry={entry} onApplied={onApplied} />
      <ReferencesList entry={entry} codeReferencesScanned={codeReferencesScanned} />
    </div>
  );
}

function ModelStats({ entry }: { entry: AssetBudgetEntry }) {
  const model = entry.model;
  if (!model) return null;
  const rows: [string, string][] = [
    ['Triangles (GL primitives)', formatCount(model.glPrimitives)],
    ['Vertices', formatCount(model.vertices)],
    ['Meshes', String(model.meshCount)],
    ['Materials', String(model.materialCount)],
    ['Animations', String(model.animationCount)],
    ['Geometry upload', formatBytes(model.geometryBytes)],
    [
      'Texture VRAM est.',
      `${model.unknownTextureCount > 0 ? '≥ ' : ''}${formatBytes(model.textureGpuBytes)}`,
    ],
  ];
  return (
    <div style={{ marginTop: spaceVar[4] }}>
      {rows.map(([label, value]) => (
        <div
          key={label}
          style={{ display: 'flex', justifyContent: 'space-between', fontSize: fontSizeVar.base }}
        >
          <span style={{ color: text[3] }}>{label}</span>
          <span style={{ color: text[1], fontFamily: fontMono }}>{value}</span>
        </div>
      ))}
      {model.textures.length > 0 ? (
        <div style={{ marginTop: spaceVar[3] }}>
          <div style={{ fontSize: fontSizeVar.base, fontWeight: 600, color: text[2] }}>
            Textures
          </div>
          {model.textures.map((texture) => (
            <div
              key={`${texture.name}:${texture.slots.join(',')}`}
              style={{ fontSize: fontSizeVar.base, color: text[3] }}
            >
              {texture.name || '(unnamed)'} · {texture.mimeType} · {texture.resolution} ·{' '}
              {texture.gpuBytes === null ? 'VRAM unknown' : formatBytes(texture.gpuBytes)}
            </div>
          ))}
        </div>
      ) : null}
      {model.unknownTextureCount > 0 ? (
        <div style={{ fontSize: fontSizeVar.sm, color: warn, marginTop: spaceVar[2] }}>
          {model.unknownTextureCount} texture(s) have no reliable VRAM estimate — totals are lower
          bounds.
        </div>
      ) : null}
    </div>
  );
}

// --- Optimize actions (M3) ---------------------------------------------------

function useGltfCapabilities(): GltfIOCapabilities | null {
  const [capabilities, setCapabilities] = useState<GltfIOCapabilities | null>(null);
  useEffect(() => {
    let live = true;
    void getGltfIO().then((bundle) => {
      if (live) setCapabilities(bundle.capabilities);
    });
    return () => {
      live = false;
    };
  }, []);
  return capabilities;
}

interface PendingOptimize {
  readonly label: string;
  readonly operationName: string;
  readonly params?: Record<string, unknown>;
  readonly outcome: OptimizeOutcome;
  readonly lod?: LodGenerationOutcome;
}

function diffLabel(outcome: OptimizeOutcome): string {
  const delta = outcome.afterBytes - outcome.beforeBytes;
  const pct = outcome.beforeBytes > 0 ? Math.round((delta / outcome.beforeBytes) * 100) : 0;
  return `${formatBytes(outcome.beforeBytes)} → ${formatBytes(outcome.afterBytes)} (${pct > 0 ? '+' : ''}${pct}%)`;
}

/** One codec button: availability-probed title/disabled state in one place. */
function CodecButton({
  testId,
  label,
  availability,
  busy,
  activeTitle,
  onClick,
}: {
  testId: string;
  label: string;
  availability: { available: boolean; reason?: string } | undefined;
  busy: boolean;
  activeTitle: string;
  onClick?: () => void;
}) {
  const title = availability?.available
    ? activeTitle
    : (availability?.reason ?? 'Probing codec availability…');
  return (
    <Button
      type="button"
      size="compact"
      data-testid={testId}
      disabled={busy || !availability?.available || !onClick}
      title={title}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

function OptimizeConfirm({
  pending,
  busy,
  onApply,
  onCancel,
}: {
  pending: PendingOptimize;
  busy: boolean;
  onApply: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      data-testid="asset-budget-op-confirm"
      style={{
        marginTop: spaceVar[3],
        padding: spaceVar[4],
        border: `1px solid ${border[1]}`,
        borderRadius: radius.sm,
      }}
    >
      <div
        data-testid="asset-budget-op-diff"
        style={{ fontSize: fontSizeVar.base, color: text[1] }}
      >
        {pending.label}: {diffLabel(pending.outcome)}
      </div>
      {pending.lod ? (
        <div style={{ fontSize: fontSizeVar.base, color: text[3], marginTop: spaceVar[1] }}>
          {pending.lod.levels
            .map((level) => `${level.node} ${formatCount(level.triangles)} tris`)
            .join(' · ')}{' '}
          (base {formatCount(pending.lod.baseTriangles)})
        </div>
      ) : (
        <div style={{ fontSize: fontSizeVar.base, color: warn, marginTop: spaceVar[1] }}>
          Rewrites the file on disk — not undoable from the editor.
        </div>
      )}
      <div style={{ display: 'flex', gap: spaceVar[2], marginTop: spaceVar[3] }}>
        <Button
          type="button"
          size="compact"
          variant="primary"
          data-testid="asset-budget-op-apply"
          disabled={busy}
          onClick={onApply}
        >
          Apply
        </Button>
        <Button
          type="button"
          size="compact"
          data-testid="asset-budget-op-cancel"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function OptimizeNotices({
  busy,
  error,
  stampError,
}: {
  busy: string | null;
  error: string | null;
  stampError: string | null;
}) {
  return (
    <>
      {busy ? (
        <div
          data-testid="asset-budget-op-busy"
          style={{ fontSize: fontSizeVar.base, color: text[3], marginTop: spaceVar[3] }}
        >
          {busy}…
        </div>
      ) : null}
      {error ? (
        <div
          data-testid="asset-budget-op-error"
          style={{ fontSize: fontSizeVar.base, color: danger, marginTop: spaceVar[3] }}
        >
          {error}
        </div>
      ) : null}
      {stampError ? (
        <div
          data-testid="asset-budget-stamp-error"
          style={{ fontSize: fontSizeVar.base, color: warn, marginTop: spaceVar[3] }}
        >
          {stampError}
        </div>
      ) : null}
    </>
  );
}

/**
 * Per-asset optimize buttons — real gltf-transform ops on the real bytes.
 * Compression rewrites the file, which the editor undo stack (scene-document
 * snapshots) cannot restore, so every apply goes through an inline
 * CONFIRM-WITH-DIFF (before → after, computed from the actual result, never
 * predicted). Unavailable codecs render disabled with the probe's reason
 * (KTX2 always, in this environment). GLB only: multi-file .gltf write-back
 * is out of scope and says so.
 */
function OptimizeActions({ entry, onApplied }: { entry: AssetBudgetEntry; onApplied: () => void }) {
  const capabilities = useGltfCapabilities();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stampError, setStampError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingOptimize | null>(null);
  const [lodNode, setLodNode] = useState('');
  if (entry.category !== 'model') return null;
  if (!/\.glb$/i.test(entry.path)) {
    return (
      <div style={{ marginTop: spaceVar[5], fontSize: fontSizeVar.base, color: text[3] }}>
        Optimization supports single-file .glb assets (this is a multi-file .gltf).
      </div>
    );
  }
  if (entry.inspectError) return null;

  const run = (
    label: string,
    operationName: string,
    operation: (bytes: Uint8Array) => Promise<OptimizeOutcome>,
    params?: Record<string, unknown>,
  ): void => {
    setBusy(label);
    setError(null);
    setStampError(null);
    setPending(null);
    void getStorageBackend()
      .readBytes(entry.path)
      .then(operation)
      .then((outcome) => {
        setPending({
          label,
          operationName,
          ...(params ? { params } : {}),
          outcome,
          ...('levels' in outcome ? { lod: outcome as LodGenerationOutcome } : {}),
        });
      })
      .catch((runError: unknown) => {
        setError(runError instanceof Error ? runError.message : String(runError));
      })
      .finally(() => setBusy(null));
  };

  const apply = (): void => {
    if (!pending) return;
    setBusy(pending.label);
    void applyOptimizedBytes(
      getStorageBackend(),
      {
        operationName: pending.operationName,
        storagePath: entry.path,
        beforeBytes: pending.outcome.beforeBytes,
        beforeSha256: entry.sha256,
        ...(pending.params ? { params: pending.params } : {}),
      },
      pending.outcome.bytes,
    )
      .then((result) => {
        if (result.stampError) {
          setStampError(`Optimized, but provenance stamp failed: ${result.stampError}`);
        }
        setPending(null);
        onApplied();
      })
      .catch((applyError: unknown) => {
        setError(applyError instanceof Error ? applyError.message : String(applyError));
      })
      .finally(() => setBusy(null));
  };

  const lodCandidates = entry.model?.meshNames ?? [];
  const chosenLodNode = lodNode || lodCandidates[0] || '';

  return (
    <div style={{ marginTop: spaceVar[6] }}>
      <div
        style={{
          fontSize: fontSizeVar.base,
          fontWeight: 600,
          color: text[2],
          marginBottom: spaceVar[2],
        }}
      >
        Optimize
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: spaceVar[2] }}>
        <CodecButton
          testId="asset-budget-op-meshopt"
          label="Compress · meshopt"
          availability={capabilities?.meshoptEncoder}
          busy={busy !== null}
          activeTitle="Reorder + quantize + EXT_meshopt_compression"
          onClick={() =>
            run('Meshopt', 'asset-budget.meshopt', compressModelMeshopt, { codec: 'meshopt' })
          }
        />
        <CodecButton
          testId="asset-budget-op-draco"
          label="Compress · Draco"
          availability={capabilities?.dracoEncoder}
          busy={busy !== null}
          activeTitle="KHR_draco_mesh_compression"
          onClick={() => run('Draco', 'asset-budget.draco', compressModelDraco, { codec: 'draco' })}
        />
        <CodecButton
          testId="asset-budget-op-ktx2"
          label="Compress textures · KTX2"
          availability={capabilities?.ktx2Encoder}
          busy={busy !== null}
          activeTitle="KHR_texture_basisu — ETC1S for color maps, UASTC for normal/ORM data"
          onClick={() => run('KTX2', 'asset-budget.ktx2', compressTexturesKtx2, { codec: 'ktx2' })}
        />
      </div>
      {lodCandidates.length > 0 ? (
        <div style={{ display: 'flex', gap: spaceVar[2], marginTop: spaceVar[3] }}>
          <Select
            className="vgai-select"
            aria-label="LOD base node"
            data-testid="asset-budget-op-lod-node"
            value={chosenLodNode}
            onChange={(event) => setLodNode(event.target.value)}
            style={{ flex: 1, minWidth: 0 }}
          >
            {lodCandidates.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
          <CodecButton
            testId="asset-budget-op-lod"
            label="Generate LOD nodes"
            availability={capabilities?.meshoptSimplifier}
            busy={busy !== null || !chosenLodNode}
            activeTitle="simplify() the chosen node into _LOD1/_LOD2 sibling nodes (additive — base geometry untouched). Add mesh.lod rows from the Mesh inspector."
            onClick={() =>
              run(
                'Generate LODs',
                'asset-budget.lod-levels',
                (bytes) => generateLodLevels(bytes, chosenLodNode),
                { baseNode: chosenLodNode },
              )
            }
          />
        </div>
      ) : null}
      {pending ? (
        <OptimizeConfirm
          pending={pending}
          busy={busy !== null}
          onApply={apply}
          onCancel={() => setPending(null)}
        />
      ) : null}
      <OptimizeNotices busy={busy} error={error} stampError={stampError} />
    </div>
  );
}

/** The critique-P5 "what uses this" query, rendered. */
function ReferencesList({
  entry,
  codeReferencesScanned,
}: {
  entry: AssetBudgetEntry;
  codeReferencesScanned: boolean;
}) {
  return (
    <div style={{ marginTop: spaceVar[5] }}>
      <div style={{ fontSize: fontSizeVar.base, fontWeight: 600, color: text[2] }}>
        What uses this ({entry.references.length})
      </div>
      {entry.engineVendored ? (
        <div
          data-testid="asset-budget-engine-runtime"
          style={{ fontSize: fontSizeVar.base, color: text[3] }}
        >
          Engine runtime (Three.js examples/jsm) — loaded by the engine at runtime, not by project
          content. Required infrastructure; not safe to delete.
        </div>
      ) : entry.references.length === 0 ? (
        <>
          <div
            data-testid="asset-budget-no-references"
            style={{ fontSize: fontSizeVar.base, color: warn }}
          >
            Nothing in this project’s manifest, code, or other assets references this asset.
          </div>
          {codeReferencesScanned ? null : (
            <div
              data-testid="asset-budget-code-not-scanned"
              style={{
                fontSize: fontSizeVar.sm,
                color: warn,
                marginTop: spaceVar[1],
                lineHeight: lineHeightVar.normal,
              }}
            >
              Code references (src/**) are not scanned in server mode — an asset used only from code
              will show here. Not necessarily safe to delete.
            </div>
          )}
        </>
      ) : (
        entry.references.map((reference) => (
          <div
            key={`${reference.ownerPath}:${reference.jsonPath ?? reference.kind}`}
            data-testid="asset-budget-reference"
            style={{ fontSize: fontSizeVar.base, padding: `${spaceVar[1]} 0` }}
          >
            <span style={{ color: text[1], fontFamily: fontMono }}>{reference.ownerPath}</span>
            <span style={{ color: text[3] }}>
              {' '}
              · {reference.kind}
              {reference.jsonPath ? ` · ${reference.jsonPath}` : ''}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

export function AssetBudgetPanel() {
  useSyncExternalStore(subscribeFocus, focusVersion);
  const { report, loading, error, refresh, stale } = useBudgetReport();
  const [sortKey, setSortKey] = useState<SortKey>('bytes');
  const [direction, setDirection] = useState<1 | -1>(-1);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  // Adopt a pending focus request (context-menu jump) once data is present.
  useEffect(() => {
    if (!report) return;
    const focus = takeFocusPath();
    if (focus === null) return;
    const normalized = focus.replace(/^\/+/, '');
    // Match all live spellings: entry paths are serving-rooted in server mode
    // (`models/x.glb`) and public/-prefixed in project-rooted snapshots, while
    // callers may hand over either form.
    const match = report.entries.find(
      (entry) =>
        entry.path === normalized ||
        entry.path === `public/${normalized}` ||
        `public/${entry.path}` === normalized,
    );
    if (match) setSelectedPath(match.path);
  }, [report]);

  const onSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) setDirection((prior) => (prior === 1 ? -1 : 1));
      else {
        setSortKey(key);
        setDirection(key === 'path' || key === 'category' ? 1 : -1);
      }
    },
    [sortKey],
  );

  const entries = report ? sortEntries(report.entries, sortKey, direction) : [];
  const selected = report?.entries.find((entry) => entry.path === selectedPath) ?? null;

  return (
    <div
      data-testid="asset-budget-document"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: bg[1],
        color: text[1],
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: spaceVar[4],
          padding: `${spaceVar[3]} ${spaceVar[5]}`,
          borderBottom: `1px solid ${border[1]}`,
        }}
      >
        <span style={{ fontSize: fontSizeVar.md, fontWeight: 600 }}>Asset Budget</span>
        <Button type="button" size="compact" data-testid="asset-budget-refresh" onClick={refresh}>
          Refresh
        </Button>
        {stale ? (
          <span
            data-testid="asset-budget-stale"
            style={{ fontSize: fontSizeVar.base, color: warn }}
          >
            Project files changed — refresh for current numbers.
          </span>
        ) : null}
        {loading ? (
          <span
            data-testid="asset-budget-loading"
            style={{ fontSize: fontSizeVar.base, color: text[3] }}
          >
            Analyzing…
          </span>
        ) : null}
      </div>
      {error ? (
        <div
          data-testid="asset-budget-error"
          style={{ padding: spaceVar[6], color: danger, fontSize: fontSizeVar.md }}
        >
          Analysis failed: {error}
        </div>
      ) : null}
      {report ? (
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div
            style={{
              flex: 2,
              minWidth: 0,
              overflow: 'auto',
              borderRight: `1px solid ${border[1]}`,
            }}
          >
            <SummaryChips report={report} />
            <table
              data-testid="asset-budget-table"
              style={{ width: '100%', borderCollapse: 'collapse', fontSize: fontSizeVar.md }}
            >
              <thead>
                <tr>
                  <HeaderCell
                    label="Asset"
                    sortKey="path"
                    active={sortKey === 'path'}
                    direction={direction}
                    onSort={onSort}
                  />
                  <HeaderCell
                    label="Category"
                    sortKey="category"
                    active={sortKey === 'category'}
                    direction={direction}
                    onSort={onSort}
                  />
                  <HeaderCell
                    label="Size"
                    sortKey="bytes"
                    active={sortKey === 'bytes'}
                    direction={direction}
                    onSort={onSort}
                    align="right"
                  />
                  <HeaderCell
                    label="VRAM est."
                    sortKey="vram"
                    active={sortKey === 'vram'}
                    direction={direction}
                    onSort={onSort}
                    align="right"
                  />
                  <HeaderCell
                    label="Tris"
                    sortKey="tris"
                    active={sortKey === 'tris'}
                    direction={direction}
                    onSort={onSort}
                    align="right"
                  />
                  <HeaderCell
                    label="Refs"
                    sortKey="refs"
                    active={sortKey === 'refs'}
                    direction={direction}
                    onSort={onSort}
                    align="right"
                  />
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <BudgetRow
                    key={entry.path}
                    entry={entry}
                    selected={entry.path === selectedPath}
                    onSelect={setSelectedPath}
                  />
                ))}
              </tbody>
            </table>
            <UnusedSection report={report} onSelect={setSelectedPath} />
            <DuplicatesSection report={report} />
          </div>
          <div style={{ flex: 1, minWidth: 220, overflow: 'auto' }}>
            <DetailPane
              entry={selected}
              onApplied={refresh}
              codeReferencesScanned={report.codeReferencesScanned}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
