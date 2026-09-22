/** Shared Three capture mechanics; this entry must not import host or contribution code. */
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/** Three renders ordinary offscreen targets in linear space without tone
 * mapping. Both scene and document captures resolve their half-float scene
 * target through this pass before reading display pixels.
 *
 * One pass lives for the page, shared by every capture. Its uniforms/defines
 * follow the supplied renderer on each render; reusing the pass avoids
 * compiling another full-screen program on every screenshot or thumbnail.
 */
let outputPass: OutputPass | null = null;
const unassociateAlphaUniform = { value: false };

export function viewportCaptureOutputPass(unassociateAlpha = false): OutputPass {
  if (!outputPass) {
    outputPass = new OutputPass();
    Object.assign(outputPass.uniforms, { unassociateAlpha: unassociateAlphaUniform });
    // Render targets contain associated linear RGB; PNG/ImageData require
    // straight display RGB. Resolve alpha before Three's own display transform.
    outputPass.material.fragmentShader = outputPass.material.fragmentShader
      .replace(
        'uniform sampler2D tDiffuse;',
        'uniform sampler2D tDiffuse;\nuniform bool unassociateAlpha;',
      )
      .replace(
        'gl_FragColor = texture2D( tDiffuse, vUv );',
        `gl_FragColor = texture2D( tDiffuse, vUv );
        if (unassociateAlpha && gl_FragColor.a != 0.0) {
          gl_FragColor.rgb /= gl_FragColor.a;
        }`,
      );
  }
  unassociateAlphaUniform.value = unassociateAlpha;
  return outputPass;
}
