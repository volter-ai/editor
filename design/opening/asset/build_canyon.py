"""Cyclotron card: the machine in a stylized desert canyon at golden hour.

Builds the scene from scratch in headless Blender, saves canyon.blend and
renders card-canyon.png (900 x 1200, EEVEE) next to this script.

    blender -b --factory-startup --python build_canyon.py -- [--no-render] [--samples 128] [--out card-canyon.png]

The machine is cyclotron-machine.obj (export-asset.mjs: the site's own scene,
poster state, Y up). Faces carry a role material (body / trim / accent /
metal) that is dressed here. Everything that makes this setting a canyon lives
in SETTING and the build_* functions, so another setting can reuse the rest.
"""
import bpy, bmesh, math, os, random, sys, time
from mathutils import Vector, Matrix, noise

HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None):
    return ARGS[ARGS.index('--' + name) + 1] if '--' + name in ARGS else default
RENDER = '--no-render' not in ARGS
SAMPLES = int(arg('samples', 128))
OUT_PNG = os.path.join(HERE, arg('out', 'card-canyon.png'))
OUT_BLEND = os.path.join(HERE, arg('blend', 'canyon.blend'))
OBJ = os.path.join(HERE, 'cyclotron-machine.obj')

SETTING = {
    'seed': 7,
    'resolution': (900, 1200),
    # machine dress
    'body': '#f7f6f1', 'trim': '#16252c', 'accent': '#d8eb6a', 'metal': '#b9c1c5',
    'accent_glow': 0.32,
    'pad_top': 0.32,                    # the machine stands on a raised landing pad
    # canyon palette (Canyon Comet: layered red-orange sandstone, tan sand)
    'sand': '#e2b585', 'sand_dark': '#cf9a68',
    'strata': ['#d27b4b', '#e39566', '#c0673f', '#eab183', '#b65c39'],
    'rock': '#a9603f', 'pad': '#d3c7b6', 'pad_wear': '#9c8f80', 'pad_mark': '#16252c',
    # golden hour
    'sky_zenith': '#7d95c8', 'sky_horizon': '#dcd5e9', 'sky_glow': '#ffbe7d', 'world_strength': 0.42,
    'haze': '#e3c9d3', 'sun_color': '#ffb468', 'sun_strength': 4.0, 'fill_strength': 500,
    'sun_elevation': 10.0, 'sun_side': -0.85, 'sun_front': 0.45,   # sun direction in the camera frame
    # camera: the poster's azimuth, low and close
    'view_azimuth': (0.616, -0.788),   # camera side of the machine, Blender XY
    'cam_distance': 28.5, 'cam_height': 4.2, 'cam_target_z': 5.0, 'lens': 52.0, 'shift_y': -0.04,
}

def lin(h, a=1.0):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple([x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [a])

random.seed(SETTING['seed'])

# ------------------------------------------------------------------ scene ---
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = SETTING['resolution']
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.eevee.taa_render_samples = SAMPLES
scene.eevee.use_raytracing = True
scene.eevee.use_shadows = True
scene.eevee.shadow_ray_count = 2
scene.eevee.shadow_step_count = 8
scene.eevee.use_fast_gi = True
# Standard keeps the brand colours (AgX washes the lime and sandstone toward pastel).
scene.view_settings.view_transform = 'Standard'
try: scene.view_settings.look = 'Medium Contrast'
except TypeError: pass

def new_mat(name, color, rough=0.5, metal=0.0, emit=None, emit_strength=0.0, spec=0.5):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = lin(color)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if 'Specular IOR Level' in b.inputs: b.inputs['Specular IOR Level'].default_value = spec
    if emit:
        b.inputs['Emission Color'].default_value = lin(emit)
        b.inputs['Emission Strength'].default_value = emit_strength
    return m

def link(obj, coll=None):
    (coll or scene.collection).objects.link(obj); return obj

def mesh_obj(name, bm, mat=None, smooth=False, coll=None):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = smooth
    o = bpy.data.objects.new(name, me)
    if mat: o.data.materials.append(mat)
    return link(o, coll)

# Distance haze for the backdrop: mix toward the haze colour with view distance.
def hazed(m, near=40.0, far=300.0, amount=0.45):
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    cam = nt.nodes.new('ShaderNodeCameraData')
    mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = near; mr.inputs['From Max'].default_value = far
    mr.inputs['To Max'].default_value = amount
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
    mix.inputs['A'].default_value = b.inputs['Base Color'].default_value
    mix.inputs['B'].default_value = lin(SETTING['haze'])
    nt.links.new(cam.outputs['View Distance'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], mix.inputs['Factor'])
    nt.links.new(mix.outputs['Result'], b.inputs['Base Color'])
    return m

# ----------------------------------------------------------------- machine ---
def build_machine():
    bpy.ops.wm.obj_import(filepath=OBJ, forward_axis='NEGATIVE_Z', up_axis='Y')
    parts = [o for o in bpy.context.selected_objects if o.type == 'MESH']
    mats = {
        'body': new_mat('machine_body', SETTING['body'], rough=0.42, spec=0.45),
        'trim': new_mat('machine_trim', SETTING['trim'], rough=0.45, metal=0.15),
        'accent': new_mat('machine_accent', SETTING['accent'], rough=0.38, emit=SETTING['accent'], emit_strength=SETTING['accent_glow']),
        'metal': new_mat('machine_metal', SETTING['metal'], rough=0.28, metal=1.0),
    }
    zmin = min((o.matrix_world @ Vector(c)).z for o in parts for c in o.bound_box)
    rig = bpy.data.objects.new('Machine', None); link(rig)
    for o in parts:
        for slot in o.material_slots:
            role = slot.material.name.split('.')[0] if slot.material else 'body'
            slot.material = mats.get(role, mats['body'])
        o.parent = rig
    rig.location.z = -zmin + SETTING['pad_top']
    return rig, parts

# --------------------------------------------------------------- the pad ---
def build_pad(radius=3.9, depth=0.5):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=radius, radius2=radius * 0.97, depth=depth)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 8, 3, 'Z'))
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, SETTING['pad_top'] - depth / 2))
    m = new_mat('pad', SETTING['pad'], rough=0.85, spec=0.3)
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    # worn: noise blotches and a scorch toward the centre, as if something landed
    tc = nt.nodes.new('ShaderNodeTexCoord'); nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 1.6
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    grad = nt.nodes.new('ShaderNodeTexGradient'); grad.gradient_type = 'SPHERICAL'
    mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1 / (radius * 0.95),) * 3
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector']); nt.links.new(mp.outputs['Vector'], grad.inputs['Vector'])
    mx = nt.nodes.new('ShaderNodeMath'); mx.operation = 'MULTIPLY'
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.25; ramp.color_ramp.elements[0].color = lin(SETTING['pad_wear'])
    ramp.color_ramp.elements[1].position = 0.75; ramp.color_ramp.elements[1].color = lin(SETTING['pad'])
    add = nt.nodes.new('ShaderNodeMath'); add.operation = 'ADD'
    inv = nt.nodes.new('ShaderNodeMath'); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1.0
    nt.links.new(grad.outputs['Fac'], inv.inputs[1])                    # 1 at the rim, 0 at the centre
    nt.links.new(inv.outputs['Value'], add.inputs[0]); nt.links.new(nz.outputs['Fac'], add.inputs[1])
    half = nt.nodes.new('ShaderNodeMath'); half.operation = 'MULTIPLY'; half.inputs[1].default_value = 0.62
    nt.links.new(add.outputs['Value'], half.inputs[0]); nt.links.new(half.outputs['Value'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    pad = mesh_obj('Pad', bm, m)
    bev = pad.modifiers.new('worn edge', 'BEVEL'); bev.width = 0.09; bev.segments = 3; bev.limit_method = 'ANGLE'
    pad.modifiers.new('normals', 'WEIGHTED_NORMAL').keep_sharp = True
    # painted landing ring, a hair above the top face
    bm = bmesh.new(); outer, inner, seg = radius * 0.86, radius * 0.80, 64
    vo = [bm.verts.new((outer * math.cos(t), outer * math.sin(t), SETTING['pad_top'] + 0.012)) for t in (i / seg * 2 * math.pi for i in range(seg))]
    vi = [bm.verts.new((inner * math.cos(t), inner * math.sin(t), SETTING['pad_top'] + 0.012)) for t in (i / seg * 2 * math.pi for i in range(seg))]
    for i in range(seg):
        j = (i + 1) % seg
        if i % 8 in (6, 7): continue                                     # dashed, like a worn marking
        bm.faces.new((vi[i], vo[i], vo[j], vi[j]))
    mesh_obj('Pad marking', bm, new_mat('pad_mark', SETTING['pad_mark'], rough=0.9, spec=0.2))
    return pad

# ------------------------------------------------------------ the ground ---
def build_ground(size=420.0, cuts=84):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=cuts, y_segments=cuts, size=size / 2)
    for v in bm.verts:
        r = math.hypot(v.co.x, v.co.y)
        if r < 9: v.co.z = 0.0; continue
        k = min(1.0, (r - 9) / 40)
        v.co.z = k * (0.9 * noise.noise(Vector((v.co.x / 22, v.co.y / 22, 0.3))) + 0.25 * noise.noise(Vector((v.co.x / 6, v.co.y / 6, 1.7)))) - 0.15 * k
    m = new_mat('sand', SETTING['sand'], rough=0.95, spec=0.25)
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord'); nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 0.035
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = lin(SETTING['sand_dark']); ramp.color_ramp.elements[1].color = lin(SETTING['sand'])
    ramp.color_ramp.elements[0].position = 0.35; ramp.color_ramp.elements[1].position = 0.65
    nt.links.new(nz.outputs['Fac'], ramp.inputs['Fac']); nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    hazed(m, near=60, far=320, amount=0.5)
    return mesh_obj('Ground', bm, m)

# ----------------------------------------------------------- the canyon ---
def frame():
    ax, ay = SETTING['view_azimuth']
    back = Vector((-ax, -ay, 0)).normalized()          # from the camera, past the machine
    right = Vector((back.y, -back.x, 0))
    return back, right

def mesa(name, centre, radius, height, layers, mats, sides=9, lean=0.0):
    bm = bmesh.new()
    z = -1.5
    base_r = radius
    for i in range(layers):
        h = height / layers * random.uniform(0.75, 1.25)
        r = base_r * random.uniform(0.9, 1.04)
        ring = []
        for k in range(sides):
            t = k / sides * 2 * math.pi + random.uniform(-0.12, 0.12)
            rr = r * random.uniform(0.82, 1.12)
            ring.append(bm.verts.new((centre.x + rr * math.cos(t) + lean * z, centre.y + rr * math.sin(t), z)))
        top = [bm.verts.new((v.co.x * 0 + centre.x + (v.co.x - centre.x) * random.uniform(0.94, 1.0), centre.y + (v.co.y - centre.y) * random.uniform(0.94, 1.0), z + h)) for v in ring]
        for k in range(sides):
            f = bm.faces.new((ring[k], ring[(k + 1) % sides], top[(k + 1) % sides], top[k])); f.material_index = i % len(mats)
        bm.faces.new(list(reversed(ring))).material_index = i % len(mats)
        bm.faces.new(top).material_index = i % len(mats)
        z += h
        base_r = r * random.uniform(0.86, 1.0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    for m in mats: o.data.materials.append(m)
    return link(o)

def build_canyon():
    back, right = frame()
    mats = [hazed(new_mat(f'sandstone_{i}', c, rough=0.9, spec=0.25)) for i, c in enumerate(SETTING['strata'])]
    rocks = hazed(new_mat('rock', SETTING['rock'], rough=0.9, spec=0.25))
    def at(d, s): return back * d + right * s
    # canyon walls either side of the view, a gap of sky behind the machine, buttes beyond
    walls = [(-34, 42, 15, 34, 9), (-48, 70, 18, 42, 10), (-30, 105, 20, 30, 7),
             (36, 46, 14, 30, 8), (52, 76, 19, 46, 11), (40, 112, 22, 34, 8),
             (-90, 150, 30, 40, 8), (95, 170, 34, 50, 9), (10, 230, 26, 26, 6), (-25, 260, 30, 34, 7)]
    for i, (s, d, r, h, n) in enumerate(walls):
        rot = mats[i % len(mats):] + mats[:i % len(mats)]
        mesa(f'Mesa {i + 1}', at(d, s), r, h, n, rot)
    # a few rocks round the pad and along the floor
    for i, (s, d, r) in enumerate([(-5.4, 1.5, 0.6), (-6.6, 4.5, 0.4), (5.6, 3.6, 0.85), (5.2, -0.4, 0.35), (-11, 12, 1.6), (12, 14, 2.0), (3.4, 9.0, 0.5), (-3.6, 11.0, 0.7), (-8.5, 22, 2.4), (9.5, 26, 1.4)]):
        bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r)
        for v in bm.verts: v.co *= random.uniform(0.8, 1.15); v.co.z *= 0.72
        c = at(d, s); bmesh.ops.translate(bm, verts=bm.verts, vec=(c.x, c.y, r * 0.25))
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(c.x, c.y, 0), matrix=Matrix.Rotation(random.uniform(0, 6.28), 3, 'Z'))
        mesh_obj(f'Rock {i + 1}', bm, rocks)

# ----------------------------------------------------------------- the sky ---
def build_sky(sun_dir):
    w = bpy.data.worlds.new('Golden hour'); scene.world = w; w.use_nodes = True
    nt = w.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld'); bg = nt.nodes.new('ShaderNodeBackground'); bg.inputs['Strength'].default_value = SETTING['world_strength']
    tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Generated'], sep.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB'); cr = ramp.color_ramp
    cr.elements[0].position = 0.0; cr.elements[0].color = lin(SETTING['sky_horizon'])
    cr.elements[1].position = 0.55; cr.elements[1].color = lin(SETTING['sky_zenith'])
    e = cr.elements.new(0.12); e.color = lin('#e9d6e0')
    nt.links.new(sep.outputs['Z'], ramp.inputs['Fac'])
    # warm glow around the low sun
    dot = nt.nodes.new('ShaderNodeVectorMath'); dot.operation = 'DOT_PRODUCT'; dot.inputs[1].default_value = sun_dir
    nt.links.new(tc.outputs['Generated'], dot.inputs[0])
    glow = nt.nodes.new('ShaderNodeMapRange'); glow.inputs['From Min'].default_value = 0.35; glow.inputs['From Max'].default_value = 1.0
    nt.links.new(dot.outputs['Value'], glow.inputs['Value'])
    pw = nt.nodes.new('ShaderNodeMath'); pw.operation = 'POWER'; pw.inputs[1].default_value = 2.2
    nt.links.new(glow.outputs['Result'], pw.inputs[0])
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.inputs['B'].default_value = lin(SETTING['sky_glow'])
    nt.links.new(pw.outputs['Value'], mix.inputs['Factor']); nt.links.new(ramp.outputs['Color'], mix.inputs['A'])
    nt.links.new(mix.outputs['Result'], bg.inputs['Color']); nt.links.new(bg.outputs['Background'], out.inputs['Surface'])

# ------------------------------------------------------- light and camera ---
def build_light_and_camera(machine_top):
    back, right = frame()
    el = math.radians(SETTING['sun_elevation'])
    horiz = (right * SETTING['sun_side'] - back * SETTING['sun_front']).normalized()
    to_sun = Vector((horiz.x * math.cos(el), horiz.y * math.cos(el), math.sin(el))).normalized()
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN')); link(sun)
    sun.data.energy = SETTING['sun_strength']; sun.data.color = lin(SETTING['sun_color'])[:3]; sun.data.angle = math.radians(1.2)
    sun.rotation_euler = to_sun.to_track_quat('Z', 'Y').to_euler()
    # a soft rim from behind so the silhouette lifts off the sky
    rim = bpy.data.objects.new('Rim', bpy.data.lights.new('Rim', 'AREA')); link(rim)
    rim.data.energy = 2600; rim.data.size = 9; rim.data.color = lin('#ffd9b5')[:3]
    rim.location = back * 16 + right * 7 + Vector((0, 0, machine_top * 0.85))
    rim.rotation_euler = (Vector((0, 0, machine_top * 0.5)) - rim.location).to_track_quat('-Z', 'Y').to_euler()
    # a soft warm fill from the camera side keeps the front of the machine readable
    fill = bpy.data.objects.new('Fill', bpy.data.lights.new('Fill', 'AREA')); link(fill)
    fill.data.energy = SETTING['fill_strength']; fill.data.size = 14; fill.data.color = lin('#ffe6cc')[:3]
    fill.location = -back * 20 - right * 9 + Vector((0, 0, machine_top * 0.75))
    fill.rotation_euler = (Vector((0, 0, machine_top * 0.45)) - fill.location).to_track_quat('-Z', 'Y').to_euler()
    cam = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera')); link(cam); scene.camera = cam
    cam.data.lens = SETTING['lens']; cam.data.sensor_fit = 'VERTICAL'; cam.data.sensor_height = 24 * 1.25
    cam.data.shift_y = SETTING['shift_y']; cam.data.clip_end = 1200
    cam.location = -back * SETTING['cam_distance'] + Vector((0, 0, SETTING['cam_height']))
    target = Vector((0, 0, SETTING['cam_target_z']))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    return to_sun

# ------------------------------------------------------------ compositor ---
def build_compositor():
    try:
        ng = bpy.data.node_groups.new('Card glow', 'CompositorNodeTree')
        ng.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
        rl = ng.nodes.new('CompositorNodeRLayers'); out = ng.nodes.new('NodeGroupOutput')
        glare = ng.nodes.new('CompositorNodeGlare')
        glare.inputs['Type'].default_value = 'Bloom'
        glare.inputs['Threshold'].default_value = 0.86
        glare.inputs['Strength'].default_value = 0.3
        glare.inputs['Size'].default_value = 0.7
        ng.links.new(rl.outputs['Image'], glare.inputs['Image']); ng.links.new(glare.outputs['Image'], out.inputs['Image'])
        scene.compositing_node_group = ng; scene.render.use_compositing = True
        print('compositor: bloom on')
    except Exception as ex:   # the render is fine without it
        print('compositor: skipped', ex)

# ---------------------------------------------------------------- build ---
t0 = time.time()
rig, parts = build_machine()
machine_top = max((o.matrix_world @ Vector(c)).z for o in parts for c in o.bound_box) - min((o.matrix_world @ Vector(c)).z for o in parts for c in o.bound_box)
bpy.context.view_layer.update()
build_pad(); build_ground(); build_canyon()
to_sun = build_light_and_camera(machine_top)
build_sky(to_sun)
build_compositor()
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
print(f'built in {time.time() - t0:.1f}s; machine height {machine_top:.2f}; saved {OUT_BLEND}')
if RENDER:
    t1 = time.time()
    scene.render.filepath = OUT_PNG
    bpy.ops.render.render(write_still=True)
    print(f'rendered {OUT_PNG} in {time.time() - t1:.1f}s ({SAMPLES} samples)')
