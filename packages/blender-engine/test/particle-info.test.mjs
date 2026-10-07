import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const native=JSON.parse(await readFile(new URL('./fixtures/particle-info.json',import.meta.url)));
const built=await build({stdin:{contents:`export {particleInfoGraph} from './particle-info-support';
export {BlenderObjectInfoMaterials} from '../browser/three/blender-object-info-materials';
export {setMaterialGraph,paletteGraphs} from '../browser/three/blender-graph-material';
export {applyPhysicalMaterial} from '../browser/three/blender-physical-material';
export {MeshPhysicalMaterial,Mesh,BoxGeometry,ShaderLib} from 'three';`,
resolveDir:fileURLToPath(new URL('./',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
const {particleInfoGraph,BlenderObjectInfoMaterials,setMaterialGraph,paletteGraphs,applyPhysicalMaterial,MeshPhysicalMaterial,Mesh,BoxGeometry,ShaderLib}=
await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].contents).toString('base64'));
const source=fileURLToPath(new URL('../browser/session.py',import.meta.url));
function python(code) {
 const result=spawnSync('python3',['-c',`import ast,json,sys,types
nodes=ast.parse(open(sys.argv[1]).read()).body
scope={'json':json}
for name in ['_particle_info_random','_depsgraph_placements']:
 fn=next(n for n in nodes if isinstance(n,ast.FunctionDef) and n.name==name)
 exec(compile(ast.Module(body=[fn],type_ignores=[]),'native-export','exec'),scope)
${code}`,source,JSON.stringify(native.cases)],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
}
test('Particle Random matches native Cycles for parents, ordinary objects and children',()=>{
 const values=python(`cases=json.loads(sys.argv[2])
print(json.dumps([scope['_particle_info_random'](c['index'] if c['kind']=='parent' else 0) for c in cases]))`);
 native.cases.forEach((c,i)=>assert.equal(values[i],c.rgba[0],`${c.kind} ${c.index}`));
});
test('native placement export selects parent index and dummy record for children and collections',()=>{
 const rows=python(`S=types.SimpleNamespace
source=S(name='Source',type='MESH',visible_shadow=True,hide_render=False)
owner=S(name='Emitter',visible_shadow=True,hide_render=False)
object=S(original=source,color=[1,1,1,1])
base=dict(is_instance=True,show_self=True,object=object,instance_object=None,parent=S(original=owner),random_id=123,matrix_world=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]])
instances=[S(**base,persistent_id=[index],particle_system=psys) for index,psys in [(2,S(particles=[None]*8)),(8,S(particles=[None]*8)),(5,None)]]
frame={'objects':[{'name':'Source','id':'source','mesh':'mesh'},{'name':'Emitter','id':'owner','render_visible':True}]}
scope['bpy']=S(data=S(objects=S(get=lambda name: source if name=='Source' else owner)))
print(json.dumps(scope['_depsgraph_placements'](frame,S(object_instances=instances))))`);
 assert.equal(rows[0].particle_random,native.cases.find(c=>c.kind==='parent'&&c.index===2).rgba[0]);
 assert.equal(rows[1].particle_random,native.cases[0].rgba[0]);
 assert.equal(rows[2].particle_random,native.cases[0].rgba[0]);
 assert.notEqual(rows[0].random,rows[0].particle_random,'distinct shader inputs');
});
test('shared authored Particle graphs retain per-draw uniforms and reject missing inputs or unsupported sockets',()=>{
 const source=new MeshPhysicalMaterial();applyPhysicalMaterial(source);
 setMaterialGraph(source,particleInfoGraph(),()=>null,true);
 assert.equal(paletteGraphs([source,source]),null,'palettes cannot flatten particle inputs');
 const geometry=new BoxGeometry(),owner=new BlenderObjectInfoMaterials();
 const meshes=native.cases.slice(1,4).map(c=>{
  const mesh=new Mesh(geometry,source);mesh.userData.blenderObjectInfo={color:[1,1,1,1],index:0,random:.125,particle_random:c.rgba[0]};return mesh;
 });
 owner.begin();const copies=meshes.map(m=>owner.get(source,m));owner.end();
 const shaders=copies.map(m=>{const s={uniforms:{},vertexShader:ShaderLib.physical.vertexShader,fragmentShader:ShaderLib.physical.fragmentShader};m.onBeforeCompile(s,{});return s;});
 assert.equal(new Set(copies).size,3);
 shaders.forEach((s,i)=>assert.equal(s.uniforms.blenderParticleRandom.value,native.cases[i+1].rgba[0]));
 const versions=copies.map(m=>m.version);
 meshes[0].userData.blenderObjectInfo.particle_random=.5;
 owner.refresh();assert.equal(shaders[0].uniforms.blenderParticleRandom.value,.5);
 assert.deepEqual(copies.map(m=>m.version),versions,'value edits do not recompile');
 delete meshes[0].userData.blenderObjectInfo.particle_random;
 assert.throws(()=>owner.refresh(),/Particle Info Random input missing/);
 for(const output of [0,2,3,4,5,6,7]) assert.throws(()=>particleInfoGraph(output),/Particle Info output .* is not compiled/);
 owner.clear();geometry.dispose();source.dispose();
});

test('identical particle-only inputs share a draw without flattening distinct particles',()=>{
 const source=new MeshPhysicalMaterial();applyPhysicalMaterial(source);
 setMaterialGraph(source,particleInfoGraph(),()=>null,true);
 const geometry=new BoxGeometry(),owner=new BlenderObjectInfoMaterials();
 const meshes=[0,1,2].map(()=>{const m=new Mesh(geometry,source);m.userData.blenderObjectInfo={color:[1,1,1,1],index:0,random:.1,particle_random:.86};return m;});
 owner.begin();let copies=meshes.map(m=>owner.get(source,m));owner.end();
 assert.equal(new Set(copies).size,1,'child particles share their native default input');
 meshes[0].userData.blenderObjectInfo.particle_random=.295;
 assert.equal(owner.needsRemap(),true);
 owner.begin();copies=meshes.map(m=>owner.get(source,m));owner.end();
 assert.equal(owner.needsRemap(),false);
 assert.equal(copies[1],copies[2]);assert.notEqual(copies[0],copies[1]);
 owner.refresh();
 const shader={uniforms:{},vertexShader:ShaderLib.physical.vertexShader,fragmentShader:ShaderLib.physical.fragmentShader};
 copies[1].onBeforeCompile(shader,{});
 assert.equal(shader.uniforms.blenderParticleRandom.value,.86,'shared draw no longer follows the edited representative');
 owner.clear();geometry.dispose();source.dispose();
});
