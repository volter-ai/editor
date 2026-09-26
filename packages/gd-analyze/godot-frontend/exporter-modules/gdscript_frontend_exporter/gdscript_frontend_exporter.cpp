#include "gdscript_frontend_exporter.h"

#include "build_identity.gen.h"

#include "core/config/project_settings.h"
#include "core/object/class_db.h"
#include "core/object/script_language.h"
#include "modules/gdscript/gdscript.h"
#include "modules/gdscript/gdscript_analyzer.h"
#include "modules/gdscript/gdscript_compiler.h"
#include "modules/gdscript/gdscript_parser.h"
#include "modules/gdscript/gdscript_tokenizer.h"

namespace {

using Node = GDScriptParser::Node;

const char *node_type_name(Node::Type p_type) {
	switch (p_type) {
	case Node::ANNOTATION: return "ANNOTATION";
		case Node::ARRAY: return "ARRAY";
		case Node::ASSERT: return "ASSERT";
		case Node::ASSIGNMENT: return "ASSIGNMENT";
		case Node::AWAIT: return "AWAIT";
		case Node::BINARY_OPERATOR: return "BINARY_OPERATOR";
		case Node::BREAK: return "BREAK";
		case Node::BREAKPOINT: return "BREAKPOINT";
		case Node::CALL: return "CALL";
		case Node::CAST: return "CAST";
		case Node::CLASS: return "CLASS";
		case Node::CONSTANT: return "CONSTANT";
		case Node::CONTINUE: return "CONTINUE";
		case Node::DICTIONARY: return "DICTIONARY";
		case Node::ENUM: return "ENUM";
		case Node::FOR: return "FOR";
		case Node::FUNCTION: return "FUNCTION";
		case Node::GET_NODE: return "GET_NODE";
		case Node::IDENTIFIER: return "IDENTIFIER";
		case Node::IF: return "IF";
		case Node::LAMBDA: return "LAMBDA";
		case Node::LITERAL: return "LITERAL";
		case Node::MATCH: return "MATCH";
		case Node::MATCH_BRANCH: return "MATCH_BRANCH";
		case Node::PARAMETER: return "PARAMETER";
		case Node::PASS: return "PASS";
		case Node::PATTERN: return "PATTERN";
		case Node::PRELOAD: return "PRELOAD";
		case Node::RETURN: return "RETURN";
		case Node::SELF: return "SELF";
		case Node::SIGNAL: return "SIGNAL";
		case Node::SUBSCRIPT: return "SUBSCRIPT";
		case Node::SUITE: return "SUITE";
		case Node::TERNARY_OPERATOR: return "TERNARY_OPERATOR";
		case Node::TYPE: return "TYPE";
		case Node::TYPE_TEST: return "TYPE_TEST";
		case Node::UNARY_OPERATOR: return "UNARY_OPERATOR";
		case Node::VARIABLE: return "VARIABLE";
		case Node::WHILE: return "WHILE";
		default: return "UNEXPORTED";
	}
}

const char *pattern_type_name(GDScriptParser::PatternNode::Type p_type) {
	switch (p_type) {
		case GDScriptParser::PatternNode::PT_LITERAL: return "PT_LITERAL";
		case GDScriptParser::PatternNode::PT_EXPRESSION: return "PT_EXPRESSION";
		case GDScriptParser::PatternNode::PT_BIND: return "PT_BIND";
		case GDScriptParser::PatternNode::PT_ARRAY: return "PT_ARRAY";
		case GDScriptParser::PatternNode::PT_DICTIONARY: return "PT_DICTIONARY";
		case GDScriptParser::PatternNode::PT_REST: return "PT_REST";
		case GDScriptParser::PatternNode::PT_WILDCARD: return "PT_WILDCARD";
	}
	return "PT_LITERAL";
}

const char *unary_operation_name(GDScriptParser::UnaryOpNode::OpType p_operation) {
	switch (p_operation) {
		case GDScriptParser::UnaryOpNode::OP_POSITIVE: return "OP_POSITIVE";
		case GDScriptParser::UnaryOpNode::OP_NEGATIVE: return "OP_NEGATIVE";
		case GDScriptParser::UnaryOpNode::OP_COMPLEMENT: return "OP_COMPLEMENT";
		case GDScriptParser::UnaryOpNode::OP_LOGIC_NOT: return "OP_LOGIC_NOT";
	}
	return "OP_POSITIVE";
}

const char *assignment_operation_name(GDScriptParser::AssignmentNode::Operation p_operation) {
	switch (p_operation) {
		case GDScriptParser::AssignmentNode::OP_NONE: return "OP_NONE";
		case GDScriptParser::AssignmentNode::OP_ADDITION: return "OP_ADDITION";
		case GDScriptParser::AssignmentNode::OP_SUBTRACTION: return "OP_SUBTRACTION";
		case GDScriptParser::AssignmentNode::OP_MULTIPLICATION: return "OP_MULTIPLICATION";
		case GDScriptParser::AssignmentNode::OP_DIVISION: return "OP_DIVISION";
		case GDScriptParser::AssignmentNode::OP_MODULO: return "OP_MODULO";
		case GDScriptParser::AssignmentNode::OP_POWER: return "OP_POWER";
		case GDScriptParser::AssignmentNode::OP_BIT_SHIFT_LEFT: return "OP_BIT_SHIFT_LEFT";
		case GDScriptParser::AssignmentNode::OP_BIT_SHIFT_RIGHT: return "OP_BIT_SHIFT_RIGHT";
		case GDScriptParser::AssignmentNode::OP_BIT_AND: return "OP_BIT_AND";
		case GDScriptParser::AssignmentNode::OP_BIT_OR: return "OP_BIT_OR";
		case GDScriptParser::AssignmentNode::OP_BIT_XOR: return "OP_BIT_XOR";
	}
	return "OP_NONE";
}

// A plain assignment carries Variant::OP_MAX ("no operator"), which has no name to ask for.
String variant_operator_name(Variant::Operator p_operator) {
	return p_operator == Variant::OP_MAX ? String() : Variant::get_operator_name(p_operator);
}

const char *binary_operation_name(GDScriptParser::BinaryOpNode::OpType p_operation) {
	switch (p_operation) {
		case GDScriptParser::BinaryOpNode::OP_ADDITION: return "OP_ADDITION";
		case GDScriptParser::BinaryOpNode::OP_SUBTRACTION: return "OP_SUBTRACTION";
		case GDScriptParser::BinaryOpNode::OP_MULTIPLICATION: return "OP_MULTIPLICATION";
		case GDScriptParser::BinaryOpNode::OP_DIVISION: return "OP_DIVISION";
		case GDScriptParser::BinaryOpNode::OP_MODULO: return "OP_MODULO";
		case GDScriptParser::BinaryOpNode::OP_POWER: return "OP_POWER";
		case GDScriptParser::BinaryOpNode::OP_BIT_LEFT_SHIFT: return "OP_BIT_LEFT_SHIFT";
		case GDScriptParser::BinaryOpNode::OP_BIT_RIGHT_SHIFT: return "OP_BIT_RIGHT_SHIFT";
		case GDScriptParser::BinaryOpNode::OP_BIT_AND: return "OP_BIT_AND";
		case GDScriptParser::BinaryOpNode::OP_BIT_OR: return "OP_BIT_OR";
		case GDScriptParser::BinaryOpNode::OP_BIT_XOR: return "OP_BIT_XOR";
		case GDScriptParser::BinaryOpNode::OP_LOGIC_AND: return "OP_LOGIC_AND";
		case GDScriptParser::BinaryOpNode::OP_LOGIC_OR: return "OP_LOGIC_OR";
		case GDScriptParser::BinaryOpNode::OP_CONTENT_TEST: return "OP_CONTENT_TEST";
		case GDScriptParser::BinaryOpNode::OP_COMP_EQUAL: return "OP_COMP_EQUAL";
		case GDScriptParser::BinaryOpNode::OP_COMP_NOT_EQUAL: return "OP_COMP_NOT_EQUAL";
		case GDScriptParser::BinaryOpNode::OP_COMP_LESS: return "OP_COMP_LESS";
		case GDScriptParser::BinaryOpNode::OP_COMP_LESS_EQUAL: return "OP_COMP_LESS_EQUAL";
		case GDScriptParser::BinaryOpNode::OP_COMP_GREATER: return "OP_COMP_GREATER";
		case GDScriptParser::BinaryOpNode::OP_COMP_GREATER_EQUAL: return "OP_COMP_GREATER_EQUAL";
	}
	return "OP_ADDITION";
}

const char *datatype_kind_name(GDScriptParser::DataType::Kind p_kind) {
	switch (p_kind) {
		case GDScriptParser::DataType::BUILTIN: return "BUILTIN";
		case GDScriptParser::DataType::NATIVE: return "NATIVE";
		case GDScriptParser::DataType::SCRIPT: return "SCRIPT";
		case GDScriptParser::DataType::CLASS: return "CLASS";
		case GDScriptParser::DataType::ENUM: return "ENUM";
		case GDScriptParser::DataType::VARIANT: return "VARIANT";
		case GDScriptParser::DataType::RESOLVING: return "RESOLVING";
		case GDScriptParser::DataType::UNRESOLVED: return "UNRESOLVED";
	}
	return "UNRESOLVED";
}

const char *datatype_source_name(GDScriptParser::DataType::TypeSource p_source) {
	switch (p_source) {
		case GDScriptParser::DataType::UNDETECTED: return "UNDETECTED";
		case GDScriptParser::DataType::INFERRED: return "INFERRED";
		case GDScriptParser::DataType::ANNOTATED_EXPLICIT: return "ANNOTATED_EXPLICIT";
		case GDScriptParser::DataType::ANNOTATED_INFERRED: return "ANNOTATED_INFERRED";
	}
	return "UNDETECTED";
}

const char *identifier_source_name(GDScriptParser::IdentifierNode::Source p_source) {
	switch (p_source) {
		case GDScriptParser::IdentifierNode::UNDEFINED_SOURCE: return "UNDEFINED_SOURCE";
		case GDScriptParser::IdentifierNode::FUNCTION_PARAMETER: return "FUNCTION_PARAMETER";
		case GDScriptParser::IdentifierNode::LOCAL_VARIABLE: return "LOCAL_VARIABLE";
		case GDScriptParser::IdentifierNode::LOCAL_CONSTANT: return "LOCAL_CONSTANT";
		case GDScriptParser::IdentifierNode::LOCAL_ITERATOR: return "LOCAL_ITERATOR";
		case GDScriptParser::IdentifierNode::LOCAL_BIND: return "LOCAL_BIND";
		case GDScriptParser::IdentifierNode::MEMBER_VARIABLE: return "MEMBER_VARIABLE";
		case GDScriptParser::IdentifierNode::MEMBER_CONSTANT: return "MEMBER_CONSTANT";
		case GDScriptParser::IdentifierNode::MEMBER_FUNCTION: return "MEMBER_FUNCTION";
		case GDScriptParser::IdentifierNode::MEMBER_SIGNAL: return "MEMBER_SIGNAL";
		case GDScriptParser::IdentifierNode::MEMBER_CLASS: return "MEMBER_CLASS";
		case GDScriptParser::IdentifierNode::INHERITED_VARIABLE: return "INHERITED_VARIABLE";
		case GDScriptParser::IdentifierNode::STATIC_VARIABLE: return "STATIC_VARIABLE";
		case GDScriptParser::IdentifierNode::NATIVE_CLASS: return "NATIVE_CLASS";
	}
	return "UNDEFINED_SOURCE";
}

const char *compiler_call_kind_name(GDScriptParser::CallNode::FrontendExportCallKind p_kind) {
	switch (p_kind) {
		case GDScriptParser::CallNode::FRONTEND_EXPORT_CALL_UNRESOLVED: return "unresolved";
		case GDScriptParser::CallNode::FRONTEND_EXPORT_CALL_BUILTIN_CONSTRUCTOR: return "builtin-constructor";
		case GDScriptParser::CallNode::FRONTEND_EXPORT_CALL_VARIANT_UTILITY: return "variant-utility";
		case GDScriptParser::CallNode::FRONTEND_EXPORT_CALL_GDSCRIPT_UTILITY: return "gdscript-utility";
		case GDScriptParser::CallNode::FRONTEND_EXPORT_CALL_SUPER: return "super";
		case GDScriptParser::CallNode::FRONTEND_EXPORT_CALL_NATIVE_METHOD: return "native-method";
		case GDScriptParser::CallNode::FRONTEND_EXPORT_CALL_SCRIPT_SELF: return "script-self";
		case GDScriptParser::CallNode::FRONTEND_EXPORT_CALL_SCRIPT_CLASS: return "script-class";
		case GDScriptParser::CallNode::FRONTEND_EXPORT_CALL_BUILTIN_STATIC: return "builtin-static";
		case GDScriptParser::CallNode::FRONTEND_EXPORT_CALL_NATIVE_STATIC: return "native-static";
		case GDScriptParser::CallNode::FRONTEND_EXPORT_CALL_DYNAMIC: return "dynamic";
		case GDScriptParser::CallNode::FRONTEND_EXPORT_CALL_BUILTIN_MEMBER: return "builtin-member";
	}
	return "unresolved";
}

Dictionary encode_variant(const Variant &p_value) {
	Dictionary encoded;
	switch (p_value.get_type()) {
		case Variant::NIL:
			encoded["kind"] = "nil";
			break;
		case Variant::BOOL:
			encoded["kind"] = "bool";
			encoded["value"] = p_value;
			break;
		case Variant::INT:
			encoded["kind"] = "int";
			encoded["value"] = String::num_int64((int64_t)p_value);
			break;
		case Variant::FLOAT:
			encoded["kind"] = "float";
			encoded["value"] = String::num_real((double)p_value);
			break;
		case Variant::STRING:
			encoded["kind"] = "string";
			encoded["value"] = p_value;
			break;
		case Variant::STRING_NAME:
			encoded["kind"] = "string-name";
			encoded["value"] = String((StringName)p_value);
			break;
		case Variant::ARRAY: {
			encoded["kind"] = "array";
			Array values;
			for (const Variant &value : (Array)p_value) {
				values.push_back(encode_variant(value));
			}
			encoded["value"] = values;
		} break;
		case Variant::DICTIONARY: {
			encoded["kind"] = "dictionary";
			Array entries;
			Dictionary source = p_value;
			Array keys = source.keys();
			for (const Variant &key : keys) {
				Dictionary entry;
				entry["key"] = encode_variant(key);
				entry["value"] = encode_variant(source[key]);
				entries.push_back(entry);
			}
			encoded["value"] = entries;
		} break;
		default:
			encoded["kind"] = "opaque";
			encoded["type"] = Variant::get_type_name(p_value.get_type());
			encoded["text"] = p_value.stringify();
			break;
	}
	return encoded;
}

Dictionary encode_datatype(const GDScriptParser::DataType &p_type) {
	Dictionary encoded;
	encoded["kind"] = datatype_kind_name(p_type.kind);
	encoded["typeSource"] = datatype_source_name(p_type.type_source);
	encoded["constant"] = p_type.is_constant;
	encoded["readOnly"] = p_type.is_read_only;
	encoded["metaType"] = p_type.is_meta_type;
	encoded["pseudoType"] = p_type.is_pseudo_type;
	encoded["coroutine"] = p_type.is_coroutine;
	encoded["display"] = p_type.to_string();
	encoded["builtinType"] = Variant::get_type_name(p_type.builtin_type);
	encoded["nativeType"] = String(p_type.native_type);
	encoded["enumType"] = String(p_type.enum_type);
	encoded["scriptPath"] = p_type.script_path;
	encoded["className"] = p_type.class_type == nullptr ? String() : p_type.class_type->fqcn;
	Array containers;
	for (const GDScriptParser::DataType &element : p_type.container_element_types) {
		containers.push_back(encode_datatype(element));
	}
	encoded["containerTypes"] = containers;
	Array enum_values;
	Vector<StringName> enum_names;
	for (const KeyValue<StringName, int64_t> &entry : p_type.enum_values) {
		enum_names.push_back(entry.key);
	}
	enum_names.sort_custom<StringName::AlphCompare>();
	for (const StringName &name : enum_names) {
		Dictionary entry;
		entry["name"] = String(name);
		entry["value"] = String::num_int64(p_type.enum_values[name]);
		enum_values.push_back(entry);
	}
	encoded["enumValues"] = enum_values;
	return encoded;
}

Array encode_diagnostics(const List<GDScriptParser::ParserError> &p_errors) {
	Array result;
	for (const GDScriptParser::ParserError &error : p_errors) {
		Dictionary row;
		row["message"] = error.message;
		row["startLine"] = error.start_line;
		row["startColumn"] = error.start_column;
		row["endLine"] = error.end_line;
		row["endColumn"] = error.end_column;
		result.push_back(row);
	}
	return result;
}

class InitialNodeEncoder {
	HashMap<const Node *, int> ids;
	Array rows;

	int encode_optional(const Node *p_node) {
		return p_node == nullptr ? -1 : encode(p_node);
	}

public:
	int encode(const Node *p_node) {
		if (ids.has(p_node)) {
			return ids[p_node];
		}
		const int id = rows.size();
		ids[p_node] = id;
		Dictionary row;
		row["id"] = id;
		row["kind"] = node_type_name(p_node->type);
		row["startLine"] = p_node->start_line;
		row["startColumn"] = p_node->start_column;
		row["endLine"] = p_node->end_line;
		row["endColumn"] = p_node->end_column;
		row["datatype"] = encode_datatype(p_node->get_datatype());
		rows.push_back(row);

		Array annotations;
		for (const GDScriptParser::AnnotationNode *annotation : p_node->annotations) {
			annotations.push_back(encode(annotation));
		}
		row["annotations"] = annotations;

		switch (p_node->type) {
			case Node::ARRAY: {
				const auto *node = static_cast<const GDScriptParser::ArrayNode *>(p_node);
				Array elements;
				for (const GDScriptParser::ExpressionNode *element : node->elements) {
					elements.push_back(encode(element));
				}
				row["elements"] = elements;
			} break;
			case Node::ASSERT: {
				const auto *node = static_cast<const GDScriptParser::AssertNode *>(p_node);
				row["condition"] = encode_optional(node->condition);
				row["message"] = encode_optional(node->message);
			} break;
			case Node::CLASS: {
				const auto *node = static_cast<const GDScriptParser::ClassNode *>(p_node);
				row["identifier"] = encode_optional(node->identifier);
				row["fqcn"] = node->fqcn;
				row["abstract"] = node->is_abstract;
				row["extendsPath"] = node->extends_path;
				Array extends;
				for (const GDScriptParser::IdentifierNode *identifier : node->extends) {
					extends.push_back(encode(identifier));
				}
				row["extends"] = extends;
				row["iconPath"] = node->icon_path;
				Array members;
				for (const GDScriptParser::ClassNode::Member &member : node->members) {
					switch (member.type) {
						case GDScriptParser::ClassNode::Member::CLASS:
							members.push_back(encode(member.m_class));
							break;
						case GDScriptParser::ClassNode::Member::ENUM:
							members.push_back(encode(member.m_enum));
							break;
						case GDScriptParser::ClassNode::Member::ENUM_VALUE:
							// Godot represents an unnamed enum as one class member per value. The first
							// value retains the parent EnumNode and its complete ordered value list, so
							// export that parent once at the enum's source position.
							if (member.enum_value.index == 0) {
								members.push_back(encode(member.enum_value.parent_enum));
							}
							break;
						case GDScriptParser::ClassNode::Member::FUNCTION:
							members.push_back(encode(member.function));
							break;
						case GDScriptParser::ClassNode::Member::VARIABLE:
							members.push_back(encode(member.variable));
							break;
						case GDScriptParser::ClassNode::Member::CONSTANT:
							members.push_back(encode(member.constant));
							break;
						case GDScriptParser::ClassNode::Member::SIGNAL:
							members.push_back(encode(member.signal));
							break;
						default:
							break;
					}
				}
				row["members"] = members;
			} break;
			case Node::CONSTANT: {
				const auto *node = static_cast<const GDScriptParser::ConstantNode *>(p_node);
				row["identifier"] = encode_optional(node->identifier);
				row["initializer"] = encode_optional(node->initializer);
				row["datatypeSpecifier"] = encode_optional(node->datatype_specifier);
				row["inferDatatype"] = node->infer_datatype;
			} break;
			case Node::ASSIGNMENT: {
				const auto *node = static_cast<const GDScriptParser::AssignmentNode *>(p_node);
				row["operation"] = assignment_operation_name(node->operation);
				row["variantOperator"] = variant_operator_name(node->variant_op);
				row["variantOperatorId"] = (int)node->variant_op;
				row["assignee"] = encode_optional(node->assignee);
				row["assignedValue"] = encode_optional(node->assigned_value);
				row["useConversionAssign"] = node->use_conversion_assign;
			} break;
			case Node::AWAIT: {
				const auto *node = static_cast<const GDScriptParser::AwaitNode *>(p_node);
				row["toAwait"] = encode_optional(node->to_await);
			} break;
			case Node::BINARY_OPERATOR: {
				const auto *node = static_cast<const GDScriptParser::BinaryOpNode *>(p_node);
				row["operation"] = binary_operation_name(node->operation);
				row["variantOperator"] = variant_operator_name(node->variant_op);
				row["variantOperatorId"] = (int)node->variant_op;
				row["leftOperand"] = encode_optional(node->left_operand);
				row["rightOperand"] = encode_optional(node->right_operand);
			} break;
			case Node::CALL: {
				const auto *node = static_cast<const GDScriptParser::CallNode *>(p_node);
				row["callee"] = encode_optional(node->callee);
				Array arguments;
				for (const GDScriptParser::ExpressionNode *argument : node->arguments) {
					arguments.push_back(encode(argument));
				}
				row["arguments"] = arguments;
				row["functionName"] = String(node->function_name);
				row["super"] = node->is_super;
				row["static"] = node->is_static;
				Dictionary compiler_target;
				compiler_target["kind"] = compiler_call_kind_name(node->frontend_export_call_kind);
				compiler_target["owner"] = String(node->frontend_export_call_owner);
				compiler_target["member"] = String(node->frontend_export_call_member);
				compiler_target["signatureHash"] = (int64_t)node->frontend_export_call_hash;
				row["compilerTarget"] = compiler_target;
			} break;
			case Node::CAST: {
				const auto *node = static_cast<const GDScriptParser::CastNode *>(p_node);
				row["operand"] = encode_optional(node->operand);
				row["castType"] = encode_optional(node->cast_type);
			} break;
			case Node::BREAK:
			case Node::BREAKPOINT:
			case Node::CONTINUE:
			case Node::PASS:
				break;
			case Node::ANNOTATION: {
				const auto *node = static_cast<const GDScriptParser::AnnotationNode *>(p_node);
				row["name"] = String(node->name);
				row["resolved"] = node->is_resolved;
				row["applied"] = node->is_applied;
				Array arguments;
				for (const GDScriptParser::ExpressionNode *argument : node->arguments) {
					arguments.push_back(encode(argument));
				}
				row["arguments"] = arguments;
				Array resolved_arguments;
				for (const Variant &argument : node->resolved_arguments) {
					resolved_arguments.push_back(encode_variant(argument));
				}
				row["resolvedArguments"] = resolved_arguments;
			} break;
			case Node::ENUM: {
				const auto *node = static_cast<const GDScriptParser::EnumNode *>(p_node);
				row["identifier"] = encode_optional(node->identifier);
				row["dictionary"] = encode_variant(node->dictionary);
				Array values;
				for (const GDScriptParser::EnumNode::Value &value : node->values) {
					Dictionary encoded;
					encoded["identifier"] = encode_optional(value.identifier);
					encoded["customValue"] = encode_optional(value.custom_value);
					encoded["index"] = value.index;
					encoded["resolved"] = value.resolved;
					encoded["value"] = String::num_int64(value.value);
					encoded["line"] = value.line;
					encoded["startColumn"] = value.start_column;
					encoded["endColumn"] = value.end_column;
					values.push_back(encoded);
				}
				row["values"] = values;
			} break;
			case Node::DICTIONARY: {
				const auto *node = static_cast<const GDScriptParser::DictionaryNode *>(p_node);
				Array elements;
				for (const GDScriptParser::DictionaryNode::Pair &pair : node->elements) {
					Dictionary encoded;
					encoded["key"] = encode_optional(pair.key);
					encoded["value"] = encode_optional(pair.value);
					elements.push_back(encoded);
				}
				row["elements"] = elements;
				row["style"] = node->style == GDScriptParser::DictionaryNode::LUA_TABLE ? "LUA_TABLE" : "PYTHON_DICT";
			} break;
			case Node::FUNCTION: {
				const auto *node = static_cast<const GDScriptParser::FunctionNode *>(p_node);
				row["identifier"] = encode_optional(node->identifier);
				Array parameters;
				for (const GDScriptParser::ParameterNode *parameter : node->parameters) {
					parameters.push_back(encode(parameter));
				}
				row["parameters"] = parameters;
				row["restParameter"] = encode_optional(node->rest_parameter);
				row["returnType"] = encode_optional(node->return_type);
				row["body"] = encode_optional(node->body);
				row["abstract"] = node->is_abstract;
				row["static"] = node->is_static;
				row["coroutine"] = node->is_coroutine;
			} break;
			case Node::PARAMETER: {
				const auto *node = static_cast<const GDScriptParser::ParameterNode *>(p_node);
				row["identifier"] = encode_optional(node->identifier);
				row["initializer"] = encode_optional(node->initializer);
				row["datatypeSpecifier"] = encode_optional(node->datatype_specifier);
				row["inferDatatype"] = node->infer_datatype;
			} break;
			case Node::FOR: {
				const auto *node = static_cast<const GDScriptParser::ForNode *>(p_node);
				row["variable"] = encode_optional(node->variable);
				row["datatypeSpecifier"] = encode_optional(node->datatype_specifier);
				row["useConversionAssign"] = node->use_conversion_assign;
				row["list"] = encode_optional(node->list);
				row["loop"] = encode_optional(node->loop);
			} break;
			case Node::GET_NODE: {
				const auto *node = static_cast<const GDScriptParser::GetNodeNode *>(p_node);
				row["fullPath"] = node->full_path;
				row["useDollar"] = node->use_dollar;
			} break;
			case Node::IDENTIFIER: {
				const auto *node = static_cast<const GDScriptParser::IdentifierNode *>(p_node);
				row["name"] = String(node->name);
				row["source"] = identifier_source_name(node->source);
				row["usages"] = node->usages;
			} break;
			case Node::IF: {
				const auto *node = static_cast<const GDScriptParser::IfNode *>(p_node);
				row["condition"] = encode_optional(node->condition);
				row["trueBlock"] = encode_optional(node->true_block);
				row["falseBlock"] = encode_optional(node->false_block);
			} break;
			case Node::LAMBDA: {
				const auto *node = static_cast<const GDScriptParser::LambdaNode *>(p_node);
				row["function"] = encode_optional(node->function);
				Array captures;
				for (const GDScriptParser::IdentifierNode *capture : node->captures) {
					captures.push_back(encode(capture));
				}
				row["captures"] = captures;
				row["useSelf"] = node->use_self;
			} break;
			case Node::LITERAL: {
				const auto *node = static_cast<const GDScriptParser::LiteralNode *>(p_node);
				row["value"] = encode_variant(node->value);
				row["constant"] = node->is_constant;
				row["reduced"] = node->reduced;
				row["reducedValue"] = encode_variant(node->reduced_value);
			} break;
			case Node::MATCH: {
				const auto *node = static_cast<const GDScriptParser::MatchNode *>(p_node);
				row["test"] = encode_optional(node->test);
				Array branches;
				for (const GDScriptParser::MatchBranchNode *branch : node->branches) {
					branches.push_back(encode(branch));
				}
				row["branches"] = branches;
			} break;
			case Node::MATCH_BRANCH: {
				const auto *node = static_cast<const GDScriptParser::MatchBranchNode *>(p_node);
				Array patterns;
				for (const GDScriptParser::PatternNode *pattern : node->patterns) {
					patterns.push_back(encode(pattern));
				}
				row["patterns"] = patterns;
				row["block"] = encode_optional(node->block);
				row["hasWildcard"] = node->has_wildcard;
				row["guardBody"] = encode_optional(node->guard_body);
			} break;
			case Node::PATTERN: {
				const auto *node = static_cast<const GDScriptParser::PatternNode *>(p_node);
				row["patternType"] = pattern_type_name(node->pattern_type);
				row["literal"] = node->pattern_type == GDScriptParser::PatternNode::PT_LITERAL ? encode_optional(node->literal) : -1;
				row["expression"] = node->pattern_type == GDScriptParser::PatternNode::PT_EXPRESSION ? encode_optional(node->expression) : -1;
				row["bind"] = node->pattern_type == GDScriptParser::PatternNode::PT_BIND ? encode_optional(node->bind) : -1;
				Array array_patterns;
				for (const GDScriptParser::PatternNode *pattern : node->array) {
					array_patterns.push_back(encode(pattern));
				}
				row["array"] = array_patterns;
				row["restUsed"] = node->rest_used;
				Array dictionary_patterns;
				for (const GDScriptParser::PatternNode::Pair &pair : node->dictionary) {
					Dictionary encoded;
					encoded["key"] = encode_optional(pair.key);
					encoded["valuePattern"] = encode_optional(pair.value_pattern);
					dictionary_patterns.push_back(encoded);
				}
				row["dictionary"] = dictionary_patterns;
				Vector<StringName> bind_names;
				for (const KeyValue<StringName, GDScriptParser::IdentifierNode *> &entry : node->binds) {
					bind_names.push_back(entry.key);
				}
				bind_names.sort_custom<StringName::AlphCompare>();
				Array binds;
				for (const StringName &name : bind_names) {
					Dictionary encoded;
					encoded["name"] = String(name);
					encoded["identifier"] = encode_optional(node->binds[name]);
					binds.push_back(encoded);
				}
				row["binds"] = binds;
			} break;
			case Node::PRELOAD: {
				const auto *node = static_cast<const GDScriptParser::PreloadNode *>(p_node);
				row["path"] = encode_optional(node->path);
				row["resolvedPath"] = node->resolved_path;
			} break;
			case Node::RETURN: {
				const auto *node = static_cast<const GDScriptParser::ReturnNode *>(p_node);
				row["returnValue"] = encode_optional(node->return_value);
				row["voidReturn"] = node->void_return;
				row["useConversion"] = node->use_conversion;
			} break;
			case Node::SELF:
				break;
			case Node::SIGNAL: {
				const auto *node = static_cast<const GDScriptParser::SignalNode *>(p_node);
				row["identifier"] = encode_optional(node->identifier);
				Array parameters;
				for (const GDScriptParser::ParameterNode *parameter : node->parameters) {
					parameters.push_back(encode(parameter));
				}
				row["parameters"] = parameters;
			} break;
			case Node::SUBSCRIPT: {
				const auto *node = static_cast<const GDScriptParser::SubscriptNode *>(p_node);
				row["base"] = encode_optional(node->base);
				row["index"] = node->is_attribute ? -1 : encode_optional(node->index);
				row["attribute"] = node->is_attribute ? encode_optional(node->attribute) : -1;
				row["isAttribute"] = node->is_attribute;
			} break;
			case Node::SUITE: {
				const auto *node = static_cast<const GDScriptParser::SuiteNode *>(p_node);
				Array statements;
				for (const GDScriptParser::Node *statement : node->statements) {
					statements.push_back(encode(statement));
				}
				row["statements"] = statements;
			} break;
			case Node::TERNARY_OPERATOR: {
				const auto *node = static_cast<const GDScriptParser::TernaryOpNode *>(p_node);
				row["condition"] = encode_optional(node->condition);
				row["trueExpression"] = encode_optional(node->true_expr);
				row["falseExpression"] = encode_optional(node->false_expr);
			} break;
			case Node::TYPE: {
				const auto *node = static_cast<const GDScriptParser::TypeNode *>(p_node);
				Array type_chain;
				for (const GDScriptParser::IdentifierNode *identifier : node->type_chain) {
					type_chain.push_back(encode(identifier));
				}
				row["typeChain"] = type_chain;
				Array container_types;
				for (const GDScriptParser::TypeNode *container : node->container_types) {
					container_types.push_back(encode(container));
				}
				row["containerTypes"] = container_types;
			} break;
			case Node::TYPE_TEST: {
				const auto *node = static_cast<const GDScriptParser::TypeTestNode *>(p_node);
				row["operand"] = encode_optional(node->operand);
				row["testType"] = encode_optional(node->test_type);
				row["testDatatype"] = encode_datatype(node->test_datatype);
			} break;
			case Node::UNARY_OPERATOR: {
				const auto *node = static_cast<const GDScriptParser::UnaryOpNode *>(p_node);
				row["operation"] = unary_operation_name(node->operation);
				row["variantOperator"] = variant_operator_name(node->variant_op);
				row["variantOperatorId"] = (int)node->variant_op;
				row["operand"] = encode_optional(node->operand);
			} break;
			case Node::VARIABLE: {
				const auto *node = static_cast<const GDScriptParser::VariableNode *>(p_node);
				row["identifier"] = encode_optional(node->identifier);
				row["initializer"] = encode_optional(node->initializer);
				row["datatypeSpecifier"] = encode_optional(node->datatype_specifier);
				row["inferDatatype"] = node->infer_datatype;
				row["static"] = node->is_static;
				row["exported"] = node->exported;
				row["onready"] = node->onready;
				switch (node->property) {
					case GDScriptParser::VariableNode::PROP_NONE:
						row["propertyStyle"] = "PROP_NONE";
						row["setter"] = -1;
						row["setterParameter"] = -1;
						row["getter"] = -1;
						break;
					case GDScriptParser::VariableNode::PROP_INLINE:
						row["propertyStyle"] = "PROP_INLINE";
						row["setter"] = encode_optional(node->setter);
						row["setterParameter"] = encode_optional(node->setter_parameter);
						row["getter"] = encode_optional(node->getter);
						break;
					case GDScriptParser::VariableNode::PROP_SETGET:
						row["propertyStyle"] = "PROP_SETGET";
						row["setter"] = encode_optional(node->setter_pointer);
						row["setterParameter"] = -1;
						row["getter"] = encode_optional(node->getter_pointer);
						break;
				}
			} break;
			case Node::WHILE: {
				const auto *node = static_cast<const GDScriptParser::WhileNode *>(p_node);
				row["condition"] = encode_optional(node->condition);
				row["loop"] = encode_optional(node->loop);
			} break;
			default:
				row["officialKind"] = (int)p_node->type;
				break;
		}
		rows[id] = row;
		return id;
	}

	Array take_rows() const {
		return rows;
	}
};

} // namespace

void GDScriptFrontendExporter::_bind_methods() {
	ClassDB::bind_method(D_METHOD("get_build_identity"), &GDScriptFrontendExporter::get_build_identity);
	ClassDB::bind_method(D_METHOD("register_source", "source", "script_path"), &GDScriptFrontendExporter::register_source);
	ClassDB::bind_method(D_METHOD("prepare_source", "script_path"), &GDScriptFrontendExporter::prepare_source);
	ClassDB::bind_method(D_METHOD("seal_sources_for_compilation"), &GDScriptFrontendExporter::seal_sources_for_compilation);
	ClassDB::bind_method(D_METHOD("export_source", "source", "script_path"), &GDScriptFrontendExporter::export_source);
}

Dictionary GDScriptFrontendExporter::get_build_identity() const {
	Dictionary result;
	result["sourceRevision"] = VGAI_GODOT_SOURCE_REVISION;
	result["sourceTreeSha256"] = VGAI_GODOT_SOURCE_TREE_SHA256;
	result["sourceArchiveSha256"] = VGAI_GODOT_SOURCE_ARCHIVE_SHA256;
	result["exporterSourceSha256"] = VGAI_GODOT_EXPORTER_SOURCE_SHA256;
	result["buildOptions"] = VGAI_GODOT_EXPORTER_BUILD_OPTIONS;
	return result;
}

void GDScriptFrontendExporter::register_source(const String &p_source, const String &p_script_path) {
	ERR_FAIL_COND_MSG(compilation_cache_sealed, "GDScript source registration happened after the compilation cache was sealed.");
	ERR_FAIL_COND_MSG(registered_sources.has(p_script_path), "GDScript source path was registered twice: " + p_script_path);
	registered_sources[p_script_path] = p_source;
}

void GDScriptFrontendExporter::prepare_source(const String &p_script_path) {
	ERR_FAIL_COND_MSG(compilation_cache_sealed, "GDScript source preparation happened after the compilation cache was sealed.");
	ERR_FAIL_COND_MSG(!registered_sources.has(p_script_path), "GDScript source path was not registered: " + p_script_path);
	ERR_FAIL_COND_MSG(prepared_scripts.has(p_script_path), "GDScript source path was prepared twice: " + p_script_path);
	if (!project_globals_prepared) {
		// The editor's filesystem scan registers every `class_name` before any script is analyzed
		// (EditorFileSystem::_register_global_class_script). A headless capture has no scan and no
		// `.godot` cache, so register each snapshot source through the same two official calls.
		GDScriptLanguage *gdscript = GDScriptLanguage::get_singleton();
		for (const KeyValue<String, String> &entry : registered_sources) {
			String base_type;
			bool is_abstract = false;
			bool is_tool = false;
			const String class_name = gdscript->get_global_class_name(entry.key, &base_type, nullptr, &is_abstract, &is_tool);
			if (class_name.is_empty()) {
				continue;
			}
			ScriptServer::remove_global_class_by_path(entry.key);
			ScriptServer::add_global_class(class_name, base_type, gdscript->get_name(), entry.key, is_abstract, is_tool);
		}
		for (const KeyValue<StringName, ProjectSettings::AutoloadInfo> &entry : ProjectSettings::get_singleton()->get_autoload_list()) {
			if (!entry.value.is_singleton) {
				continue;
			}
			for (int index = 0; index < ScriptServer::get_language_count(); index++) {
				ScriptServer::get_language(index)->add_global_constant(entry.value.name, Variant());
			}
		}
		project_globals_prepared = true;
	}
	Error parse_error = OK;
	Ref<GDScript> script = GDScriptCache::get_shallow_script(p_script_path, parse_error);
	Error parser_error = OK;
	Ref<GDScriptParserRef> parser_ref = GDScriptCache::get_parser(
			p_script_path, GDScriptParserRef::PARSED, parser_error);
	if (parse_error == OK) {
		parse_error = parser_error;
	}
	Error analyze_error = ERR_PARSE_ERROR;
	if (parse_error == OK) {
		parser_ref = GDScriptCache::get_parser(
				p_script_path, GDScriptParserRef::FULLY_SOLVED, analyze_error);
	}
	ERR_FAIL_COND_MSG(script.is_null() || parser_ref.is_null(), "Godot frontend cache did not retain: " + p_script_path);
	ERR_FAIL_COND_MSG(script->get_source_code() != registered_sources[p_script_path], "Godot frontend cache read different source bytes: " + p_script_path);
	prepared_scripts[p_script_path] = script;
	prepared_parsers[p_script_path] = parser_ref;
	parse_errors[p_script_path] = (int)parse_error;
	analysis_errors[p_script_path] = (int)analyze_error;
}

void GDScriptFrontendExporter::seal_sources_for_compilation() {
	ERR_FAIL_COND_MSG(compilation_cache_sealed, "GDScript compilation cache was sealed twice.");
	ERR_FAIL_COND_MSG(prepared_scripts.size() != registered_sources.size(), "Every registered GDScript source must be prepared before compilation.");
	ERR_FAIL_NULL(GDScriptCache::singleton);
	MutexLock lock(GDScriptCache::mutex);
	// A prepared script is either still shallow, or Godot's own loader already finished it while
	// analysis resolved a dependency (a `preload` of a scene loads that scene's scripts through
	// ResourceLoader). Either way the cache must hold the prepared object itself.
	for (const KeyValue<String, Ref<GDScript>> &entry : prepared_scripts) {
		const bool shallow = GDScriptCache::singleton->shallow_gdscript_cache.has(entry.key);
		const bool full = GDScriptCache::singleton->full_gdscript_cache.has(entry.key);
		ERR_FAIL_COND_MSG(!shallow && !full, "Prepared GDScript source was not retained in the script cache: " + entry.key);
		ERR_FAIL_COND_MSG(shallow && GDScriptCache::singleton->shallow_gdscript_cache[entry.key] != entry.value, "Prepared GDScript source cache identity changed: " + entry.key);
		ERR_FAIL_COND_MSG(!shallow && GDScriptCache::singleton->full_gdscript_cache[entry.key] != entry.value, "Prepared GDScript source cache identity changed: " + entry.key);
	}
	// Batch the cache-promotion half of Godot's finish_compiling() before compilation. Every
	// dependency then resolves to its retained official object instead of entering reload(), which
	// would parse and analyze the same snapshot source a second time.
	for (const KeyValue<String, Ref<GDScript>> &entry : prepared_scripts) {
		if (!GDScriptCache::singleton->shallow_gdscript_cache.has(entry.key)) {
			continue;
		}
		GDScriptCache::singleton->full_gdscript_cache[entry.key] = entry.value;
		GDScriptCache::singleton->shallow_gdscript_cache.erase(entry.key);
	}
	compilation_cache_sealed = true;
}

Dictionary GDScriptFrontendExporter::export_source(const String &p_source, const String &p_script_path) {
	ERR_FAIL_COND_V_MSG(!compilation_cache_sealed, Dictionary(), "GDScript sources must be sealed before compilation.");
	ERR_FAIL_COND_V_MSG(!registered_sources.has(p_script_path), Dictionary(), "GDScript source path was not registered: " + p_script_path);
	ERR_FAIL_COND_V_MSG(!prepared_scripts.has(p_script_path), Dictionary(), "GDScript source path was not prepared: " + p_script_path);
	ERR_FAIL_COND_V_MSG(registered_sources[p_script_path] != p_source, Dictionary(), "Registered GDScript source bytes changed: " + p_script_path);
	if (exported_sources.has(p_script_path)) {
		return exported_sources[p_script_path];
	}
	ERR_FAIL_COND_V_MSG(exporting_sources.has(p_script_path), Dictionary(), "GDScript dependency cycle reached exporter scheduling: " + p_script_path);
	exporting_sources.insert(p_script_path);
	Dictionary result;
	result["resPath"] = p_script_path;
	Ref<GDScript> script = prepared_scripts[p_script_path];
	Ref<GDScriptParserRef> parser_ref = prepared_parsers[p_script_path];
	GDScriptParser &parser = *parser_ref->get_parser();

	Array tokens;
	GDScriptTokenizerText tokenizer;
	tokenizer.set_source_code(p_source);
	for (int count = 0; count < 1000000; count++) {
		const GDScriptTokenizer::Token token = tokenizer.scan();
		Dictionary encoded;
		encoded["type"] = GDScriptTokenizer::get_token_name(token.type);
		encoded["typeId"] = (int)token.type;
		encoded["source"] = token.source;
		encoded["literal"] = encode_variant(token.literal);
		encoded["startLine"] = token.start_line;
		encoded["startColumn"] = token.start_column;
		encoded["endLine"] = token.end_line;
		encoded["endColumn"] = token.end_column;
		tokens.push_back(encoded);
		if (token.type == GDScriptTokenizer::Token::TK_EOF) {
			break;
		}
	}
	result["tokens"] = tokens;

	const Error parse_error = (Error)parse_errors[p_script_path];
	Dictionary parse;
	parse["ok"] = parse_error == OK;
	parse["errorCode"] = (int)parse_error;
	parse["diagnostics"] = encode_diagnostics(parser.get_errors());
	result["parse"] = parse;
	if (parse_error != OK) {
		Dictionary analysis;
		analysis["ok"] = false;
		analysis["errorCode"] = (int)ERR_PARSE_ERROR;
		analysis["diagnostics"] = encode_diagnostics(parser.get_errors());
		result["analysis"] = analysis;
		Dictionary compile;
		compile["ok"] = false;
		compile["errorCode"] = (int)ERR_PARSE_ERROR;
		compile["message"] = "parse failed; analyzer and compiler not invoked";
		compile["line"] = 0;
		compile["column"] = 0;
		compile["functions"] = Array();
		result["compile"] = compile;
		result["rootNodeId"] = -1;
		result["nodes"] = Array();
		result["tool"] = parser.is_tool();
		exporting_sources.erase(p_script_path);
		exported_sources[p_script_path] = result;
		return result;
	}

	const Error analyze_error = (Error)analysis_errors[p_script_path];
	Dictionary analysis;
	analysis["ok"] = analyze_error == OK;
	analysis["errorCode"] = (int)analyze_error;
	analysis["diagnostics"] = encode_diagnostics(parser.get_errors());
	result["analysis"] = analysis;

	Dictionary compile;
	if (analyze_error == OK) {
		const GDScriptParser::DataType &base_type = parser.get_tree()->base_type;
		if (base_type.kind == GDScriptParser::DataType::CLASS &&
				!base_type.script_path.is_empty() && base_type.script_path != p_script_path &&
				registered_sources.has(base_type.script_path) &&
				!exported_sources.has(base_type.script_path)) {
			export_source(registered_sources[base_type.script_path], base_type.script_path);
		}
		GDScriptCompiler compiler;
		const Error compile_error = compiler.compile(&parser, script.ptr(), false);
		compile["ok"] = compile_error == OK;
		compile["errorCode"] = (int)compile_error;
		compile["message"] = compiler.get_error();
		compile["line"] = compiler.get_error_line();
		compile["column"] = compiler.get_error_column();
		Array functions;
		if (compile_error == OK) {
			Vector<StringName> function_names;
			for (const KeyValue<StringName, GDScriptFunction *> &entry : script->get_member_functions()) {
				function_names.push_back(entry.key);
			}
			function_names.sort_custom<StringName::AlphCompare>();
			for (const StringName &name : function_names) {
				const GDScriptFunction *function = script->get_member_functions()[name];
				Dictionary encoded;
				encoded["name"] = String(function->get_name());
				encoded["source"] = String(function->get_source());
				encoded["static"] = function->is_static();
				encoded["vararg"] = function->is_vararg();
				encoded["argumentCount"] = function->get_argument_count();
				encoded["maxStackSize"] = function->get_max_stack_size();
				functions.push_back(encoded);
			}
		}
		compile["functions"] = functions;
	} else {
		compile["ok"] = false;
		compile["errorCode"] = (int)ERR_PARSE_ERROR;
		compile["message"] = "analysis failed; compiler not invoked";
		compile["line"] = 0;
		compile["column"] = 0;
		compile["functions"] = Array();
	}
	result["compile"] = compile;

	// Compilation selects concrete call operations. Encode only after it has annotated the analyzed
	// tree, so the exporter serializes the official compiler's choice rather than reconstructing it.
	InitialNodeEncoder node_encoder;
	result["rootNodeId"] = node_encoder.encode(parser.get_tree());
	result["nodes"] = node_encoder.take_rows();
	result["tool"] = parser.is_tool();
	exporting_sources.erase(p_script_path);
	exported_sources[p_script_path] = result;
	return result;
}
