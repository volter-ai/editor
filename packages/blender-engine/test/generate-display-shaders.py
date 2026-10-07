"""Bake Blender's OCIO display processors, not resampled look approximations.

Requires opencolorio==2.5.0 and numpy. Pass config.ocio and the browser/three
output directory. Operations mirror libocio_display_processor.cc: finish a
look in its process space, then bypass the display view's automatic looks.
Exposure and gamma stay runtime uniforms. Tables are deduplicated float32.
"""
import hashlib
import json
import pathlib
import sys
import PyOpenColorIO as ocio

config_path, output = map(pathlib.Path, sys.argv[1:])
config = ocio.Config.CreateFromFile(str(config_path))
data = bytearray()
offsets = {}
processors = {}
for view in ['Standard', 'Filmic', 'AgX', 'Khronos PBR Neutral']:
    looks = ['None'] + [look.getName() for look in config.getLooks()
                       if (view == 'Filmic' and look.getProcessSpace() == 'Filmic Log')
                       or (view == 'AgX' and look.getName().startswith('AgX - '))]
    for look in looks:
        group = ocio.GroupTransform()
        source = 'Linear Rec.709'
        if look != 'None':
            target = config.getLook(look).getProcessSpace()
            group.appendTransform(ocio.LookTransform(src=source, dst=target, looks=look))
            source = target
        group.appendTransform(ocio.DisplayViewTransform(src=source, display='sRGB', view=view,
                                                       looksBypass=look != 'None'))
        processor = config.getProcessor(group)
        desc = ocio.GpuShaderDesc.CreateShaderDesc()
        desc.setLanguage(ocio.GPU_LANGUAGE_GLSL_ES_3_0)
        desc.setFunctionName('blenderDisplay')
        desc.setResourcePrefix('blender_')
        desc.setAllowTexture1D(False)
        processor.getDefaultGPUProcessor().extractGpuShaderInfo(desc)
        textures = []
        for texture in [*desc.getTextures(), *desc.get3DTextures()]:
            values = texture.getValues().flatten()
            raw = values.astype('<f4').tobytes()
            key = hashlib.sha256(raw).hexdigest()
            if key not in offsets:
                offsets[key] = len(data)
                data += raw
            spec = dict(sampler=texture.samplerName, offset=offsets[key], count=len(values),
                        linear=texture.interpolation == ocio.INTERP_LINEAR)
            if hasattr(texture, 'edgeLen'):
                spec.update(size=texture.edgeLen, channels=3)
            else:
                spec.update(width=texture.width, height=texture.height,
                            channels=1 if texture.channel == ocio.GpuShaderDesc.TEXTURE_RED_CHANNEL else 3)
            textures.append(spec)
        if list(desc.getUniforms()):
            raise RuntimeError('Unexpected dynamic OCIO uniforms')
        processors[view + '/' + look] = dict(shader=desc.getShaderText(), textures=textures)
metadata = dict(version=ocio.__version__,
                config_sha256=hashlib.sha256(config_path.read_bytes()).hexdigest(),
                source='Blender 5.2 fbe6228777e7 config.ocio, libocio_display_processor.cc',
                processors=processors, data_sha256=hashlib.sha256(data).hexdigest())
(output / 'blender-display-shaders.json').write_text(json.dumps(metadata, separators=(',', ':')) + '\n')
(output / 'blender-display-shaders.lut').write_bytes(data)
print('DISPLAY_SHADERS', len(processors), 'processors', len(data), 'bytes')
