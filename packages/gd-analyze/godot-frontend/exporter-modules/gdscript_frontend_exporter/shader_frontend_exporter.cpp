#include "gdscript_frontend_exporter.h"

#include "servers/rendering/rendering_server.h"
#include "servers/rendering/shader_language.h"
#include "servers/rendering/shader_preprocessor.h"
#include "servers/rendering/shader_types.h"

// The pinned Godot's own shader frontend (ShaderPreprocessor, then ShaderLanguage::compile over the
// server's ShaderTypes for the shader's mode, as Shader::set_code and ShaderCompiler::compile run
// them), its parsed and type-checked tree serialized node by node. Nothing is re-derived here: every
// type, operator and resolved name is the official parser's.

#ifdef RSE
#define VGAI_SHADER_MODE RSE::ShaderMode
#define VGAI_SHADER_ENUM(name) RSE::name
#else
#define VGAI_SHADER_MODE RS::ShaderMode
#define VGAI_SHADER_ENUM(name) RS::name
#endif

namespace {

using SL = ShaderLanguage;

const char *shader_node_kind(SL::Node::Type p_type) {
	switch (p_type) {
		case SL::Node::NODE_TYPE_SHADER: return "SHADER";
		case SL::Node::NODE_TYPE_FUNCTION: return "FUNCTION";
		case SL::Node::NODE_TYPE_BLOCK: return "BLOCK";
		case SL::Node::NODE_TYPE_VARIABLE: return "VARIABLE";
		case SL::Node::NODE_TYPE_VARIABLE_DECLARATION: return "VARIABLE_DECLARATION";
		case SL::Node::NODE_TYPE_CONSTANT: return "CONSTANT";
		case SL::Node::NODE_TYPE_OPERATOR: return "OPERATOR";
		case SL::Node::NODE_TYPE_CONTROL_FLOW: return "CONTROL_FLOW";
		case SL::Node::NODE_TYPE_MEMBER: return "MEMBER";
		case SL::Node::NODE_TYPE_ARRAY: return "ARRAY";
		case SL::Node::NODE_TYPE_ARRAY_CONSTRUCT: return "ARRAY_CONSTRUCT";
		case SL::Node::NODE_TYPE_STRUCT: return "STRUCT";
	}
	return "UNEXPORTED";
}

// A scalar by its data type's scalar kind; a float is its exact binary32 bits.
Dictionary shader_scalar(const SL::Scalar &p_value, SL::DataType p_type) {
	Dictionary encoded;
	switch (SL::get_scalar_type(p_type)) {
		case SL::TYPE_BOOL:
			encoded["bool"] = p_value.boolean;
			break;
		case SL::TYPE_INT:
			encoded["int"] = p_value.sint;
			break;
		case SL::TYPE_UINT:
			encoded["uint"] = (int64_t)p_value.uint;
			break;
		default:
			encoded["floatBits"] = (int64_t)p_value.uint;
			break;
	}
	return encoded;
}

Array shader_scalars(const Vector<SL::Scalar> &p_values, SL::DataType p_type) {
	Array values;
	for (const SL::Scalar &value : p_values) {
		values.push_back(shader_scalar(value, p_type));
	}
	return values;
}

Variant shader_node(const SL::Node *p_node);

Array shader_nodes(const Vector<SL::Node *> &p_nodes) {
	Array nodes;
	for (const SL::Node *node : p_nodes) {
		nodes.push_back(shader_node(node));
	}
	return nodes;
}

Dictionary shader_type(SL::DataType p_type, const String &p_struct = String(), int p_array_size = 0) {
	Dictionary type;
	type["id"] = (int)p_type;
	type["name"] = SL::get_datatype_name(p_type);
	type["struct"] = p_struct;
	type["arraySize"] = p_array_size;
	return type;
}

Variant shader_node(const SL::Node *p_node) {
	if (p_node == nullptr) {
		return Variant();
	}
	Dictionary encoded;
	encoded["kind"] = shader_node_kind(p_node->type);
	encoded["datatype"] = shader_type(p_node->get_datatype(), p_node->get_datatype_name(), p_node->get_array_size());
	switch (p_node->type) {
		case SL::Node::NODE_TYPE_OPERATOR: {
			const SL::OperatorNode *node = static_cast<const SL::OperatorNode *>(p_node);
			encoded["op"] = (int)node->op;
			encoded["opText"] = SL::get_operator_text(node->op);
			encoded["arguments"] = shader_nodes(node->arguments);
			encoded["values"] = shader_scalars(node->values, node->return_cache);
		} break;
		case SL::Node::NODE_TYPE_VARIABLE: {
			const SL::VariableNode *node = static_cast<const SL::VariableNode *>(p_node);
			encoded["name"] = String(node->name);
			encoded["rname"] = String(node->rname);
			encoded["const"] = node->is_const;
			encoded["local"] = node->is_local;
		} break;
		case SL::Node::NODE_TYPE_VARIABLE_DECLARATION: {
			const SL::VariableDeclarationNode *node = static_cast<const SL::VariableDeclarationNode *>(p_node);
			encoded["precision"] = SL::get_precision_name(node->precision);
			encoded["declared"] = shader_type(node->datatype, node->struct_name);
			encoded["const"] = node->is_const;
			Array declarations;
			for (const SL::VariableDeclarationNode::Declaration &declaration : node->declarations) {
				Dictionary row;
				row["name"] = String(declaration.name);
				row["size"] = (int64_t)declaration.size;
				row["sizeExpression"] = shader_node(declaration.size_expression);
				row["initializer"] = shader_nodes(declaration.initializer);
				row["singleExpression"] = declaration.single_expression;
				declarations.push_back(row);
			}
			encoded["declarations"] = declarations;
		} break;
		case SL::Node::NODE_TYPE_CONSTANT: {
			const SL::ConstantNode *node = static_cast<const SL::ConstantNode *>(p_node);
			encoded["values"] = shader_scalars(node->values, node->datatype);
			Array declarations;
			for (const SL::VariableDeclarationNode::Declaration &declaration : node->array_declarations) {
				Dictionary row;
				row["name"] = String(declaration.name);
				row["size"] = (int64_t)declaration.size;
				row["initializer"] = shader_nodes(declaration.initializer);
				declarations.push_back(row);
			}
			encoded["arrayDeclarations"] = declarations;
		} break;
		case SL::Node::NODE_TYPE_BLOCK: {
			const SL::BlockNode *node = static_cast<const SL::BlockNode *>(p_node);
			encoded["blockType"] = node->block_type;
			encoded["singleStatement"] = node->single_statement;
			encoded["commaBetweenStatements"] = node->use_comma_between_statements;
			Array statements;
			for (const SL::Node *statement : node->statements) {
				statements.push_back(shader_node(statement));
			}
			encoded["statements"] = statements;
		} break;
		case SL::Node::NODE_TYPE_CONTROL_FLOW: {
			const SL::ControlFlowNode *node = static_cast<const SL::ControlFlowNode *>(p_node);
			encoded["flowOp"] = (int)node->flow_op;
			encoded["expressions"] = shader_nodes(node->expressions);
			Array blocks;
			for (const SL::BlockNode *block : node->blocks) {
				blocks.push_back(shader_node(block));
			}
			encoded["blocks"] = blocks;
		} break;
		case SL::Node::NODE_TYPE_MEMBER: {
			const SL::MemberNode *node = static_cast<const SL::MemberNode *>(p_node);
			encoded["basetype"] = shader_type(node->basetype, node->base_struct_name);
			encoded["name"] = String(node->name);
			encoded["owner"] = shader_node(node->owner);
			encoded["indexExpression"] = shader_node(node->index_expression);
			encoded["assignExpression"] = shader_node(node->assign_expression);
			encoded["callExpression"] = shader_node(node->call_expression);
			encoded["swizzleDuplicates"] = node->has_swizzling_duplicates;
		} break;
		case SL::Node::NODE_TYPE_ARRAY: {
			const SL::ArrayNode *node = static_cast<const SL::ArrayNode *>(p_node);
			encoded["name"] = String(node->name);
			encoded["local"] = node->is_local;
			encoded["const"] = node->is_const;
			encoded["indexExpression"] = shader_node(node->index_expression);
			encoded["callExpression"] = shader_node(node->call_expression);
			encoded["assignExpression"] = shader_node(node->assign_expression);
		} break;
		case SL::Node::NODE_TYPE_ARRAY_CONSTRUCT: {
			const SL::ArrayConstructNode *node = static_cast<const SL::ArrayConstructNode *>(p_node);
			encoded["initializer"] = shader_nodes(node->initializer);
		} break;
		case SL::Node::NODE_TYPE_STRUCT: {
			const SL::StructNode *node = static_cast<const SL::StructNode *>(p_node);
			Array members;
			for (const SL::MemberNode *member : node->members) {
				members.push_back(shader_node(member));
			}
			encoded["members"] = members;
		} break;
		case SL::Node::NODE_TYPE_FUNCTION: {
			const SL::FunctionNode *node = static_cast<const SL::FunctionNode *>(p_node);
			encoded["name"] = String(node->name);
			encoded["rname"] = String(node->rname);
			encoded["returnType"] = shader_type(node->return_type, node->return_struct_name, node->return_array_size);
			Array arguments;
			for (const SL::FunctionNode::Argument &argument : node->arguments) {
				Dictionary row;
				row["name"] = String(argument.name);
				row["type"] = shader_type(argument.type, argument.struct_name, argument.array_size);
				row["qualifier"] = (int)argument.qualifier;
				row["const"] = argument.is_const;
				arguments.push_back(row);
			}
			encoded["arguments"] = arguments;
			encoded["body"] = shader_node(node->body);
			encoded["canDiscard"] = node->can_discard;
		} break;
		case SL::Node::NODE_TYPE_SHADER:
			break;
	}
	return encoded;
}

Dictionary shader_tree(const SL::ShaderNode *p_shader) {
	Dictionary tree;
	Array render_modes;
	for (const StringName &mode : p_shader->render_modes) {
		render_modes.push_back(String(mode));
	}
	tree["renderModes"] = render_modes;
	Array uniforms;
	for (const KeyValue<StringName, SL::ShaderNode::Uniform> &entry : p_shader->uniforms) {
		const SL::ShaderNode::Uniform &uniform = entry.value;
		Dictionary row;
		row["name"] = String(entry.key);
		row["type"] = shader_type(uniform.type, String(), uniform.array_size);
		row["order"] = uniform.order;
		row["textureOrder"] = uniform.texture_order;
		row["scope"] = (int)uniform.scope;
		row["hint"] = (int)uniform.hint;
		row["hintName"] = SL::get_uniform_hint_name(uniform.hint);
		row["useColor"] = uniform.use_color;
		row["filter"] = (int)uniform.filter;
		row["repeat"] = (int)uniform.repeat;
		Array range;
		for (int i = 0; i < 3; i++) {
			SL::Scalar bits;
			bits.real = uniform.hint_range[i];
			range.push_back((int64_t)bits.uint);
		}
		row["hintRangeBits"] = range;
		row["default"] = shader_scalars(uniform.default_value, uniform.type);
		row["group"] = uniform.group;
		uniforms.push_back(row);
	}
	tree["uniforms"] = uniforms;
	Array varyings;
	for (const KeyValue<StringName, SL::ShaderNode::Varying> &entry : p_shader->varyings) {
		Dictionary row;
		row["name"] = String(entry.key);
		row["type"] = shader_type(entry.value.type, String(), entry.value.array_size);
		row["stage"] = (int)entry.value.stage;
		row["interpolation"] = (int)entry.value.interpolation;
		varyings.push_back(row);
	}
	tree["varyings"] = varyings;
	Array constants;
	for (const SL::ShaderNode::Constant &constant : p_shader->vconstants) {
		Dictionary row;
		row["name"] = String(constant.name);
		row["type"] = shader_type(constant.type, constant.struct_name, constant.array_size);
		row["initializer"] = shader_node(constant.initializer);
		constants.push_back(row);
	}
	tree["constants"] = constants;
	Array structs;
	for (const SL::ShaderNode::Struct &shader_struct : p_shader->vstructs) {
		Dictionary row;
		row["name"] = String(shader_struct.name);
		row["struct"] = shader_node(shader_struct.shader_struct);
		structs.push_back(row);
	}
	tree["structs"] = structs;
	Array functions;
	for (const SL::ShaderNode::Function &function : p_shader->vfunctions) {
		Dictionary row;
		row["name"] = String(function.name);
		row["callable"] = function.callable;
		row["function"] = shader_node(function.function);
		functions.push_back(row);
	}
	tree["functions"] = functions;
	return tree;
}

} // namespace

Dictionary GDScriptFrontendExporter::export_shader(const String &p_source, const String &p_shader_path) {
	Dictionary result;
	result["path"] = p_shader_path;
	String preprocessed;
	String preprocess_error;
	ShaderPreprocessor preprocessor;
	Error preprocessed_ok = preprocessor.preprocess(p_source, p_shader_path, preprocessed, &preprocess_error);
	if (preprocessed_ok != OK) {
		result["ok"] = false;
		result["stage"] = "preprocess";
		result["message"] = preprocess_error;
		return result;
	}
	result["preprocessed"] = preprocessed;
	const String type = SL::get_shader_type(preprocessed);
	result["shaderType"] = type;
	VGAI_SHADER_MODE mode;
	if (type == "spatial") {
		mode = VGAI_SHADER_ENUM(SHADER_SPATIAL);
	} else if (type == "canvas_item") {
		mode = VGAI_SHADER_ENUM(SHADER_CANVAS_ITEM);
	} else if (type == "particles") {
		mode = VGAI_SHADER_ENUM(SHADER_PARTICLES);
	} else if (type == "sky") {
		mode = VGAI_SHADER_ENUM(SHADER_SKY);
	} else if (type == "fog") {
		mode = VGAI_SHADER_ENUM(SHADER_FOG);
	} else {
		result["ok"] = false;
		result["stage"] = "type";
		result["message"] = "shader_type " + type + " is not exported";
		return result;
	}
	SL::ShaderCompileInfo info;
	info.functions = ShaderTypes::get_singleton()->get_functions(mode);
	info.render_modes = ShaderTypes::get_singleton()->get_modes(mode);
	info.stencil_modes = ShaderTypes::get_singleton()->get_stencil_modes(mode);
	info.shader_types = ShaderTypes::get_singleton()->get_types();
	SL parser;
	Error compiled = parser.compile(preprocessed, info);
	if (compiled != OK) {
		result["ok"] = false;
		result["stage"] = "compile";
		result["message"] = parser.get_error_text();
		result["line"] = parser.get_error_line();
		return result;
	}
	result["ok"] = true;
	result["tree"] = shader_tree(parser.get_shader());
	return result;
}

// An engine material (PanoramaSkyMaterial, ProceduralSkyMaterial, PhysicalSkyMaterial) has no
// `.gdshader`: its class generates the shader text itself and hands it to the RenderingServer
// (`sky_material.cpp` `_update_shader`). The material's own shader RID and the server's
// `shader_get_code` return exactly that text, which then goes through the same frontend as a
// project shader. The pinned official-source patch makes the headless (dummy) server keep the
// code it is given, which it otherwise discards.
Dictionary GDScriptFrontendExporter::export_engine_shader(const Ref<Material> &p_material, const String &p_shader_path) {
	Dictionary result;
	result["path"] = p_shader_path;
	if (p_material.is_null()) {
		result["ok"] = false;
		result["stage"] = "material";
		result["message"] = "no material";
		return result;
	}
	const String code = RS::get_singleton()->shader_get_code(p_material->get_shader_rid());
	if (code.is_empty()) {
		result["ok"] = false;
		result["stage"] = "generate";
		result["message"] = p_material->get_class() + " produced no shader text";
		return result;
	}
	Dictionary exported = export_shader(code, p_shader_path);
	exported["source"] = code;
	return exported;
}
