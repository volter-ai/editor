/**
 * The ONE redaction pass for values recorded to a project's on-disk ledgers
 * (`.vgai/provenance.json`, `.vgai/generations.json`).
 *
 * Secret-shaped keys, signed URL queries, inline data-URLs and binary bodies
 * are replaced before a byte reaches disk. This lives in exactly one module
 * because two copies of a redaction regex agree only until someone tightens
 * one of them — at which point the other ledger silently keeps leaking the
 * newly-recognized secret. Both writers import THIS; neither carries its own
 * spelling of what counts as a secret.
 */

import { createHash } from 'node:crypto';

const SECRET_FIELD = /(authorization|credential|password|secret|token|api.?key|fal.?key)/i;
const SIGNED_URL_PARAMETER = /(signature|credential|token|expires|x-amz-)/i;

function sanitizeString(value: string): unknown {
  const dataUrl = /^data:([^;,]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=\s]+)$/.exec(value);
  if (dataUrl?.[1] && dataUrl[2]) {
    const bytes = Buffer.from(dataUrl[2], 'base64');
    return {
      mediaType: dataUrl[1],
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      encoding: 'data-url-omitted',
    };
  }
  try {
    const url = new URL(value);
    if (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      [...url.searchParams.keys()].some((key) => SIGNED_URL_PARAMETER.test(key))
    ) {
      return `${url.origin}${url.pathname}?[redacted signed query]`;
    }
  } catch {
    // Most recorded strings are labels, ids, prompts, or paths rather than URLs.
  }
  return value;
}

function isBinaryValue(value: object): boolean {
  return (
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    (typeof Blob !== 'undefined' && value instanceof Blob)
  );
}

/** Redact `value` recursively; returns a JSON-safe structure. */
export function sanitizeRecordedValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return sanitizeString(value);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (value === undefined) return undefined;
  if (typeof value !== 'object') return `[omitted ${typeof value}]`;
  if (isBinaryValue(value)) return '[binary omitted]';
  if (seen.has(value)) return '[circular omitted]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => sanitizeRecordedValue(entry, seen) ?? null);
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) {
      output[key] = '[redacted]';
      continue;
    }
    const next = sanitizeRecordedValue(entry, seen);
    if (next !== undefined) output[key] = next;
  }
  return output;
}
