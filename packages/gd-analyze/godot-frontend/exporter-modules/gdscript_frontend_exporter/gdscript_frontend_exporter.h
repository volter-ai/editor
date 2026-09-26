#pragma once

#include "core/object/ref_counted.h"
#include "core/templates/hash_map.h"
#include "core/templates/hash_set.h"
#include "modules/gdscript/gdscript.h"
#include "modules/gdscript/gdscript_cache.h"

class GDScriptFrontendExporter : public RefCounted {
	GDCLASS(GDScriptFrontendExporter, RefCounted);
	HashMap<String, String> registered_sources;
	HashMap<String, Ref<GDScript>> prepared_scripts;
	HashMap<String, Ref<GDScriptParserRef>> prepared_parsers;
	HashMap<String, int> parse_errors;
	HashMap<String, int> analysis_errors;
	HashMap<String, Dictionary> exported_sources;
	HashSet<String> exporting_sources;
	bool project_globals_prepared = false;
	bool compilation_cache_sealed = false;

protected:
	static void _bind_methods();

public:
	Dictionary get_build_identity() const;
	void register_source(const String &p_source, const String &p_script_path);
	void prepare_source(const String &p_script_path);
	void seal_sources_for_compilation();
	Dictionary export_source(const String &p_source, const String &p_script_path);
};
