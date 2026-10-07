/** Run through a registered public editor command. This exercises the actual
 * WebGL shaders and textures against native Blender's independently saved
 * float-buffer reference, including every supported Filmic and AgX look. */
import * as THREE from 'three';
import {BlenderDisplayTransform} from '../browser/three/blender-display-transform';
import native from './fixtures/display-colors.json';

export async function verifyDisplayParity(dataBase64: string) {
  const bytes = Uint8Array.from(atob(dataBase64), c=>c.charCodeAt(0));
  const renderer = new THREE.WebGLRenderer({alpha:true});
  renderer.setSize(native.colors.length, 1);
  const rgba = new Uint16Array(native.colors.length * 4);
  for (let i=0;i<native.colors.length;i++) {
    for (let k=0;k<3;k++) rgba[i*4+k] = THREE.DataUtils.toHalfFloat(native.colors[i]![k]!);
    rgba[i*4+3] = THREE.DataUtils.toHalfFloat(1);
  }
  const cases = [];
  try {
    for (const c of native.cases) {
      const transform = new BlenderDisplayTransform({...c, exposure:2**c.exposure}, bytes.buffer);
      try {
        const actual = transform.encodeFrame(renderer, rgba, native.colors.length, 1);
        let worst = 0;
        let location: unknown = null;
        for (let i=0;i<native.colors.length;i++) for (let k=0;k<3;k++) {
          const error = Math.abs(actual[i*4+k]! - Math.round(c.display[i]![k]! * 255));
          if (error>worst) { worst=error; location={color:native.colors[i],channel:k,actual:actual[i*4+k],native:c.display[i]![k]! * 255}; }
        }
        cases.push({transform:c.transform,look:c.look,exposure:c.exposure,gamma:c.gamma,worst,location});
      } finally { transform.dispose(); }
    }
    const transform = new BlenderDisplayTransform({transform:'Filmic',look:'Medium Contrast',exposure:1,gamma:1}, bytes.buffer);
    try {
      const opaque=transform.encodeFrame(renderer,new Uint16Array([0x3400,0x3800,0x3c00,0x3c00]),1,1);
      const translucent=transform.encodeFrame(renderer,new Uint16Array([0x3000,0x3400,0x3800,0x3800]),1,1);
      const alphaError = Math.max(...[0,1,2].map(k=>Math.abs(opaque[k]!-translucent[k]!)));
      return {oracle:{version:native.version,build:native.build},passed:cases.every(c=>c.worst<=1)&&alphaError<=1&&translucent[3]===128,
        maxByteError:Math.max(...cases.map(c=>c.worst)),cases,alpha:{alphaError,byte:translucent[3]}};
    } finally { transform.dispose(); }
  } finally { renderer.dispose(); renderer.forceContextLoss(); }
}
