/**
 * read/glb-container.ts — the binary `.glb` wrapper, decoded to its JSON chunk + binary buffer.
 *
 * ## Ground truth
 *
 * The glTF 2.0 specification, §4.4 "GLB File Format Specification" (Khronos, `glTF/2.0/README.md`).
 * The structures cited here are the whole of that section:
 *
 *   - **Header**, 12 bytes, three `uint32` little-endian: `magic` (`0x46546C67`, ASCII `glTF`),
 *     `version` (must be 2), `length` (the TOTAL length of the file including the header).
 *   - **Chunk**, repeated to `length`: `chunkLength` (`uint32`), `chunkType` (`uint32`), then
 *     `chunkLength` bytes of data padded with trailing bytes to a 4-byte boundary. The padding is
 *     INSIDE the chunk's declared length (§4.4.3: "chunkLength … MUST be divisible by 4"), so the
 *     next chunk starts at `offset + 8 + chunkLength` with no extra alignment arithmetic.
 *   - **Chunk types**: `0x4E4F534A` (`JSON`), exactly one, FIRST; `0x004E4942` (`BIN`), at most
 *     one, second. §4.4.4 says a client "MUST ignore" any chunk type it does not recognize, which
 *     is the ONE place this reader is permissive — and it says so in a diagnostic rather than
 *     silently, because an unrecognized chunk in a file we are treating as a scene is worth a line
 *     in the report.
 *
 * ## Why the lane has its own container reader
 *
 * Nothing else in this repo reads a `.glb` as DATA. `packages/engine` loads them through three's
 * `GLTFLoader` into a live scene graph, which is a different question (what does three render?)
 * from the one this package asks (what node tree does GODOT's importer build?). A loader that
 * answers the first cannot answer the second — the whole content of the second is the transform
 * `resource_importer_scene.cpp` applies afterwards. See `gltf-godot-scene.ts`.
 */

/** The one error this file and its siblings raise; `godot-project.ts` catches it per document. */
export class GltfParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GltfParseError';
  }
}

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const GIT_LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/v1\n';

export interface GlbContainer {
  /** The parsed JSON chunk. Typed as `unknown` here — `gltf-document.ts` is what validates it. */
  readonly json: unknown;
  /** The `BIN` chunk, or an empty view when the file declares none. */
  readonly binary: Uint8Array;
  /**
   * Chunk types present that the spec does not define, by their `uint32` type value in hex. The
   * spec says to ignore them; this says WHICH were ignored.
   */
  readonly ignoredChunkTypes: readonly string[];
}

function u32(bytes: Uint8Array, offset: number, at: string): number {
  if (offset + 4 > bytes.length) {
    throw new GltfParseError(`${at}: truncated at byte ${offset}; a uint32 needs 4 more bytes`);
  }
  return (
    ((bytes[offset] as number) |
      ((bytes[offset + 1] as number) << 8) |
      ((bytes[offset + 2] as number) << 16) |
      ((bytes[offset + 3] as number) << 24)) >>>
    0
  );
}

export function readGlbContainer(bytes: Uint8Array, at: string): GlbContainer {
  const magic = u32(bytes, 0, at);
  if (magic !== GLB_MAGIC) {
    // A Git LFS pointer is repository metadata, not a degraded model representation. Three's
    // GLTFLoader cannot consume it and neither can Godot's importer; distinguish the missing LFS
    // object from malformed GLB bytes so the operator gets the exact recovery action while the
    // model remains refused. The pointer grammar is intentionally strict and bounded before any
    // UTF-8 decoding, so arbitrary binary with the same first uint32 cannot masquerade as one.
    const pointerText =
      bytes.length <= 1024
        ? new TextDecoder('utf-8').decode(bytes).replace(/\r\n/g, '\n')
        : undefined;
    if (pointerText?.startsWith(GIT_LFS_POINTER_PREFIX) === true) {
      const oid = /^oid sha256:([0-9a-f]{64})$/m.exec(pointerText)?.[1];
      const size = /^size ([0-9]+)$/m.exec(pointerText)?.[1];
      if (oid !== undefined && size !== undefined) {
        throw new GltfParseError(
          `${at}: the checkout contains a Git LFS pointer (sha256:${oid}, ${size} bytes), ` +
            'not the model object; fetch that LFS object before importing',
        );
      }
    }
    throw new GltfParseError(
      `${at}: not a .glb — magic is 0x${magic.toString(16)}, the spec's is 0x46546c67 ("glTF")`,
    );
  }
  const version = u32(bytes, 4, at);
  if (version !== 2) {
    throw new GltfParseError(
      `${at}: glb container version ${version}; this reader implements glTF 2.0 only`,
    );
  }
  const declaredLength = u32(bytes, 8, at);
  if (declaredLength > bytes.length) {
    throw new GltfParseError(
      `${at}: header declares ${declaredLength} bytes but the file is ${bytes.length}`,
    );
  }

  let json: unknown;
  let binary: Uint8Array | undefined;
  const ignoredChunkTypes: string[] = [];

  let offset = 12;
  while (offset < declaredLength) {
    const chunkLength = u32(bytes, offset, at);
    const chunkType = u32(bytes, offset + 4, at);
    const start = offset + 8;
    const end = start + chunkLength;
    if (end > declaredLength) {
      throw new GltfParseError(
        `${at}: chunk at byte ${offset} declares ${chunkLength} bytes, past the file's ${declaredLength}`,
      );
    }
    if (chunkType === CHUNK_JSON) {
      if (json !== undefined) {
        throw new GltfParseError(
          `${at}: a second JSON chunk at byte ${offset}; the spec allows one`,
        );
      }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start, end));
      json = JSON.parse(text);
    } else if (chunkType === CHUNK_BIN) {
      if (binary !== undefined) {
        throw new GltfParseError(
          `${at}: a second BIN chunk at byte ${offset}; the spec allows one`,
        );
      }
      binary = bytes.subarray(start, end);
    } else {
      ignoredChunkTypes.push(`0x${chunkType.toString(16).padStart(8, '0')}`);
    }
    offset = end;
  }

  if (json === undefined) {
    throw new GltfParseError(`${at}: no JSON chunk; the spec requires exactly one, first`);
  }
  return { json, binary: binary ?? new Uint8Array(0), ignoredChunkTypes };
}
