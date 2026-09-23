import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const result=await build({stdin:{contents:`export * from './blender-physical-material'; export * from './blender-texture-samplers'; export * from './blender-runtime-geometry'; export {BlenderRuntimeView} from './blender-runtime-view'; export {MeshPhysicalMaterial,ShaderLib,Texture,BufferGeometry,RepeatWrapping,ClampToEdgeWrapping} from 'three';`,
  resolveDir:fileURLToPath(new URL('../browser/three/',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
const {applyPhysicalMaterial,physicalMaterialSchema,MeshPhysicalMaterial,ShaderLib,BlenderTextureSamplers,Texture,BufferGeometry,RepeatWrapping,ClampToEdgeWrapping,bindNamedUvChannels,drawArraysFromColumns,geometryFromDrawArrays,BlenderRuntimeView}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].contents).toString('base64'));
const values={coat:0.8,coat_roughness:0.12,coat_ior:1.8,coat_tint:[0.2,0.4,0.6],
  sheen:0.7,sheen_roughness:0.35,sheen_tint:[0.5,0.2,0.1],anisotropy:0.6,anisotropy_rotation:0.25,
  specular_level:0.75,specular_tint:[0.7,0.8,0.9],film_thickness:450,film_ior:1.4};
test('Principled physical sockets map with turns and nanometres intact',()=>{
  const material=new MeshPhysicalMaterial();
  applyPhysicalMaterial(material,physicalMaterialSchema.parse(values));
  assert.equal(material.clearcoat,0.8);assert.equal(material.clearcoatRoughness,0.12);
  assert.equal(material.sheen,0.7);assert.deepEqual(material.sheenColor.toArray(),[0.5,0.2,0.1]);
  assert.equal(material.anisotropy,0.6);assert.equal(material.anisotropyRotation,Math.PI/2);
  assert.equal(material.specularIntensity,1.5);assert.equal(material.iridescence,1);
  assert.deepEqual(material.iridescenceThicknessRange,[450,450]);assert.equal(material.iridescenceIOR,1.4);
});
test('shader carries coat IOR, absorption, normal strength and grazing reflection',()=>{
  const material=new MeshPhysicalMaterial();applyPhysicalMaterial(material,values);
  const shader={uniforms:{},fragmentShader:ShaderLib.physical.fragmentShader};
  material.onBeforeCompile(shader,{});
  assert.equal(shader.uniforms.blenderCoatIor.value,1.8);
  assert(shader.fragmentShader.includes('blenderCoatIor - 1.0'));
  assert(shader.fragmentShader.includes('pow(max(blenderCoatTint'));
  assert(shader.fragmentShader.includes('material.specularF90 = 1.0;'));
  assert(shader.fragmentShader.includes('mapN.z = mix(1.0, mapN.z'));
  assert(shader.fragmentShader.includes('mix(blenderBaseNormal'));
  applyPhysicalMaterial(material,{...values,coat_ior:2});
  assert.equal(shader.uniforms.blenderCoatIor.value,2,'live uniform must follow edits');
});
test('restoration resets every physical feature without retaining old frame values',()=>{
  const material=new MeshPhysicalMaterial();applyPhysicalMaterial(material,values);applyPhysicalMaterial(material);
  assert.equal(material.clearcoat,0);assert.equal(material.sheen,0);assert.equal(material.anisotropy,0);
  assert.equal(material.iridescence,0);assert.equal(material.specularIntensity,1);
  assert.deepEqual(material.specularColor.toArray(),[1,1,1]);
});
test('Clip applies to each sampler independently; Base Color does not connect Alpha',()=>{
  const material=new MeshPhysicalMaterial();applyPhysicalMaterial(material,values,{map:true,normal:true});
  const shader={uniforms:{},fragmentShader:ShaderLib.physical.fragmentShader};material.onBeforeCompile(shader,{});
  assert.equal(shader.uniforms.blenderMapClip.value,true);
  assert.equal(shader.uniforms.blenderRoughnessClip.value,false);
  assert(shader.fragmentShader.includes('blenderImageSample(map, vMapUv, blenderMapClip)'));
  assert(shader.fragmentShader.includes('blenderImageSample(normalMap, vNormalMapUv, blenderNormalClip)'));
  assert(shader.fragmentShader.includes('blenderImageSample(roughnessMap, vRoughnessMapUv, blenderRoughnessClip)'));
  assert(shader.fragmentShader.includes('diffuseColor.rgb *= sampledDiffuseColor.rgb;'));
  applyPhysicalMaterial(material,values);assert.equal(shader.uniforms.blenderMapClip.value,false);
});
test('same image has independent samplers, follows repaint, avoids redundant uploads',()=>{
  const samplers=new BlenderTextureSamplers(), source=new Texture({width:1,height:1});
  const repeat=samplers.get('a',source,'REPEAT'),clip=samplers.get('b',source,'CLIP');
  assert.notEqual(repeat,clip);assert.equal(repeat.source,clip.source);
  assert.equal(repeat.wrapS,RepeatWrapping);assert.equal(clip.wrapS,ClampToEdgeWrapping);
  const version=repeat.version;
  assert.equal(samplers.get('a',source,'REPEAT').version,version);
  source.needsUpdate=true;
  assert.equal(samplers.get('a',source,'REPEAT').version,version+1);
  assert.equal(samplers.get('a',source,'REPEAT').version,version+1);
  let disposed=0;repeat.addEventListener('dispose',()=>disposed++);
  samplers.delete('a');assert.equal(disposed,1);samplers.clear();assert.equal(disposed,1);
});
test('PNG decode uploads surviving clones but never disposed ones',async()=>{
  const samplers=new BlenderTextureSamplers(), source=new Texture();
  let resolve;const ready=new Promise(r=>resolve=r);
  const kept=samplers.get('kept',source,'REPEAT',ready),removed=samplers.get('removed',source,'CLIP',ready);
  samplers.delete('removed');const removedVersion=removed.version;
  source.image={width:1,height:1};source.needsUpdate=true;resolve();await ready;
  assert.equal(kept.image,source.image);assert(kept.version>0);assert.equal(removed.version,removedVersion);
  const version=kept.version;samplers.get('kept',source,'REPEAT',ready);assert.equal(kept.version,version);
  samplers.clear();
});
test('named UV seams split geometry without changing Blender evaluated normals',()=>{
  const layers=Array.from({length:8},(_,i)=>({name:`Layer${i}`,type:'FLOAT2',domain:'CORNER',data:new Float32Array(12)}));
  layers[7].data[6]=1; layers[7].data[7]=1;
  const c={co:new Float64Array([0,0,0,1,0,0,1,1,0,0,1,0]),
    faceStart:new Uint32Array([0,3,6]),corner:new Uint32Array([0,1,2,0,2,3]),
    cornerEdge:new Int32Array([0,1,2,2,3,4]),edge:new Uint32Array([0,1,1,2,2,0,2,3,3,0]),
    edgeSharp:new Uint8Array(5),material:new Uint32Array(2),smooth:new Uint8Array([1,1]),
    cornerNormal:new Float32Array([0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1]),
    attributes:layers,activeUv:'Layer0',renderUv:'Layer0'};
  const drawn=drawArraysFromColumns(c,'probe');
  const split=Array.from(drawn.sourceVertex).flatMap((v,i)=>v===0?[i]:[]);
  assert.equal(split.length,2);
  for(const i of split) assert.deepEqual(Array.from(drawn.normals.slice(i*3,i*3+3)),[0,0,1]);
  const geometry=geometryFromDrawArrays(drawn);
  assert.equal(geometry.userData.blenderUvChannels.Layer7,8);
  assert(geometry.getAttribute('uv8'));
  const selected=split.map(i=>Array.from(drawn.uvLayers[7].data.slice(i*2,i*2+2)));
  assert.deepEqual(selected,[[0,0],[1,1]]);
  geometry.dispose();
});
test('shared materials resolve named channels separately for each mesh and after edits',()=>{
  const samplers=new BlenderTextureSamplers(),source=new Texture({width:1,height:1}),material=new MeshPhysicalMaterial();
  material.map=samplers.get('color',source,'REPEAT',undefined,'Paint');
  material.normalMap=samplers.get('normal',source,'REPEAT',undefined,'Normal');
  const first=new BufferGeometry(),second=new BufferGeometry();
  first.userData.blenderUvChannels={Paint:8,Normal:2};second.userData.blenderUvChannels={Paint:1,Normal:3};
  bindNamedUvChannels(material,first);assert.equal(material.map.channel,8);assert.equal(material.normalMap.channel,2);
  bindNamedUvChannels(material,second);assert.equal(material.map.channel,1);assert.equal(material.normalMap.channel,3);
  const version=material.version;bindNamedUvChannels(material,second);assert.equal(material.version,version);
  samplers.get('color',source,'REPEAT');bindNamedUvChannels(material,second);assert.equal(material.map.channel,0);
  samplers.clear();material.dispose();first.dispose();second.dispose();
});
test('revision-owned render snapshots preserve all named UVs and native normals',()=>{
  const view=new BlenderRuntimeView();
  const uvLayers=Array.from({length:8},(_,i)=>({name:`Layer${i}`,data:new Float32Array([i,0,i,1,i,2])}));
  const normals=new Float32Array([0,0,1,0,0,1,0,0,1]);
  view.applyFrame({session:'uv-snapshot',revision:1,active:'probe',mode:'OBJECT',materials:{},
    meshes:{probe:{hash:'probe',positions:new Float32Array([0,0,0,1,0,0,0,1,0]),normals,uv:new Float32Array(6),
      uvLayers,indices:new Uint32Array([0,1,2]),groups:[{start:0,count:3,materialIndex:0}]}},
    objects:[{id:'probe',name:'probe',type:'MESH',mesh:'probe',materials:[],matrix:[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],
      visible:true,selected:true,parent:null}]});
  const capture=view.captureSnapshot(), mesh=capture.root.getObjectByName('probe');
  assert(mesh?.isMesh);
  for(let i=0;i<8;i++) assert.deepEqual(Array.from(mesh.geometry.getAttribute(`uv${i+1}`).array),Array.from(uvLayers[i].data));
  assert.deepEqual(Array.from(mesh.geometry.getAttribute('normal').array),Array.from(normals));
  const current=view.root.getObjectByName('probe');assert.notEqual(mesh.geometry,current.geometry);
  current.geometry.getAttribute('uv8').setX(0,99);
  assert.equal(mesh.geometry.getAttribute('uv8').getX(0),7);
  capture.dispose();view.dispose();
});
