"""Native placement metadata oracle; geometry continues to use the C++ arena."""
import ast
import copy
import json
from pathlib import Path
from types import SimpleNamespace
import unittest


class DepsgraphPlacements(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).parent
        self.fixture = json.loads((root / 'fixtures/depsgraph-placements.json').read_text())
        self.objects = {}
        for row in self.fixture['objects']:
            obj = SimpleNamespace(name=row['name'], type=row['type'], hide_render=row['hide_render'],
                                  visible_shadow=True,
                                  is_instancer=row['is_instancer'],
                                  show_instancer_for_render=row['show_instancer_for_render'])
            obj.original = obj
            self.objects[obj.name] = obj
        self.native = [SimpleNamespace(
            object=SimpleNamespace(original=self.objects[row['source']], color=row['color'], data=SimpleNamespace(as_pointer=lambda pointer=row['data_pointer']:pointer)
                                  if row['source']=='ConvertedCurve' and row['data_pointer'] != row['source_data_pointer']
                                  else row['source']),
            instance_object=SimpleNamespace(data=row['source']) if row['is_instance'] else None,
            parent=self.objects[row['owner']] if row['owner'] else None,
            is_instance=row['is_instance'], show_self=row['show_self'],
            persistent_id=row['persistent_id'], random_id=row['random_id'],
            matrix_world=row['matrix']) for row in self.fixture['native']]
        tree = ast.parse((root.parent / 'browser/session.py').read_text())
        fn = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and
                  node.name == '_depsgraph_placements')
        namespace = {'json': json, 'warn': lambda msg: self.fail(msg),
                     'bpy': SimpleNamespace(data=SimpleNamespace(objects=self.objects))}
        exec(compile(ast.Module(body=[fn], type_ignores=[]), 'session.py', 'exec'), namespace)
        self.export = namespace[fn.name]
        self.frame = {'objects': copy.deepcopy(self.fixture['objects']),
                      'instance_geometry':self.fixture['instance_geometry']}

    def test_collection_nested_and_particle_placements_match_native_metadata(self):
        draws = self.export(self.frame, SimpleNamespace(object_instances=self.native))
        expected = [row for row in self.fixture['native'] if row['is_instance'] and
                    row['show_self'] and self.objects[row['source']].type in ('MESH','CURVE')]
        self.assertEqual(len(draws), 22)
        self.assertEqual(len(draws), len(expected))
        self.assertEqual(len({row['id'] for row in draws}), len(draws))
        self.assertNotIn('instance_geometry',self.frame,'native address tokens do not reach the presenter')
        for actual, native in zip(draws, expected):
            self.assertEqual(actual['matrix'], native['matrix'])
            self.assertEqual(actual['random'], native['random'])
            self.assertEqual(actual['color'], native['color'])
            self.assertEqual(actual['source'], native['source'])
            self.assertEqual(actual['owner'], native['owner'])
        repeated = self.export({'objects':self.frame['objects'],
                                'instance_geometry':self.fixture['instance_geometry']},
                               SimpleNamespace(object_instances=self.native))
        self.assertEqual(draws, repeated)
        emitter = next(row for row in self.frame['objects'] if row['name'] == 'Emitter')
        self.assertFalse(emitter['viewport_show_self'])
        self.assertFalse(emitter['render_show_self'])

    def test_render_hidden_owner_keeps_viewport_placements_and_hides_render(self):
        self.objects['Emitter'].hide_render = True
        draws = self.export(self.frame, SimpleNamespace(object_instances=self.native))
        particles = [row for row in draws if row['owner'] == 'Emitter']
        self.assertEqual(len(particles), 7)
        self.assertTrue(all(row['visible'] and not row['render_visible'] for row in particles))

    def test_differing_geometry_cannot_draw_the_source_mesh_as_a_substitute(self):
        instance = next(row for row in self.native if row.is_instance and row.object.original.type == 'MESH')
        instance.object.data = SimpleNamespace(as_pointer=lambda: -1)
        with self.assertRaisesRegex(NotImplementedError, 'geometry differs'):
            self.export(self.frame, SimpleNamespace(object_instances=self.native))

    def test_missing_native_geometry_is_named(self):
        self.frame['objects'] = [row for row in self.frame['objects'] if row['name'] != 'SourceCube']
        with self.assertRaisesRegex(NotImplementedError, 'SourceCube'):
            self.export(self.frame, SimpleNamespace(object_instances=self.native))

    def test_shadow_visibility_intersects_source_and_instancer_like_cycles(self):
        self.objects['Emitter'].visible_shadow = False
        self.objects['SourceCube'].visible_shadow = False
        draws = self.export(self.frame, SimpleNamespace(object_instances=self.native))
        for draw in draws:
            expected = self.objects[draw['source']].visible_shadow and (
                draw['owner'] is None or self.objects[draw['owner']].visible_shadow)
            self.assertEqual(draw['shadow_visible'], expected)
            self.assertTrue(draw['visible'], 'ray visibility does not hide the camera draw')
        for row in self.frame['objects']:
            self.assertEqual(row['shadow_visible'], self.objects[row['name']].visible_shadow)


if __name__ == '__main__':
    unittest.main()
