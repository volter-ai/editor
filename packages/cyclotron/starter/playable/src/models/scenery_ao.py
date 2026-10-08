# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright 2026 Volter AI, Inc.
# Last step of canyon.py: ambient occlusion baked into the static scenery, for depth.
#
# Each receiver's vertices get a `scenery_ao` colour attribute: the share of a
# cosine-weighted hemisphere of rays that reach open sky within AO_DISTANCE, a
# hit nearer counting more. Its materials multiply Base Color by it. Nothing that
# moves is baked or casts into the bake: the karts and their drivers (and the
# coins and boost flames canyon.play.ts adds) are excluded, so the start grid
# carries no baked kart shadow. A material a kart shares is copied for the
# scenery, so no kart reads an attribute it lacks. Props (cacti, guardrails,
# signs, stones) occlude but are not baked themselves: they share instanced
# meshes, and baking them would need a copy of each. The three low shelves are
# left out too: eight-vertex boxes half inside the mesas, too coarse to shade.
# The desert floor's top face is split into a grid first, so it has vertices
# to carry the bake.
#
# Pure Python against mathutils' BVH, with fixed ray directions: the same file
# gives the same bake in native Blender and in the editor's.
import bpy, bmesh, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from pathlib import Path
ROOT=str(Path(bpy.data.filepath).resolve().parents[2])
ATTRIBUTE='scenery_ao'
AO_DISTANCE=20.0      # metres; a hit at distance d occludes by 1 - d/AO_DISTANCE
RAYS=64
DARKEST=0.35
FLOOR_CELL=4.0        # metres between the desert floor's vertices
GROUND=('Desert floor','Circuit asphalt','Ivory shoulder','Turquoise racing edge','Lane dash','Finish line tile')
RECEIVERS=('Desert floor','Circuit asphalt','Ivory shoulder','Turquoise racing edge','Natural sandstone arch',
           'West high mesa','West middle mesa','West ledge','Arch east tower','East foreground cliff','Arch west tower',
           'Distant mesa','Far left mesa','Far right mesa','Return canyon mesa')
NOT_OCCLUDERS=('Cloud','Return cloud puff','Cactus thorn','Cactus rib','Arrow amber lamp')

col=bpy.data.collections['Canyon Comet']
def moving(o):
    while o is not None:
        if o.name.startswith('Kart.'):return True
        o=o.parent
    return False
scenery=[o for o in col.all_objects if o.type=='MESH' and not moving(o)]
receivers=[o for o in scenery if o.name.startswith(RECEIVERS)]
ground=[o for o in scenery if o.name.startswith(GROUND)]

# The floor is one 8-vertex box: give its top face a grid the bake can shade.
floor=bpy.data.objects['Desert floor']
if len(floor.data.vertices)<100:
    if floor.data.users>1:floor.data=floor.data.copy()
    bm=bmesh.new();bm.from_mesh(floor.data);bm.faces.ensure_lookup_table()
    top=max(bm.faces,key=lambda f:f.normal.z)
    cuts=max(1,round(floor.dimensions.x/FLOOR_CELL)-1)
    bmesh.ops.subdivide_edges(bm,edges=list(top.edges),cuts=cuts,use_grid_fill=True)
    bm.to_mesh(floor.data);bm.free();floor.data.update()
# A receiver needs its own vertices for its own colours.
for o in receivers:
    if o.data.users>1:o.data=o.data.copy()

def triangles(objects):
    depsgraph=bpy.context.evaluated_depsgraph_get();verts=[];tris=[]
    for o in objects:
        ev=o.evaluated_get(depsgraph);mesh=ev.to_mesh();mesh.calc_loop_triangles();m=ev.matrix_world;base=len(verts)
        verts.extend(m@v.co for v in mesh.vertices);tris.extend(tuple(base+i for i in t.vertices) for t in mesh.loop_triangles)
        ev.to_mesh_clear()
    return BVHTree.FromPolygons(verts,tris)
occluders=[o for o in scenery if not o.name.startswith(NOT_OCCLUDERS)]
everything=triangles(occluders)
# Ground layers lie on one another: a ground receiver ignores them, or each would shade the next.
raised=triangles([o for o in occluders if o not in ground])

golden=math.pi*(3-math.sqrt(5))
hemisphere=[(math.sqrt((i+.5)/RAYS)*math.cos(i*golden),math.sqrt((i+.5)/RAYS)*math.sin(i*golden),math.sqrt(1-(i+.5)/RAYS)) for i in range(RAYS)]
def openness(tree,p,n):
    t=(n.cross(Vector((0,0,1))) if abs(n.z)<.9 else n.cross(Vector((1,0,0)))).normalized();b=n.cross(t);origin=p+n*.03;hidden=0.0
    for x,y,z in hemisphere:
        hit=tree.ray_cast(origin,t*x+b*y+n*z,AO_DISTANCE)[0]
        if hit is not None:hidden+=1-(hit-origin).length/AO_DISTANCE
    return max(DARKEST,1-hidden/RAYS)

report={}
for o in receivers:
    tree=raised if o in ground else everything;m=o.matrix_world;nm=m.to_3x3().inverted_safe().transposed();mesh=o.data
    if ATTRIBUTE in mesh.color_attributes:mesh.color_attributes.remove(mesh.color_attributes[ATTRIBUTE])
    layer=mesh.color_attributes.new(ATTRIBUTE,'FLOAT_COLOR','POINT');values=[]
    for v in mesh.vertices:
        n=(nm@v.normal).normalized()
        # Half the track ribbons wind downward; a ground layer always faces the sky.
        if o in ground and n.z<0:n=-n
        a=openness(tree,m@v.co,n);values.append(a);layer.data[v.index].color=(a,a,a,1)
    report[o.name]=(len(values),round(sum(values)/len(values),3),round(min(values),3))

# Multiply each receiver material's Base Color by the attribute; a material anything else also wears is copied.
receiving=set(receivers);copies={}
for o in receivers:
    for slot in o.material_slots:
        material=slot.material
        if material is None:continue
        shared=any(other not in receiving for other in bpy.data.objects if other.type=='MESH' and any(s.material==material for s in other.material_slots))
        if shared:
            if material.name not in copies:copies[material.name]=bpy.data.materials.get(material.name+' (scenery AO)') or material.copy()
            copies[material.name].name=material.name+' (scenery AO)';slot.material=copies[material.name];material=copies[material.name]
        nodes=material.node_tree.nodes;links=material.node_tree.links;bsdf=nodes.get('Principled BSDF')
        if nodes.get('Scenery AO') is not None:continue
        ao=nodes.new('ShaderNodeVertexColor');ao.name=ao.label='Scenery AO';ao.layer_name=ATTRIBUTE;ao.location=(bsdf.location.x-520,bsdf.location.y-260)
        mix=nodes.new('ShaderNodeMix');mix.name=mix.label='Scenery AO multiply';mix.data_type='RGBA';mix.blend_type='MULTIPLY';mix.location=(bsdf.location.x-260,bsdf.location.y-120)
        mix.inputs['Factor'].default_value=1.0;base=bsdf.inputs['Base Color']
        if base.is_linked:
            source=base.links[0].from_socket;links.remove(base.links[0]);links.new(source,mix.inputs[6])
        else:mix.inputs[6].default_value=base.default_value
        links.new(ao.outputs['Color'],mix.inputs[7]);links.new(mix.outputs[2],base)
for name,(count,mean,low) in sorted(report.items()):print('scenery AO',name,count,'vertices, mean',mean,'darkest',low)
print('scenery AO materials copied for the scenery:',sorted(copies))
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/src/models/canyon.blend')
print('Ambient occlusion baked into',len(receivers),'static scenery meshes')
