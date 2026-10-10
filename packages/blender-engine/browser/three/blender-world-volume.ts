/** Homogeneous World transport, in scene-linear radiance. Surface depth bounds
 * the camera segment; a World with no hit is unbounded, not a camera-far fog box.
 * Absorption/emission are analytic. Local-light single scattering is numerical;
 * multiple scattering and heterogeneous fields are not implemented here. */
import * as THREE from 'three';
import type {WorldData, WorldExpression} from './blender-runtime-lighting';
import {worldField} from './world-field-sampler';

export interface WorldMedium {
  extinction: THREE.Vector3;
  emission: THREE.Vector3;
  lobes: {coefficient: THREE.Vector3; g: number; alpha: number}[];
}

function constant(expression: WorldExpression): number | THREE.Vector3 {
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if ('kind' in value && ['direction', 'window', 'sky'].includes(String(value.kind)))
      throw new Error(`World volume spatial input ${value.kind} is not implemented`);
    for (const child of Object.values(value)) visit(child);
  };
  visit(expression);
  const value = worldField(expression)(new THREE.Vector3());
  const components = typeof value === 'number' ? [value] : value.toArray();
  if (!components.every(Number.isFinite)) throw new Error('World volume input is not finite');
  return value;
}
function scalar(expression: WorldExpression): number {
  const value = constant(expression);
  if (typeof value !== 'number') throw new Error('World volume scalar input resolved to a color');
  return Math.max(0, value);
}
function color(expression: WorldExpression): THREE.Vector3 {
  const value = constant(expression);
  return (typeof value === 'number' ? new THREE.Vector3().setScalar(value) : value.clone()).max(new THREE.Vector3());
}

// Blender IMB_colormanagement_blackbody_temperature_to_rgb, default linear Rec.709.
// Coefficients from source/blender/imbuf/intern/colormanagement.cc (GPL-2.0-or-later).
export function blackbody(t: number): THREE.Vector3 {
  if (t < 800) return new THREE.Vector3(5.413294490189271, 0, 0);
  if (t >= 12000) return new THREE.Vector3(.8262954810464208, .9945080501520986, 1.566307710274283);
  const i = [965,1167,1449,1902,3315,6365].filter(limit => t >= limit).length;
  const r = [[1619.19106,-.00205010916,5.02995757],[2488.45471,-.00111330907,3.22621544],
    [3341.43193,-.000486551192,1.76486769],[4094.61742,-.000127446582,.725731635],
    [4670.28036,.0000291258199,.126703442],[4595.09185,.0000287495649,.150345020],
    [3787.17450,.00000935907826,.399075871]][i]!;
  const g = [[-488.999748,.000604330754,-.0755807526],[-755.994277,.000316730098,.478306139],
    [-1023.63977,.000120223470,.936662319],[-1265.71316,.00000487340896,1.27054498],
    [-1425.29332,-.0000401150431,1.43972784],[-1175.54822,-.0000216378048,1.30408023],
    [-500.799571,-.00000459832026,1.09098763]][i]!;
  const b = [[5.96945309e-11,-4.85742887e-8,-9.70622247e-5,-.00407936148],
    [2.40430366e-11,5.55021075e-8,-1.98503712e-4,.0289312858],
    [-1.40949732e-11,1.89878968e-7,-3.56632824e-4,.0910767778],
    [-3.61460868e-11,2.84822009e-7,-4.93211319e-4,.156723440],
    [-1.97075738e-11,1.75359352e-7,-2.50542825e-4,-.0222783266],
    [-1.61997957e-13,-1.64216008e-8,3.86216271e-4,-.738077418],
    [6.72650283e-13,-2.73078809e-8,4.24098264e-4,-.752335691]][i]!;
  return new THREE.Vector3(r[0]!/t+r[1]!*t+r[2]!, g[0]!/t+g[1]!*t+g[2]!,
    ((b[0]!*t+b[1]!)*t+b[2]!)*t+b[3]!).max(new THREE.Vector3());
}

export function worldMedium(world: WorldData | null | undefined): WorldMedium | null {
  if (!world?.volume?.length) return null;
  const medium: WorldMedium = {extinction: new THREE.Vector3(), emission: new THREE.Vector3(), lobes: []};
  for (const node of world.volume) {
    const weight = scalar(node.weight);
    if (weight === 0) continue;
    const c = color(node.color), density = scalar(node.density);
    const absorption = new THREE.Vector3(), scatter = new THREE.Vector3();
    if (node.kind === 'absorption') absorption.set(1-c.x,1-c.y,1-c.z).max(new THREE.Vector3()).multiplyScalar(density);
    if (node.kind === 'scatter' || node.kind === 'principled') {
      scatter.copy(c).multiplyScalar(density);
      const phase = node.kind === 'principled' ? 'HENYEY_GREENSTEIN' : node.phase;
      if (!['HENYEY_GREENSTEIN','DRAINE','RAYLEIGH'].includes(phase))
        throw new Error(`World volume ${phase} phase is not implemented`);
      const anisotropy = constant(node.anisotropy);
      if (typeof anisotropy !== 'number') throw new Error('World volume anisotropy must be scalar');
      medium.lobes.push({coefficient: scatter.clone().multiplyScalar(weight),
        g: phase === 'RAYLEIGH' ? 0 : THREE.MathUtils.clamp(anisotropy, -.999, .999),
        alpha: phase === 'RAYLEIGH' ? 1 : phase === 'DRAINE' ? scalar(node.alpha) : 0});
    }
    if (node.kind === 'principled') {
      const a = color(node.absorption_color);
      absorption.set(Math.max(1-c.x,0)*Math.max(1-Math.sqrt(a.x),0),
        Math.max(1-c.y,0)*Math.max(1-Math.sqrt(a.y),0), Math.max(1-c.z,0)*Math.max(1-Math.sqrt(a.z),0)).multiplyScalar(density);
      const bb = scalar(node.blackbody_intensity);
      if (bb > .001) {
        const t = scalar(node.temperature);
        const power = 5.670373e-14 / Math.PI * (1 + bb * (t**4 - 1));
        medium.emission.add(blackbody(t).multiply(color(node.blackbody_tint)).multiplyScalar(power * weight));
      }
    }
    if (node.kind === 'principled' || node.kind === 'emission')
      medium.emission.add((node.kind === 'emission' ? c : color(node.emission_color)).multiplyScalar(scalar(node.emission_strength)*weight));
    medium.extinction.add(absorption.add(scatter).multiplyScalar(weight));
  }
  for (const axis of ['x','y','z'] as const)
    if (medium.extinction[axis] === 0 && medium.emission[axis] > 0)
      throw new Error('Unbounded emissive World volume with zero extinction has divergent radiance');
  return medium;
}

/** Integral of exp(-sigma*t) on a finite or infinite segment. */
export function mediumIntegral(sigma: number, distance: number): number {
  return sigma > 0 ? -Math.expm1(-sigma*distance)/sigma : distance;
}

export function phaseDraine(cosine: number, g: number, alpha: number): number {
  return (1-g*g)*(1+alpha*cosine*cosine) /
    (4*Math.PI*(1+alpha*(1+2*g*g)/3)*Math.pow(1+g*g-2*g*cosine,1.5));
}

/** Caller owns the returned target until dispose. Construct per revision-owned
 * capture, so a concurrent model edit cannot change its medium or resources. */
export class WorldVolumePass {
  private readonly target = new THREE.WebGLRenderTarget(1,1,{type: THREE.HalfFloatType, depthBuffer: false});
  private readonly geometry = new THREE.PlaneGeometry(2,2);
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private material: THREE.ShaderMaterial | undefined;
  constructor(readonly medium: WorldMedium) {}

  render(renderer: THREE.WebGLRenderer, input: THREE.WebGLRenderTarget, scene: THREE.Scene, camera: THREE.Camera): THREE.WebGLRenderTarget {
    if (!input.depthTexture) throw new Error('World volume render requires surface depth');
    const uniforms: Record<string, THREE.IUniform> = {
      surface: {value: input.texture}, depth: {value: input.depthTexture},
      inverseProjection: {value: camera.projectionMatrixInverse}, cameraWorld: {value: camera.matrixWorld},
      orthographic: {value: (camera as THREE.OrthographicCamera).isOrthographicCamera === true},
      sigma: {value: this.medium.extinction}, emission: {value: this.medium.emission},
    };
    let declarations = '', lighting = '';
    let lightIndex = 0, samplers = 2;
    scene.traverseVisible(object => {
      if (!(object instanceof THREE.PointLight || object instanceof THREE.SpotLight || object instanceof THREE.RectAreaLight)) return;
      const light = object, id = lightIndex++;
      const position = light.getWorldPosition(new THREE.Vector3());
      uniforms[`lp${id}`] = {value: position};
      uniforms[`lc${id}`] = {value: light.color.clone().multiplyScalar(light.intensity)};
      declarations += `uniform vec3 lp${id}, lc${id};\n`;
      let visibility = '1.0', spot = '1.0';
      if (light instanceof THREE.SpotLight) {
        uniforms[`ld${id}`] = {value: light.target.getWorldPosition(new THREE.Vector3()).sub(position).normalize()};
        uniforms[`cone${id}`] = {value: new THREE.Vector2(Math.cos(light.angle), Math.cos(light.angle*(1-light.penumbra)))};
        declarations += `uniform vec3 ld${id}; uniform vec2 cone${id};\n`;
        spot = `smoothstep(cone${id}.x, max(cone${id}.x+1e-6,cone${id}.y),dot(-L,ld${id}))`;
      }
      if (!(light instanceof THREE.RectAreaLight) && light.castShadow && light.shadow.map) {
        if (++samplers > renderer.capabilities.maxTextures) throw new Error('World volume shadow samplers exceed this GPU texture-unit limit');
        uniforms[`sm${id}`] = {value: light.shadow.map.texture};
        uniforms[`sx${id}`] = {value: light.shadow.matrix};
        uniforms[`ss${id}`] = {value: light.shadow.mapSize};
        uniforms[`sb${id}`] = {value: light.shadow.bias};
        uniforms[`sn${id}`] = {value: light.shadow.camera.near};
        uniforms[`sf${id}`] = {value: light.shadow.camera.far};
        declarations += `uniform sampler2D sm${id}; uniform mat4 sx${id}; uniform vec2 ss${id}; uniform float sb${id},sn${id},sf${id};\n`;
        visibility = light instanceof THREE.PointLight
          ? `getPointShadow(sm${id},ss${id},1.0,sb${id},1.0,sx${id}*vec4(p,1.0),sn${id},sf${id})`
          : `getShadow(sm${id},ss${id},1.0,sb${id},1.0,sx${id}*vec4(p,1.0))`;
      }
      if (light instanceof THREE.RectAreaLight) {
        const rotation = new THREE.Matrix4().extractRotation(light.matrixWorld);
        uniforms[`lx${id}`] = {value: new THREE.Vector3(light.width,0,0).applyMatrix4(rotation)};
        uniforms[`ly${id}`] = {value: new THREE.Vector3(0,light.height,0).applyMatrix4(rotation)};
        uniforms[`ln${id}`] = {value: new THREE.Vector3(0,0,-1).transformDirection(rotation)};
        declarations += `uniform vec3 lx${id},ly${id},ln${id};\n`;
        lighting += `for(int ax=0;ax<4;ax++) for(int ay=0;ay<4;ay++) {
          vec3 delta=lp${id}+lx${id}*((float(ax)+.5)/4.-.5)+ly${id}*((float(ay)+.5)/4.-.5)-p;
          float d=length(delta); vec3 L=delta/max(d,1e-6);
          sum+=lc${id}*exp(-sigma*d)*phase(dot(L,ray))*max(dot(-L,ln${id}),0.)*
            length(lx${id})*length(ly${id})/(16.*max(d*d,1e-4)); }\n`;
      } else {
        uniforms[`cut${id}`] = {value: light.distance};
        uniforms[`decay${id}`] = {value: light.decay};
        declarations += `uniform float cut${id},decay${id};\n`;
        lighting += `{ vec3 delta=lp${id}-p; float d=length(delta); vec3 L=delta/max(d,1e-6);
          float cutoff=cut${id}>0.?pow(clamp(1.-pow(d/cut${id},4.),0.,1.),2.):1.;
          sum+=lc${id}*exp(-sigma*d)*phase(dot(L,ray))*${spot}*${visibility}*cutoff/max(pow(d,decay${id}),.01); }\n`;
      }
    });
    let phase = 'vec3 result=vec3(0.);';
    this.medium.lobes.forEach((lobe,i) => {
      uniforms[`scatter${i}`] = {value: lobe.coefficient};
      uniforms[`g${i}`] = {value: lobe.g}; uniforms[`a${i}`] = {value: lobe.alpha};
      declarations += `uniform vec3 scatter${i}; uniform float g${i},a${i};\n`;
      phase += `result+=scatter${i}*(1.-g${i}*g${i})*(1.+a${i}*c*c)/(12.56637061436*(1.+a${i}*(1.+2.*g${i}*g${i})/3.)*pow(1.+g${i}*g${i}-2.*g${i}*c,1.5));`;
    });
    // The finite quadrature tail is bounded at 20 optical depths (2e-9).
    const positive = this.medium.extinction.toArray().filter(v => v > 0);
    uniforms['range'] = {value: positive.length ? 20/Math.min(...positive) : 1};
    this.material?.dispose();
    this.material = new THREE.ShaderMaterial({uniforms, depthTest: false, depthWrite: false, toneMapped: false,
      defines: {USE_SHADOWMAP: '', NUM_DIR_LIGHT_SHADOWS: 0, NUM_SPOT_LIGHT_SHADOWS: 0, NUM_POINT_LIGHT_SHADOWS: 0, NUM_SPOT_LIGHT_COORDS: 0},
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: `
        #include <common>
        #include <packing>
        #include <shadowmap_pars_fragment>
        varying vec2 vUv; uniform sampler2D surface,depth;
        uniform mat4 inverseProjection,cameraWorld; uniform bool orthographic;
        uniform vec3 sigma,emission; uniform float range;
        ${declarations}
        vec3 phase(float c){${phase} return result;}
        vec3 incident(vec3 p,vec3 ray){vec3 sum=vec3(0.);${lighting}return sum;}
        float integral(float s,float d){float x=s*d;return x<.001 ? d*(1.-x*.5+x*x/6.) : (1.-exp(-x))/s;}
        void main(){
          float z=texture2D(depth,vUv).r; vec4 base=texture2D(surface,vUv);
          vec4 v=inverseProjection*vec4(vUv*2.-1.,z*2.-1.,1.);v/=v.w;
          vec3 hit=(cameraWorld*v).xyz;
          vec3 origin=cameraWorld[3].xyz;
          if(orthographic) origin=(cameraWorld*vec4(v.xy,0.,1.)).xyz;
          vec3 ray=normalize(hit-origin); float d=length(hit-origin); bool background=z>=1.;
          vec3 tr=exp(-sigma*d);
          vec3 integrals=vec3(integral(sigma.x,d),integral(sigma.y,d),integral(sigma.z,d));
          if(background){tr=vec3(sigma.x>0.?0.:1.,sigma.y>0.?0.:1.,sigma.z>0.?0.:1.);
            integrals=vec3(sigma.x>0.?1./sigma.x:0.,sigma.y>0.?1./sigma.y:0.,sigma.z>0.?1./sigma.z:0.);}
          vec3 radiance=base.rgb*tr+emission*integrals;
          float end=background?range:min(range,d);
          for(int i=0;i<256;i++){
            float lo=end*pow(float(i)/256.,3.); float hi=end*pow(float(i+1)/256.,3.);
            float t=(lo+hi)*.5;
            radiance+=incident(origin+ray*t,ray)*exp(-sigma*t)*(hi-lo);
          }
          gl_FragColor=vec4(radiance,base.a+(1.-base.a)*(1.-dot(tr,vec3(1./3.))));
        }`});
    this.scene.clear();
    this.scene.add(new THREE.Mesh(this.geometry,this.material));
    this.target.setSize(input.width,input.height);
    const previous = renderer.getRenderTarget();
    try { renderer.setRenderTarget(this.target); renderer.render(this.scene,this.camera); }
    finally { renderer.setRenderTarget(previous); }
    return this.target;
  }
  dispose(): void {this.material?.dispose();this.geometry.dispose();this.target.dispose();this.scene.clear();}
}
