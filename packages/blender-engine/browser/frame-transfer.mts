/** Buffers at every depth of a frame move to the presenter exactly once. */
export function frameTransferBuffers(frame: unknown): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  const visited = new Set<object>();
  const walk = (value: unknown): void => {
    if (value === null || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (value instanceof ArrayBuffer) {
      buffers.add(value);
    } else if (ArrayBuffer.isView(value)) {
      // Shared Wasm memory cannot be transferred; arena readers make owned copies.
      if (value.buffer instanceof ArrayBuffer) buffers.add(value.buffer);
    } else {
      for (const child of Object.values(value)) walk(child);
    }
  };
  walk(frame);
  return [...buffers];
}
