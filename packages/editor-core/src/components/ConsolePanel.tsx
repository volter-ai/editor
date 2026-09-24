import {
  faCircleInfo,
  faCube,
  faExclamationTriangle,
  faTimesCircle,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
import {
  Button,
  EditorIcon,
  EditorSurface,
  EditorToolbar,
  IconButton,
  Select,
  TextInput,
  ToolbarDivider,
  themeVars,
} from '@volter/editor-sdk/widgets';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getActiveAuthoring } from '../authoring/active-adapter';
import { setAuthoringSelection } from '../authoring/consumer-actions';
import { type ConsoleLevel, editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { useEditorStore } from '../editor-runtime';

const LEVEL_COLORS: Record<ConsoleLevel, string> = {
  info: themeVars.content.primary,
  warn: themeVars.semantic.warning,
  error: themeVars.semantic.danger,
};

const SUBSYSTEM_COLORS: Record<string, string> = {
  scene: '#78dce8',
  physics: '#ff6188',
  animation: '#a9dc76',
  network: '#fc9867',
  audio: '#ab9df2',
  ai: '#ffd866',
  input: '#78dce8',
  core: themeVars.content.primary,
};

const LEVEL_ICONS = {
  info: faCircleInfo,
  warn: faExclamationTriangle,
  error: faTimesCircle,
};

export function ConsolePanel() {
  const store = useEditorStore();
  useSyncExternalStore(editorConsole.subscribe, editorConsole.getSnapshot);

  const [filter, setFilter] = useState('');
  const [instanceFilter, setInstanceFilter] = useState('all');
  const [showLevels, setShowLevels] = useState<Record<ConsoleLevel, boolean>>({
    info: true,
    warn: true,
    error: true,
  });
  const listRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const entries = editorConsole.getEntries();
  const instances = new Map<string, string>();
  for (const entry of entries) {
    const id = entry.metadata?.['instanceId'];
    if (typeof id !== 'string' || id.length === 0) continue;
    const name = entry.metadata?.['instanceName'];
    instances.set(id, typeof name === 'string' && name.length > 0 ? name : `Instance ${id}`);
  }
  const filtered = entries.filter((e) => {
    if (!showLevels[e.level]) return false;
    if (instanceFilter !== 'all' && e.metadata?.['instanceId'] !== instanceFilter) return false;
    if (filter && !e.message.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [entries.length, autoScroll]);

  const handleScroll = () => {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    // Pin auto-scroll if within 20px of bottom
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 20);
  };

  const toggleLevel = (level: ConsoleLevel) => {
    setShowLevels((prev) => ({ ...prev, [level]: !prev[level] }));
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
  };

  const selectAndFocusEntity = (entityId: string) => {
    setAuthoringSelection(getActiveAuthoring(store), [entityId]);
    store.focusOnEntity(entityId);
  };

  const counts = editorConsole.counts;

  return (
    <EditorSurface className="vgai-console">
      {/* Toolbar */}
      <EditorToolbar label="Console filters" compact>
        {/* Clear button */}
        <IconButton
          aria-label="Clear console"
          size="compact"
          onClick={() => editorConsole.clear()}
          title="Clear console"
        >
          <EditorIcon icon={faTrash} size="xs" />
        </IconButton>

        <ToolbarDivider />

        <Select
          aria-label="Filter console by game instance"
          title="Show messages from all game instances or one inspected instance"
          value={instanceFilter}
          onChange={(event) => setInstanceFilter(event.target.value)}
          style={{ width: 'auto', minWidth: 74, height: 24, fontSize: 11 }}
        >
          <option value="all">All instances</option>
          {[...instances].map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>

        <ToolbarDivider />

        {/* Level filter toggles */}
        {(['info', 'warn', 'error'] as const).map((level) => (
          <Button
            key={level}
            variant="ghost"
            size="compact"
            aria-label={`Toggle ${level} messages`}
            aria-pressed={showLevels[level]}
            data-console-level={level}
            onClick={() => toggleLevel(level)}
          >
            <EditorIcon icon={LEVEL_ICONS[level]} size="xs" />
            {counts[level]}
          </Button>
        ))}

        {/* Search filter */}
        {/* B-4: the one dock text-input style (`.vgai-input` — real hover/focus
            states from the U0 sheet) instead of this file's own variant. */}
        <TextInput
          placeholder="Filter..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="vgai-console-filter"
        />
      </EditorToolbar>

      {/* Message list */}
      <div ref={listRef} onScroll={handleScroll} className="vgai-console-list vgai-selectable-text">
        {filtered.length === 0 && <div className="vgai-console-empty">No messages</div>}
        {filtered.map((entry) => {
          const entityId =
            entry.metadata?.['entityId'] != null ? String(entry.metadata['entityId']) : null;
          // The live Object3D's own name is the entity's name.
          const entityName = (entityId ? store.objectMap.get(entityId)?.name : null) || entityId;
          const instanceId =
            typeof entry.metadata?.['instanceId'] === 'string'
              ? entry.metadata['instanceId']
              : null;
          const instanceName =
            typeof entry.metadata?.['instanceName'] === 'string'
              ? entry.metadata['instanceName']
              : instanceId
                ? `Instance ${instanceId}`
                : null;

          // dangerFaint (NOT dangerMuted): resting row tint stays deliberately
          // low-emphasis so stacked error rows read as a list, not a red wall.
          return (
            <div
              key={entry.id}
              className="vgai-console-row"
              data-level={entry.level}
              style={{ color: LEVEL_COLORS[entry.level] }}
            >
              <span style={{ color: themeVars.content.dim, marginRight: 6, flexShrink: 0 }}>
                {formatTime(entry.timestamp)}
              </span>
              <EditorIcon
                icon={LEVEL_ICONS[entry.level]}
                style={{ fontSize: 9, marginTop: 4, marginRight: 6, flexShrink: 0 }}
              />
              {instanceName && (
                <span
                  title={instanceId ? `Runtime instance ${instanceId}` : undefined}
                  style={{
                    background: themeVars.accent.muted,
                    color: themeVars.accent.default,
                    borderRadius: themeVars.shape.small,
                    padding: '0 4px',
                    fontSize: 10,
                    marginRight: 6,
                    flexShrink: 0,
                  }}
                >
                  {instanceName}
                </span>
              )}
              {entry.subsystem && (
                <span
                  style={{
                    background: `${SUBSYSTEM_COLORS[entry.subsystem] ?? themeVars.content.muted}22`,
                    color: SUBSYSTEM_COLORS[entry.subsystem] ?? themeVars.content.muted,
                    borderRadius: themeVars.shape.small,
                    padding: '0 4px',
                    fontSize: 10,
                    marginRight: 6,
                    flexShrink: 0,
                  }}
                >
                  {entry.subsystem}
                </span>
              )}
              <span style={{ flex: 1, wordBreak: 'break-word' }}>
                {entry.message}
                {entityId && (
                  <span
                    onClick={() => selectAndFocusEntity(entityId)}
                    style={{
                      background: themeVars.semantic.successMuted,
                      color: themeVars.semantic.success,
                      borderRadius: themeVars.shape.small,
                      padding: '0 5px',
                      fontSize: 10,
                      marginLeft: 6,
                      cursor: 'pointer',
                      pointerEvents: 'auto',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 3,
                    }}
                    title={`Select and focus "${entityName}"`}
                  >
                    <EditorIcon icon={faCube} style={{ fontSize: 8 }} />
                    {entityName}
                  </span>
                )}
                {entry.source && (
                  <span style={{ color: themeVars.content.dim, marginLeft: 6 }}>
                    [{entry.source}]
                  </span>
                )}
              </span>
              {entry.count > 1 && <span className="vgai-console-count">{entry.count}</span>}
            </div>
          );
        })}
      </div>
    </EditorSurface>
  );
}
