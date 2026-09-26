/** Godot 4.7 String path and name helpers from `core/string/ustring.cpp`. */

const normalizeSeparators = (value: string): string => value.replace(/\\/gu, '/');

export function stringGetExtension(value: string): string {
  const file = stringGetFile(value);
  const dot = file.lastIndexOf('.');
  return dot <= 0 ? '' : file.slice(dot + 1);
}

export function stringGetBasename(value: string): string {
  const slash = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  const dot = value.lastIndexOf('.');
  return dot <= slash ? value : value.slice(0, dot);
}

export function stringPathJoin(value: string, path: string): string {
  if (value.length === 0) return path;
  if (path.length === 0) return value;
  const leftSlash = /[\\/]$/u.test(value);
  const rightSlash = /^[\\/]/u.test(path);
  if (leftSlash && rightSlash) return value + path.slice(1);
  if (!leftSlash && !rightSlash) return `${value}/${path}`;
  return value + path;
}

export function stringIsAbsolutePath(value: string): boolean {
  return /^[\\/]/u.test(value) || /^[A-Za-z]:[\\/]/u.test(value) || /^\w+:\/\//u.test(value);
}

export const stringIsRelativePath = (value: string): boolean => !stringIsAbsolutePath(value);

export function stringSimplifyPath(value: string): string {
  const normalized = normalizeSeparators(value);
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)/u.exec(normalized)?.[1] ?? '';
  const drive = scheme.length === 0 ? (/^([A-Za-z]:\/)/u.exec(normalized)?.[1] ?? '') : '';
  const absolute = scheme.length > 0 || drive.length > 0 || normalized.startsWith('/');
  const prefix = scheme || drive || (absolute ? '/' : '');
  const body = normalized.slice(prefix.length);
  const parts: string[] = [];
  for (const part of body.split('/')) {
    if (part.length === 0 || part === '.') continue;
    if (part === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop();
      else if (!absolute) parts.push('..');
    } else parts.push(part);
  }
  const result = prefix + parts.join('/');
  return result.length === 0 ? '.' : result;
}

export function stringGetBaseDir(value: string): string {
  const normalized = normalizeSeparators(value);
  const slash = normalized.lastIndexOf('/');
  if (slash < 0) return '';
  if (slash === 0) return '/';
  return normalized.slice(0, slash);
}

export function stringGetFile(value: string): string {
  const normalized = normalizeSeparators(value);
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

const INVALID_FILENAME = /[:/\\?*"|%<>]/gu;
const HAS_INVALID_FILENAME = /[:/\\?*"|%<>]/u;

export function stringValidateFilename(value: string): string {
  return value.trim().replace(INVALID_FILENAME, '_');
}

export function stringIsValidFilename(value: string): boolean {
  return value.length > 0 && value.trim() === value && !HAS_INVALID_FILENAME.test(value);
}

export function stringValidateNodeName(value: string): string {
  return value.replace(/[.:@/"%]/gu, '_');
}
