/**
 * The `.data.json` DIFF CONTRACT, server-side and unforkable.
 *
 * A data asset's editor UI ships as a COPIED capability (`data-tables`), and a
 * copy can be edited — which is the point, and also the reason none of this
 * may live there. Key order and `$schema`-first serialization are the property
 * that keeps a one-cell edit a one-line git diff; a project that reorganized
 * its own table UI must not be able to reorganize the file's bytes with it. So
 * the client posts PARSED VALUES for a path (`POST /__editor/data-file` with
 * `values`) and this module owns the fold from those values to the exact text
 * written to disk.
 *
 * Ported verbatim (behavior, not shape) from the editor-side data panel that
 * used to own it. Two facts drive every line here:
 *
 * 1. `JSON.parse` REINDEXES integer-like keys. A JS object enumerates "1",
 *    "2", "10" numerically-ascending no matter what order the file had, so
 *    "the order this file has on disk" can only be recovered from the raw
 *    TEXT, before parsing — {@link extractTopLevelKeyOrder}.
 * 2. `JSON.stringify` of a spread-reordered object reindexes them again on the
 *    way out, so the writer emits keys one at a time in the caller's order —
 *    {@link serializeDataFile}.
 */

/** Scan a (valid-JSON) string literal starting at the opening quote; returns the index just past the closing quote. */
function skipJsonString(text: string, i: number): number {
  let j = i + 1;
  while (j < text.length) {
    const ch = text[j];
    if (ch === '\\') {
      j += 2;
      continue;
    }
    if (ch === '"') return j + 1;
    j++;
  }
  return j;
}

/** Scan one JSON value (string/object/array/number/bool/null) starting at `i`; returns the index just past it. Assumes well-formed JSON (only ever called on text `JSON.parse` already accepted). */
function skipJsonValue(text: string, i: number): number {
  const ch = text[i];
  if (ch === '"') return skipJsonString(text, i);
  if (ch === '{' || ch === '[') {
    const close = ch === '{' ? '}' : ']';
    let depth = 1;
    let j = i + 1;
    while (j < text.length && depth > 0) {
      const c = text[j];
      if (c === '"') {
        j = skipJsonString(text, j);
        continue;
      }
      if (c === '{' || c === '[') depth++;
      else if (c === close || c === '}' || c === ']') depth--;
      j++;
    }
    return j;
  }
  // number / true / false / null — run until a structural character.
  let j = i;
  while (j < text.length && !/[,}\]\s]/.test(text[j]!)) j++;
  return j;
}

/**
 * Read a top-level JSON object's key order straight off the SOURCE TEXT — see
 * fact #1 in the module header. Only ever called with text `JSON.parse`
 * already accepted, so this can assume well-formed JSON throughout.
 */
export function extractTopLevelKeyOrder(text: string): string[] {
  const keys: string[] = [];
  let i = 0;
  const n = text.length;
  const skipWs = () => {
    while (i < n && /\s/.test(text[i]!)) i++;
  };
  skipWs();
  if (text[i] !== '{') return keys;
  i++;
  skipWs();
  while (i < n && text[i] !== '}') {
    if (text[i] !== '"') break;
    const keyEnd = skipJsonString(text, i);
    const key = JSON.parse(text.slice(i, keyEnd)) as string;
    if (!keys.includes(key)) keys.push(key);
    i = keyEnd;
    skipWs();
    if (text[i] !== ':') break;
    i++;
    skipWs();
    i = skipJsonValue(text, i);
    skipWs();
    if (text[i] === ',') {
      i++;
      skipWs();
      continue;
    }
    break;
  }
  return keys;
}

/**
 * Fold a commit's resulting keys into a stable order: `prevOrder` (the order
 * the file currently has on disk) survives for every key still present, and
 * any BRAND NEW key (add-row, a freshly-set nested field) is appended at the
 * end in `Object.keys` order.
 */
export function nextKeyOrder(
  prevOrder: string[] | undefined,
  obj: Record<string, unknown>,
): string[] {
  const existing = prevOrder ?? Object.keys(obj);
  const kept = [...new Set(existing)].filter((k) => k in obj);
  const added = Object.keys(obj).filter((k) => !existing.includes(k));
  return [...kept, ...added];
}

/**
 * Serialize per the diff-minimal contract: `"$schema"` first, then every other
 * key in `keyOrder` (falling back to `Object.keys(obj)` when the caller has
 * none — a brand-new file), 2-space indent, trailing newline. Emitting the
 * object key by key is deliberate; see fact #2 in the module header.
 */
export function serializeDataFile(obj: Record<string, unknown>, keyOrder?: string[]): string {
  const hasSchema = '$schema' in obj;
  const rest = (keyOrder ?? Object.keys(obj)).filter((k) => k !== '$schema' && k in obj);
  const order = hasSchema ? ['$schema', ...rest] : rest;
  if (order.length === 0) return '{}\n';
  const lines = order.map((k) => {
    const valueJson = JSON.stringify(obj[k], null, 2);
    return `  ${JSON.stringify(k)}: ${valueJson.split('\n').join('\n  ')}`;
  });
  return `{\n${lines.join(',\n')}\n}\n`;
}

/**
 * The whole server-side fold in one call: the file's CURRENT text (absent for
 * a file that does not exist yet) plus the values the client posted, giving
 * the exact bytes to write.
 */
export function foldDataFileText(
  currentText: string | null,
  values: Record<string, unknown>,
): string {
  let prevOrder: string[] | undefined;
  if (currentText !== null) {
    try {
      JSON.parse(currentText);
      prevOrder = extractTopLevelKeyOrder(currentText);
    } catch {
      // Unparseable file on disk — nothing to carry, so the posted values
      // define the order. Never a reason to refuse the write.
    }
  }
  return serializeDataFile(values, nextKeyOrder(prevOrder, values));
}
