#include "register_types.h"

#include "gdscript_frontend_exporter.h"

#include "core/object/class_db.h"

void initialize_gdscript_frontend_exporter_module(ModuleInitializationLevel p_level) {
	if (p_level != MODULE_INITIALIZATION_LEVEL_SERVERS) {
		return;
	}
	GDREGISTER_CLASS(GDScriptFrontendExporter);
}

void uninitialize_gdscript_frontend_exporter_module(ModuleInitializationLevel p_level) {
	if (p_level != MODULE_INITIALIZATION_LEVEL_SERVERS) {
		return;
	}
}
