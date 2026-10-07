/** Actual WebGL comparison against native Cycles emission renders. */
import * as THREE from 'three';
import {BlenderObjectInfoMaterials} from '../browser/three/blender-object-info-materials';
import {setMaterialGraph} from '../browser/three/blender-graph-material';
import {applyPhysicalMaterial} from '../browser/three/blender-physical-material';
import {particleInfoGraph} from './particle-info-support';
import native from './fixtures/particle-info.json';
export async function verifyParticleInfoParity() {
 const renderer=new THREE.WebGLRenderer({alpha:true});
 renderer.setSize(112,16);renderer.setClearColor(0,0);
 const target=new THREE.WebGLRenderTarget(112,16,{type:THREE.FloatType});
 const geometry=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene();
 const camera=new THREE.OrthographicCamera(-7,7,1,-1,.1,100);
 camera.position.z=10;
 const source=new THREE.MeshPhysicalMaterial();applyPhysicalMaterial(source);
 setMaterialGraph(source,particleInfoGraph(),()=>null,true);
 const owner=new BlenderObjectInfoMaterials();
 try {
  owner.begin();
  native.cases.forEach((c,i)=>{
   const mesh=new THREE.Mesh(geometry,source);mesh.position.x=i*2-6;
   mesh.userData['blenderObjectInfo']={color:[1,1,1,1],index:0,random:i/8,particle_random:c.rgba[0]};
   mesh.material=owner.get(source,mesh);scene.add(mesh);
  });owner.end();renderer.setRenderTarget(target);renderer.render(scene,camera);
  const cases=native.cases.map((c,i)=>{
   const pixel=new Float32Array(4);renderer.readRenderTargetPixels(target,i*16+8,8,1,1,pixel);
   const actual=Array.from(pixel);return {kind:c.kind,index:c.index,actual,native:c.rgba,
    error:Math.max(...actual.map((v,j)=>Math.abs(v-c.rgba[j]!)))};
  });
  const maxAbsoluteError=Math.max(...cases.map(c=>c.error));
  return {oracle:{version:native.version,build:native.build,engine:native.engine},passed:maxAbsoluteError<1e-6,maxAbsoluteError,cases};
 } finally {
  owner.clear();setMaterialGraph(source,null,()=>null,true);source.dispose();geometry.dispose();target.dispose();renderer.dispose();renderer.forceContextLoss();
 }
}
