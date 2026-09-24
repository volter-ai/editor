import { type ProfilerViewId, profilerView } from '../host/components/utility-view-state';
import { EditorTab, EditorTabList } from '@volter/editor-sdk/widgets';
import { useSyncExternalStore } from 'react';
import { FrameDebuggerPanel } from './FrameDebuggerPanel';
import { PerformancePanel } from './PerformancePanel';

/**
 * The engine's instrument bench: frame cost over time (Profiler) and the
 * single-frame draw-call capture (Frame). Both read the host's own render
 * path, which is why they share one utility — the game's debug plane
 * (providers/commands) is a different audience and lives in its own.
 */

const TABS: ReadonlyArray<{ id: ProfilerViewId; label: string }> = [
  { id: 'profiler', label: 'Profiler' },
  { id: 'frame', label: 'Frame' },
];

export function ProfilerPanel() {
  useSyncExternalStore(profilerView.subscribe, profilerView.version, profilerView.version);
  const active = profilerView.active();
  return (
    <div
      data-testid="profiler-panel"
      style={{
        // §2.31: no root fill — the dock surface shows through.
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <EditorTabList aria-label="Profiler views">
        {TABS.map((tab) => (
          <EditorTab
            key={tab.id}
            selected={active === tab.id}
            data-testid={`profiler-tab-${tab.id}`}
            onClick={() => profilerView.select(tab.id)}
          >
            {tab.label}
          </EditorTab>
        ))}
      </EditorTabList>
      <div role="tabpanel" style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {active === 'profiler' && <PerformancePanel />}
        {/* W4b: the Frame debugger (single-frame draw-call capture over the
            RenderDebugAdapter) renders its own honest no-adapter notice. */}
        {active === 'frame' && <FrameDebuggerPanel />}
      </div>
    </div>
  );
}
