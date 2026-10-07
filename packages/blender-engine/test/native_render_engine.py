"""Render-engine ownership, including repeated registration and absent Cycles."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest


class RenderEngineOwnership(unittest.TestCase):
    def check_engines(self, native=True):
        class RenderEngine: pass
        class Presenter(RenderEngine): bl_idname='VOLTER_THREE'
        class Cycles(RenderEngine): bl_idname='CYCLES'
        engines={'CYCLES':Cycles} if native else {}
        registered=[]
        released=[]
        def register(cls):
            registered.append(cls.bl_idname)
            engines[cls.bl_idname]=cls
        def unregister(cls):
            released.append(cls.bl_idname)
            del engines[cls.bl_idname]
        namespace={'bpy':SimpleNamespace(utils=SimpleNamespace(register_class=register,unregister_class=unregister)),
                   'VolterRenderEngine':Presenter,'_engine_class':engines.get,
                   '_release_from_owning_addon':lambda cls:self.fail('native add-on was changed'),
                   'warn':lambda msg:self.fail(msg)}
        tree=ast.parse((Path(__file__).parent.parent/'browser/session.py').read_text())
        fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='_register_engine')
        exec(compile(ast.Module(body=[fn],type_ignores=[]),'session.py','exec'),namespace)
        first=namespace['_register_engine']()
        second=namespace['_register_engine']()
        self.assertEqual(first,second)
        self.assertNotIn('CYCLES',registered)
        self.assertNotIn('CYCLES',released)
        self.assertCountEqual(registered,['BLENDER_EEVEE','BLENDER_WORKBENCH','VOLTER_THREE'])
        if native:
            self.assertIs(engines['CYCLES'],Cycles)
            self.assertIn('CYCLES',first[0]);self.assertNotIn('CYCLES',first[1])
        else:
            self.assertNotIn('CYCLES',first[0]);self.assertIn('CYCLES',first[1])

    def test_native_cycles_survives_repeated_registration(self): self.check_engines()
    def test_missing_cycles_is_not_faked_with_raster_capture(self): self.check_engines(False)


if __name__=='__main__': unittest.main()
