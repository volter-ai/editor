extends SceneTree

# Runs inside the exact source Godot editor. Loading every script makes Godot's own
# tokenizer/parser/analyzer/compiler the authority for whether the project is valid; Script's
# reflection surface exports the declarations the TypeScript analyzer must bind against.

const PROTOCOL := "vgai.godot-semantic-snapshot"
const PROTOCOL_VERSION := 1

var _out_path := ""
var _failed := false

func _init() -> void:
	var args: PackedStringArray = OS.get_cmdline_user_args()
	for i in args.size():
		if args[i] == "--out" and i + 1 < args.size():
			_out_path = args[i + 1]
	if _out_path == "":
		push_error("snapshot-godot4.gd: pass -- --out <snapshot.json>")
		quit(2)
		return

	var paths: Array[String] = []
	_collect_scripts("res://", paths)
	paths.sort()
	var scripts: Array = []
	for path in paths:
		var script: Script = ResourceLoader.load(path, "GDScript", ResourceLoader.CACHE_MODE_IGNORE) as Script
		if script == null or script.reload() != OK:
			push_error("snapshot-godot4.gd: Godot could not parse/analyze %s" % path)
			_failed = true
			continue
		scripts.append(_script_row(path, script))
	if _failed:
		quit(3)
		return

	var version: Dictionary = Engine.get_version_info()
	var snapshot: Dictionary = {
		"protocol": PROTOCOL,
		"protocolVersion": PROTOCOL_VERSION,
		"engine": {
			"major": version["major"],
			"minor": version["minor"],
			"patch": version["patch"],
			"status": version["status"],
			"build": version["build"],
			"sourceRevision": version["hash"],
			"string": version["string"],
		},
		"scripts": scripts,
	}
	var out: FileAccess = FileAccess.open(_out_path, FileAccess.WRITE)
	if out == null:
		push_error("snapshot-godot4.gd: cannot write %s" % _out_path)
		quit(4)
		return
	out.store_string(JSON.stringify(snapshot, "  ", false))
	out.close()
	quit(0)

func _collect_scripts(root: String, paths: Array[String]) -> void:
	var directory: DirAccess = DirAccess.open(root)
	if directory == null:
		push_error("snapshot-godot4.gd: cannot open %s" % root)
		_failed = true
		return
	directory.list_dir_begin()
	while true:
		var name: String = directory.get_next()
		if name == "":
			break
		if name.begins_with("."):
			continue
		var path: String = root.path_join(name)
		if directory.current_is_dir():
			_collect_scripts(path, paths)
		elif name.ends_with(".gd"):
			paths.append(path)
	directory.list_dir_end()

func _script_row(path: String, script: Script) -> Dictionary:
	var base: Script = script.get_base_script()
	var properties: Variant = _json_value(script.get_script_property_list())
	var defaults: Dictionary = {}
	for property in script.get_script_property_list():
		var property_name: StringName = property["name"]
		defaults[String(property_name)] = _json_value(script.get_property_default_value(property_name))
	return {
		"resPath": path,
		"sourceSha256": FileAccess.get_sha256(path),
		"globalName": script.get_global_name(),
		"baseScript": base.resource_path if base != null else null,
		"instanceBaseType": script.get_instance_base_type(),
		"tool": script.is_tool(),
		"abstract": script.is_abstract(),
		"methods": _json_value(script.get_script_method_list()),
		"properties": properties,
		"propertyDefaults": defaults,
		"signals": _json_value(script.get_script_signal_list()),
		"constants": _json_value(script.get_script_constant_map()),
		"rpcConfig": _json_value(script.get_rpc_config()),
	}

func _json_value(value: Variant) -> Variant:
	match typeof(value):
		TYPE_NIL, TYPE_BOOL, TYPE_INT, TYPE_FLOAT, TYPE_STRING:
			return value
		TYPE_STRING_NAME, TYPE_NODE_PATH:
			return String(value)
		TYPE_ARRAY:
			var result: Array = []
			for item in value:
				result.append(_json_value(item))
			return result
		TYPE_DICTIONARY:
			var result: Dictionary = {}
			for key in value:
				result[String(key)] = _json_value(value[key])
			return result
		TYPE_OBJECT:
			if value == null:
				return null
			return {
				"$type": value.get_class(),
				"$path": value.resource_path if value is Resource else null,
			}
		_:
			return {"$type": type_string(typeof(value)), "$value": str(value)}
