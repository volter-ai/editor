import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const bundle = await build({ entryPoints: [fileURLToPath(new URL('../browser/frame-stream.mts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { FrameStreamReader, sendFrameValue, FRAME_CHUNK_BYTES } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('large metadata and typed columns cross in bounded acknowledged chunks, exactly', async () => {
  const reader = new FrameStreamReader();
  const data = new Float64Array(600000); for (let i=0;i<data.length;i++) data[i] = i / 7;
  const value = { manifest: 'm'.repeat(2 * FRAME_CHUNK_BYTES), nested: { data: data.subarray(3), flags: new Uint8Array([1, 0, 255]) } };
  let inflight = 0, maximum = 0, packets = 0, restored;
  await sendFrameValue(value, async chunk => {
    assert.equal(++inflight, 1, 'the sender awaits receiver acknowledgement');
    if (chunk.kind === 'bytes') { maximum = Math.max(maximum, chunk.bytes.length); packets++; }
    const result = await reader.accept(structuredClone(chunk, { transfer: chunk.kind === 'bytes' ? [chunk.bytes.buffer] : [] }));
    if (result) restored = result.value;
    inflight--;
  });
  assert.equal(maximum, FRAME_CHUNK_BYTES); assert.ok(packets > 6);
  assert.deepEqual(restored, value); assert.equal(data.length, 600000, 'source remains intact until its value completes');
});

test('drift, reordering and truncation refuse without delivering a value; a fresh value recovers', async () => {
  for (const mode of ['drift', 'order', 'truncated']) {
    const reader = new FrameStreamReader(); let changed = false;
    await assert.rejects(sendFrameValue({ bytes: new Uint8Array(20) }, async chunk => {
      if (!changed && chunk.kind === 'bytes') {
        changed = true;
        if (mode === 'drift') chunk.bytes[0] ^= 1;
        if (mode === 'order') chunk.offset++;
        if (mode === 'truncated') return;
      }
      return reader.accept(chunk);
    }), /digest mismatch|out of order|incomplete/);
    let recovered;
    await sendFrameValue({ ok: true }, async chunk => { recovered = (await reader.accept(chunk))?.value ?? recovered; });
    assert.deepEqual(recovered, { ok: true });
  }
});

const viewBundle = await build({ entryPoints: [fileURLToPath(new URL('../browser/three/blender-runtime-view.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { BlenderRuntimeView } = await import(`data:text/javascript;base64,${Buffer.from(viewBundle.outputFiles[0].text).toString('base64')}`);
const triangle = {
  revision: 1, counts: { verts: 3, edges: 3, faces: 1, corners: 3 }, attributes: [], activeUv: null, renderUv: null,
  columns: { co: new Float64Array([0,0,0, 1,0,0, 0,1,0]), cornerNormal: new Float32Array([0,0,1,0,0,1,0,0,1]),
    faceStart: new Uint32Array([0,3]), corner: new Uint32Array([0,1,2]), cornerEdge: new Int32Array([0,1,2]), edge: new Uint32Array([0,1,1,2,2,0]),
    edgeSharp: new Uint8Array(3), edgeSeam: new Uint8Array(3), edgeCrease: new Float32Array(3), material: new Uint32Array(1), smooth: new Uint8Array(1),
    vertSelect: new Uint8Array(3), vertHide: new Uint8Array(3), edgeSelect: new Uint8Array(3), edgeHide: new Uint8Array(3), faceSelect: new Uint8Array(1), faceHide: new Uint8Array(1) }
};
const frame = revision => ({ session: 'test', revision, meshes: { triangle: { unchanged: true, revision: 1 } }, materials: {}, objects: [], active: null, mode: 'OBJECT' });
test('streamed geometry is prepared once, committed by matching manifest and reused by a delta', () => {
  const view = new BlenderRuntimeView();
  view.stageFrame({ session: 'test', revision: 1 });
  view.stageFrame({ session: 'test', revision: 1, mesh: 'triangle', piece: triangle });
  assert.equal(view.inspect().revision, undefined, 'partial frame is not displayed');
  assert.throws(() => view.applyFrame(frame(2)), /staged revision/);
  const first = view.applyFrame(frame(1));
  assert.equal(first.geometryBuilds, 1); assert.equal(first.held, null);
  const delta = view.applyFrame(frame(2));
  assert.equal(delta.geometryBuilds, 1); assert.deepEqual(delta.held, { session: 'test', revision: 1 });
  assert.throws(() => view.stageFrame({ session: 'test', revision: 2, mesh: 'triangle', piece: triangle }), /pending revision/);
  view.dispose();
});
