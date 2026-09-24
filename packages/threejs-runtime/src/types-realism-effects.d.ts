declare module 'realism-effects' {
  import type { Effect, EffectComposer, Pass } from 'postprocessing';
  import type { Camera, Scene } from 'three';

  export class VelocityDepthNormalPass extends Pass {
    constructor(scene: Scene, camera: Camera);
  }

  export class VelocityPass extends Pass {
    constructor(scene: Scene, camera: Camera);
  }

  interface SSGIOptions {
    intensity?: number;
    exponent?: number;
    distance?: number;
    thickness?: number;
    maxRoughness?: number;
    specularOnly?: boolean;
    diffuseOnly?: boolean;
  }

  export class SSGIEffect extends Effect {
    constructor(
      scene: Scene,
      camera: Camera,
      velocityDepthNormalPass: VelocityDepthNormalPass,
      options?: SSGIOptions,
    );
  }

  export class SSREffect extends SSGIEffect {
    constructor(
      scene: Scene,
      camera: Camera,
      velocityDepthNormalPass: VelocityDepthNormalPass,
      options?: SSGIOptions,
    );
  }

  interface MotionBlurOptions {
    intensity?: number;
    jitter?: number;
    samples?: number;
  }

  export class MotionBlurEffect extends Effect {
    constructor(velocityPass: VelocityDepthNormalPass, options?: MotionBlurOptions);
  }

  interface AOOptions {
    spp?: number;
    distance?: number;
    distancePower?: number;
    power?: number;
  }

  export class HBAOEffect extends Effect {
    constructor(composer: EffectComposer, camera: Camera, scene: Scene, options?: AOOptions);
  }
}
