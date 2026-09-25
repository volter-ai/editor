import {
  getInspectedNetworking,
  inspectedInstanceId,
  inspectedInstanceVersion,
  setInspectedInstance,
  subscribeInspectedInstance,
} from '@volter/editor-sdk/kit/authoring/active-systems';
import { useEditorStore } from '@volter/editor-core/editor-runtime';
import { gameRealmDiagnostics } from '../host/gated-globals';
import { faEye } from '@fortawesome/free-solid-svg-icons';
import {
  AnchoredMenu,
  Button,
  DisclosureIcon,
  EditorIcon,
  MenuItem,
  MenuSeparator,
  Text,
  themeVars,
} from '@volter/editor-sdk/widgets';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  focusedInstanceId,
  instanceEntries,
  subscribeFocusedInstance,
  subscribeGameSession,
} from '../play/play-mode';

function instancesSnapshot(): string {
  return instanceEntries()
    .map(({ id, name }) => `${id}\u0000${name}`)
    .join('\u0001');
}

function Diagnostics({ instanceId }: { instanceId: string }) {
  const store = useEditorStore();
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const focused = useSyncExternalStore(
    subscribeFocusedInstance,
    focusedInstanceId,
    focusedInstanceId,
  );
  const [, refresh] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => refresh((value) => value + 1), 250);
    return () => window.clearInterval(timer);
  }, []);

  const realm = gameRealmDiagnostics(instanceId);
  const networking = getInspectedNetworking();
  const timers = realm
    ? (realm.loop.activeTimeouts ?? 0) +
      (realm.loop.activeIntervals ?? 0) +
      (realm.loop.activeAnimationFrames ?? 0) +
      realm.loop.pending
    : 0;
  const listeners = realm ? realm.listeners.window + realm.listeners.document : 0;
  const rows: [string, string][] = [
    ['Mount', instanceId],
    ['Simulation', store.playState === 'paused' ? 'Paused' : 'Running'],
    ['Input', focused === instanceId ? 'Keyboard focus' : 'Inactive'],
    [
      'Input events',
      realm
        ? `${realm.loop.input ?? 0} observed · ${realm.loop.inputBlocked ?? 0} blocked`
        : 'Not measured',
    ],
    // Two different nothings: no adapter at all, and an adapter that cannot
    // read connection state. Neither is "disconnected".
    [
      'Network',
      !networking
        ? 'Not registered'
        : (networking.getConnectionState?.() ?? 'Not reported by this adapter'),
    ],
    ['Owned callbacks', String(timers)],
    ['Owned listeners', String(listeners)],
    ['Realm globals', String(realm?.globals ?? 0)],
    // Same-origin browser storage is intentionally disclosed rather than
    // presented as isolated. A durable virtual profile would require a stable
    // project-owned identity beyond the transient mount id.
    [
      'Browser storage',
      realm
        ? `Shared origin · ${realm.storage.local.reads + realm.storage.session.reads} reads · ${realm.storage.local.writes + realm.storage.session.writes} writes`
        : 'Shared origin',
    ],
  ];

  return (
    <div
      role="none"
      style={{
        display: 'grid',
        gridTemplateColumns: '112px minmax(120px, 1fr)',
        gap: '4px 12px',
        padding: '8px 10px',
        fontSize: 10,
        lineHeight: '15px',
      }}
    >
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: 'contents' }}>
          <span style={{ color: themeVars.content.dim }}>{label}</span>
          <span
            style={{
              color: themeVars.content.primary,
              fontFamily: label === 'Mount' ? themeVars.typography.mono : undefined,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Runtime context selector for a split Game document. This changes only
 * editor instruments; it never retargets scene authoring or agent commands. */
export function InstanceInspectorPicker() {
  useSyncExternalStore(subscribeGameSession, instancesSnapshot, instancesSnapshot);
  useSyncExternalStore(
    subscribeInspectedInstance,
    inspectedInstanceVersion,
    inspectedInstanceVersion,
  );
  const entries = instanceEntries();
  const inspectedId = inspectedInstanceId();
  const selected = entries.find((entry) => entry.id === inspectedId) ?? entries[0];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  if (entries.length < 2 || !selected) return null;
  const diagnostics = gameRealmDiagnostics(selected.id);
  const warning = (diagnostics?.loop.firedWhileHeld ?? 0) > 0;

  return (
    <div className="vgai-playbar-popover-anchor">
      <Button
        ref={ref}
        variant="ghost"
        size="compact"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title={`Runtime instruments inspect ${selected.name}; agent-addressed commands are unchanged`}
      >
        <EditorIcon
          icon={faEye}
          size="sm"
          style={{ color: warning ? themeVars.semantic.warning : undefined }}
        />
        <Text variant="code">Inspect {selected.name}</Text>
        <DisclosureIcon direction="down" />
      </Button>
      {open && (
        <AnchoredMenu
          anchorRef={ref}
          gap={3}
          onDismiss={() => setOpen(false)}
          style={{ minWidth: 270 }}
        >
          {entries.map((entry) => (
            <MenuItem
              key={entry.id}
              role="menuitemradio"
              aria-checked={entry.id === selected.id}
              onSelect={() => setInspectedInstance(entry.id)}
            >
              {entry.id === selected.id ? '✓ ' : '  '}
              {entry.name}
            </MenuItem>
          ))}
          <MenuSeparator />
          <Diagnostics instanceId={selected.id} />
        </AnchoredMenu>
      )}
    </div>
  );
}
