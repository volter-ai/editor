"""Run with Blender --background --factory-startup --python this-file.

Known scene-linear float pixels isolate color management from lighting and
sampling. The oracle is Blender's image.save_render, never our LUT sampler.
Regenerates the fixture beside this script; temporary PNGs stay in a temp dir.
"""
import bpy
import hashlib
import json
import pathlib
import tempfile

root = pathlib.Path(__file__).parent
config = pathlib.Path(bpy.utils.resource_path('LOCAL')) / 'datafiles/colormanagement'
colors = [[v, v, v] for v in [0, .0001, .001, .003, .01, .05, .18, .5, 1, 2, 8, 64, 1024]]
colors += [[1, 0, 0], [0, 1, 0], [0, 0, 1], [.18, .03, .01], [.01, .2, .7],
           [8, .5, .03], [.03, 8, .5], [.5, .03, 8], [2, .18, .02], [-.01, .18, .5]]
scene = bpy.context.scene
scene.display_settings.display_device = 'sRGB'
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.color_depth = '16'
scene.render.dither_intensity = 0
image = bpy.data.images.new('Scene linear oracle', width=len(colors), height=1, float_buffer=True)
image.pixels[:] = [c for rgb in colors for c in [*rgb, 1]]
cases = []
settings = [('Standard', 'None'), ('Khronos PBR Neutral', 'None'), ('Filmic', 'Medium Contrast'), ('AgX', 'None'),
            ('AgX', 'AgX - Punchy'), ('AgX', 'AgX - Medium High Contrast')]
settings += [('Filmic', look) for look in ['None', 'Very High Contrast', 'High Contrast',
             'Medium High Contrast', 'Medium Low Contrast', 'Low Contrast', 'Very Low Contrast']]
settings += [('AgX', 'AgX - ' + look) for look in ['Greyscale', 'Very High Contrast', 'High Contrast',
             'Base Contrast', 'Medium Low Contrast', 'Low Contrast', 'Very Low Contrast']]
with tempfile.TemporaryDirectory() as directory:
    for transform, look in settings:
        for exposure, gamma in [(0, 1), (-2, 1), (2, 1.3)]:
            scene.view_settings.view_transform = transform
            scene.view_settings.look = look
            scene.view_settings.exposure = exposure
            scene.view_settings.gamma = gamma
            path = str(pathlib.Path(directory) / 'oracle.png')
            image.save_render(path, scene=scene)
            read = bpy.data.images.load(path, check_existing=False)
            read.colorspace_settings.name = 'Non-Color'
            pixels = list(read.pixels[:])
            cases.append(dict(transform=transform, look=look, exposure=exposure, gamma=gamma,
                              display=[pixels[i:i+3] for i in range(0, len(pixels), 4)]))
            bpy.data.images.remove(read)
fixture = dict(oracle='Blender image.save_render on scene-linear float pixels',
               version=bpy.app.version_string, build=bpy.app.build_hash.decode(),
               config_sha256=hashlib.sha256((config / 'config.ocio').read_bytes()).hexdigest(),
               colors=colors, cases=cases)
(root / 'fixtures/display-colors.json').write_text(json.dumps(fixture, indent=2) + '\n')
print('DISPLAY_ORACLE', len(cases), 'cases', len(colors), 'colors')
