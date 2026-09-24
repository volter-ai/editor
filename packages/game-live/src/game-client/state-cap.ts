/** Byte-capping for the failure block's "last state" member (Task 3.3: never
 *  elided, byte-capped at 4KB, truncation always marked). */

export interface CappedJson {
  text: string;
  truncated: boolean;
}

const TRUNCATION_MARKER = '\n… [truncated to fit the 4KB cap]';

export function capJson(value: unknown, maxBytes = 4096): CappedJson {
  const full = JSON.stringify(value, null, 2) ?? 'undefined';
  if (byteLength(full) <= maxBytes) {
    return { text: full, truncated: false };
  }
  const budget = Math.max(maxBytes - byteLength(TRUNCATION_MARKER), 0);
  let text = full;
  // Binary-search-free shrink: strings only grow bytes via multi-byte UTF-8,
  // so a length-proportional slice converges in a handful of iterations.
  while (byteLength(text) > budget && text.length > 0) {
    const ratio = budget / byteLength(text);
    text = text.slice(0, Math.max(Math.floor(text.length * ratio), 0));
  }
  return { text: text + TRUNCATION_MARKER, truncated: true };
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
