import { faVolumeHigh, faVolumeXmark } from '@fortawesome/free-solid-svg-icons';
import { userLocalSection, writeUserLocalSection } from '@volter/editor-sdk/kit/user-local-state';
import { AnchoredMenu, Button, EditorIcon, Inline, MenuItem } from '@volter/editor-sdk/widgets';
import type { PerformanceSnapshot } from '../../runtime/dev/performance-profiler';
import type { AudioAdapter, AudioMeterFrame } from '@volter/editor-project/adapter';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  activeAudioVersion,
  getAllActiveAudio,
  getInspectedAudio,
  subscribeActiveAudio,
} from '@volter/editor-sdk/kit/authoring/active-systems';
import { useEditorStore } from '@volter/editor-sdk/kit/editor-runtime';
import { useActivePerformanceSource } from '../use-active-performance-source';
import {
  activeChromeRegions,
  chromeRegionsKey,
  subscribeChromeRegions,
} from '@volter/editor-sdk/kit/workspace-regions';
import {
  AUDIO_METER_SEGMENTS,
  audioMeterSegmentCount,
  FRAME_BUDGET_60_FPS_MS,
  frameSparklinePoints,
  PERFORMANCE_SPARKLINE_SAMPLES,
  performanceTelemetryTone,
  sampleFrameInterval,
} from './header-telemetry-model';
import { profilerView } from './utility-view-state';

/** The editor's mute: the person's, in every project (their UI state). */
const MUTE_SECTION = 'muted';
const EMPTY_PERFORMANCE: PerformanceSnapshot = {
  enabled: false,
  recording: false,
  fps: 0,
  cpuMs: 0,
  p95Ms: 0,
  p99Ms: 0,
  frames: [],
  phases: [],
  systems: [],
  components: [],
  render: {
    gpuMs: null,
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    renderPasses: 0,
  },
};

function storedMutePreference(): boolean {
  return userLocalSection<unknown>(MUTE_SECTION) === true;
}

function persistMutePreference(muted: boolean): void {
  writeUserLocalSection(MUTE_SECTION, muted);
}

function audioDisplayLevel(adapter: AudioAdapter, frames: readonly AudioMeterFrame[]): number {
  const master = frames.find((frame) => frame.id === 'master')?.level;
  if (!adapter.isMuted() && master !== undefined) return master;
  // The first-party master tap is post-gain, so it truthfully flatlines while
  // muted. The bus taps are pre-master: their maximum is an ACTIVITY reading,
  // not a fabricated mixed output level, and lets grey bars say "signal is
  // present but silenced". External adapters that expose only master degrade
  // to that honest (possibly zero) value.
  const upstream = frames.filter((frame) => frame.id !== 'master').map((frame) => frame.level);
  return upstream.length > 0 ? Math.max(...upstream) : (master ?? 0);
}

/**
 * AUTHORING IS SILENT: the host's own policy, not each game's manners.
 *
 * In edit mode a mounted world's system adapters are live (the design session
 * publishes `game.systemAdapters`), so a game whose audio starts with its
 * scene sounds at the person EDITING it. The engine only mutes for pause
 * (`setRootGates`), which is a runtime concern; nothing muted a world for
 * being authored rather than played. So the effective mute for every active
 * adapter is `userMuted || !playing`, applied here, with the user's own
 * preference left untouched: the toggle keeps meaning "the user wants mute",
 * and while stopped it decides what happens once play starts.
 *
 * Only `'playing'` counts as audible so the two gates agree instead of
 * fighting: `'paused'` is already muted by the engine, which restores the
 * pre-pause value on resume — which is exactly this effective value, and the
 * play-state subscription re-applies it on that transition anyway.
 */
function AudioTelemetry() {
  const store = useEditorStore();
  useSyncExternalStore(store.subscribe, store.getShellSnapshot ?? store.getSnapshot);
  const playing = store.playState === 'playing';
  const [menuOpen, setMenuOpen] = useState(false);
  const [level, setLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [meterAvailable, setMeterAvailable] = useState(false);
  // The user's own wish, which the authoring gate above never clobbers — the
  // menu names THIS (what the next click changes), while the icon and the
  // state label report the effective, audible-or-not truth.
  const [userMuted, setUserMuted] = useState(storedMutePreference);
  const desiredMuteRef = useRef(storedMutePreference());
  const appliedRef = useRef(new WeakMap<object, boolean>());
  const buttonRef = useRef<HTMLButtonElement>(null);
  const audioVersion = useSyncExternalStore(
    subscribeActiveAudio,
    activeAudioVersion,
    activeAudioVersion,
  );
  const adapter = getInspectedAudio();

  useEffect(() => {
    void audioVersion;
    const desired = desiredMuteRef.current || !playing;
    for (const active of getAllActiveAudio()) {
      if (appliedRef.current.get(active) === desired) continue;
      active.setMuted(desired);
      appliedRef.current.set(active, desired);
    }
  }, [audioVersion, playing]);

  useEffect(() => {
    if (!adapter) {
      setLevel(0);
      setMuted(false);
      setMeterAvailable(false);
      return;
    }
    const handle = adapter.acquireMeters?.() ?? null;
    setMeterAvailable(handle !== null);
    const sample = () => {
      setMuted(adapter.isMuted());
      setLevel(handle ? audioDisplayLevel(adapter, handle.read()) : 0);
    };
    sample();
    const id = setInterval(sample, 100);
    return () => {
      clearInterval(id);
      handle?.dispose();
    };
  }, [adapter]);

  // The button toggles the USER's preference, never the effective state:
  // reading it back off the adapters would make "unmute" while stopped (where
  // everything is muted by the authoring gate) unmute the world at the person
  // editing it, and would lose the preference the next time play starts.
  const toggleMute = () => {
    const nextPreference = !desiredMuteRef.current;
    const effective = nextPreference || !playing;
    for (const item of getAllActiveAudio()) {
      item.resume?.();
      item.setMuted(effective);
      appliedRef.current.set(item, effective);
    }
    desiredMuteRef.current = nextPreference;
    setUserMuted(nextPreference);
    persistMutePreference(nextPreference);
    setMuted(effective);
  };

  const filled = audioMeterSegmentCount(level);
  // Muted-because-not-playing is the one state a person cannot explain from
  // the icon alone; it rides in the existing tooltip rather than new chrome.
  const muteReason = adapter && muted && !userMuted && !playing ? ' (not playing)' : '';
  const stateLabel = !adapter
    ? 'Audio unavailable'
    : muted
      ? 'Audio muted'
      : level > 0
        ? 'Audio playing'
        : 'Audio quiet';

  return (
    <div className="vgai-header-audio" data-muted={muted || undefined} data-available={!!adapter}>
      <Button
        ref={buttonRef}
        type="button"
        variant="ghost"
        size="compact"
        className="vgai-header-telemetry-button"
        data-testid="header-audio-telemetry"
        aria-label={`${stateLabel}; open audio controls`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={`${stateLabel}${muteReason}${meterAvailable ? '' : ' · level metering unavailable'}`}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <EditorIcon icon={muted ? faVolumeXmark : faVolumeHigh} size="sm" />
        <span className="vgai-audio-vu" aria-hidden="true">
          {Array.from({ length: AUDIO_METER_SEGMENTS }, (_, index) => (
            <i key={index} data-filled={index < filled || undefined} />
          ))}
        </span>
      </Button>
      {menuOpen && (
        <AnchoredMenu anchorRef={buttonRef} onDismiss={() => setMenuOpen(false)} gap={3}>
          <MenuItem
            onClick={() => {
              toggleMute();
              setMenuOpen(false);
            }}
          >
            {userMuted ? 'Unmute audio' : 'Mute audio'}
          </MenuItem>
        </AnchoredMenu>
      )}
    </div>
  );
}

function PerformanceTelemetry() {
  const source = useActivePerformanceSource();
  const profiler = source?.profiler ?? null;
  const [snapshot, setSnapshot] = useState<PerformanceSnapshot>(EMPTY_PERFORMANCE);
  const [frameHistory, setFrameHistory] = useState<number[]>([]);

  useEffect(() => {
    if (!profiler) {
      setSnapshot(EMPTY_PERFORMANCE);
      setFrameHistory([]);
      return;
    }
    const telemetryWasEnabled = profiler.telemetryEnabled;
    profiler.telemetryEnabled = true;
    const initial = profiler.getSnapshot();
    const initialSample = sampleFrameInterval(initial.frames, 0);
    let sampledThroughFrameId = initialSample.frameId;
    setSnapshot(initial);
    setFrameHistory(initialSample.intervalMs === null ? [] : [initialSample.intervalMs]);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const publish = () => {
      timer = null;
      const next = profiler.getSnapshot();
      const sample = sampleFrameInterval(next.frames, sampledThroughFrameId);
      sampledThroughFrameId = sample.frameId;
      setSnapshot(next);
      const interval = sample.intervalMs;
      if (interval !== null) {
        setFrameHistory((history) => [...history, interval].slice(-PERFORMANCE_SPARKLINE_SAMPLES));
      }
    };
    const unsubscribe = profiler.subscribe(() => {
      if (timer === null) timer = setTimeout(publish, 500);
    });
    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
      if (!telemetryWasEnabled) profiler.telemetryEnabled = false;
    };
  }, [profiler]);

  const latestFrameMs = frameHistory.at(-1) ?? null;
  const points = frameSparklinePoints(frameHistory, 72, 18);
  const fps = latestFrameMs
    ? Math.round(1000 / latestFrameMs)
    : snapshot.fps > 0
      ? Math.round(snapshot.fps)
      : null;
  const frameMs = latestFrameMs ?? (snapshot.fps > 0 ? 1000 / snapshot.fps : null);
  const tone = performanceTelemetryTone(frameHistory);
  const title = source
    ? `${source.label}: ${fps ?? '—'} FPS · ${frameMs?.toFixed(1) ?? '—'} ms frame time · open Profiler`
    : 'The active document has no live render loop to profile';

  return (
    <Button
      type="button"
      variant="ghost"
      size="compact"
      className="vgai-header-telemetry-button vgai-header-performance"
      data-testid="header-performance-telemetry"
      data-performance-tone={tone}
      disabled={!source}
      aria-label={title}
      title={title}
      onClick={() => profilerView.open('profiler')}
    >
      <svg
        className="vgai-performance-graph"
        aria-hidden="true"
        viewBox="0 0 72 18"
        width="72"
        height="18"
      >
        <line
          className="vgai-performance-budget"
          x1="0"
          x2="72"
          y1={18 - (FRAME_BUDGET_60_FPS_MS / 50) * 18}
          y2={18 - (FRAME_BUDGET_60_FPS_MS / 50) * 18}
        />
        {points && <polyline className="vgai-performance-sparkline" points={points} />}
      </svg>
      <span className="vgai-performance-readout">
        <strong className="vgai-header-fps">{fps ?? '—'} FPS</strong>
        <span className="vgai-header-frame-ms">{frameMs?.toFixed(1) ?? '—'} ms</span>
      </span>
    </Button>
  );
}

/**
 * Persistent, glanceable runtime telemetry. The audio VU is an instantaneous
 * segmented magnitude; performance is a historical line, so the two readings
 * remain distinguishable without color.
 *
 * IT IS A CHROME REGION (`telemetry`, `workspace-regions.ts`), the way the
 * workspace tab strip is: measured against Blender's Modeling frame, this
 * cluster is the brightest, highest-chroma ink in a window whose brightest
 * chrome ink is 216 — a yellow readout, an orange sparkline and a lit meter
 * where Blender's corner carries two quiet wells (Scene, ViewLayer) — and it
 * is the first thing the eye lands on. A style that wants that corner quiet
 * declares `telemetry: 'hidden'`; absent means shown, so every existing skin
 * is unchanged. Only these three readings are behind the region: Invite and
 * Account are product identity, not look, and they are already quiet. The
 * Profiler utility remains the door to the same numbers, which is what the
 * readout's own tooltip says.
 */
export function HeaderTelemetry() {
  useSyncExternalStore(subscribeChromeRegions, chromeRegionsKey, chromeRegionsKey);
  if (activeChromeRegions().telemetry === 'hidden') return null;
  return (
    <Inline
      className="vgai-header-telemetry vgai-chrome-island vgai-glass-island"
      data-island-scale="compact"
      align="center"
      gap={1}
    >
      <AudioTelemetry />
      <PerformanceTelemetry />
    </Inline>
  );
}
