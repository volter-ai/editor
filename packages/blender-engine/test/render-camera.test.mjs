import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const built=await build({stdin:{contents:"export {blenderRenderCamera} from './blender-render-camera'; export {Vector3} from 'three';",
  resolveDir:fileURLToPath(new URL('../browser/three/',import.meta.url)),loader:'ts'},
  bundle:true,platform:'node',format:'esm',write:false});
const {blenderRenderCamera,Vector3}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].contents).toString('base64'));
const native=JSON.parse(await readFile(new URL('./fixtures/render-camera.json',import.meta.url)));

test('render projection matches native clipping and shift across camera and sensor fits',()=>{
  for(const c of native.cases){
    const camera=blenderRenderCamera(c.render);
    camera.updateProjectionMatrix();
    for(let row=0;row<4;row++)for(let col=0;col<4;col++)
      assert.ok(Math.abs(camera.projectionMatrix.elements[col*4+row]-c.projection[row][col])<3e-6,
        `${c.name}: projection ${row},${col}`);
    assert.equal(camera.near,c.render.clipStart);assert.equal(camera.far,c.render.clipEnd);
  }
});

test('deliberate near clipping removes enclosing geometry and scales with the document',()=>{
  const render=native.cases[0].render;
  for(const scale of [1,3]){
    const camera=blenderRenderCamera(render,scale);
    assert.ok(new Vector3(0,0,-.5*scale).applyMatrix4(camera.projectionMatrix).z < -1);
    assert.ok(new Vector3(0,0,-2*scale).applyMatrix4(camera.projectionMatrix).z > -1);
    assert.equal(camera.near,render.clipStart*scale);
    assert.equal(camera.far,render.clipEnd*scale);
  }
});
