/** Actual GPU against native Cycles' scene-linear Object Info renders. */
import * as THREE from 'three';
import {BlenderObjectInfoMaterials} from '../browser/three/blender-object-info-materials';
import {setMaterialGraph,materialGraph} from '../browser/three/blender-graph-material';
import {applyPhysicalMaterial} from '../browser/three/blender-physical-material';
import {objectInfoGraph, objectInfoSockets} from './object-info-support';
import native from './fixtures/object-info.json';

export async function verifyObjectInfoParity() {
  const renderer=new THREE.WebGLRenderer({alpha:true});
  renderer.setSize(64,16);renderer.setClearColor(0,0);
  const target=new THREE.WebGLRenderTarget(64,16,{type:THREE.FloatType});
  const geometry=new THREE.PlaneGeometry(2,2);
  const scene=new THREE.Scene(),root=new THREE.Group();scene.add(root);
  root.rotation.x=-Math.PI/2;
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,100);
  camera.position.set(-.5,7,-1.25);camera.up.set(0,0,-1);camera.lookAt(-.5,2,-1.25);
  const owner=new BlenderObjectInfoMaterials();
  const cases: {name:string;socket:string;actual:number[];native:number[];worst:number}[]=[];
  const sources:THREE.MeshPhysicalMaterial[]=[];
  const info=(c:typeof native.cases[number])=>({color:c.color,index:c.index,random:c.outputs.Random[0]!});
  try {
    renderer.setRenderTarget(target);
    for(let output=0;output<objectInfoSockets.length;output++) {
      const source=new THREE.MeshPhysicalMaterial();applyPhysicalMaterial(source);
      setMaterialGraph(source,objectInfoGraph(output),()=>null,true);sources.push(source);
      for(const c of native.cases) {
        const mesh=new THREE.Mesh(geometry,source);mesh.name=c.name;
        mesh.position.fromArray(c.location);mesh.userData['blenderObjectInfo']=info(c);
        owner.begin();mesh.material=owner.get(source,mesh);owner.end();root.add(mesh);
        renderer.render(scene,camera);
        const pixel=new Float32Array(4);renderer.readRenderTargetPixels(target,32,8,1,1,pixel);
        const actual=Array.from(pixel.slice(0,3));
        const socket=objectInfoSockets[output]!,expected=c.outputs[socket];
        cases.push({name:c.name,socket,actual,native:expected,worst:Math.max(...actual.map((v,i)=>Math.abs(v-expected[i]!)))});
        root.remove(mesh);
      }
    }
    // Four objects wearing one authored material in ONE render: this catches
    // Three's material upload caching, which isolated single-object frames hide.
    root.rotation.x=0;
    camera.left=-4;camera.right=4;camera.updateProjectionMatrix();
    camera.position.set(0,0,10);camera.up.set(0,1,0);camera.lookAt(0,0,0);
    const source=new THREE.MeshPhysicalMaterial();applyPhysicalMaterial(source);
    setMaterialGraph(source,objectInfoGraph(5),()=>null,true);sources.push(source);
    owner.begin();
    native.cases.forEach((c,i)=>{
      const mesh=new THREE.Mesh(geometry,source);mesh.name=c.name;mesh.position.x=i*2-3;
      mesh.userData['blenderObjectInfo']=info(c);mesh.material=owner.get(source,mesh);root.add(mesh);
    });owner.end();
    renderer.render(scene,camera);
    const shared=native.cases.map((c,i)=>{
      const pixel=new Float32Array(4);renderer.readRenderTargetPixels(target,i*16+8,8,1,1,pixel);
      const actual=pixel[0]!;
      return {name:c.name,actual,native:c.outputs.Random[0]!,error:Math.abs(actual-c.outputs.Random[0]!)};
    });
    const maxAbsoluteError=Math.max(...cases.map(c=>c.worst),...shared.map(c=>c.error));
    const changed=objectInfoGraph(2);
    setMaterialGraph(source,changed,()=>null,false);
    owner.refresh();renderer.render(scene,camera);
    for(let i=0;i<120 && materialGraph(source)?.key!==changed.key;i++)
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
    const linked=materialGraph(source)?.key===changed.key;
    owner.begin();for(const child of root.children) {
      const mesh=child as THREE.Mesh;mesh.material=owner.get(source,mesh);
    }owner.end();renderer.render(scene,camera);
    const edited=new Float32Array(4);renderer.readRenderTargetPixels(target,8,8,1,1,edited);
    const asyncEdit={passed:linked && Math.abs(edited[0]!-.625)<1e-6,linked,alpha:edited[0]};
    return {oracle:{version:native.version,build:native.build,engine:native.engine},passed:maxAbsoluteError<1e-6&&asyncEdit.passed,
      maxAbsoluteError,cases,shared,asyncEdit};
  } finally {
    owner.clear();for(const source of sources){setMaterialGraph(source,null,()=>null,true);source.dispose();}
    geometry.dispose();target.dispose();renderer.dispose();renderer.forceContextLoss();
  }
}
