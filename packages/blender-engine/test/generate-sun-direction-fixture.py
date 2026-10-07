"""Compile the pinned Cycles direction code: python SCRIPT BLENDER_SOURCE OUTPUT.

Run through the repository's World. Uses native headers and verbatim shader
normalization/kernel expressions; does not call the browser implementation.
"""
import json
import pathlib
import re
import subprocess
import sys
import tempfile

source = pathlib.Path(sys.argv[1]).resolve()
cycles = source / 'intern/cycles'
node = (cycles / 'scene/shader_nodes.cpp').read_text()
kernel = (cycles / 'kernel/svm/sky.h').read_text()
normalization = re.search(
    r'void SkyTextureNode::simplify_settings\(Scene \* /\* scene \*/\)\s*(\{.*?\n\})',
    node, re.S).group(1)
direction = re.search(r'const float3 sun_dir = spherical_to_direction\([^;]+;', kernel).group(0)
cases = [
    ('rotation-zero', 0.4, 0), ('rotation-quarter', 0.4, 1.5707963267948966),
    ('courtyard', 0.9250245094299316, 2.6179938316345215),
    ('negative-rotation', 0.6, -0.8), ('wrapped-rotation', 0.6, 7.1),
    ('below-horizon', -0.05, 0.9), ('folded-elevation', 2.1, 0.3),
]
program = '''#include <cstdio>
#define CCL_NAMESPACE_BEGIN namespace ccl {
#define CCL_NAMESPACE_END }
#include "util/defines.h"
#include "util/projection.h"
using namespace ccl;
struct Scene {};
struct SkyTextureNode {
  float sun_elevation, sun_rotation;
  struct {void clear() {}} handle;
  bool is_modified() {return false;}
  void simplify_settings(Scene*);
};
void SkyTextureNode::simplify_settings(Scene*) ''' + normalization + '\nint main() {\n'
for _, elevation, rotation in cases:
    program += ('{SkyTextureNode node{%.17gf, %.17gf}; node.simplify_settings(nullptr);\n'
                'float sun_elevation=node.sun_elevation, sun_rotation=node.sun_rotation;\n'
                '%s\nprintf("%%.9g %%.9g %%.9g\\n",sun_dir.x,sun_dir.y,sun_dir.z);}\n' %
                (elevation, rotation, direction)).replace(' 0f', ' 0.0f')
program += '}\n'
with tempfile.TemporaryDirectory() as tmp:
    cpp = pathlib.Path(tmp) / 'sun.cpp'
    cpp.write_text(program)
    exe = pathlib.Path(tmp) / 'sun'
    subprocess.run(['clang++', '-std=c++20', '-O2', '-ffp-contract=off',
                    '-I' + str(cycles), str(cpp), '-o', str(exe)], check=True)
    rows = subprocess.check_output([str(exe)], text=True).splitlines()
revision = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
fixture = {'source': 'https://github.com/volter-ai/blender/tree/' + revision,
           'compiler': 'clang++ -std=c++20 -O2 -ffp-contract=off',
           'native': ['SkyTextureNode::simplify_settings', 'sky_radiance_nishita', 'spherical_to_direction'],
           'cases': [{'name': name, 'sunElevation': elevation, 'sunRotation': rotation,
                      'direction': list(map(float, row.split()))}
                     for (name, elevation, rotation), row in zip(cases, rows, strict=True)]}
pathlib.Path(sys.argv[2]).write_text(json.dumps(fixture, indent=2) + '\n')
