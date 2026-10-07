import * as THREE from 'three';
import {bindGraphObjectInfo, materialGraph} from './blender-graph-material';
import {syncPhysicalDrawMaterial} from './blender-physical-material';

export interface BlenderObjectInfo {
  readonly color: readonly number[];
  readonly index: number;
  readonly random: number;
  readonly particle_random?: number;
}
type Draw = {source: THREE.MeshPhysicalMaterial; mesh: THREE.Mesh; material: THREE.MeshPhysicalMaterial; version:number};

/** Per-object shader inputs cannot be shared between material identities:
 * Three skips uploads when successive objects wear the same material. Keep
 * small draw copies, sharing every image/ramp, rather than copying geometry or
 * flattening Random to a constant. Instance/palette optimization stays out of
 * these draws until it can carry every native per-instance input. */
export class BlenderObjectInfoMaterials {
  private readonly draws=new Map<string,Draw>();
  private readonly sources=new Map<THREE.MeshPhysicalMaterial,string|null>();
  private used=new Set<string>();
  private readonly particleInputs=new Map<THREE.Mesh,number>();

  begin(): void {this.used.clear();this.sources.clear();this.particleInputs.clear();}

  get(source: THREE.Material, mesh: THREE.Mesh): THREE.Material {
    if (!(source instanceof THREE.MeshPhysicalMaterial)) return source;
    const graph=materialGraph(source);
    this.sources.set(source,graph?.key??null);
    if (!graph || (!graph.objectInfo && !graph.particleInfo)) return source;
    const info=mesh.userData['blenderObjectInfo'] as BlenderObjectInfo|undefined;
    if (!info) throw new Error(`Object Info inputs missing for Blender object ${mesh.name}`);
    // Particle Random alone is a draw-uniform value, not a position input.
    // Identical geometry/values (especially Cycles' default child record) share one
    // material identity. Object Info still needs each object's model matrix.
    if (graph.particleInfo && info.particle_random === undefined)
      throw new Error(`Particle Info Random input missing for Blender object ${mesh.name}`);
    if (!graph.objectInfo) this.particleInputs.set(mesh,info.particle_random!);
    const key=`${graph.objectInfo ? mesh.uuid : `particle:${mesh.geometry.uuid}:${info.particle_random}`}:${source.uuid}`;
    this.used.add(key);
    let draw=this.draws.get(key);
    if (!draw) {
      const material=syncPhysicalDrawMaterial(source,undefined,true);
      if (!material) return source;
      draw={source,mesh,material,version:source.version};
      this.draws.set(key,draw);
    }
    // Refresh follows a mesh that still wears this shared input, including
    // when its former representative was edited or removed.
    draw.mesh=mesh;
    this.sync(draw,info);
    return draw.material;
  }

  end(): void {
    for(const [key,draw] of this.draws) if(!this.used.has(key)) {
      draw.material.dispose();this.draws.delete(key);
    }
  }

  /** A pending authored graph can finish without another native export. */
  needsRemap(): boolean {
    for (const [source,key] of this.sources)
      if ((materialGraph(source)?.key??null)!==key) return true;
    for (const [mesh,value] of this.particleInputs)
      if ((mesh.userData['blenderObjectInfo'] as BlenderObjectInfo|undefined)?.particle_random!==value) return true;
    return false;
  }

  refresh(): void {
    for(const draw of this.draws.values()) {
      const info=draw.mesh.userData['blenderObjectInfo'] as BlenderObjectInfo|undefined;
      if (!info) throw new Error(`Object Info inputs missing for Blender object ${draw.mesh.name}`);
      this.sync(draw,info);
    }
  }

  private sync(draw:Draw,info:BlenderObjectInfo): void {
    if(!syncPhysicalDrawMaterial(draw.source,draw.material,true))
      throw new Error(`Object Info material ${draw.source.name} lost its draw binding`);
    if(draw.version!==draw.source.version) draw.material.needsUpdate=true;
    draw.version=draw.source.version;
    bindGraphObjectInfo(draw.material,info);
  }

  clear(): void {
    for(const draw of this.draws.values()) draw.material.dispose();
    this.draws.clear();this.sources.clear();this.used.clear();this.particleInputs.clear();
  }
}
