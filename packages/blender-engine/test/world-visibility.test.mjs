import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const result=await build({stdin:{contents:`export * from './blender-world-visibility';export {Mesh,BoxGeometry,MeshBasicMaterial,Group,Texture,Vector4} from 'three';`,
 resolveDir:fileURLToPath(new URL('../browser/three/',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
const {BlenderWorldVisibility,Mesh,BoxGeometry,MeshBasicMaterial,Group,Texture}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].contents).toString('base64'));
function fixture() {
 const visibility=new BlenderWorldVisibility(),root=new Group(),geometry=new BoxGeometry(4,4,4),material=new MeshBasicMaterial(),world=new Texture();
 const mesh=new Mesh(geometry,material);mesh.castShadow=true;root.add(mesh);root.updateMatrixWorld(true);
 let target=null,draws=0;const renderer={autoClear:false,shadowMap:{enabled:true},
  getRenderTarget:()=>target,setRenderTarget:value=>{target=value;},clear(){},render(){draws++;}};
 return {visibility,root,geometry,material,world,mesh,renderer,draws:()=>draws,target:()=>target,
  sync(){root.updateMatrixWorld(true);visibility.sync([mesh],world,root,true);},
  dispose(){visibility.dispose();geometry.dispose();material.dispose();world.dispose();}};
}
test('world visibility retains authored vertices/index order and caches static and camera-only frames',()=>{
 const f=fixture(),positions=f.geometry.attributes.position.array.slice(),indices=f.geometry.index.array.slice();
 try {
  f.sync();f.visibility.prepare(f.renderer);assert.equal(f.draws(),16);
  f.sync();f.visibility.prepare(f.renderer);assert.equal(f.draws(),16);
  f.mesh.position.x=3;f.sync();f.visibility.prepare(f.renderer);assert.equal(f.draws(),48);
  const staticPasses=f.visibility.diagnostics().staticPasses;
  f.mesh.position.x=2.5;f.sync();f.visibility.prepare(f.renderer);
  assert.equal(f.visibility.diagnostics().staticPasses,staticPasses,'later actor poses reuse the static environment atlas');
  assert.equal(f.visibility.diagnostics().dynamicPasses,32);
  assert.deepEqual(f.geometry.attributes.position.array,positions);assert.deepEqual(f.geometry.index.array,indices);
  f.mesh.castShadow=false;f.sync();f.visibility.prepare(f.renderer);assert.equal(f.visibility.diagnostics().casters,0);
  f.mesh.castShadow=true;f.root.visible=false;f.sync();f.visibility.prepare(f.renderer);assert.equal(f.visibility.diagnostics().casters,0);
 } finally {f.dispose();}
});
test('failed atlas drawing restores the target and renderer and remains retryable',()=>{
 const f=fixture(),target={owned:'photograph'};f.renderer.setRenderTarget(target);
 try {
  f.sync();f.renderer.render=()=>{throw new Error('depth draw failed');};
  assert.throws(()=>f.visibility.prepare(f.renderer),/depth draw failed/);
  assert.equal(f.target(),target);assert.equal(f.renderer.autoClear,false);assert.equal(f.renderer.shadowMap.enabled,true);
  assert.equal(f.visibility.diagnostics().dirty,true);assert.equal(f.visibility.diagnostics().passes,0);
  f.renderer.render=()=>{};f.visibility.prepare(f.renderer);assert.equal(f.visibility.diagnostics().dirty,false);
  f.visibility.dispose();f.visibility.sync([],f.world,f.root,true);f.visibility.prepare(f.renderer);
  assert.equal(f.visibility.diagnostics().vertices,0,'a new empty scene retains no old caster geometry');
 } finally {f.dispose();}
});
