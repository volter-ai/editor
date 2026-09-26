/**
 * The game's MUSIC, played from a piece's render (`render-piece`'s output folder): the looped
 * mix, a section loop per `<Marker>` (`--sections`), the stems, and one-shot stingers
 * (`--one-shot`), all through the game's own Web Audio graph.
 *
 *   horizontal   `queue('Battle')` switches loops on the next bar line of what is playing
 *                (`barSeconds` in the report), or at its loop end; the old loop fades out
 *   vertical     `play(null, { stems: true })` plays the stems in sync, each on its own gain,
 *                and `layer('Horn', -60)` brings a part in or out without a seam
 *   stingers     `stinger(buffer, 'bar')` lays a one-shot over the loop on the next bar line
 *
 * Every file a render writes is a sample-exact loop (or a one-shot), so a source's native
 * `loop` is the whole mechanism; this module only does the arithmetic that is easy to get
 * wrong: where the next bar line falls on the AudioContext clock, and starting several sources
 * on one sample. It returns the Web Audio nodes it makes; nothing here holds the game's state.
 *
 * RESOURCE OWNERSHIP: the player owns its output `GainNode` and the sources and gains it starts;
 * `dispose()` stops and disconnects them. The `context` and `destination` are the caller's.
 */

/** The fields of a render's `report.json` this player reads. */
export interface MusicRender {
  /** The looped mix, relative to the render folder; `fileM4a` is the same loop as AAC. */
  readonly file: string;
  readonly fileM4a?: string;
  /** The second of every bar line of the piece, 0 to its end inclusive. */
  readonly barSeconds: readonly number[];
  /** A section per marker: `start` is its second in the whole piece, where its loop begins. */
  readonly sections?: readonly { readonly name: string; readonly start: number; readonly seconds: number; readonly file: string; readonly fileM4a?: string }[];
  readonly stems?: { readonly files?: readonly { readonly track: string; readonly file: string; readonly fileM4a?: string }[] };
}

/**
 * Fetch and decode every file a render lists, keyed by its (Ogg) path in the report. A browser
 * that cannot decode Vorbis (Safari on iOS before 17.4) gets the same loop from its `.m4a`.
 */
export async function loadMusic(context: BaseAudioContext, baseUrl: string, render: MusicRender): Promise<Map<string, AudioBuffer>> {
  const entries = [render, ...(render.sections ?? []), ...(render.stems?.files ?? [])];
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const decode = async (file: string): Promise<AudioBuffer> => {
    const response = await fetch(new URL(file, base));
    if (!response.ok) throw new Error(`${file}: ${response.status} ${response.statusText}`);
    return context.decodeAudioData(await response.arrayBuffer());
  };
  const buffers = new Map<string, AudioBuffer>();
  await Promise.all(
    entries.map(async ({ file, fileM4a }) => {
      buffers.set(file, await decode(file).catch((error: unknown) => (fileM4a ? decode(fileM4a) : Promise.reject(error))));
    }),
  );
  return buffers;
}

interface Playing {
  readonly name: string | null;
  readonly gain: GainNode;
  readonly sources: ReadonlyMap<string, { readonly source: AudioBufferSourceNode; readonly gain: GainNode }>;
  /** Context time of the loop's position 0. */
  readonly origin: number;
  readonly seconds: number;
  /** Bar lines within the loop, from 0; the loop's end is the last. */
  readonly bars: readonly number[];
}

export interface MusicPlayer {
  /** The player's output; connect it where the game's music bus is. */
  readonly output: GainNode;
  /** Start a section's loop (by marker name), or the whole piece's with `null`, at `when` (now). */
  play(section: string | null, options?: { stems?: boolean; when?: number }): void;
  /** Switch to another loop at the next bar line, or at the playing loop's end. Returns the context time it switches. */
  queue(section: string | null, options?: { at?: 'bar' | 'end'; fade?: number; stems?: boolean }): number;
  /** A stem's level in dB (the whole-piece loop played with `stems`), ramped over `seconds`. */
  layer(track: string, db: number, seconds?: number): void;
  /** A one-shot over the music, now or on the next bar line. Returns the context time it starts. */
  stinger(buffer: AudioBuffer, at?: 'now' | 'bar'): number;
  /** The context time of the playing loop's next bar line (or of `after`'s). */
  nextBar(after?: number): number;
  stop(fade?: number): void;
  dispose(): void;
}

/** Scheduling lead: an event is never placed closer than this to the context's clock. */
const LEAD = 0.05;

export function createMusicPlayer(options: {
  readonly context: BaseAudioContext;
  readonly destination: AudioNode;
  readonly render: MusicRender;
  readonly buffers: ReadonlyMap<string, AudioBuffer>;
}): MusicPlayer {
  const { context, render, buffers } = options;
  const output = context.createGain();
  output.connect(options.destination);
  let playing: Playing | null = null;
  /** The loop still sounding while `playing` waits for its switch point (its `origin`). */
  let leaving: Playing | null = null;
  const stingers = new Set<AudioBufferSourceNode>();
  const levels = new Map<string, number>();

  const buffer = (file: string): AudioBuffer => {
    const found = buffers.get(file);
    if (!found) throw new Error(`${file} is not loaded (loadMusic reads every file the render lists).`);
    return found;
  };

  const start = (name: string | null, stems: boolean, when: number): Playing => {
    const section = name === null ? null : render.sections?.find((candidate) => candidate.name === name);
    if (name !== null && !section) throw new Error(`No section "${name}" in this render (render it with --sections).`);
    if (stems && section) throw new Error('Stems are rendered for the whole piece, not per section.');
    const files = stems ? (render.stems?.files ?? []).map((stem) => [stem.track, stem.file] as const) : [[name ?? 'mix', section?.file ?? render.file] as const];
    if (files.length === 0) throw new Error('This render has no stems.');
    // The loop is the decoded buffer's own length (the context may resample the file); its bar
    // lines are the piece's that fall inside it, from its start. A marker off a downbeat starts a
    // loop mid-bar, and its bar lines are still the piece's.
    const seconds = buffer(files[0]![1]).duration;
    const from = section?.start ?? 0;
    const bars = [
      ...render.barSeconds.map((second) => second - from).filter((second) => second >= -1e-6 && second < seconds - 1e-3),
      seconds,
    ];
    const gain = context.createGain();
    gain.connect(output);
    const sources = new Map<string, { source: AudioBufferSourceNode; gain: GainNode }>();
    for (const [key, file] of files) {
      const source = context.createBufferSource();
      source.buffer = buffer(file);
      source.loop = true;
      const own = context.createGain();
      own.gain.value = 10 ** ((levels.get(key) ?? 0) / 20);
      source.connect(own).connect(gain);
      source.start(when);
      sources.set(key, { source, gain: own });
    }
    return { name, gain, sources, origin: when, seconds, bars };
  };

  const fadeOut = (voice: Playing, at: number, fade: number): void => {
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, at);
    voice.gain.gain.linearRampToValueAtTime(0, at + fade);
    const sources = [...voice.sources.values()];
    for (const { source } of sources) source.stop(at + fade + 0.01);
    // The voice's nodes leave the graph once its sources have stopped.
    const last = sources[0]?.source;
    if (last) last.onended = () => {
      for (const { source, gain } of sources) {
        source.disconnect();
        gain.disconnect();
      }
      voice.gain.disconnect();
    };
  };

  const barOf = (voice: Playing, after: number): number => {
    const position = (((after - voice.origin) % voice.seconds) + voice.seconds) % voice.seconds;
    const line = voice.bars.find((bar) => bar >= position - 1e-6) ?? voice.seconds;
    return after - position + line;
  };
  const nextBar = (after = context.currentTime + LEAD): number => {
    if (!playing) return after;
    // Before a queued switch lands, the bar lines are the sounding loop's, up to the switch.
    if (after < playing.origin) return leaving ? Math.min(barOf(leaving, after), playing.origin) : playing.origin;
    return barOf(playing, after);
  };

  return {
    output,
    play(section, opts = {}) {
      for (const voice of [playing, leaving]) if (voice) fadeOut(voice, context.currentTime, 0.02);
      leaving = null;
      playing = start(section, opts.stems === true, opts.when ?? context.currentTime + LEAD);
    },
    queue(section, opts = {}) {
      const now = context.currentTime + LEAD;
      if (!playing) {
        playing = start(section, opts.stems === true, now);
        return now;
      }
      if (playing.origin > now) {
        // A switch is already waiting (queued twice before the first one lands): the new loop
        // takes the waiting one's place, at the same moment, and the waiting one never sounds.
        const at = playing.origin;
        for (const { source, gain } of playing.sources.values()) {
          source.stop();
          source.disconnect();
          gain.disconnect();
        }
        playing.gain.disconnect();
        playing = start(section, opts.stems === true, at);
        return at;
      }
      const at = opts.at === 'end' ? playing.origin + Math.ceil((now - playing.origin) / playing.seconds) * playing.seconds : nextBar(now);
      fadeOut(playing, at, opts.fade ?? 0.25);
      leaving = playing;
      playing = start(section, opts.stems === true, at);
      return at;
    },
    layer(track, db, seconds = 0.5) {
      levels.set(track, db);
      const entry = playing?.sources.get(track);
      if (!entry) return;
      const now = context.currentTime;
      entry.gain.gain.cancelScheduledValues(now);
      entry.gain.gain.setValueAtTime(entry.gain.gain.value, now);
      entry.gain.gain.linearRampToValueAtTime(10 ** (db / 20), now + seconds);
    },
    stinger(one, at = 'now') {
      const when = at === 'bar' ? nextBar() : context.currentTime + LEAD;
      const source = context.createBufferSource();
      source.buffer = one;
      source.connect(output);
      source.onended = () => {
        stingers.delete(source);
        source.disconnect();
      };
      stingers.add(source);
      source.start(when);
      return when;
    },
    nextBar,
    stop(fade = 0.5) {
      if (playing) fadeOut(playing, context.currentTime, fade);
      if (leaving) fadeOut(leaving, context.currentTime, fade);
      playing = leaving = null;
    },
    dispose() {
      for (const voice of [playing, leaving]) if (voice) for (const { source } of voice.sources.values()) source.stop();
      leaving = null;
      for (const source of stingers) source.stop();
      stingers.clear();
      playing = null;
      output.disconnect();
    },
  };
}
