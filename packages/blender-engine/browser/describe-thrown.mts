/** Anything thrown, rendered so the message SURVIVES the worker boundary.
 *
 * String(object) erased a prior real diagnostic as [object Object]. Preserve
 * named messages or JSON fields, with a safe fallback for cyclic values.
 * Startup wrappers omit Error stacks from their user-visible message; worker
 * replies keep them as before. */
export function describeThrown(error: unknown, includeStack = true): string {
  if (error instanceof Error)
    return (includeStack ? error.stack : undefined) ?? `${error.name}: ${error.message}`;
  if (typeof error === 'object' && error !== null) {
    const named = error as { name?: unknown; message?: unknown };
    if (typeof named.message === 'string') {
      return typeof named.name === 'string' ? `${named.name}: ${named.message}` : named.message;
    }
    try {
      return JSON.stringify(error) ?? Object.prototype.toString.call(error);
    } catch {
      return Object.prototype.toString.call(error);
    }
  }
  return String(error);
}
