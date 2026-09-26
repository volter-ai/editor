/** Godot ImageFormatSaverExtension registry and script-defined encoder protocol. */

import type { GodotFileAccess } from './file-access';
import type { GodotImage } from './image';
import { registerGodotObjectIdentity } from './object';
import { packedByteArray, packedStringArray, type PackedArrayValue, type PackedStringArray } from './packed-array';

export interface GodotImageFormatSaverExtensionHooks {
  _get_recognized_extensions(): Iterable<string>;
  _save_image(image: GodotImage, fileAccess: GodotFileAccess, options: Readonly<Record<string, unknown>>): number;
  _save_image_to_buffer?(image: GodotImage, options: Readonly<Record<string, unknown>>): Iterable<number>;
}

export interface GodotImageFormatSaveRequest {
  readonly image: GodotImage;
  readonly extension: string;
  readonly options?: Readonly<Record<string, unknown>>;
}

const activeImageFormatSavers: GodotImageFormatSaverExtension[] = [];

function extensionName(extension: string): string {
  const normalized = String(extension).trim().toLowerCase().replace(/^\./, '');
  if (normalized.length === 0 || normalized.includes('/') || normalized.includes('\\')) {
    throw new TypeError(`Image format extension ${JSON.stringify(extension)} is invalid.`);
  }
  return normalized;
}

function saveOptions(options: unknown): Readonly<Record<string, unknown>> {
  if (options === undefined) return Object.freeze({});
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('ImageFormatSaverExtension options require Dictionary.');
  }
  return Object.freeze({ ...(options as Readonly<Record<string, unknown>>) });
}

function saveError(value: unknown, member: string): number {
  if (!Number.isSafeInteger(value)) throw new TypeError(`ImageFormatSaverExtension.${member} must return Error.`);
  return value as number;
}

export class GodotImageFormatSaverExtension {
  private registered = false;

  constructor(private readonly hooks: GodotImageFormatSaverExtensionHooks) {
    if (hooks === null || typeof hooks !== 'object') throw new TypeError('ImageFormatSaverExtension requires hooks.');
    registerGodotObjectIdentity(this, 'ImageFormatSaverExtension');
  }

  _get_recognized_extensions(): PackedStringArray {
    const unique = new Set<string>();
    for (const extension of this.hooks._get_recognized_extensions()) unique.add(extensionName(extension));
    return packedStringArray(unique);
  }

  _save_image(
    image: GodotImage,
    fileAccess: GodotFileAccess,
    options: Readonly<Record<string, unknown>> = {},
  ): number {
    return saveError(this.hooks._save_image(image, fileAccess, saveOptions(options)), '_save_image');
  }

  _save_image_to_buffer(
    image: GodotImage,
    options: Readonly<Record<string, unknown>> = {},
  ): PackedArrayValue<number> {
    const hook = this.hooks._save_image_to_buffer;
    if (hook === undefined) {
      throw new Error('ImageFormatSaverExtension._save_image_to_buffer is not implemented by this encoder.');
    }
    const result = hook(image, saveOptions(options));
    if (result === null || result === undefined || typeof result[Symbol.iterator] !== 'function') {
      throw new TypeError('ImageFormatSaverExtension._save_image_to_buffer must return PackedByteArray.');
    }
    return packedByteArray(result);
  }

  add_format_saver(atFront = false): void {
    if (typeof atFront !== 'boolean') throw new TypeError('ImageFormatSaverExtension.add_format_saver at_front requires bool.');
    if (this.registered) this.remove_format_saver();
    if (atFront) activeImageFormatSavers.unshift(this);
    else activeImageFormatSavers.push(this);
    this.registered = true;
  }

  remove_format_saver(): void {
    const index = activeImageFormatSavers.indexOf(this);
    if (index >= 0) activeImageFormatSavers.splice(index, 1);
    this.registered = false;
  }

  is_format_saver_added(): boolean { return this.registered; }

  recognizes_extension(extension: string): boolean {
    return this._get_recognized_extensions().includes(extensionName(extension));
  }

  save_image(
    image: GodotImage,
    fileAccess: GodotFileAccess,
    options: Readonly<Record<string, unknown>> = {},
  ): number {
    return this._save_image(image, fileAccess, options);
  }

  save_image_to_buffer(
    image: GodotImage,
    options: Readonly<Record<string, unknown>> = {},
  ): PackedArrayValue<number> {
    return this._save_image_to_buffer(image, options);
  }
}

export function createGodotImageFormatSaverExtension(
  hooks: GodotImageFormatSaverExtensionHooks,
): GodotImageFormatSaverExtension {
  return new GodotImageFormatSaverExtension(hooks);
}

export function getGodotImageFormatSavers(): readonly GodotImageFormatSaverExtension[] {
  return activeImageFormatSavers.slice();
}

export function findGodotImageFormatSaver(extensionOrPath: string): GodotImageFormatSaverExtension | null {
  const fileName = extensionOrPath.replace(/[?#].*$/, '');
  const dot = fileName.lastIndexOf('.');
  const extension = extensionName(dot >= 0 ? fileName.slice(dot + 1) : fileName);
  for (const saver of activeImageFormatSavers) if (saver.recognizes_extension(extension)) return saver;
  return null;
}

export function saveGodotImageWithFormatSaver(
  extensionOrPath: string,
  image: GodotImage,
  fileAccess: GodotFileAccess,
  options: Readonly<Record<string, unknown>> = {},
): number {
  return findGodotImageFormatSaver(extensionOrPath)?.save_image(image, fileAccess, options) ?? 7;
}

export function saveGodotImageToBufferWithFormatSaver(
  extension: string,
  image: GodotImage,
  options: Readonly<Record<string, unknown>> = {},
): PackedArrayValue<number> {
  const saver = findGodotImageFormatSaver(extension);
  if (saver === null) throw new Error(`No ImageFormatSaverExtension recognizes ${extensionName(extension)}.`);
  return saver.save_image_to_buffer(image, options);
}

export function clearGodotImageFormatSavers(): void {
  for (const saver of activeImageFormatSavers.splice(0)) saver.remove_format_saver();
}
