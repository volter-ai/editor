"""Render-engine ownership, including repeated registration and absent Cycles."""
import ast
from pathlib import Path
from types import SimpleNamespace
from copy import deepcopy
import os
import tempfile
import time
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


class NativePreviewIsolation(unittest.TestCase):
    def namespace(self, renderer=None):
        class Presenter: pass
        class Cycles: pass
        original=SimpleNamespace(name='Authored', camera=SimpleNamespace(name='Camera',type='CAMERA'),
            render=SimpleNamespace(engine='VOLTER_THREE',resolution_x=1431,resolution_y=805,
                resolution_percentage=50,use_compositing=True,use_persistent_data=True,
                image_settings=SimpleNamespace(file_format='OPEN_EXR',color_mode='RGB',color_depth='16'),filepath='authored.exr'),
            cycles=SimpleNamespace(samples=128,use_denoising=True))
        copied=[];removed=[]
        def copy():
            preview=deepcopy(original);preview.name='Owned preview';copied.append(preview);return preview
        original.copy=copy
        original.objects={'Camera':original.camera}
        def render(**args):
            self.assertEqual(args,{'write_still':True,'scene':'Owned preview','layer':'View Layer'})
            self.assertIs(bpy.context.scene,original)
            self.assertEqual(original.render.filepath,'authored.exr')
            self.assertEqual(original.cycles.samples,128)
            if renderer: return renderer(copied[-1])
            raise RuntimeError('Native rendering failed')
        bpy=SimpleNamespace(context=SimpleNamespace(scene=original,view_layer=SimpleNamespace(name='View Layer')),
            data=SimpleNamespace(scenes=SimpleNamespace(remove=lambda scene,do_unlink:removed.append(scene))),
            ops=SimpleNamespace(render=SimpleNamespace(render=render)))
        temporary=tempfile.TemporaryDirectory(prefix='native-preview-test-')
        self.addCleanup(temporary.cleanup)
        namespace={'bpy':bpy,'os':os,'time':time,'ROOT':temporary.name,
            'SESSION':SimpleNamespace(session='native-preview-test',revision=17),
            'VolterRenderEngine':Presenter,'_engine_class':lambda name:Cycles}
        tree=ast.parse((Path(__file__).parent.parent/'browser/session.py').read_text())
        fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='_native_preview')
        exec(compile(ast.Module(body=[fn],type_ignores=[]),'session.py','exec'),namespace)
        return namespace,copied,removed

    def test_rejects_invalid_budgets_before_copying_scene(self):
        namespace,copied,_=self.namespace()
        for key in ('width','height','samples'):
            for invalid in (None,True,1.5,0,-1,1025):
                request={'width':360,'height':202,'samples':8,key:invalid}
                with self.assertRaises(ValueError):namespace['_native_preview'](request)
        self.assertEqual(copied,[])

    def test_native_renderer_is_required(self):
        namespace,copied,_=self.namespace()
        for substitute in (None,namespace['VolterRenderEngine']):
            namespace['_engine_class']=lambda name:substitute
            with self.assertRaisesRegex(RuntimeError,'Native Cycles is unavailable'):
                namespace['_native_preview']({'width':360,'height':202,'samples':8})
        self.assertEqual(copied,[])

    def test_error_and_cancellation_remove_only_the_preview_scene(self):
        for renderer in (None,lambda preview:{'CANCELLED'}):
            namespace,copied,removed=self.namespace(renderer)
            with self.assertRaises(RuntimeError):
                namespace['_native_preview']({'width':360,'height':202,'samples':8})
            self.assertEqual(removed,copied)
            self.assertEqual(len(removed),1)
            self.assertEqual(namespace['SESSION'].revision,17)
            self.assertEqual(namespace['bpy'].context.scene.render.engine,'VOLTER_THREE')
            self.assertEqual(namespace['bpy'].context.scene.render.use_compositing,True)

    def test_success_returns_native_identity_and_preserves_authoring_settings(self):
        def render(preview):
            Path(preview.render.filepath).write_bytes(b'PNG fixture')
            return {'FINISHED'}
        namespace,copied,removed=self.namespace(render)
        result=namespace['_native_preview']({'width':360,'height':202,'samples':8,'camera':'Camera'})
        self.assertEqual((result['renderer'],result['session'],result['revision']),('CYCLES','native-preview-test',17))
        self.assertEqual((result['width'],result['height'],result['samples'],result['camera']),(360,202,8,'Camera'))
        self.assertTrue(Path(result['path']).is_file())
        self.assertEqual(removed,copied)
        original=namespace['bpy'].context.scene
        self.assertEqual((original.render.engine,original.render.resolution_x,original.render.resolution_y),('VOLTER_THREE',1431,805))
        self.assertEqual((original.cycles.samples,original.cycles.use_denoising),(128,True))

    def test_document_identity_read_does_not_execute_export_or_mutate(self):
        tree=ast.parse((Path(__file__).parent.parent/'browser/session.py').read_text())
        fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='_dispatch')
        namespace={'bpy':SimpleNamespace(data=SimpleNamespace(filepath='/project/models/changed.blend')),
            'SESSION':SimpleNamespace(session='native',revision=17)}
        exec(compile(ast.Module(body=[fn],type_ignores=[]),'session.py','exec'),namespace)
        self.assertEqual(namespace['_dispatch']({'op':'document-info'}),
            {'filepath':'/project/models/changed.blend','session':'native','revision':17})
        self.assertEqual(namespace['SESSION'].revision,17)


class RenderExportIsolation(unittest.TestCase):
    def test_capture_failure_restores_export_scope_and_keeps_authoring_session(self):
        for failure in (False,True):
            events=[]
            class CaptureSession:
                def _present(self,capture,depsgraph):
                    events.append((capture,depsgraph,self.session))
                    if failure:raise RuntimeError('capture failed')
                    return {'base64':'pixels'}
            namespace={'Session':CaptureSession,'time':time,
                '_blender_web':SimpleNamespace(begin_render_export=lambda graph:events.append(('begin',graph)),
                    end_render_export=lambda:events.append(('end',)))}
            tree=ast.parse((Path(__file__).parent.parent/'browser/session.py').read_text())
            cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='Session')
            fn=next(n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name=='photograph')
            exec(compile(ast.Module(body=[fn],type_ignores=[]),'session.py','exec'),namespace)
            author=SimpleNamespace(session='author',revision=17,_known={'mesh:authored':3})
            if failure:
                with self.assertRaisesRegex(RuntimeError,'capture failed'):namespace['photograph'](author,'RENDER',{'render':{}})
            else:self.assertEqual(namespace['photograph'](author,'RENDER',{'render':{}}),{'base64':'pixels'})
            self.assertEqual(events[0],('begin','RENDER'));self.assertEqual(events[-1],('end',))
            self.assertEqual(events[1][0]['evaluation'],'render')
            self.assertTrue(events[1][2].startswith('author:render:'))
            self.assertEqual((author.revision,author._known),(17,{'mesh:authored':3}))


if __name__=='__main__': unittest.main()
