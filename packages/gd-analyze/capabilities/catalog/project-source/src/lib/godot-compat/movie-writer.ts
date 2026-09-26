/** MovieWriter protocol and process-wide writer selection registry. */

import { registerGodotObjectIdentity } from './object';
import { packedStringArray, type PackedStringArray } from './packed-array';

export interface GodotMovieWriterHooks {
  readonly audioMixRate?: () => number;
  readonly audioSpeakerMode?: () => number;
  readonly handlesFile?: (path: string) => boolean;
  readonly supportedExtensions?: () => readonly string[];
  readonly writeBegin?: (size: { x: number; y: number }, fps: number, basePath: string) => number;
  readonly writeFrame?: (frameImage: unknown, audioFrameBlock: unknown) => number;
  readonly writeEnd?: () => void;
}

function integer(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`MovieWriter.${member} requires integer.`);
  return value;
}

function stringValue(value: unknown, member: string): string {
  if (typeof value !== 'string') throw new TypeError(`MovieWriter.${member} requires String.`);
  return value;
}

const WRITERS: GodotMovieWriter[] = [];

export class GodotMovieWriter {
  private writing = false;

  constructor(private readonly hooks: GodotMovieWriterHooks = {}) {
    registerGodotObjectIdentity(this, 'MovieWriter');
  }

  static add_writer(writer: GodotMovieWriter): void {
    if (!(writer instanceof GodotMovieWriter)) throw new TypeError('MovieWriter.add_writer requires MovieWriter.');
    if (!WRITERS.includes(writer)) WRITERS.push(writer);
  }

  _get_audio_mix_rate(): number { return integer(this.hooks.audioMixRate?.() ?? 48_000, '_get_audio_mix_rate'); }
  _get_audio_speaker_mode(): number { return integer(this.hooks.audioSpeakerMode?.() ?? 0, '_get_audio_speaker_mode'); }
  _handles_file(path: string): boolean {
    const normalized = stringValue(path, '_handles_file');
    if (this.hooks.handlesFile !== undefined) return this.hooks.handlesFile(normalized);
    const extension = normalized.split('.').pop()?.toLowerCase() ?? '';
    return this._get_supported_extensions().includes(extension);
  }
  _get_supported_extensions(): PackedStringArray {
    return packedStringArray((this.hooks.supportedExtensions?.() ?? []).map((value) => String(value).replace(/^\./, '').toLowerCase()));
  }
  _write_begin(movieSize: { x: number; y: number }, fpsValue: unknown, basePath: unknown): number {
    const fps = integer(fpsValue, '_write_begin fps');
    if (fps <= 0 || !Number.isSafeInteger(movieSize.x) || !Number.isSafeInteger(movieSize.y) || movieSize.x <= 0 || movieSize.y <= 0) return 31;
    const error = integer(this.hooks.writeBegin?.({ x: movieSize.x, y: movieSize.y }, fps, stringValue(basePath, '_write_begin base_path')) ?? 0, '_write_begin result');
    this.writing = error === 0;
    return error;
  }
  _write_frame(frameImage: unknown, audioFrameBlock: unknown): number {
    if (!this.writing) return 1;
    return integer(this.hooks.writeFrame?.(frameImage, audioFrameBlock) ?? 0, '_write_frame result');
  }
  _write_end(): void {
    if (!this.writing) return;
    this.writing = false;
    this.hooks.writeEnd?.();
  }
  is_writing(): boolean { return this.writing; }
}

export function createGodotMovieWriter(hooks: GodotMovieWriterHooks = {}): GodotMovieWriter {
  return new GodotMovieWriter(hooks);
}

export function godotMovieWriters(): readonly GodotMovieWriter[] { return [...WRITERS]; }
export function godotMovieWriterForPath(path: string): GodotMovieWriter | null {
  return WRITERS.find((writer) => writer._handles_file(path)) ?? null;
}
export function removeGodotMovieWriter(writer: GodotMovieWriter): void {
  const index = WRITERS.indexOf(writer);
  if (index >= 0) WRITERS.splice(index, 1);
}
