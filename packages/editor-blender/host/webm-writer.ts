/**
 * A WEBM FILE OF ONE VIDEO TRACK, written from the chunks a WebCodecs `VideoEncoder` hands out
 * (`cyclotron render-movie`). Matroska's EBML, the few elements a player needs: the header, the
 * segment's Info (time scale and duration), one track, and clusters of SimpleBlocks, a new cluster
 * at each key frame (or every five seconds), so a seek lands on a picture.
 *
 * Every element's size is written in eight bytes (`0x01` and seven), which EBML allows for any
 * size, so nothing is measured twice.
 */

type Element = Uint8Array;

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
};

const idBytes = (id: number): Uint8Array => {
  const bytes: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Uint8Array.from(bytes);
};

const size8 = (n: number): Uint8Array => {
  const out = new Uint8Array(8);
  out[0] = 0x01;
  for (let i = 7, v = n; i >= 1; i--, v = Math.floor(v / 256)) out[i] = v & 0xff;
  return out;
};

const element = (id: number, body: Uint8Array): Element => concat([idBytes(id), size8(body.length), body]);
const uint = (id: number, value: number): Element => {
  const bytes: number[] = [];
  for (let v = value; v > 0 || bytes.length === 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return element(id, Uint8Array.from(bytes));
};
const float64 = (id: number, value: number): Element => {
  const body = new Uint8Array(8);
  new DataView(body.buffer).setFloat64(0, value);
  return element(id, body);
};
const ascii = (id: number, text: string): Element => element(id, Uint8Array.from(text, (c) => c.charCodeAt(0) & 0x7f));
const master = (id: number, children: readonly Element[]): Element => element(id, concat(children));

/** One encoded picture: its bytes, its time in milliseconds, and whether it is a key frame. */
export interface WebmFrame {
  readonly data: Uint8Array;
  readonly ms: number;
  readonly key: boolean;
}

/** The whole file, from its frames in order. `codec` is Matroska's (`V_VP8`, `V_VP9`). */
export function writeWebm(options: { readonly codec: 'V_VP8' | 'V_VP9'; readonly width: number; readonly height: number; readonly durationMs: number },
  frames: readonly WebmFrame[]): Uint8Array {
  const header = master(0x1a45dfa3, [
    uint(0x4286, 1), uint(0x42f7, 1), uint(0x42f2, 4), uint(0x42f3, 8), ascii(0x4282, 'webm'), uint(0x4287, 4), uint(0x4285, 2),
  ]);
  const info = master(0x1549a966, [
    uint(0x2ad7b1, 1_000_000), float64(0x4489, options.durationMs),
    ascii(0x4d80, 'Volter Cyclotron'), ascii(0x5741, 'Volter Cyclotron render-movie'),
  ]);
  const tracks = master(0x1654ae6b, [master(0xae, [
    uint(0xd7, 1), uint(0x73c5, 1), uint(0x83, 1), ascii(0x86, options.codec),
    master(0xe0, [uint(0xb0, options.width), uint(0xba, options.height)]),
  ])]);
  const clusters: Element[] = [];
  let open: { start: number; blocks: Element[] } | null = null;
  const close = () => { if (open) clusters.push(master(0x1f43b675, [uint(0xe7, open.start), ...open.blocks])); open = null; };
  for (const frame of frames) {
    const ms = Math.round(frame.ms);
    if (!open || frame.key || ms - open.start > 5000) { close(); open = { start: ms, blocks: [] }; }
    const block = new Uint8Array(4 + frame.data.length);
    block[0] = 0x81;                                     // track 1, as a one-byte vint
    new DataView(block.buffer).setInt16(1, ms - open.start);
    block[3] = frame.key ? 0x80 : 0x00;
    block.set(frame.data, 4);
    open.blocks.push(element(0xa3, block));
  }
  close();
  return concat([header, master(0x18538067, [info, tracks, ...clusters])]);
}
