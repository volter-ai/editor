import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const result=await build({stdin:{contents:`export {expandDrawPlacements} from './blender-depsgraph-placements';`,
  resolveDir:fileURLToPath(new URL('../browser/three/',import.meta.url)),loader:'ts'},
  bundle:true,platform:'node',format:'esm',write:false});
const {expandDrawPlacements}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].contents).toString('base64'));
const matrix=[[1,0,0,3],[0,1,0,4],[0,0,1,5],[0,0,0,1]];

test('native placements borrow source geometry and retain owner selection and their random input',()=>{
  const source={id:'mesh',name:'Source',type:'MESH',mesh:'geometry',materials:['shared'],matrix,
    parent:null,selected:false,visible:false,render_visible:false,viewport_show_self:false,
    object_info:{color:[.2,.3,.4,1],index:7,random:.8}};
  const owner={id:'owner',name:'Chair',type:'EMPTY',mesh:null,parent:null,selected:true,matrix};
  const input={objects:[source,owner],meshes:{geometry:{positions:new Float32Array([1,2,3])}},
    instances:[{id:'dupli',source:'mesh',owner:'owner',matrix,visible:true,render_visible:true,shadow_visible:false,random:.125,color:[1,0,0,.5]}]};
  const output=expandDrawPlacements(input);
  assert.equal(input.objects.length,2,'no authored objects added');
  assert.equal(input.instances.length,1);
  assert.equal(output.objects.length,3);
  assert.equal(output.instances,undefined,'followers do not expand twice');
  const draw=output.objects[2];
  assert.equal(draw.mesh,source.mesh);assert.equal(draw.materials,source.materials);
  assert.equal(output.meshes,input.meshes,'no geometry allocation');
  assert.equal(draw.parent,'owner');assert.equal(draw.name,'Chair');assert.equal(draw.selected,true);
  assert.equal(draw.viewport_show_self,true);assert.equal(draw.visible,true);
  assert.equal(draw.shadow_visible,false);
  assert.equal(draw.object_info.random,.125);assert.deepEqual(draw.object_info.color,[1,0,0,.5]);assert.equal(source.object_info.random,.8);
  assert.equal(expandDrawPlacements(output),output);
});

test('missing source/owner refuses rather than inventing an unlinked draw',()=>{
  const source={id:'s',name:'Source',mesh:'g'};
  const placement={id:'i',source:'missing',owner:null,matrix,visible:true,render_visible:true,random:0,color:[1,1,1,1]};
  assert.throws(()=>expandDrawPlacements({objects:[source],instances:[placement]}),/Missing native instance source/);
  assert.throws(()=>expandDrawPlacements({objects:[source],instances:[{...placement,source:'s',owner:'missing'}]}),/Missing native instance owner/);
});
