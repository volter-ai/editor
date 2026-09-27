import { Button, Checkbox, RangeInput, SectionHeader, themeVars } from '@volter/editor-sdk/widgets';
import { useEffect, useRef, useState } from 'react';

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: themeVars.content.dim,
  marginBottom: 2,
};

export function AudioViewer({ assetPath }: { assetPath: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [loop, setLoop] = useState(false);
  const [volume, setVolume] = useState(1);
  const fileName = assetPath.split('/').pop() ?? assetPath;
  const ext = assetPath.split('.').pop()?.toUpperCase() ?? '';

  // Pause when component unmounts (tab closed or switched)
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
    } else {
      el.play();
    }
    setPlaying(!playing);
  };

  const formatTime = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        style={{
          fontWeight: 600,
          fontSize: 12,
          color: themeVars.content.primary,
          wordBreak: 'break-all',
        }}
      >
        {fileName}
      </div>
      {/* Player */}
      <div
        // §2.31 P2 amendment: player controls read over a local frost layer.
        className="vgai-content-frost"
        style={{
          width: '100%',
          // §2.31: hairline-only player card — no fill over the surface.
          border: `1px solid ${themeVars.boundary.default}`,
          borderRadius: themeVars.shape.small,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 8,
          padding: 16,
        }}
      >
        {/* Audio icon */}
        <svg viewBox="0 0 24 24" width={48} height={48}>
          <rect x="3" y="3" width="18" height="18" rx="2" fill="var(--vgai-asset-icon-audio)" />
          <path
            d="M9 8l4-2v12l-4-2H7V10h2zm6 1v6m2-5v4"
            stroke="var(--vgai-text-1)"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
        {/* Progress */}
        {duration != null && (
          <div
            style={{
              width: '100%',
              fontSize: 10,
              color: themeVars.content.muted,
              textAlign: 'center',
            }}
          >
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
        )}
        {/* Scrub bar */}
        {duration != null && duration > 0 && (
          <div
            style={{
              width: '100%',
              height: 4,
              background: themeVars.surface.raised,
              borderRadius: themeVars.shape.small,
              cursor: 'pointer',
              position: 'relative',
            }}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const frac = (e.clientX - rect.left) / rect.width;
              if (audioRef.current) {
                audioRef.current.currentTime = frac * duration;
              }
            }}
          >
            <div
              style={{
                width: `${(currentTime / duration) * 100}%`,
                height: '100%',
                background: 'var(--vgai-asset-icon-audio)',
                borderRadius: themeVars.shape.small,
              }}
            />
          </div>
        )}
        <Button type="button" variant="secondary" size="comfortable" onClick={togglePlay}>
          {playing ? 'Pause' : 'Play'}
        </Button>
        <div
          role="img"
          aria-label="Audio waveform"
          style={{ width: '100%', height: 36, display: 'flex', alignItems: 'center', gap: 2 }}
        >
          {Array.from({ length: 48 }, (_, index) => (
            <i
              key={index}
              style={{
                flex: 1,
                height: `${20 + ((index * 37) % 75)}%`,
                background: 'var(--vgai-asset-icon-audio)',
                opacity: index / 48 <= currentTime / (duration || 1) ? 1 : 0.3,
              }}
            />
          ))}
        </div>
        <label style={{ fontSize: 11, color: themeVars.content.muted }}>
          <Checkbox checked={loop} onChange={(event) => setLoop(event.target.checked)} /> Loop
        </label>
        <label style={{ fontSize: 11, color: themeVars.content.muted }}>
          Volume{' '}
          <RangeInput
            aria-label="Audio volume"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(event) => {
              const value = Number(event.target.value);
              setVolume(value);
              if (audioRef.current) audioRef.current.volume = value;
            }}
          />
        </label>
      </div>
      <audio
        ref={audioRef}
        src={assetPath}
        loop={loop}
        onLoadedMetadata={() => {
          if (audioRef.current) setDuration(audioRef.current.duration);
        }}
        onTimeUpdate={() => {
          if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
        }}
        onEnded={() => setPlaying(false)}
      />
      <SectionHeader label="Info">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div>
            <div style={labelStyle}>Path</div>
            <div style={{ fontSize: 11, color: themeVars.content.primary, wordBreak: 'break-all' }}>
              {assetPath}
            </div>
          </div>
          {duration != null && (
            <div>
              <div style={labelStyle}>Duration</div>
              <div style={{ fontSize: 11, color: themeVars.content.primary }}>
                {formatTime(duration)}
              </div>
            </div>
          )}
          <div>
            <div style={labelStyle}>Format</div>
            <div style={{ fontSize: 11, color: themeVars.content.primary }}>{ext}</div>
          </div>
        </div>
      </SectionHeader>
    </div>
  );
}
