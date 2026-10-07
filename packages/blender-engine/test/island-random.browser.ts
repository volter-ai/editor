/** Actual GPU comparison against independently rendered Cycles float32 data. */
import * as THREE from 'three';
import {applyPhysicalMaterial} from '../browser/three/blender-physical-material';
import {setMaterialGraph,prepareGraphGeometry} from '../browser/three/blender-graph-material';
import {geometryFromDrawArrays} from '../browser/three/blender-runtime-geometry';
import {islandGraph,islandDrawArrays} from './island-random-support';
import native from './fixtures/island-random.json';
export async function verifyIslandRandomParity() {
 const renderer=new THREE.WebGLRenderer();renderer.setSize(64,16);
 const target=new THREE.WebGLRenderTarget(64,16,{type:THREE.FloatType});
 const source=new THREE.MeshPhysicalMaterial();applyPhysicalMaterial(source);setMaterialGraph(source,islandGraph(),()=>null,true);
 const camera=new THREE.OrthographicCamera(-4,4,1,-1,.1,10);camera.position.z=5;camera.updateMatrixWorld(true);
 const cases=[];
 try {
  for(const c of native.cases){
   const geometry=geometryFromDrawArrays(islandDrawArrays(c)),scene=new THREE.Scene(),mesh=new THREE.Mesh(geometry,source);
   prepareGraphGeometry(mesh);scene.add(mesh);renderer.setRenderTarget(target);renderer.render(scene,camera);
   const pixels=c.rgba.map((expected,i)=>{const p=new Float32Array(4);renderer.readRenderTargetPixels(target,i*16+8,8,1,1,p);
    return {actual:Array.from(p),native:expected,error:Math.max(...Array.from(p,(v,j)=>Math.abs(v-expected[j]!)))};});
   const frame=new Float32Array(64*16*4);renderer.readRenderTargetPixels(target,0,0,64,16,frame);
   let maxInteriorVariation=0;
   for(let i=0;i<4;i++)for(let y=4;y<=12;y++)for(let x=i*16+4;x<=i*16+12;x++)
    maxInteriorVariation=Math.max(maxInteriorVariation,Math.abs(frame[(y*64+x)*4]!-pixels[i]!.actual[0]!));
   cases.push({name:c.name,pixels,maxInteriorVariation});geometry.dispose();
  }
  const maxAbsoluteError=Math.max(...cases.flatMap(c=>c.pixels.map(p=>p.error)));
  return {passed:maxAbsoluteError<6e-8 && cases.every(c=>c.maxInteriorVariation===0),maxAbsoluteError,
    oracle:{engine:native.engine,version:native.blender,build:native.build},cases};
 }finally{setMaterialGraph(source,null,()=>null,true);source.dispose();target.dispose();renderer.dispose();renderer.forceContextLoss();}
}
