extends SceneTree

# This script is only a process adapter. GDScriptFrontendExporter is compiled directly against the
# pinned Godot frontend and supplies every token, node, binding, type, and compiler outcome.

const PROTOCOL := "vgai.godot-bound-program"
const PROTOCOL_VERSION := 13

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
	var shader_paths: Array[String] = []
	_collect_scripts("res://", paths, shader_paths)
	paths.sort()
	shader_paths.sort()
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
	var shaders: Array = []
	for path in shader_paths:
		var shader_row: Dictionary = exporter.export_shader(FileAccess.get_file_as_string(path), path)
		shader_row["sourceSha256"] = FileAccess.get_sha256(path)
		shaders.append(shader_row)
	# Every variant each engine sky material class generates (sky_material.cpp `_update_shader`),
	# as its own shader text through the same frontend. Translation selects the variant a resource
	# names from its properties.
	var engine_shaders: Array = []
	var cover := PlaceholderTexture2D.new()
	for filter in [false, true]:
		var panorama := PanoramaSkyMaterial.new()
		panorama.filter = filter
		engine_shaders.append(_engine_shader(exporter, panorama, "PanoramaSkyMaterial", {"filter": filter}))
	for debanding in [false, true]:
		for covered in [false, true]:
			var procedural := ProceduralSkyMaterial.new()
			procedural.use_debanding = debanding
			procedural.sky_cover = cover if covered else null
			engine_shaders.append(_engine_shader(exporter, procedural, "ProceduralSkyMaterial", {"use_debanding": debanding, "sky_cover": covered}))
			var physical := PhysicalSkyMaterial.new()
			physical.use_debanding = debanding
			physical.night_sky = cover if covered else null
			engine_shaders.append(_engine_shader(exporter, physical, "PhysicalSkyMaterial", {"use_debanding": debanding, "night_sky": covered}))

	# Every ParticleProcessMaterial a project scene or resource holds (particle_process_material.cpp
	# `_update_shader`): its generated shader, keyed by the material's resource path (a scene's
	# built-in resource is `res://scene.tscn::id`). Needs the official import's cache to load.
	var documents: Array[String] = []
	_collect_documents("res://", documents)
	documents.sort()
	var particle_materials: Dictionary = {}
	for document in documents:
		var loaded = ResourceLoader.load(document)
		if loaded is PackedScene:
			var state: SceneState = (loaded as PackedScene).get_state()
			for node in state.get_node_count():
				for property in state.get_node_property_count(node):
					var value = state.get_node_property_value(node, property)
					if value is ParticleProcessMaterial and value.resource_path != "":
						particle_materials[value.resource_path] = value
		elif loaded is ParticleProcessMaterial and loaded.resource_path != "":
			particle_materials[loaded.resource_path] = loaded
	var particle_paths: Array = particle_materials.keys()
	particle_paths.sort()
	for resource_path in particle_paths:
		engine_shaders.append(_engine_shader(exporter, particle_materials[resource_path], "ParticleProcessMaterial", {"resource": resource_path}))

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
		"shaders": shaders,
		"engineShaders": engine_shaders,
	}
	var file := FileAccess.open(_out_path, FileAccess.WRITE)
	if file == null:
		push_error("capture-bound-program-godot4.gd cannot write %s" % _out_path)
		quit(4)
		return
	file.store_string(JSON.stringify(output, "  ", false))
	file.close()
	quit(0)

func _collect_scripts(root: String, paths: Array[String], shader_paths: Array[String]) -> void:
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
			_collect_scripts(path, paths, shader_paths)
		elif name.ends_with(".gd"):
			paths.append(path)
		elif name.ends_with(".gdshader"):
			shader_paths.append(path)
	directory.list_dir_end()

func _collect_documents(root: String, documents: Array[String]) -> void:
	var directory := DirAccess.open(root)
	if directory == null:
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
			_collect_documents(path, documents)
		elif name.ends_with(".tscn") or name.ends_with(".scn") or name.ends_with(".tres") or name.ends_with(".res"):
			documents.append(path)
	directory.list_dir_end()

func _engine_shader(exporter: GDScriptFrontendExporter, material: Material, material_class: String, variant: Dictionary) -> Dictionary:
	var keys := variant.keys()
	keys.sort()
	var query: Array[String] = []
	for key in keys:
		var value = variant[key]
		query.append("%s=%s" % [key, ("true" if value else "false") if value is bool else str(value)])
	var path := "engine://%s?%s" % [material_class, "&".join(query)]
	var row: Dictionary = {"path": path, "ok": false, "stage": "exporter", "message": "this exporter build exports no engine shader"}
	if exporter.has_method("export_engine_shader"):
		row = exporter.call("export_engine_shader", material, path)
	row["materialClass"] = material_class
	row["variant"] = variant
	row["sourceSha256"] = (row.get("source", "") as String).sha256_text()
	row.erase("source")
	return row
