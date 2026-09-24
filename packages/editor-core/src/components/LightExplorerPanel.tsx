import { faArrowDown, faArrowUp } from '@fortawesome/free-solid-svg-icons';
import {
  Button,
  Checkbox,
  ColorSwatchInput,
  EditorIcon,
  NumberInput,
  Select,
  TextInput,
} from '@volter/editor-sdk/widgets';
import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import {
  type MutableRefObject,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { activeAuthoringVersion, subscribeActiveAuthoring } from '../authoring/active-adapter';
import { setAuthoringSelection } from '../authoring/consumer-actions';
import { resolvePanelAuthoring } from '../authoring/panel-authoring';
import { useEditorStore } from '../editor-runtime';
import {
  type LightExplorerField,
  type LightExplorerRow,
  lightExplorerRows,
  setLightExplorerField,
} from '../light-explorer-model';
import {
  subscribeWorkspaceDocuments,
  workspaceDocumentRegistryVersion,
} from '@volter/editor-sdk/kit/workspace-document-registry';

type SortKey = 'name' | 'type' | 'intensity' | 'range' | 'shadows';
type SortDirection = 'ascending' | 'descending';

function compareNullable(a: string | number | boolean | null, b: string | number | boolean | null) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === 'string' && typeof b === 'string') {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  }
  return Number(a) - Number(b);
}

function sortValue(row: LightExplorerRow, key: SortKey): string | number | boolean | null {
  if (key === 'name' || key === 'type') return row[key];
  return row[key].value;
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
}: {
  readonly label: string;
  readonly sortKey: SortKey;
  readonly activeKey: SortKey;
  readonly direction: SortDirection;
  readonly onSort: (key: SortKey) => void;
}) {
  const active = sortKey === activeKey;
  return (
    <Button
      type="button"
      variant="ghost"
      size="compact"
      className="vgai-light-explorer-sort"
      aria-label={`Sort lights by ${label}`}
      onClick={() => onSort(sortKey)}
    >
      {label}
      {active ? (
        <EditorIcon icon={direction === 'ascending' ? faArrowUp : faArrowDown} size="xs" />
      ) : null}
    </Button>
  );
}

function UnsupportedCell() {
  return <span className="vgai-light-explorer-unavailable">—</span>;
}

function EnabledCell({
  row,
  edit,
}: {
  readonly row: LightExplorerRow;
  readonly edit: (field: LightExplorerField, value: unknown) => void;
}) {
  if (!row.enabled.supported) return <UnsupportedCell />;
  return (
    <Checkbox
      aria-label={`${row.enabled.value ? 'Disable' : 'Enable'} ${row.name}`}
      checked={row.enabled.value ?? false}
      disabled={!row.enabled.writable}
      onChange={(event) => edit('enabled', event.target.checked)}
    />
  );
}

function ColorCell({
  row,
  edit,
}: {
  readonly row: LightExplorerRow;
  readonly edit: (field: LightExplorerField, value: unknown) => void;
}) {
  if (!row.color.supported || !row.color.value) return <UnsupportedCell />;
  return (
    <div className="vgai-light-explorer-color">
      <ColorSwatchInput
        aria-label={`Color for ${row.name}`}
        value={row.color.value}
        disabled={!row.color.writable}
        onChange={(event) => edit('color', event.target.value)}
      />
      <span>{row.color.value}</span>
    </div>
  );
}

function NumericCell({
  row,
  field,
  step,
  edit,
}: {
  readonly row: LightExplorerRow;
  readonly field: 'intensity' | 'range';
  readonly step: number;
  readonly edit: (field: LightExplorerField, value: unknown) => void;
}) {
  const cell = row[field];
  if (!cell.supported) return <UnsupportedCell />;
  return (
    <NumberInput
      value={cell.value}
      disabled={!cell.writable}
      precision={2}
      step={step}
      onChange={(value) => edit(field, value)}
    />
  );
}

function ShadowsCell({
  row,
  edit,
}: {
  readonly row: LightExplorerRow;
  readonly edit: (field: LightExplorerField, value: unknown) => void;
}) {
  if (!row.shadows.supported) return <UnsupportedCell />;
  return (
    <Checkbox
      aria-label={`Toggle shadows for ${row.name}`}
      checked={row.shadows.value ?? false}
      disabled={!row.shadows.writable}
      onChange={(event) => edit('shadows', event.target.checked)}
    />
  );
}

function LightTableRow({
  row,
  adapter,
  visibleRows,
  selected,
  selectionAnchor,
  edit,
}: {
  readonly row: LightExplorerRow;
  readonly adapter: AuthoringAdapter;
  readonly visibleRows: readonly LightExplorerRow[];
  readonly selected: ReadonlySet<string>;
  readonly selectionAnchor: MutableRefObject<string | null>;
  readonly edit: (row: LightExplorerRow, field: LightExplorerField, value: unknown) => void;
}) {
  const editRow = (field: LightExplorerField, value: unknown) => edit(row, field, value);
  return (
    <tr data-selected={selected.has(row.id) || undefined}>
      <td>
        <EnabledCell row={row} edit={editRow} />
      </td>
      <td>
        <Button
          type="button"
          variant="ghost"
          size="compact"
          className="vgai-light-explorer-name"
          aria-pressed={selected.has(row.id)}
          onClick={(event) => {
            selectRow(
              adapter,
              visibleRows,
              row.id,
              selectionAnchor.current,
              event.shiftKey,
              event.metaKey || event.ctrlKey,
            );
            if (!event.shiftKey) selectionAnchor.current = row.id;
          }}
        >
          {row.name}
        </Button>
      </td>
      <td className="vgai-light-explorer-type">{row.type}</td>
      <td>
        <ColorCell row={row} edit={editRow} />
      </td>
      <td>
        <NumericCell row={row} field="intensity" step={0.1} edit={editRow} />
      </td>
      <td>
        <NumericCell row={row} field="range" step={0.5} edit={editRow} />
      </td>
      <td>
        <ShadowsCell row={row} edit={editRow} />
      </td>
    </tr>
  );
}

function selectedTargets(
  row: LightExplorerRow,
  selected: ReadonlySet<string>,
  visibleRows: readonly LightExplorerRow[],
): string[] {
  if (!selected.has(row.id)) return [row.id];
  const selectedLights = visibleRows.filter((candidate) => selected.has(candidate.id));
  return selectedLights.length > 1 ? selectedLights.map((candidate) => candidate.id) : [row.id];
}

function selectRow(
  adapter: AuthoringAdapter,
  visibleRows: readonly LightExplorerRow[],
  rowId: string,
  anchorId: string | null,
  extend: boolean,
  toggle: boolean,
): void {
  if (!adapter.selection) return;
  const current = adapter.selection.get();
  if (extend && anchorId) {
    const anchor = visibleRows.findIndex((row) => row.id === anchorId);
    const target = visibleRows.findIndex((row) => row.id === rowId);
    if (anchor >= 0 && target >= 0) {
      const range = visibleRows
        .slice(Math.min(anchor, target), Math.max(anchor, target) + 1)
        .map((row) => row.id);
      setAuthoringSelection(adapter, toggle ? [...new Set([...current, ...range])] : range, {
        intent: 'exact',
      });
      return;
    }
  }
  if (toggle) {
    setAuthoringSelection(
      adapter,
      current.includes(rowId) ? current.filter((id) => id !== rowId) : [...current, rowId],
      { intent: 'exact' },
    );
    return;
  }
  setAuthoringSelection(adapter, [rowId], { intent: 'exact' });
}

export function LightExplorerPanel() {
  const store = useEditorStore();
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useSyncExternalStore(
    subscribeWorkspaceDocuments,
    workspaceDocumentRegistryVersion,
    workspaceDocumentRegistryVersion,
  );
  useSyncExternalStore(subscribeActiveAuthoring, activeAuthoringVersion, activeAuthoringVersion);
  const { adapter } = resolvePanelAuthoring(store);
  const [, notifyAdapterChange] = useReducer((value: number) => value + 1, 0);
  useEffect(() => adapter.subscribe?.(notifyAdapterChange), [adapter]);

  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('ascending');
  const selectionAnchor = useRef<string | null>(null);
  const rows = lightExplorerRows(adapter);
  const types = useMemo(
    () => [...new Set(rows.map((row) => row.type))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleRows = rows
    .filter(
      (row) =>
        (typeFilter === 'all' || row.type === typeFilter) &&
        (!normalizedQuery ||
          row.name.toLocaleLowerCase().includes(normalizedQuery) ||
          row.type.toLocaleLowerCase().includes(normalizedQuery)),
    )
    .sort((a, b) => {
      const compared = compareNullable(sortValue(a, sortKey), sortValue(b, sortKey));
      return sortDirection === 'ascending' ? compared : -compared;
    });
  const selected = new Set(adapter.selection?.get() ?? []);
  const selectedLightCount = rows.filter((row) => selected.has(row.id)).length;

  const chooseSort = (next: SortKey) => {
    if (next === sortKey) {
      setSortDirection((direction) => (direction === 'ascending' ? 'descending' : 'ascending'));
    } else {
      setSortKey(next);
      setSortDirection('ascending');
    }
  };
  const edit = (row: LightExplorerRow, field: LightExplorerField, value: unknown) => {
    const targets = selectedTargets(row, selected, visibleRows);
    if (setLightExplorerField(adapter, targets, field, value) > 0) store.notifyIngestEdit();
  };

  return (
    <section className="vgai-light-explorer" aria-label="Light Explorer">
      <div className="vgai-light-explorer-toolbar">
        <TextInput
          aria-label="Search lights"
          placeholder="Search lights…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Select
          aria-label="Filter lights by type"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
        >
          <option value="all">All types</option>
          {types.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </Select>
        <span className="vgai-light-explorer-summary">
          {rows.length} {rows.length === 1 ? 'light' : 'lights'}
          {selectedLightCount > 0 ? ` · ${selectedLightCount} selected` : ''}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="vgai-light-explorer-empty">
          The active document does not expose any lights.
        </div>
      ) : (
        <div className="vgai-light-explorer-scroll">
          <table className="vgai-light-explorer-table">
            <thead>
              <tr>
                <th className="vgai-light-explorer-check-column" scope="col">
                  On
                </th>
                <th scope="col">
                  <SortHeader
                    label="Name"
                    sortKey="name"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={chooseSort}
                  />
                </th>
                <th scope="col">
                  <SortHeader
                    label="Type"
                    sortKey="type"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={chooseSort}
                  />
                </th>
                <th scope="col">Color</th>
                <th scope="col">
                  <SortHeader
                    label="Intensity"
                    sortKey="intensity"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={chooseSort}
                  />
                </th>
                <th scope="col">
                  <SortHeader
                    label="Range"
                    sortKey="range"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={chooseSort}
                  />
                </th>
                <th scope="col">
                  <SortHeader
                    label="Shadows"
                    sortKey="shadows"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={chooseSort}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <LightTableRow
                  key={row.id}
                  row={row}
                  adapter={adapter}
                  visibleRows={visibleRows}
                  selected={selected}
                  selectionAnchor={selectionAnchor}
                  edit={edit}
                />
              ))}
            </tbody>
          </table>
          {visibleRows.length === 0 ? (
            <div className="vgai-light-explorer-empty">No lights match the current filters.</div>
          ) : null}
        </div>
      )}
    </section>
  );
}
