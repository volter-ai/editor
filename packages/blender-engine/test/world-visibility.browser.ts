/** Actual WebGL direct-world visibility checks against the native closed-room
 * oracle, plus an open control to reject globally dimmed lighting. */
import * as THREE from 'three';
import {BlenderWorldVisibility,bindWorldVisibility} from '../browser/three/blender-world-visibility';
import {applyPhysicalMaterial} from '../browser/three/blender-physical-material';
import {fitModelDirectionalShadow} from '../browser/three/blender-runtime-shadows';
export async function verifyWorldVisibility() {
 const renderer=new THREE.WebGLRenderer();renderer.setSize(32,32);renderer.setPixelRatio(2);renderer.outputColorSpace=THREE.LinearSRGBColorSpace;
 const world=new THREE.DataTexture(new Float32Array([1,1,1,1,1,1,1,1]),2,1,THREE.RGBAFormat,THREE.FloatType);
 world.mapping=THREE.EquirectangularReflectionMapping;world.needsUpdate=true;
 const scene=new THREE.Scene();scene.environment=world;
 const root=new THREE.Group();scene.add(root);
 const material=new THREE.MeshPhysicalMaterial({color:new THREE.Color().setRGB(.8,.8,.8),roughness:1,side:THREE.DoubleSide});
 applyPhysicalMaterial(material);
 const geometry=new THREE.BoxGeometry(4,4,4),room=new THREE.Mesh(geometry,material);
 room.castShadow=true;root.add(room);root.updateMatrixWorld(true);
 const camera=new THREE.PerspectiveCamera(50,1,.1,10);camera.updateMatrixWorld(true);
 const visibility=new BlenderWorldVisibility();bindWorldVisibility(material,visibility);
 const output=new THREE.WebGLRenderTarget(32,32,{type:THREE.FloatType});
 const pixel=()=>{const p=new Float32Array(4);renderer.readRenderTargetPixels(output,16,16,1,1,p);return Array.from(p);};
 const draw=()=>{root.updateMatrixWorld(true);visibility.sync([room],world,root,true);visibility.prepare(renderer);
  renderer.setRenderTarget(output);renderer.render(scene,camera);return pixel();};
 try {
  const closed=draw(),closedPasses=visibility.diagnostics().passes;
  const cached=draw(),cachedPasses=visibility.diagnostics().passes;
  room.castShadow=false;const noShadowCaster=draw();
  room.castShadow=true;
  // Replace the enclosure with a single plane in front of the camera.
  const plane=new THREE.PlaneGeometry(4,4);room.geometry=plane;room.position.z=-2;
  const open=draw();room.position.x=1;const moved=draw();
  plane.dispose();
  // A solar light is created after sky preparation, before the photograph's
  // first draw. An offset closed room exposes fitting in stale light axes.
  const solarScene=new THREE.Scene(),solarGeometry=new THREE.BoxGeometry(4,4,4);
  const solarMaterial=new THREE.MeshPhysicalMaterial({color:new THREE.Color().setRGB(.8,.8,.8),roughness:1,side:THREE.DoubleSide});
  const solarRoom=new THREE.Mesh(solarGeometry,solarMaterial);solarRoom.position.set(20,0,20);
  solarRoom.castShadow=solarRoom.receiveShadow=true;solarScene.add(solarRoom);solarRoom.updateMatrixWorld(true);
  const sun=new THREE.DirectionalLight(0xffffff,1);sun.castShadow=true;sun.position.set(.4,.8,.2);
  sun.shadow.mapSize.set(512,512);solarScene.add(sun,sun.target);
  const solarCamera=new THREE.PerspectiveCamera(50,1,.1,10);solarCamera.position.copy(solarRoom.position);
  solarCamera.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(solarRoom),receivers=[bounds.min.clone(),bounds.max.clone(),
    new THREE.Vector3(bounds.min.x,bounds.max.y,bounds.max.z),new THREE.Vector3(bounds.max.x,bounds.min.y,bounds.min.z)];
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  const drawSun=()=>{fitModelDirectionalShadow(sun,receivers,[bounds]);renderer.setRenderTarget(output);
    renderer.render(solarScene,solarCamera);return pixel();};
  const firstSun=drawSun(),settledSun=drawSun();
  solarGeometry.dispose();solarMaterial.dispose();sun.shadow.dispose();
  const passed=closed.slice(0,3).every(x=>Math.abs(x)<1/255) && cached.slice(0,3).every(x=>Math.abs(x)<1/255) &&
   open.slice(0,3).every(x=>x>.7) && noShadowCaster.slice(0,3).every(x=>x>.7) && cachedPasses===closedPasses;
  return {passed:passed && firstSun.slice(0,3).every(x=>Math.abs(x)<1/255) &&
   firstSun.every((x,i)=>Math.abs(x-settledSun[i]!)<1/255),closed,cached,open,noShadowCaster,moved,
   firstSun,settledSun,closedPasses,cachedPasses,diagnostics:visibility.diagnostics()};
 } finally {
  visibility.dispose();geometry.dispose();material.dispose();world.dispose();output.dispose();renderer.dispose();renderer.forceContextLoss();
 }
}
