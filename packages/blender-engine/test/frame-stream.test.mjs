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

const geometryBundle = await build({ entryPoints: [fileURLToPath(new URL('../browser/three/blender-runtime-geometry.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { drawArraysFromColumns } = await import(`data:text/javascript;base64,${Buffer.from(geometryBundle.outputFiles[0].text).toString('base64')}`);
test('native column draw preserves tessellation, every UV and attribute across seams and loose vertices', () => {
  const columns = { ...triangle.columns, co: new Float32Array([0,0,0,1,0,0,0,1,0,2,2,2]),
    faceStart: new Uint32Array([0,3,6]), corner: new Uint32Array([0,1,2,0,2,1]),
    cornerTri: new Uint32Array([0,1,2,3,4,5]), material: new Uint32Array([0,2]),
    cornerNormal: new Float32Array([0,0,1,0,0,1,0,0,1,0,0,-1,0,0,-1,0,0,-1]),
    attributes: [
      { name: 'uv', type: 'FLOAT2', domain: 'CORNER', data: new Float32Array([0,0,1,0,0,1,.1,.2,.3,.4,.5,.6]) },
      { name: 'second', type: 'FLOAT2', domain: 'CORNER', data: new Float32Array([.2,.3,.4,.5,.6,.7,.8,.9,1,0,0,1]) },
      { name: 'face-value', type: 'FLOAT', domain: 'FACE', data: new Float32Array([2,3]) },
    ], activeUv: 'uv', renderUv: 'second', smooth: new Uint8Array([1,1]) };
  const result = drawArraysFromColumns(columns, 'native');
  assert.equal(result.sourceVertex.length, 7, 'six distinct corners plus the loose vertex');
  for (let i=0;i<columns.cornerTri.length;i++) {
    const corner = columns.cornerTri[i], vertex = columns.corner[corner], drawn = result.indices[i];
    assert.equal(result.sourceVertex[drawn], vertex);
    assert.deepEqual(result.positions.slice(drawn*3,drawn*3+3), columns.co.slice(vertex*3,vertex*3+3));
    assert.deepEqual(result.normals.slice(drawn*3,drawn*3+3), columns.cornerNormal.slice(corner*3,corner*3+3));
    for (let uv=0;uv<2;uv++) assert.deepEqual(result.uvLayers[uv].data.slice(drawn*2,drawn*2+2), columns.attributes[uv].data.slice(corner*2,corner*2+2));
    assert.equal(result.attributeLayers[0].data[drawn*4], i<3?2:3);
  }
  assert.deepEqual(result.groups, [{start:0,count:3,materialIndex:0},{start:3,count:3,materialIndex:2}]);
  assert.throws(() => drawArraysFromColumns({...columns,cornerTri:new Uint32Array([0,1,5,3,4,5])}, 'wrong'), /different face/);
});
