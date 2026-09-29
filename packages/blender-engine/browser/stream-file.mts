/** File imports publish only after every declared byte arrived. WasmFS stores the one final
 * backing allocation; each write and its temporary Wasm copy are bounded to one MiB. */
export interface StreamFileSystem {
  open(path: string, flags: string): { fd: number };
  close(stream: { fd: number }): void;
  write(stream: { fd: number }, data: Uint8Array, offset: number, length: number, position: number): number;
  truncate(path: string, length: number): void;
  rename(from: string, to: string): void;
  unlink(path: string): void;
}

export async function writeStreamedFile(
  FS: StreamFileSystem,
  path: string,
  body: ReadableStream<Uint8Array>,
  size: number,
): Promise<void> {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error(`${path}: invalid file size ${size}`);
  const temporary = `${path}.volter-stage-${crypto.randomUUID()}`;
  const reader = body.getReader();
  let stream: { fd: number } | undefined;
  let complete = false;
  try {
    stream = FS.open(temporary, 'w');
    // Reserve the exact backing once: growing WasmFS's vector while importing can otherwise
    // hold both the old and the new allocation in the non-shrinking Wasm heap.
    FS.truncate(temporary, size);
    let position = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (position + value.byteLength > size) throw new Error(`${path}: file grew during import`);
      for (let offset = 0; offset < value.byteLength;) {
        const length = Math.min(1024 * 1024, value.byteLength - offset);
        const written = FS.write(stream, value, offset, length, position);
        if (written <= 0 || written > length) throw new Error(`${path}: invalid file write (${written})`);
        offset += written;
        position += written;
      }
    }
    if (position !== size) throw new Error(`${path}: expected ${size} bytes, received ${position}`);
    FS.close(stream);
    stream = undefined;
    FS.rename(temporary, path);
    complete = true;
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
    if (stream) FS.close(stream);
    if (!complete) {
      try { FS.unlink(temporary); } catch { /* open may have failed before creating the file */ }
    }
  }
}
