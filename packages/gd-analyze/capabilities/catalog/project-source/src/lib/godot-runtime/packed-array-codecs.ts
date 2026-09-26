/** General compression supply initialized by the mounted Godot runtime. */

import { Zstd } from '@hpcc-js/wasm-zstd';
import initBrotli, * as brotli from 'brotli-dec-wasm/web';
import brotliWasmUrl from 'brotli-dec-wasm/web/bg.wasm?url';
import { deflate, gzip, inflate, ungzip } from 'pako';
import { fastLzCompress, fastLzDecompress } from '../codecs/fastlz';
import type { GodotPackedArrayCodecs } from '../godot-compat/packed-array-binary';

let codecsPromise: Promise<GodotPackedArrayCodecs> | null = null;

/**
 * Instantiate the WASM codecs once, before translated synchronous PackedByteArray calls can run.
 * The returned handle is synchronous; compat owns mode routing and never creates a Promise.
 */
export function loadGodotPackedArrayCodecs(): Promise<GodotPackedArrayCodecs> {
  if (codecsPromise !== null) return codecsPromise;
  codecsPromise = Promise.all([
    Zstd.load(),
    initBrotli({ module_or_path: brotliWasmUrl }).then(() => brotli),
  ]).then(([zstd, brotliCodec]) => ({
    compress(mode, source) {
      try {
        if (mode === 0) {
          return fastLzCompress(source);
        }
        if (mode === 1) return deflate(source);
        if (mode === 2) return zstd.compress(source);
        if (mode === 3) return gzip(source);
        // Godot deliberately does not expose Brotli compression.
        return null;
      } catch {
        return null;
      }
    },
    decompress(mode, source, expectedSize, maxOutputSize) {
      try {
        let result: Uint8Array;
        if (mode === 0) {
          const capacity = expectedSize < 16 ? 16 : expectedSize;
          const decompressed = fastLzDecompress(source, capacity);
          if (decompressed === null) return null;
          result = decompressed;
        } else if (mode === 1) result = inflate(source);
        else if (mode === 2) result = zstd.decompress(source);
        else if (mode === 3) result = ungzip(source);
        else if (mode === 4) result = brotliCodec.decompress(source);
        else return null;
        if (expectedSize >= 0 && result.length !== expectedSize) return null;
        if (maxOutputSize !== undefined && maxOutputSize >= 0 && result.length > maxOutputSize)
          return null;
        return result;
      } catch {
        return null;
      }
    },
  }));
  return codecsPromise;
}
