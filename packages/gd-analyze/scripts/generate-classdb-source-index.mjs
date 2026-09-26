#!/usr/bin/env node
/**
 * Generate the Godot 4 ClassDB source-provenance index.
 *
 * This is measurement infrastructure, not a binding generator and not verification. It joins the
 * exact extension_api denominator to the exact source revision which produced it, so a later
 * compat implementation can jump from `Node.add_child` to Godot's registration site without a
 * repository-wide search. A row may cite a shared/generated registration site when Godot itself
 * creates many public rows in one loop; `precision` makes that boundary explicit.
 *
 * Usage:
 *   node scripts/generate-classdb-source-index.mjs <godot-source-root>
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..');
const API_DUMP = join(PACKAGE_ROOT, 'vendor/extension-api/godot-4.7-extension_api.json');
const OUTPUT = join(PACKAGE_ROOT, 'vendor/classdb-source-index/godot-4.7.jsonl');
const REVISION = '5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88';
const VERSION = '4.7-stable';
const SOURCE_ARCHIVE_SHA256 = 'b3d705612228c09083d55a89ed3ea7381e6181387ecfdb74fd5cf9733b28eee6';
const SOURCE_TREE_SHA256 = 'b25d23ca60d7a9e99c2cccda9a5a1b2e736e6d0f79a8411d6647dafd4693cbec';
const EXCLUDED_SEGMENTS = new Set(['.git', 'thirdparty', 'tests']);

function fail(message) {
  throw new Error(`generate ClassDB source index: ${message}`);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sourceFiles(root) {
  const found = [];
  function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      if (EXCLUDED_SEGMENTS.has(name)) continue;
      const absolute = join(dir, name);
      const entry = statSync(absolute);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && (name.endsWith('.cpp') || name.endsWith('.h')))
        found.push(absolute);
    }
  }
  walk(root);
  return found;
}

function lineNumber(text, offset) {
  let line = 1;
  for (let index = 0; index < offset; index++) if (text.charCodeAt(index) === 10) line++;
  return line;
}

function findFunctionBlock(file, text, className) {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`void\\s+${escaped}::_bind_methods\\s*\\([^)]*\\)\\s*\\{`, 'm').exec(
    text,
  );
  if (match === null) return undefined;
  // The next out-of-class method for the same owner is a safer delimiter than a toy C++ brace
  // scanner: binding blocks contain lambdas, comments, raw strings, and preprocessor branches.
  // `_bind_methods` is emitted once per owner, so another `Class::method(` cannot be nested in it.
  const afterStart = match.index + match[0].length;
  const nextDefinition = new RegExp(
    `\\n(?:[A-Za-z_][^;\\n{]*\\s+)?${escaped}::[A-Za-z_~][A-Za-z0-9_~]*\\s*\\(`,
    'm',
  ).exec(text.slice(afterStart));
  const end = nextDefinition === null ? text.length : afterStart + nextDefinition.index;
  return {
    file,
    startOffset: match.index,
    startLine: lineNumber(text, match.index),
    text: text.slice(match.index, end),
  };
}

function locationsFromBlock(block, name, kind, role) {
  if (block === undefined) return [];
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exact = new RegExp(
    `(?:"${escaped}"|'${escaped}'|(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$))`,
  );
  const lines = block.text.split(/\r?\n/);
  const matching = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    if (!exact.test(line)) continue;
    const context = lines.slice(Math.max(0, index - 3), index + 1).join(' ');
    const correctMacro =
      kind === 'method'
        ? new RegExp(
            `D_METHOD\\s*\\(\\s*"${escaped}"|bind_(?:static_)?method[^;]*"${escaped}"|BIND_VIRTUAL_METHOD[^;]*"${escaped}"|GDVIRTUAL_BIND\\s*\\(\\s*${escaped}\\b`,
          ).test(context)
        : kind === 'property'
          ? /ADD_PROPERTY|ADD_PROPERTYI|ADD_PROPERTY_DEFAULT|ADD_ARRAY/.test(context)
          : kind === 'signal'
            ? /ADD_SIGNAL/.test(context)
            : kind === 'constant'
              ? /BIND_(?:ENUM_CONSTANT|BITFIELD_FLAG|CONSTANT)|ADD_CLASS_CONSTANT/.test(context)
              : kind === 'enum'
                ? /BIND_ENUM|BIND_BITFIELD/.test(context)
                : false;
    if (correctMacro) matching.push(index);
  }
  return [...new Set(matching)].slice(0, 4).map((index) => ({
    file: block.file,
    line: block.startLine + index,
    role,
    precision: 'direct',
  }));
}

function firstMatchingLine(files, predicate, role, precision = 'direct') {
  for (const source of files) {
    for (let index = 0; index < source.lines.length; index++) {
      if (predicate(source.lines[index] ?? '', source, index)) {
        return [{ file: source.file, line: index + 1, role, precision }];
      }
    }
  }
  return [];
}

function sourceOwner(scope, location, surfaceClass) {
  if (scope === 'editor') return 'editor';
  if (surfaceClass === '@GDScript') return 'language';
  if (surfaceClass === '@GlobalScope') return 'global';
  if (location?.file.startsWith('core/variant/')) return 'builtin';
  if (location?.file.startsWith('servers/')) return 'server';
  return 'runtime';
}

function enumValues(declared) {
  return (declared?.values ?? []).map((entry) => entry.name);
}

function uniqueRows(raw) {
  const rows = new Map();
  function add(surfaceClass, name, kind, scope, metadata = {}) {
    const member = `${surfaceClass}.${name}`;
    const existing = rows.get(member);
    if (existing === undefined) {
      rows.set(member, { member, surfaceClass, scope, kinds: [kind], ...metadata });
      return;
    }
    if (!existing.kinds.includes(kind)) existing.kinds.push(kind);
    Object.assign(existing, metadata);
  }

  for (const cls of raw.classes) {
    const surfaceClass = cls.name === 'GlobalConstants' ? '@GlobalScope' : cls.name;
    const scope = cls.api_type === 'editor' ? 'editor' : 'runtime';
    if (cls.is_instantiable === true)
      add(surfaceClass, 'new', 'constructor', scope, { rawClass: cls.name });
    for (const method of cls.methods ?? []) {
      add(surfaceClass, method.name, 'method', scope, {
        rawClass: cls.name,
        method: { static: method.is_static === true, virtual: method.is_virtual === true },
      });
    }
    for (const property of cls.properties ?? []) {
      add(surfaceClass, property.name, 'property', scope, {
        rawClass: cls.name,
        accessors: {
          ...(typeof property.getter === 'string' && property.getter !== ''
            ? { getter: property.getter }
            : {}),
          ...(typeof property.setter === 'string' && property.setter !== ''
            ? { setter: property.setter }
            : {}),
        },
      });
    }
    for (const signal of cls.signals ?? [])
      add(surfaceClass, signal.name, 'signal', scope, { rawClass: cls.name });
    for (const constant of cls.constants ?? [])
      add(surfaceClass, constant.name, 'constant', scope, { rawClass: cls.name });
    for (const declared of cls.enums ?? []) {
      add(surfaceClass, declared.name, 'enum', scope, { rawClass: cls.name });
      for (const value of enumValues(declared))
        add(surfaceClass, value, 'constant', scope, { rawClass: cls.name });
    }
  }

  for (const builtin of raw.builtin_classes) {
    if (builtin.name === 'Nil') continue;
    if ((builtin.constructors ?? []).length > 0)
      add(builtin.name, 'new', 'constructor', 'runtime', { builtin: true });
    for (const member of builtin.members ?? [])
      add(builtin.name, member.name, 'member', 'runtime', { builtin: true });
    for (const method of builtin.methods ?? []) {
      add(builtin.name, method.name, 'method', 'runtime', {
        builtin: true,
        method: { static: method.is_static === true, virtual: false },
      });
    }
    for (const constant of builtin.constants ?? [])
      add(builtin.name, constant.name, 'constant', 'runtime', { builtin: true });
    for (const declared of builtin.enums ?? [])
      add(builtin.name, declared.name, 'enum', 'runtime', { builtin: true });
    for (const operator of builtin.operators ?? [])
      add(builtin.name, `operator ${operator.name}`, 'operator', 'runtime', { builtin: true });
  }

  const gdscriptNames = new Set([
    'Color8',
    'assert',
    'char',
    'convert',
    'dict_to_inst',
    'get_stack',
    'inst_to_dict',
    'is_instance_of',
    'len',
    'load',
    'ord',
    'preload',
    'print_debug',
    'print_stack',
    'range',
    'type_exists',
  ]);
  for (const utility of raw.utility_functions)
    add('@GDScript', utility.name, 'method', 'runtime', {
      method: { static: true, virtual: false },
    });
  for (const name of gdscriptNames)
    add('@GDScript', name, 'method', 'runtime', {
      method: { static: true, virtual: false },
    });
  for (const name of ['PI', 'TAU', 'INF', 'NAN']) add('@GDScript', name, 'constant', 'runtime');

  for (const constant of raw.global_constants)
    add('@GlobalScope', constant.name, 'constant', 'runtime');
  for (const declared of raw.global_enums) {
    add('@GlobalScope', declared.name, 'enum', 'runtime');
    for (const value of enumValues(declared)) add('@GlobalScope', value, 'constant', 'runtime');
  }
  return [...rows.values()].sort((a, b) => a.member.localeCompare(b.member));
}

const BUILTIN_FILES = {
  method: 'core/variant/variant_call.cpp',
  member: 'core/variant/variant_setget.cpp',
  constructor: 'core/variant/variant_construct.cpp',
  operator: 'core/variant/variant_op.cpp',
  constant: 'core/variant/variant_call.cpp',
  enum: 'core/variant/variant_call.cpp',
};

const OPERATOR_ENUM = new Map([
  ['==', 'EQUAL'],
  ['!=', 'NOT_EQUAL'],
  ['<', 'LESS'],
  ['<=', 'LESS_EQUAL'],
  ['>', 'GREATER'],
  ['>=', 'GREATER_EQUAL'],
  ['+', 'ADD'],
  ['-', 'SUBTRACT'],
  ['*', 'MULTIPLY'],
  ['/', 'DIVIDE'],
  ['unary-', 'NEGATE'],
  ['unary+', 'POSITIVE'],
  ['%', 'MODULE'],
  ['**', 'POWER'],
  ['<<', 'SHIFT_LEFT'],
  ['>>', 'SHIFT_RIGHT'],
  ['&', 'BIT_AND'],
  ['|', 'BIT_OR'],
  ['^', 'BIT_XOR'],
  ['~', 'BIT_NEGATE'],
  ['and', 'AND'],
  ['or', 'OR'],
  ['xor', 'XOR'],
  ['not', 'NOT'],
  ['in', 'IN'],
]);

function variantEnum(type) {
  return type
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toUpperCase();
}

function variantCppType(type) {
  if (type === 'float') return 'double';
  if (type === 'int') return 'int64_t';
  if (type === 'Object') return 'Object';
  return type;
}

function directBuiltinLocation(row, filesByPath) {
  const kind = row.kinds[0];
  const file = BUILTIN_FILES[kind];
  const source = filesByPath.get(file);
  if (source === undefined) fail(`missing pinned builtin source ${file}`);
  const name = row.member.slice(row.surfaceClass.length + 1);
  const typeEnum = variantEnum(row.surfaceClass);
  let candidates = [];
  if (kind === 'method') {
    candidates = source.lines.flatMap((line, index) => {
      const direct = new RegExp(
        `\\bbind_(?:static_method|method(?:v|nc)?|function(?:nc)?|custom[0-9]*)\\s*\\(\\s*${row.surfaceClass}\\s*,\\s*${name}\\b`,
      ).test(line);
      return direct ? [index] : [];
    });
    if (candidates.length === 0) {
      candidates = source.lines.flatMap((line, index) =>
        /\bbind_[A-Za-z0-9_]*method[A-Za-z0-9_]*\s*\(/.test(line) &&
        new RegExp(`(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`).test(line)
          ? [index]
          : [],
      );
    }
  } else if (kind === 'member') {
    candidates = source.lines.flatMap((line, index) =>
      new RegExp(
        `REGISTER_(?:NATIVE_)?MEMBER\\s*\\(\\s*${row.surfaceClass}\\s*,\\s*${name}\\b`,
      ).test(line)
        ? [index]
        : [],
    );
  } else if (kind === 'constructor') {
    const cppType = variantCppType(row.surfaceClass);
    candidates = source.lines.flatMap((line, index) =>
      line.includes('add_constructor') &&
      (new RegExp(`(?:<|,|::)${cppType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:,|>)`).test(
        line,
      ) ||
        (row.surfaceClass === 'Object' && /Constructor(?:Nil)?Object/.test(line)))
        ? [index]
        : [],
    );
  } else if (kind === 'operator') {
    const operator = name.slice('operator '.length);
    const op = OPERATOR_ENUM.get(operator);
    if (op !== undefined) {
      for (let index = 0; index < source.lines.length; index++) {
        const window = source.lines.slice(index, index + 4).join(' ');
        if (window.includes(`Variant::OP_${op}`) && window.includes(`Variant::${typeEnum}`))
          candidates.push(index);
      }
      if (
        candidates.length === 0 &&
        (row.surfaceClass === 'String' || row.surfaceClass === 'StringName')
      ) {
        candidates = source.lines.flatMap((line, index) =>
          line.includes('register_string_op(') && line.includes(`Variant::OP_${op}`) ? [index] : [],
        );
      }
    }
  } else {
    candidates = source.lines.flatMap((line, index) => {
      const exact =
        line.includes(`"${name}"`) ||
        new RegExp(`(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`).test(line);
      const registration = /add_(?:variant_|enum_)?constant|COLOR_CONSTANT|VARIANT_ENUM/.test(line);
      return exact && registration && line.includes(`Variant::${typeEnum}`) ? [index] : [];
    });
  }
  if (candidates.length === 0 && kind === 'constant' && row.surfaceClass === 'Color') {
    const generated = source.lines.findIndex((line) => line.includes('get_named_color_name'));
    if (generated !== -1) candidates.push(generated);
  }
  if (candidates.length === 0) {
    const registrationFunction = {
      method: '_register_variant_builtin_methods()',
      member: '_register_variant_setters_getters()',
      constructor: '_register_variant_constructors()',
      operator: '_register_variant_operators()',
      constant: '_register_variant_builtin_constants()',
      enum: '_register_variant_builtin_constants()',
    }[kind];
    const shared = source.lines.findIndex((line) => line.includes(registrationFunction));
    if (shared !== -1) {
      return [{ file, line: shared + 1, role: `builtin-${kind}-table`, precision: 'shared' }];
    }
  }
  if (candidates.length === 0) return [];
  return [
    {
      file,
      line: candidates[0] + 1,
      role: `builtin-${kind}-registration`,
      precision: kind === 'operator' ? 'generated' : 'direct',
    },
  ];
}

function classLocation(row, block, registrationLocations, classFiles) {
  const name = row.member.slice(row.surfaceClass.length + 1);
  const kind = row.kinds[0];
  if (kind === 'constructor') {
    const registration = registrationLocations.get(row.rawClass);
    if (registration !== undefined) return [registration];
  }
  const role = `${kind}-binding`;
  let locations = locationsFromBlock(block, name, kind, role);
  if (locations.length > 0) return locations;

  const candidateFiles = classFiles.get(row.rawClass) ?? [];
  locations = firstMatchingLine(
    candidateFiles,
    (line) => {
      if (kind === 'method') return new RegExp(`\\b${name}\\s*\\(`).test(line);
      if (kind === 'enum') return new RegExp(`\\benum(?:\\s+class)?\\s+${name}\\b`).test(line);
      return (
        line.includes(`"${name}"`) ||
        new RegExp(`(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`).test(line)
      );
    },
    `${kind}-declaration`,
  );
  if (locations.length > 0) return locations;
  if (kind === 'method' && /^(?:get|set|is)_/.test(name)) {
    const generatedName = name.replace(/^(?:get|set|is)_/, '');
    locations = firstMatchingLine(
      candidateFiles,
      (line) =>
        new RegExp(`(^|[^A-Za-z0-9_])${generatedName}([^A-Za-z0-9_]|$)`).test(line) &&
        /BIND|PROPERTY/.test(line),
      'generated-accessor-binding',
      'generated',
    );
    if (locations.length > 0) return locations;
  }
  if (kind === 'property' && /\d+$/.test(name)) {
    const generatedPrefix = name.replace(/\d+$/, '');
    locations = firstMatchingLine(
      candidateFiles,
      (line) =>
        /ADD_PROPERTY/.test(line) &&
        line.includes(`"${generatedPrefix}"`) &&
        /itos|String::num|vformat/.test(line),
      'generated-property-binding',
      'generated',
    );
    if (locations.length > 0) return locations;
  }
  if (block !== undefined) {
    return [
      { file: block.file, line: block.startLine, role: 'class-binding-block', precision: 'shared' },
    ];
  }
  locations = firstMatchingLine(
    candidateFiles,
    (line) => new RegExp(`\\bclass\\s+${row.rawClass}\\b`).test(line),
    'class-declaration',
    row.rawClass === 'Object' ? 'special-case' : 'shared',
  );
  if (locations.length > 0) return locations;
  return [];
}

function globalLocation(row, filesByPath) {
  const name = row.member.slice(row.surfaceClass.length + 1);
  const paths =
    row.surfaceClass === '@GDScript'
      ? [
          'core/variant/variant_utility.cpp',
          'modules/gdscript/gdscript_utility_functions.cpp',
          'modules/gdscript/gdscript_parser.cpp',
          'modules/gdscript/gdscript_tokenizer.cpp',
          'modules/gdscript/gdscript.cpp',
        ]
      : ['core/core_constants.cpp'];
  const sources = paths.map((path) => filesByPath.get(path)).filter(Boolean);
  const direct = firstMatchingLine(
    sources,
    (line) => {
      if (row.surfaceClass === '@GDScript' && row.kinds.includes('method')) {
        const registered = new RegExp(
          `(?:FUNCBIND[A-Z0-9_]*|REGISTER_FUNC)\\s*\\(\\s*_?${name}\\b`,
        ).test(line);
        const languageIntrinsic =
          (name === 'assert' || name === 'preload') && line.includes(`"${name}"`);
        return registered || languageIntrinsic;
      }
      return (
        line.includes(`"${name}"`) ||
        new RegExp(`(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`).test(line)
      );
    },
    row.kinds.includes('method') ? 'global-function-registration' : 'global-constant-registration',
  );
  if (direct.length > 0) return direct;
  if (row.surfaceClass === '@GlobalScope' && row.kinds.includes('constant')) {
    const generated = firstMatchingLine(
      sources,
      (line) => {
        if (!/BIND_CORE_(?:ENUM_)?CLASS_CONSTANT/.test(line)) return false;
        for (let split = name.indexOf('_'); split !== -1; split = name.indexOf('_', split + 1)) {
          const prefix = name.slice(0, split);
          const value = name.slice(split + 1);
          if (
            new RegExp(`[,\\s]${prefix}\\s*,`).test(line) &&
            new RegExp(`[,\\s](?:${name}|${value})\\s*\\)`).test(line)
          ) {
            return true;
          }
        }
        return false;
      },
      'generated-global-constant-registration',
      'generated',
    );
    if (generated.length > 0) return generated;
  }
  const source = sources[0];
  if (source === undefined) return [];
  const sharedLine = source.lines.findIndex((line) =>
    row.surfaceClass === '@GDScript'
      ? line.includes('register_functions()') || line.includes('register_utility_functions()')
      : line.includes('register_global_constants()'),
  );
  return sharedLine === -1
    ? []
    : [
        {
          file: source.file,
          line: sharedLine + 1,
          role: 'generated-registration-table',
          precision: 'shared',
        },
      ];
}

function main() {
  const sourceRootArgument = process.argv[2];
  if (sourceRootArgument === undefined) fail('expected the Godot source root as the only argument');
  const sourceRoot = resolve(sourceRootArgument);
  const versionSource = readFileSync(join(sourceRoot, 'version.py'), 'utf8');
  if (!/major\s*=\s*4\b/.test(versionSource) || !/minor\s*=\s*7\b/.test(versionSource)) {
    fail('source root version.py is not Godot 4.7');
  }

  const raw = JSON.parse(readFileSync(API_DUMP, 'utf8'));
  if (raw.header?.version_major !== 4 || raw.header?.version_minor !== 7)
    fail('API dump is not Godot 4.7');
  const sources = sourceFiles(sourceRoot).map((absolute) => {
    const bytes = readFileSync(absolute);
    const text = bytes.toString('utf8');
    return {
      absolute,
      file: relative(sourceRoot, absolute).split(sep).join('/'),
      bytes,
      text,
      lines: text.split(/\r?\n/),
    };
  });
  const filesByPath = new Map(sources.map((source) => [source.file, source]));
  const sourceTreeSha256 = sha256(
    sources.map((source) => `${source.file}\0${sha256(source.bytes)}`).join('\n'),
  );
  if (sourceTreeSha256 !== SOURCE_TREE_SHA256) {
    fail(`source tree is not the audited ${REVISION} tree: got ${sourceTreeSha256}`);
  }

  const wantedClasses = new Set(raw.classes.map((cls) => cls.name));
  const blocks = new Map();
  const classFiles = new Map();
  const registrationLocations = new Map();
  for (const source of sources) {
    const bindDefinitions = /void\s+([A-Za-z_][A-Za-z0-9_]*)::_bind_methods\s*\(/g;
    let binding = bindDefinitions.exec(source.text);
    while (binding !== null) {
      const className = binding[1];
      binding = bindDefinitions.exec(source.text);
      if (!wantedClasses.has(className)) continue;
      if (blocks.has(className)) fail(`${className} has multiple _bind_methods definitions`);
      blocks.set(className, findFunctionBlock(source.file, source.text, className));
    }
    const declarations = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
    let declaration = declarations.exec(source.text);
    while (declaration !== null) {
      const className = declaration[1];
      declaration = declarations.exec(source.text);
      if (!wantedClasses.has(className)) continue;
      const list = classFiles.get(className) ?? [];
      list.push(source);
      classFiles.set(className, list);
    }
    for (let index = 0; index < source.lines.length; index++) {
      const registration = /GDREGISTER_[A-Z_]*CLASS\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/.exec(
        source.lines[index] ?? '',
      );
      const className = registration?.[1];
      if (
        className !== undefined &&
        wantedClasses.has(className) &&
        !registrationLocations.has(className)
      ) {
        registrationLocations.set(className, {
          file: source.file,
          line: index + 1,
          role: 'class-registration',
          precision: 'direct',
        });
      }
    }
  }

  const rows = uniqueRows(raw).map((row) => {
    let locations;
    if (row.builtin === true) locations = directBuiltinLocation(row, filesByPath);
    else if (row.surfaceClass.startsWith('@')) locations = globalLocation(row, filesByPath);
    else
      locations = classLocation(row, blocks.get(row.rawClass), registrationLocations, classFiles);
    if (locations.length === 0) fail(`${row.member} has no source location`);
    const primary = locations[0];
    return {
      member: row.member,
      surfaceClass: row.surfaceClass,
      scope: row.scope,
      owner: sourceOwner(row.scope, primary, row.surfaceClass),
      kinds: row.kinds,
      locations,
      ...(row.rawClass === 'Object' ? { specialCase: 'root-object' } : {}),
      ...(row.accessors === undefined ? {} : { accessors: row.accessors }),
      ...(row.method === undefined ? {} : { method: row.method }),
    };
  });

  const citedFiles = [
    ...new Set(rows.flatMap((row) => row.locations.map((location) => location.file))),
  ].sort();
  const sourceHashes = citedFiles.map((file) => {
    const source = filesByPath.get(file);
    if (source === undefined) fail(`cited source ${file} is missing`);
    return { file, sha256: sha256(source.bytes) };
  });
  const byPrecision = { direct: 0, generated: 0, shared: 0, 'special-case': 0 };
  for (const row of rows) byPrecision[row.locations[0].precision]++;
  const owners = [...new Set(rows.map((row) => row.owner))].sort();
  const roles = [
    ...new Set(rows.flatMap((row) => row.locations.map((location) => location.role))),
  ].sort();
  const precisions = [
    ...new Set(rows.flatMap((row) => row.locations.map((location) => location.precision))),
  ].sort();
  const fileIndexes = new Map(sourceHashes.map((source, index) => [source.file, index]));
  const ownerIndexes = new Map(owners.map((owner, index) => [owner, index]));
  const roleIndexes = new Map(roles.map((role, index) => [role, index]));
  const precisionIndexes = new Map(precisions.map((precision, index) => [precision, index]));
  const manifest = {
    protocol: 'vgai.godot-classdb-source-index',
    protocolVersion: 2,
    rowProtocol: '[member,owner,locations,specialCase,accessors,method]',
    engineVersion: VERSION,
    sourceRepository: 'https://github.com/godotengine/godot',
    sourceRevision: REVISION,
    sourceArchiveSha256: SOURCE_ARCHIVE_SHA256,
    sourceTreeSha256,
    apiDump: {
      file: 'godot-4.7-extension_api.json',
      sha256: sha256(readFileSync(API_DUMP)),
    },
    coverage: {
      rows: rows.length,
      sourceFiles: sourceHashes.length,
      specialCaseRows: rows.filter((row) => row.specialCase !== undefined).length,
      byPrecision,
    },
    dictionaries: {
      owners,
      roles,
      precisions,
    },
    sourceFiles: sourceHashes.map((source) => [source.file, source.sha256]),
  };
  const rowLines = rows.map((row) =>
    JSON.stringify([
      row.member,
      ownerIndexes.get(row.owner),
      row.locations.map((location) => [
        fileIndexes.get(location.file),
        location.line,
        roleIndexes.get(location.role),
        precisionIndexes.get(location.precision),
      ]),
      row.specialCase === 'root-object' ? 1 : 0,
      row.accessors === undefined
        ? null
        : [row.accessors.getter ?? null, row.accessors.setter ?? null],
      row.method === undefined ? null : [row.method.static ? 1 : 0, row.method.virtual ? 1 : 0],
    ]),
  );
  writeFileSync(OUTPUT, `${JSON.stringify(manifest)}\n${rowLines.join('\n')}\n`);
  process.stdout.write(
    `${OUTPUT}\nrows ${rows.length}; files ${sourceHashes.length}; ${JSON.stringify(byPrecision)}\n`,
  );
}

main();
