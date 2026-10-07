"""Native/raster environment-visibility diagnostic, not a passing parity test.

Execute this module in a Blender session and call
capture_environment_visibility(output_dir). The browser session provides both
CYCLES and VOLTER_THREE; desktop Blender can run engines=("CYCLES",) to generate
the independent reference. A fully enclosed diffuse room has no interior light,
so its native direct-light result must be black. Keep this check separate from
sky sampling, display conversion and indirect-bounce comparisons.
"""
import os
import bpy


def capture_environment_visibility(output_dir, engines=("CYCLES", "VOLTER_THREE")):
    original = bpy.context.window.scene
    owned = []

    def own(collection, value):
        owned.append((collection, value))
        return value

    try:
        scene = own(bpy.data.scenes, bpy.data.scenes.new("Environment visibility diagnostic"))
        bpy.context.window.scene = scene
        mesh = own(bpy.data.meshes, bpy.data.meshes.new("Diagnostic enclosure"))
        mesh.from_pydata([
            (-2, -2, -2), (-2, -2, 2), (-2, 2, -2), (-2, 2, 2),
            (2, -2, -2), (2, -2, 2), (2, 2, -2), (2, 2, 2),
        ], [], [(0, 4, 6, 2), (1, 3, 7, 5), (0, 1, 5, 4),
                (2, 6, 7, 3), (0, 2, 3, 1), (4, 5, 7, 6)])
        room = own(bpy.data.objects, bpy.data.objects.new("Diagnostic room", mesh))
        scene.collection.objects.link(room)
        material = own(bpy.data.materials, bpy.data.materials.new("Diagnostic diffuse"))
        material.use_nodes = True
        bsdf = material.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (.8, .8, .8, 1)
        bsdf.inputs["Roughness"].default_value = 1
        mesh.materials.append(material)
        data = own(bpy.data.cameras, bpy.data.cameras.new("Diagnostic camera"))
        data.clip_start, data.clip_end = .1, 10
        camera = own(bpy.data.objects, bpy.data.objects.new("Diagnostic camera", data))
        scene.collection.objects.link(camera)
        scene.camera = camera
        world = own(bpy.data.worlds, bpy.data.worlds.new("Diagnostic exterior sky"))
        world.use_nodes = True
        background = world.node_tree.nodes.get("Background")
        background.inputs["Color"].default_value = (1, 1, 1, 1)
        background.inputs["Strength"].default_value = 1
        scene.world = world
        scene.render.resolution_x = scene.render.resolution_y = 32
        scene.render.resolution_percentage = 100
        scene.render.use_compositing = False
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGBA"
        scene.render.image_settings.color_depth = "8"
        scene.view_settings.view_transform = "Standard"
        scene.view_settings.look = "None"
        scene.view_settings.exposure = 0
        scene.view_settings.gamma = 1
        scene.cycles.samples = 8
        scene.cycles.use_denoising = False
        scene.cycles.max_bounces = 0
        os.makedirs(output_dir, exist_ok=True)
        outputs = {}
        for engine in engines:
            scene.render.engine = engine
            path = os.path.join(output_dir, "environment-visibility-" + engine.lower() + ".png")
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            if not os.path.isfile(path):
                raise RuntimeError("Environment diagnostic did not save " + engine)
            outputs[engine] = path
        return outputs
    finally:
        bpy.context.window.scene = original
        for collection, value in reversed(owned):
            collection.remove(value, do_unlink=True)
