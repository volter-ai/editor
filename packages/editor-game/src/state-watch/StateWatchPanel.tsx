/**
 * Runtime State Watch — the standard debugger tree/watch surface over the
 * game's native `DebugAdapter` providers.
 *
 * It deliberately authors nothing: providers stay game-owned, values are read
 * through the same adapter `@volter/editor-live` uses, and pins are per-user editor
 * convenience in the host's project-local document
 * (`editorHost().projectLocalState`), not a project sidecar or a new format.
 */

import { getActiveDebug } from '@volter/editor-sdk/kit/authoring/active-systems';
import { editorHost } from '@volter/editor-sdk/host';
import { Button, DisclosureIcon, TextInput, themeVars } from '@volter/editor-sdk/widgets';
import type { DebugAdapter } from '@volter/editor-project/adapter/system-adapter';
import { useCallback, useEffect, useMemo, useState } from 'react';

const POLL_MS = 250;
const MAX_VISIBLE_CHILDREN = 200;
const MAX_FILTERED_LEAVES = 500;
/** The section of the project-local document this panel owns. */
const SECTION = 'stateWatchPins';

interface WatchPin {
  provider: string;
  path: string[];
}

interface WatchLeaf extends WatchPin {
  value: unknown;
}

interface ResolvedWatchValue {
  available: boolean;
  value: unknown;
}

function pinKey(pin: WatchPin): string {
  return JSON.stringify([pin.provider, ...pin.path]);
}

function pathLabel(pin: WatchPin): string {
  return [pin.provider, ...pin.path].join('.');
}

function projectId(): string {
  return editorHost().projectLocalState.projectRootPath() ?? '__unscoped__';
}

function readPins(_id: string): WatchPin[] {
  const pins = editorHost().projectLocalState.read<WatchPin[]>(SECTION);
  if (!Array.isArray(pins)) return [];
  return pins.filter(
    (pin) =>
      typeof pin?.provider === 'string' &&
      Array.isArray(pin.path) &&
      pin.path.every((part) => typeof part === 'string'),
  );
}

function writePins(_id: string, pins: readonly WatchPin[]): void {
  editorHost().projectLocalState.write(
    SECTION,
    pins.map((pin) => ({ provider: pin.provider, path: [...pin.path] })),
  );
}

function isBranch(value: unknown): value is object {
  return value !== null && typeof value === 'object';
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return `“${value}”`;
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3);
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'function') return '[Function]';
  if (isBranch(value)) {
    try {
      return Array.isArray(value)
        ? `Array(${value.length})`
        : `Object(${Object.keys(value).length})`;
    } catch {
      return '[Unreadable object]';
    }
  }
  return String(value);
}

function entriesOf(value: object): [string, unknown][] {
  try {
    return Object.entries(value as Record<string, unknown>);
  } catch {
    return [];
  }
}

function valueAt(snapshot: Record<string, unknown>, pin: WatchPin): ResolvedWatchValue {
  try {
    if (!Object.hasOwn(snapshot, pin.provider)) return { available: false, value: undefined };
    let value = snapshot[pin.provider];
    for (const part of pin.path) {
      if (!isBranch(value) || !Object.hasOwn(value, part)) {
        return { available: false, value: undefined };
      }
      value = (value as Record<string, unknown>)[part];
    }
    return { available: true, value };
  } catch {
    return { available: false, value: undefined };
  }
}

function collectLeaves(
  provider: string,
  value: unknown,
  path: string[],
  query: string,
  output: WatchLeaf[],
  ancestors: readonly object[],
): void {
  if (output.length >= MAX_FILTERED_LEAVES) return;
  const circular = isBranch(value) && ancestors.includes(value);
  if (!isBranch(value) || circular) {
    const leaf = { provider, path, value: circular ? '[Circular]' : value };
    if (
      pathLabel(leaf).toLowerCase().includes(query) ||
      formatValue(leaf.value).toLowerCase().includes(query)
    ) {
      output.push(leaf);
    }
    return;
  }
  const nextAncestors = [...ancestors, value];
  const entries = entriesOf(value);
  if (entries.length === 0) {
    const leaf = { provider, path, value };
    if (pathLabel(leaf).toLowerCase().includes(query)) output.push(leaf);
    return;
  }
  for (const [name, child] of entries) {
    collectLeaves(provider, child, [...path, name], query, output, nextAncestors);
    if (output.length >= MAX_FILTERED_LEAVES) return;
  }
}

const MONO: React.CSSProperties = {
  fontFamily: themeVars.typography.mono,
  fontSize: 11,
};

function LeafRow({
  leaf,
  pinned,
  onTogglePin,
  depth = 0,
}: {
  leaf: WatchLeaf;
  pinned: boolean;
  onTogglePin: (pin: WatchPin) => void;
  depth?: number;
}) {
  const label = leaf.path.at(-1) ?? leaf.provider;
  return (
    <div
      style={{
        ...MONO,
        minHeight: 22,
        display: 'grid',
        gridTemplateColumns: 'minmax(100px, 0.65fr) minmax(120px, 1fr) auto',
        alignItems: 'center',
        gap: 8,
        paddingLeft: 8 + depth * 14,
        paddingRight: 8,
        borderBottom: `1px solid ${themeVars.boundary.default}`,
      }}
      title={pathLabel(leaf)}
    >
      <span
        style={{ color: themeVars.content.primary, overflow: 'hidden', textOverflow: 'ellipsis' }}
      >
        {label}
      </span>
      <span
        style={{
          color: themeVars.content.muted,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {formatValue(leaf.value)}
      </span>
      <Button
        type="button"
        size="compact"
        variant={pinned ? 'primary' : 'secondary'}
        aria-pressed={pinned}
        title={pinned ? `Remove ${pathLabel(leaf)} from watches` : `Watch ${pathLabel(leaf)}`}
        onClick={() => onTogglePin(leaf)}
      >
        {pinned ? 'Pinned' : 'Pin'}
      </Button>
    </div>
  );
}

function StateTreeNode({
  provider,
  name,
  value,
  path,
  depth,
  ancestors,
  pinnedKeys,
  onTogglePin,
}: {
  provider: string;
  name: string;
  value: unknown;
  path: string[];
  depth: number;
  ancestors: readonly object[];
  pinnedKeys: ReadonlySet<string>;
  onTogglePin: (pin: WatchPin) => void;
}) {
  const circular = isBranch(value) && ancestors.includes(value);
  const [expanded, setExpanded] = useState(depth === 0);
  if (!isBranch(value) || circular) {
    const leaf = { provider, path, value: circular ? '[Circular]' : value };
    return (
      <LeafRow
        leaf={leaf}
        depth={depth}
        pinned={pinnedKeys.has(pinKey(leaf))}
        onTogglePin={onTogglePin}
      />
    );
  }

  const entries = entriesOf(value);
  const visible = entries.slice(0, MAX_VISIBLE_CHILDREN);
  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        style={{
          ...MONO,
          width: '100%',
          minHeight: 22,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: `0 8px 0 ${8 + depth * 14}px`,
          color: themeVars.content.primary,
          background: 'transparent',
          border: 0,
          borderBottom: `1px solid ${themeVars.boundary.default}`,
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <span style={{ width: 12, color: themeVars.content.muted }}>
          <DisclosureIcon direction={expanded ? 'down' : 'right'} />
        </span>
        <span>{name}</span>
        <span style={{ color: themeVars.content.dim }}>
          {Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}
        </span>
      </button>
      {expanded &&
        visible.map(([childName, child]) => (
          <StateTreeNode
            key={childName}
            provider={provider}
            name={childName}
            value={child}
            path={[...path, childName]}
            depth={depth + 1}
            ancestors={[...ancestors, value]}
            pinnedKeys={pinnedKeys}
            onTogglePin={onTogglePin}
          />
        ))}
      {expanded && entries.length > visible.length && (
        <div
          style={{
            ...MONO,
            padding: `3px 8px 3px ${8 + (depth + 1) * 14}px`,
            color: themeVars.content.dim,
          }}
        >
          {entries.length - visible.length} more values — narrow with search
        </div>
      )}
    </div>
  );
}

function readSnapshot(adapter: DebugAdapter | null | undefined): {
  providers: ReturnType<DebugAdapter['providers']>;
  state: Record<string, unknown>;
  error: string | null;
} {
  if (!adapter) return { providers: [], state: {}, error: null };
  let providers: ReturnType<DebugAdapter['providers']>;
  try {
    providers = adapter.providers();
  } catch (reason) {
    return {
      providers: [],
      state: {},
      error: reason instanceof Error ? reason.message : String(reason),
    };
  }
  try {
    return { providers, state: adapter.stateAll(), error: null };
  } catch (reason) {
    return {
      providers,
      state: {},
      error: reason instanceof Error ? reason.message : String(reason),
    };
  }
}

export function StateWatchPanel() {
  const scopedProject = projectId();
  const [snapshot, setSnapshot] = useState(() => readSnapshot(getActiveDebug()));
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('');
  const [pins, setPins] = useState<WatchPin[]>(() => readPins(scopedProject));

  useEffect(() => setPins(readPins(scopedProject)), [scopedProject]);

  const refresh = useCallback(() => setSnapshot(readSnapshot(getActiveDebug())), []);
  useEffect(() => {
    refresh();
    if (paused) return;
    const interval = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(interval);
  }, [paused, refresh]);

  const pinnedKeys = useMemo(() => new Set(pins.map(pinKey)), [pins]);
  const togglePin = useCallback(
    (pin: WatchPin) => {
      setPins((current) => {
        const key = pinKey(pin);
        const next = current.some((item) => pinKey(item) === key)
          ? current.filter((item) => pinKey(item) !== key)
          : [...current, { provider: pin.provider, path: [...pin.path] }];
        writePins(scopedProject, next);
        return next;
      });
    },
    [scopedProject],
  );

  const filteredLeaves = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return [];
    const matches: WatchLeaf[] = [];
    for (const provider of snapshot.providers) {
      collectLeaves(provider.name, snapshot.state[provider.name], [], query, matches, []);
    }
    return matches;
  }, [filter, snapshot]);

  const adapter = getActiveDebug();
  if (!adapter) {
    return (
      <div style={{ padding: 12, color: themeVars.content.muted, fontSize: 11 }}>
        State Watch is available while a game with debug providers is running.
      </div>
    );
  }

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          minHeight: 34,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 8px',
          borderBottom: `1px solid ${themeVars.boundary.default}`,
        }}
      >
        <TextInput
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter state paths or values…"
          aria-label="Filter state watches"
          style={{ width: 240 }}
        />
        <Button type="button" size="compact" onClick={() => setPaused((value) => !value)}>
          {paused ? 'Resume' : 'Pause'}
        </Button>
        <Button type="button" size="compact" disabled={!paused} onClick={refresh}>
          Refresh
        </Button>
        <span style={{ color: themeVars.content.dim, fontSize: 10 }}>
          {snapshot.providers.length} provider{snapshot.providers.length === 1 ? '' : 's'} ·{' '}
          {pins.length} pinned{paused ? ' · paused' : ''}
        </span>
        {snapshot.error && (
          <span style={{ color: themeVars.semantic.danger, fontSize: 10 }}>{snapshot.error}</span>
        )}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: 'minmax(280px, 1fr) minmax(240px, 0.65fr)',
        }}
      >
        <section aria-label="Live state" style={{ minWidth: 0, overflow: 'auto' }}>
          {filter.trim() ? (
            filteredLeaves.length > 0 ? (
              filteredLeaves.map((leaf) => (
                <LeafRow
                  key={pinKey(leaf)}
                  leaf={leaf}
                  pinned={pinnedKeys.has(pinKey(leaf))}
                  onTogglePin={togglePin}
                />
              ))
            ) : (
              <div style={{ padding: 10, color: themeVars.content.dim, fontSize: 11 }}>
                No state values match “{filter.trim()}”.
              </div>
            )
          ) : (
            snapshot.providers.map((provider) => (
              <StateTreeNode
                key={provider.name}
                provider={provider.name}
                name={`${provider.name} · ${provider.tier}`}
                value={snapshot.state[provider.name]}
                path={[]}
                depth={0}
                ancestors={[]}
                pinnedKeys={pinnedKeys}
                onTogglePin={togglePin}
              />
            ))
          )}
          {snapshot.providers.length === 0 && (
            <div style={{ padding: 10, color: themeVars.content.dim, fontSize: 11 }}>
              The running game has not registered any state providers.
            </div>
          )}
        </section>

        <aside
          aria-label="Pinned watches"
          style={{
            minWidth: 0,
            overflow: 'auto',
            borderLeft: `1px solid ${themeVars.boundary.default}`,
          }}
        >
          <div
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 1,
              padding: '6px 8px',
              color: themeVars.content.muted,
              background: themeVars.surface.panel,
              borderBottom: `1px solid ${themeVars.boundary.default}`,
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Watches
          </div>
          {pins.map((pin) => {
            const resolved = valueAt(snapshot.state, pin);
            return (
              <div
                key={pinKey(pin)}
                style={{
                  ...MONO,
                  display: 'grid',
                  gridTemplateColumns: 'minmax(130px, 1fr) minmax(100px, 0.7fr) auto',
                  alignItems: 'center',
                  gap: 8,
                  minHeight: 24,
                  padding: '2px 8px',
                  borderBottom: `1px solid ${themeVars.boundary.default}`,
                }}
              >
                <span
                  title={pathLabel(pin)}
                  style={{
                    color: themeVars.content.primary,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {pathLabel(pin)}
                </span>
                <span
                  style={{
                    color: resolved.available ? themeVars.content.muted : themeVars.content.dim,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {resolved.available ? formatValue(resolved.value) : 'unavailable'}
                </span>
                <Button type="button" size="compact" onClick={() => togglePin(pin)}>
                  Remove
                </Button>
              </div>
            );
          })}
          {pins.length === 0 && (
            <div style={{ padding: 10, color: themeVars.content.dim, fontSize: 11 }}>
              Pin values from the live tree to keep them visible while you inspect the game.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
