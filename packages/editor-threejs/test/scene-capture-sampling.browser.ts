import * as THREE from 'three';
import { captureSceneLinear } from '../src/capture/scene';

/** Independent analytic radiance: each output pixel covers equal red and blue
 * emitting halves. Resolve scene-linear samples before readback/display. */
export function verifyLinearCaptureSampling() {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-.5,.5,.5,-.5,.1,10);
  camera.position.z=2;
  const geometry = new THREE.PlaneGeometry(.5,1);
  const materials = [new THREE.MeshBasicMaterial({color:0xff0000}),new THREE.MeshBasicMaterial({color:0x0000ff})];
  materials.forEach((material,i)=>{const mesh=new THREE.Mesh(geometry,material);mesh.position.x=i*.5-.25;scene.add(mesh);});
  try {
    const frame=captureSceneLinear(scene,camera,{width:1,height:1});
    const actual=Array.from(frame.pixels,THREE.DataUtils.fromHalfFloat);
    const expected=[.5,0,.5,1];
    const error=Math.max(...actual.map((value,i)=>Math.abs(value-expected[i]!)));
    return {passed:error===0,actual,expected,error,width:frame.width,height:frame.height};
  } finally { geometry.dispose();materials.forEach(material=>material.dispose()); }
}
