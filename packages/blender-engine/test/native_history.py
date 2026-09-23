"""Address/grouping tests; native restoration itself is verified in the editor."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest


class NativeHistoryTest(unittest.TestCase):
    def setUp(self):
        self.calls = []
        class Operator:
            def __init__(op, name):
                op.name = name
                op.available = True
                op.result = {"FINISHED"}
                op.after = lambda: None
            def poll(op):
                return op.available
            def __call__(op, **kwargs):
                self.calls.append(op.name)
                op.after()
                return op.result
        self.undo = Operator("undo")
        self.redo = Operator("redo")
        self.push = Operator("push")
        self.preferences = SimpleNamespace()
        session = SimpleNamespace(session="test", document_relative="cube.blend",
                                  forget=lambda: None, present=lambda: None)
        namespace = {
            "bpy": SimpleNamespace(
                context=SimpleNamespace(preferences=SimpleNamespace(edit=self.preferences),
                                        view_layer=SimpleNamespace(update=lambda: None)),
                ops=SimpleNamespace(ed=SimpleNamespace(undo=self.undo, redo=self.redo,
                                                       undo_push=self.push))),
            "SESSION": session,
            "_blender_web": SimpleNamespace(session_reset=lambda: None),
        }
        tree = ast.parse((Path(__file__).parent.parent / "browser/session.py").read_text())
        nodes = [node for node in tree.body
                 if isinstance(node, (ast.ClassDef, ast.FunctionDef))
                 and node.name in ("NativeHistory", "dispatch")]
        exec(compile(ast.Module(body=nodes, type_ignores=[]), "session.py", "exec"), namespace)
        self.history = namespace["HISTORY"] = namespace["NativeHistory"]()
        self.dispatch = namespace["dispatch"]
        self.namespace = namespace

    def test_refused_property_preserves_redo_without_an_empty_checkpoint(self):
        h = self.history
        h.commit("Move")
        token = h.steps[-1]
        h.move(token, "undo")
        def refused(request):
            raise ValueError("read-only")
        self.namespace["_dispatch"] = refused
        with self.assertRaisesRegex(ValueError, "read-only"):
            self.dispatch({"op": "rna-set", "property": "users"})
        self.assertEqual(h.cursor, 0)
        self.assertEqual(len(h.events), 1)
        h.move(token, "redo")

    def test_partial_script_failure_retains_an_undo_checkpoint(self):
        def partial(request):
            self.history.changed()
            raise ValueError("script failed after a write")
        self.namespace["_dispatch"] = partial
        with self.assertRaisesRegex(ValueError, "after a write"):
            self.dispatch({"op": "execute"})
        self.assertEqual(len(self.history.events), 1)

    def test_file_load_invalidates_history_without_a_phantom_checkpoint(self):
        self.history.commit("Move")
        def load(request):
            self.history.changed()
            self.history.reset()
        self.namespace["_dispatch"] = load
        self.dispatch({"op": "execute"})
        self.assertEqual(self.history.steps, [])
        self.assertEqual(self.dispatch({"op": "history-events"}), [{"reset": True}])
        self.assertFalse(self.history.initialized)

    def test_native_steps_and_branching(self):
        h = self.history
        h.commit("Move")
        first = h.steps[-1]
        h.commit("Rename")
        discarded = h.steps[-1]
        h.move(discarded, "undo")
        h.move(discarded, "redo")
        h.move(discarded, "undo")
        h.commit("Delete")
        self.assertEqual(h.steps[0], first)
        with self.assertRaisesRegex(RuntimeError, "expired"):
            h.move(discarded, "redo")
        self.assertEqual(self.calls.count("undo"), 2)
        self.assertEqual(self.calls.count("redo"), 1)

    def test_external_native_undo_expires_tokens_but_host_undo_does_not(self):
        h = self.history
        self.undo.after = h.native_moved
        h.commit("Move")
        token = h.steps[-1]
        h.move(token, "undo")
        self.assertEqual(h.steps, [token])
        self.assertFalse(h.moving)
        self.undo()
        self.assertEqual(h.steps, [])
        self.assertEqual(h.events, [{"reset": True}])

    def test_nested_gesture_is_one_step_and_blocks_undo(self):
        h = self.history
        self.dispatch({"op": "history-begin"})
        self.dispatch({"op": "history-begin"})
        h.commit("Move")
        h.commit("Move")
        with self.assertRaisesRegex(RuntimeError, "gesture"):
            h.move("unused", "undo")
        self.dispatch({"op": "history-end"})
        self.assertEqual(h.events, [])
        self.dispatch({"op": "history-end"})
        self.assertEqual(len(h.events), 1)
        self.assertEqual(self.calls, ["push", "push"])

    def test_empty_gesture_and_unbalanced_end(self):
        self.dispatch({"op": "history-begin"})
        self.dispatch({"op": "history-end"})
        self.assertEqual(self.history.events, [])
        with self.assertRaisesRegex(RuntimeError, "No Blender gesture"):
            self.dispatch({"op": "history-end"})

    def test_evicted_native_step_does_not_advance_cursor(self):
        h = self.history
        h.commit("Move")
        self.undo.available = False
        with self.assertRaisesRegex(RuntimeError, "cannot undo"):
            h.move(h.steps[-1], "undo")
        self.assertEqual(h.cursor, 1)

    def test_cancelled_checkpoint_never_emits_a_history_entry(self):
        h = self.history
        h.begin()
        self.push.result = {"CANCELLED"}
        with self.assertRaisesRegex(RuntimeError, "checkpoint"):
            h.commit("Move")
        self.assertEqual(h.events, [])
        self.assertEqual(h.cursor, 0)

    def test_reset_expires_tokens_and_gestures(self):
        h = self.history
        h.commit("Move")
        old = h.steps[-1]
        self.dispatch({"op": "history-begin"})
        h.reset()
        h.commit("New document")
        with self.assertRaisesRegex(RuntimeError, "expired"):
            h.move(old, "undo")
        self.assertEqual(h.group_depth, 0)
        self.assertNotEqual(h.steps[-1], old)
        self.assertEqual(self.preferences.undo_memory_limit, 256)


class WorldDescriptionTest(unittest.TestCase):
    def test_volume_only_world_and_mixed_closures(self):
        def socket(value=0, links=None, kind="VALUE"):
            return SimpleNamespace(default_value=value, type=kind, links=links or [], is_linked=bool(links))
        def link(node):
            return SimpleNamespace(from_node=node, from_socket=SimpleNamespace(name="Volume", type="SHADER"))
        absorption = SimpleNamespace(bl_idname="ShaderNodeVolumeAbsorption", as_pointer=lambda: 1,
            inputs={"Color": socket([0.2, 0.4, 0.8, 1], kind="RGBA"), "Density": socket(2)})
        scatter = SimpleNamespace(bl_idname="ShaderNodeVolumeScatter", as_pointer=lambda: 2,
            phase="RAYLEIGH", inputs={"Color": socket([1, 1, 1, 1], kind="RGBA"), "Density": socket(0.5)})
        mix = SimpleNamespace(bl_idname="ShaderNodeMixShader", as_pointer=lambda: 3,
            inputs=[socket(0.25), socket(links=[link(absorption)]), socket(links=[link(scatter)])])
        output = SimpleNamespace(bl_idname="ShaderNodeOutputWorld", is_active_output=True,
            inputs={"Surface": socket(), "Volume": socket(links=[link(mix)])})
        tree = ast.parse((Path(__file__).parent.parent / "browser/session.py").read_text())
        names = ("_surface_backgrounds", "_describe_world_socket", "_describe_world_volume", "_describe_background", "_describe_world")
        nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
        namespace = {}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), "session.py", "exec"), namespace)
        result = namespace["_describe_world"](SimpleNamespace(node_tree=SimpleNamespace(nodes=[output])))
        self.assertEqual(result["color"], [0, 0, 0])
        self.assertEqual([v["kind"] for v in result["volume"]], ["absorption", "scatter"])
        self.assertEqual(result["volume"][0]["density"], 2)
        self.assertEqual(result["volume"][1]["phase"], "RAYLEIGH")
        mix.inputs[1].links = [link(mix)]
        with self.assertRaisesRegex(NotImplementedError, "cycle"):
            namespace["_describe_world"](SimpleNamespace(node_tree=SimpleNamespace(nodes=[output])))

    def test_linked_strength_survives_constant_color_optimization(self):
        def socket(value, kind="VALUE", links=None):
            return SimpleNamespace(default_value=value, type=kind, links=links or [],
                                   is_linked=bool(links))
        math_node = SimpleNamespace(bl_idname="ShaderNodeMath", operation="MULTIPLY",
                                    use_clamp=False, inputs=[socket(2), socket(3)])
        link = SimpleNamespace(from_node=math_node,
                               from_socket=SimpleNamespace(name="Value", type="VALUE"))
        background = SimpleNamespace(bl_idname="ShaderNodeBackground", inputs={
            "Color": socket([0.2, 0.4, 0.8, 1], "RGBA"),
            "Strength": socket(1, links=[link]),
        })
        output = SimpleNamespace(bl_idname="ShaderNodeOutputWorld", is_active_output=True,
                                 inputs={"Surface": socket(0, links=[SimpleNamespace(from_node=background)]),
                                         "Volume": socket(0)})
        world = SimpleNamespace(node_tree=SimpleNamespace(nodes=[output]))
        tree = ast.parse((Path(__file__).parent.parent / "browser/session.py").read_text())
        nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                 and node.name in ("_surface_backgrounds", "_describe_world_socket", "_describe_world_volume", "_describe_background", "_describe_world")]
        namespace = {}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), "session.py", "exec"), namespace)
        result = namespace["_describe_world"](world)
        self.assertEqual(result["strength"], 1)
        self.assertEqual(result["shader"]["kind"], "mix_color")
        self.assertEqual(result["shader"]["factor"]["inputs"], [2, 3])
        self.assertEqual(result["shader"]["b"], [0.2, 0.4, 0.8])


if __name__ == "__main__":
    unittest.main()
