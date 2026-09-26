extends SceneTree

# This script is only a process adapter. GDScriptFrontendExporter is compiled directly against the
# pinned Godot frontend and supplies every token, node, binding, type, and compiler outcome.

const PROTOCOL := "vgai.godot-bound-program"
const PROTOCOL_VERSION := 9

var _out_path := ""
var _binary_sha256 := ""
var _failed := false

func _init() -> void:
	var args := OS.get_cmdline_user_args()
	for index in args.size():
		if args[index] == "--out" and index + 1 < args.size():
			_out_path = args[index + 1]
		elif args[index] == "--binary-sha256" and index + 1 < args.size():
			_binary_sha256 = args[index + 1]
	if _out_path == "" or _binary_sha256.length() != 64:
		push_error("capture-bound-program-godot4.gd requires --out and a 64-character --binary-sha256")
		quit(2)
		return

	var paths: Array[String] = []
	_collect_scripts("res://", paths)
	paths.sort()
	if _failed:
		quit(3)
		return

	var exporter := GDScriptFrontendExporter.new()
	var identity: Dictionary = exporter.get_build_identity()
	var sources: Dictionary = {}
	for path in paths:
		var source := FileAccess.get_file_as_string(path)
		sources[path] = source
		exporter.register_source(source, path)
	for path in paths:
		exporter.prepare_source(path)
	exporter.seal_sources_for_compilation()
	var scripts: Array = []
	for path in paths:
		var source: String = sources[path]
		var row: Dictionary = exporter.export_source(source, path)
		row["sourceSha256"] = FileAccess.get_sha256(path)
		scripts.append(row)

	var version := Engine.get_version_info()
	var output := {
		"protocol": PROTOCOL,
		"protocolVersion": PROTOCOL_VERSION,
		"authority": {
			"sourceRevision": identity["sourceRevision"],
			"sourceTreeSha256": identity["sourceTreeSha256"],
			"sourceArchiveSha256": identity["sourceArchiveSha256"],
			"exporterSourceSha256": identity["exporterSourceSha256"],
			"executableSha256": _binary_sha256,
			"buildOptions": identity["buildOptions"],
		},
		"engine": {
			"major": version["major"],
			"minor": version["minor"],
			"patch": version["patch"],
			"status": version["status"],
			"build": version["build"],
			"reportedRevision": version["hash"],
			"string": version["string"],
		},
		"scripts": scripts,
	}
	var file := FileAccess.open(_out_path, FileAccess.WRITE)
	if file == null:
		push_error("capture-bound-program-godot4.gd cannot write %s" % _out_path)
		quit(4)
		return
	file.store_string(JSON.stringify(output, "  ", false))
	file.close()
	quit(0)

func _collect_scripts(root: String, paths: Array[String]) -> void:
	var directory := DirAccess.open(root)
	if directory == null:
		push_error("capture-bound-program-godot4.gd cannot open %s" % root)
		_failed = true
		return
	directory.list_dir_begin()
	while true:
		var name := directory.get_next()
		if name == "":
			break
		if name.begins_with("."):
			continue
		var path := root.path_join(name)
		if directory.current_is_dir():
			_collect_scripts(path, paths)
		elif name.ends_with(".gd"):
			paths.append(path)
	directory.list_dir_end()
