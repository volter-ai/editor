import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const native=JSON.parse(await readFile(new URL('./fixtures/object-info.json',import.meta.url)));
const built=await build({stdin:{contents:`export {objectInfoGraph} from './object-info-support';
export {BlenderObjectInfoMaterials} from '../browser/three/blender-object-info-materials';
export {setMaterialGraph} from '../browser/three/blender-graph-material';
export {applyPhysicalMaterial} from '../browser/three/blender-physical-material';
export {MeshPhysicalMaterial,Mesh,BoxGeometry,ShaderLib} from 'three';`,
resolveDir:fileURLToPath(new URL('./',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
const {objectInfoGraph,BlenderObjectInfoMaterials,setMaterialGraph,applyPhysicalMaterial,MeshPhysicalMaterial,Mesh,BoxGeometry,ShaderLib}=
await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].contents).toString('base64'));

test('ordinary-object Random matches independent native Cycles, including UTF-8 names',()=>{
  const source=fileURLToPath(new URL('../browser/session.py',import.meta.url));
  const result=spawnSync('python3',['-c',`import ast,json,sys
tree=ast.parse(open(sys.argv[1]).read())
fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='_object_info_random')
scope={}
exec(compile(ast.Module(body=[fn],type_ignores=[]),'random','exec'),scope)
print(json.dumps([scope['_object_info_random'](n) for n in json.loads(sys.argv[2])]))`,source,JSON.stringify(native.cases.map(c=>c.name))],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const values=JSON.parse(result.stdout);
  native.cases.forEach((c,i)=>assert.equal(values[i],c.outputs.Random[0],c.name));
});

test('shared authored materials own distinct Object Info uniforms, update without recompiling, and release unused draws',()=>{
  const source=new MeshPhysicalMaterial();applyPhysicalMaterial(source);
  setMaterialGraph(source,objectInfoGraph(5),()=>null,true);
  const geometry=new BoxGeometry();
  const meshes=native.cases.slice(0,2).map(c=>{
    const mesh=new Mesh(geometry,source);
    mesh.name=c.name;mesh.userData.blenderObjectInfo={color:c.color,index:c.index,random:c.outputs.Random[0]};return mesh;
  });
  const owner=new BlenderObjectInfoMaterials();owner.begin();
  const copies=meshes.map(m=>owner.get(source,m));owner.end();
  assert.notEqual(copies[0],copies[1]);assert.notEqual(copies[0],source);
  const shaders=copies.map(m=>{const shader={uniforms:{},vertexShader:ShaderLib.physical.vertexShader,fragmentShader:ShaderLib.physical.fragmentShader};m.onBeforeCompile(shader,{});return shader;});
  assert.notEqual(shaders[0].uniforms.blenderObjectIndexRandom,shaders[1].uniforms.blenderObjectIndexRandom);
  assert.equal(shaders[0].uniforms.blenderObjectIndexRandom.value.y,native.cases[0].outputs.Random[0]);
  assert.equal(shaders[1].uniforms.blenderObjectIndexRandom.value.y,native.cases[1].outputs.Random[0]);
  const versions=copies.map(m=>m.version);
  meshes[0].userData.blenderObjectInfo.random=.25;
  owner.refresh();owner.refresh();
  assert.deepEqual(copies.map(m=>m.version),versions,'input edits do not rebuild programs');
  assert.equal(shaders[0].uniforms.blenderObjectIndexRandom.value.y,.25);
  assert.equal(shaders[1].uniforms.blenderObjectIndexRandom.value.y,native.cases[1].outputs.Random[0]);
  setMaterialGraph(source,objectInfoGraph(2),()=>null,false);
  assert.doesNotThrow(()=>owner.refresh(),'keep the previous graph while its replacement compiles');
  assert.equal(owner.needsRemap(),false);
  setMaterialGraph(source,objectInfoGraph(2),()=>null,true);
  assert.equal(owner.needsRemap(),true,'a completed graph edit remaps before the next draw');
  let released=0;copies[0].addEventListener('dispose',()=>released++);
  owner.begin();owner.get(source,meshes[1]);owner.end();assert.equal(released,1);
  owner.clear();geometry.dispose();source.dispose();
});

test('Object Info refuses missing native inputs instead of inventing a shared random value',()=>{
  const source=new MeshPhysicalMaterial();applyPhysicalMaterial(source);
  setMaterialGraph(source,objectInfoGraph(5),()=>null,true);
  const owner=new BlenderObjectInfoMaterials(),mesh=new Mesh(new BoxGeometry(),source);
  assert.throws(()=>owner.get(source,mesh),/Object Info inputs missing/);
  owner.clear();mesh.geometry.dispose();source.dispose();
});
