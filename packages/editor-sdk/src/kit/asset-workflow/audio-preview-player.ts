/**
 * One hover-preview voice for the asset browser. OWNER — this module.
 * SHARERS — AudioAssetThumb / AssetBrowser cards. THE ONE TEARDOWN —
 * {@link stopAssetAudioPreview}. A second hover replaces the first.
 *
 * Playback is a BufferSource on THIS context, not HTMLAudio. Hover is not a
 * user gesture, so `audio.play()` is rejected and was swallowed. Decode
 * already ran for the waveform; we play that buffer after resume().
 */
import { AUDIO_WAVEFORM_BARS, peaksFromSamples } from './audio-waveform';

export interface AssetAudioPreviewState {
  readonly url: string | null;
  readonly progress: number;
  readonly playing: boolean;
}

const listeners = new Set<() => void>();
const bufferCache = new Map<string, Promise<AudioBuffer | null>>();
const peakCache = new Map<string, Promise<readonly number[]>>();

let decodeContext: AudioContext | null = null;
let source: AudioBufferSourceNode | null = null;
let startedAt = 0;
let duration = 0;
let raf = 0;
let generation = 0;
let unlockInstalled = false;
let state: AssetAudioPreviewState = { url: null, progress: 0, playing: false };

function emit(): void {
  for (const listener of listeners) listener();
}

function setState(next: AssetAudioPreviewState): void {
  if (
    state.url === next.url &&
    state.playing === next.playing &&
    Math.abs(state.progress - next.progress) < 0.002
  ) {
    return;
  }
  state = next;
  emit();
}

function audioContext(): AudioContext {
  decodeContext ??= new AudioContext();
  return decodeContext;
}

function installUnlock(): void {
  if (unlockInstalled || typeof window === 'undefined') return;
  unlockInstalled = true;
  const resume = () => {
    if (!decodeContext) return;
    const url = state.url;
    const token = generation;
    void decodeContext.resume().then(() => {
      if (url && token === generation && !source && decodeContext?.state === 'running') {
        void playWhenReady(url, token);
      }
    });
  };
  window.addEventListener('pointerdown', resume, { capture: true });
  window.addEventListener('keydown', resume, { capture: true });
}

function stopSource(): void {
  if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
  raf = 0;
  if (!source) return;
  const node = source;
  source = null;
  node.onended = null;
  try {
    node.stop();
  } catch {
    // already stopped
  }
  node.disconnect();
}

function tick(): void {
  raf = 0;
  if (!state.playing || !decodeContext || duration <= 0) return;
  const progress = Math.min(1, (decodeContext.currentTime - startedAt) / duration);
  setState({ url: state.url, progress, playing: progress < 1 });
  if (progress < 1 && typeof requestAnimationFrame === 'function') {
    raf = requestAnimationFrame(tick);
  }
}

function startSource(buffer: AudioBuffer, url: string, token: number): void {
  if (token !== generation) return;
  stopSource();
  const context = audioContext();
  const node = context.createBufferSource();
  const gain = context.createGain();
  gain.gain.value = 1;
  node.buffer = buffer;
  node.connect(gain);
  gain.connect(context.destination);
  node.onended = () => {
    if (token !== generation) return;
    setState({ url, progress: 1, playing: false });
  };
  node.start();
  source = node;
  startedAt = context.currentTime;
  duration = buffer.duration;
  setState({ url, progress: 0, playing: true });
  if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(tick);
}

async function loadBuffer(url: string): Promise<AudioBuffer | null> {
  const cached = bufferCache.get(url);
  if (cached) return cached;
  const pending = (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Audio preview could not read ${url}.`);
    const bytes = await response.arrayBuffer();
    return audioContext().decodeAudioData(bytes.slice(0));
  })().catch(() => null);
  bufferCache.set(url, pending);
  return pending;
}

async function playWhenReady(url: string, token: number): Promise<void> {
  installUnlock();
  const buffer = await loadBuffer(url);
  if (token !== generation) return;
  if (!buffer) {
    setState({ url, progress: 0, playing: false });
    return;
  }
  const context = audioContext();
  if (context.state === 'suspended') {
    await context.resume();
    if (token !== generation) return;
  }
  if (context.state !== 'running') return;
  startSource(buffer, url, token);
}

export function subscribeAssetAudioPreview(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAssetAudioPreview(): AssetAudioPreviewState {
  return state;
}

export function previewAssetAudio(url: string): void {
  const token = ++generation;
  stopSource();
  setState({ url, progress: 0, playing: true });
  void playWhenReady(url, token);
}

export function stopAssetAudioPreview(url?: string): void {
  if (url && state.url !== url) return;
  generation += 1;
  stopSource();
  setState({ url: null, progress: 0, playing: false });
}

export function loadAudioWaveformPeaks(
  url: string,
  bars: number = AUDIO_WAVEFORM_BARS,
): Promise<readonly number[]> {
  const key = `${url}#${bars}`;
  const cached = peakCache.get(key);
  if (cached) return cached;
  const pending = loadBuffer(url).then((buffer) =>
    buffer
      ? peaksFromSamples(buffer.getChannelData(0), bars)
      : Array.from({ length: bars }, () => 0),
  );
  peakCache.set(key, pending);
  return pending;
}

export function __resetAssetAudioPreviewForTest(): void {
  generation += 1;
  stopSource();
  decodeContext = null;
  bufferCache.clear();
  peakCache.clear();
  unlockInstalled = false;
  state = { url: null, progress: 0, playing: false };
}
