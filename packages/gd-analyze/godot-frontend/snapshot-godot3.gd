extends SceneTree

# Godot 3 counterpart of snapshot-godot4.gd. The reflection calls are the engine's own Script
# API; the filesystem spellings are versioned because Godot 3 predates DirAccess/FileAccess.

const PROTOCOL = "vgai.godot-semantic-snapshot"
const PROTOCOL_VERSION = 1

var _out_path = ""
var _failed = false

func _init():
	var args = OS.get_cmdline_args()
	for i in range(args.size()):
		if args[i] == "--out" and i + 1 < args.size():
			_out_path = args[i + 1]
	if _out_path == "":
		push_error("snapshot-godot3.gd: pass -- --out <snapshot.json>")
		quit(2)
		return

	var paths = []
	_collect_scripts("res://", paths)
	paths.sort()
	var scripts = []
	for path in paths:
		var script = ResourceLoader.load(path, "GDScript", true)
		if script == null or not script is Script or script.reload() != OK:
			push_error("snapshot-godot3.gd: Godot could not parse/analyze %s" % path)
			_failed = true
			continue
		scripts.append(_script_row(path, script))
	if _failed:
		quit(3)
		return

	var version = Engine.get_version_info()
	var snapshot = {
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
	var out = File.new()
	if out.open(_out_path, File.WRITE) != OK:
		push_error("snapshot-godot3.gd: cannot write %s" % _out_path)
		quit(4)
		return
	out.store_string(JSON.print(snapshot, "  "))
	out.close()
	quit(0)

func _collect_scripts(root, paths):
	var directory = Directory.new()
	if directory.open(root) != OK:
		push_error("snapshot-godot3.gd: cannot open %s" % root)
		_failed = true
		return
	directory.list_dir_begin(true, true)
	while true:
		var name = directory.get_next()
		if name == "":
			break
		var path = root.plus_file(name)
		if directory.current_is_dir():
			_collect_scripts(path, paths)
		elif name.ends_with(".gd"):
			paths.append(path)
	directory.list_dir_end()

func _script_row(path, script):
	var file = File.new()
	var base = script.get_base_script()
	var properties = _json_value(script.get_script_property_list())
	var defaults = {}
	for property in script.get_script_property_list():
		defaults[String(property["name"])] = _json_value(
			script.get_property_default_value(property["name"])
		)
	return {
		"resPath": path,
		"sourceSha256": file.get_sha256(path),
		"globalName": null,
		"baseScript": base.resource_path if base != null else null,
		"instanceBaseType": script.get_instance_base_type(),
		"tool": script.is_tool(),
		"abstract": false,
		"methods": _json_value(script.get_script_method_list()),
		"properties": properties,
		"propertyDefaults": defaults,
		"signals": _json_value(script.get_script_signal_list()),
		"constants": _json_value(script.get_script_constant_map()),
		"rpcConfig": null,
	}

func _json_value(value):
	match typeof(value):
		TYPE_NIL, TYPE_BOOL, TYPE_INT, TYPE_REAL, TYPE_STRING:
			return value
		TYPE_NODE_PATH:
			return String(value)
		TYPE_ARRAY:
			var result = []
			for item in value:
				result.append(_json_value(item))
			return result
		TYPE_DICTIONARY:
			var result = {}
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
			return {"$type": typeof(value), "$value": str(value)}
