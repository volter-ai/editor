/** Disposable draw records only. The native frame's authoring objects remain
 * unchanged; followers receive these records without expanding them twice. */
type Placement = {
  id:string;source:string;owner:string|null;matrix:number[][];
  visible:boolean;render_visible:boolean;random:number;color:number[];
};
type DrawSource = {
  id:string;name:string;parent:string|null;selected:boolean;
  object_info?:{random:number} | undefined;
};
export function expandDrawPlacements<T extends {objects:DrawSource[];instances?:Placement[] | undefined}>(frame: T): T {
  if (!frame.instances?.length) return frame;
  const sources = new Map(frame.objects.map(row => [row.id,row]));
  const draws = frame.instances.map(instance => {
    const source = sources.get(instance.source), owner = instance.owner === null ? null : sources.get(instance.owner);
    if (!source) throw new Error(`Missing native instance source ${instance.source}`);
    if (instance.owner !== null && !owner) throw new Error(`Missing native instance owner ${instance.owner}`);
    return {...source,id:instance.id,name:owner?.name ?? source.name,parent:instance.owner,
      instance_owner:instance.owner,matrix:instance.matrix,visible:instance.visible,
      viewport_show_self:true,render_show_self:true,
      render_visible:instance.render_visible,selected:owner?.selected ?? false,
      ...(source.object_info ? {object_info:{...source.object_info,random:instance.random,color:instance.color}} : {})};
  });
  const {instances: _placements,...rest} = frame;
  return {...rest,objects:[...frame.objects,...draws]} as T;
}
