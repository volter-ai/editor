import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const metadata=JSON.parse(await readFile(new URL('../browser/three/blender-display-shaders.json',import.meta.url)));
const data=await readFile(new URL('../browser/three/blender-display-shaders.lut',import.meta.url));
const native=JSON.parse(await readFile(new URL('./fixtures/display-colors.json',import.meta.url)));
const bundled=await build({stdin:{contents:`export {BlenderDisplayTransform} from './blender-display-transform';`,
  resolveDir:fileURLToPath(new URL('../browser/three/',import.meta.url)),loader:'ts'},
  bundle:true,platform:'node',format:'esm',write:false});
const {BlenderDisplayTransform}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].contents).toString('base64'));

test('native fixture and GPU data pin the same Blender color configuration',()=>{
  assert.equal(native.config_sha256,metadata.config_sha256);
  assert.equal(createHash('sha256').update(data).digest('hex'),metadata.data_sha256);
  assert.equal(Object.keys(metadata.processors).length,20);
});
test('every native view/look fixture has a generated processor with valid texture bounds',()=>{
  for(const c of native.cases){
    const p=metadata.processors[c.transform+'/'+c.look];
    assert.ok(p,'Missing processor '+c.transform+'/'+c.look);
    assert.match(p.shader,/vec4 blenderDisplay/);
    for(const t of p.textures){
      assert.equal(t.offset%4,0);
      assert.ok(t.offset+t.count*4<=data.byteLength);
      assert.equal(t.count,t.channels*(t.size?t.size**3:t.width*t.height));
    }
  }
});
test('unknown view transforms and truncated GPU tables are refused',()=>{
  const base={transform:'Filmic',look:'Medium Contrast',exposure:1,gamma:1};
  assert.throws(()=>new BlenderDisplayTransform({...base,look:'Imaginary'},new ArrayBuffer(0)),/Unimplemented/);
  assert.throws(()=>new BlenderDisplayTransform(base,new ArrayBuffer(0)),/Invalid/);
  const transform=new BlenderDisplayTransform(base,data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength));
  transform.dispose();
});
