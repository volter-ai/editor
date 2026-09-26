/** Exact Godot spatial-shader subset emitted as a native Three ShaderMaterial program. */

import type {
  AuthoredShaderResource,
  CompiledShaderBackend,
  CompiledShaderSampler,
} from './authored-shader-material';
import { TranslateError } from './model';

const DIRECTIVE = /(?:^|\n)\s*(shader_type|render_mode)\s+([^;]+);/g;
const UNIFORM = /(?:^|\n)\s*uniform\s+(bool|int|float|vec2|vec3|vec4|sampler2D)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([^=;]+?))?(?:\s*=\s*([^;]+?))?\s*;/g;
const VARYING = /(?:^|\n)\s*varying\s+(bool|int|float|vec2|vec3|vec4)\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/g;
const ALLOWED_RENDER_MODES = new Set(['cull_front', 'unshaded']);

function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ''))
    .replace(/\/\/[^\n\r]*/g, '');
}

function stage(source: string, name: 'vertex' | 'fragment', at: string): { body: string; whole: string } {
  const declaration = new RegExp(`\\bvoid\\s+${name}\\s*\\(\\s*\\)\\s*\\{`, 'g');
  const matches = [...source.matchAll(declaration)];
  if (matches.length !== 1 || matches[0]?.index === undefined) {
    throw new TranslateError(at, `spatial shader must declare exactly one parameterless ${name}() stage.`);
  }
  const start = matches[0].index;
  const open = source.indexOf('{', start);
  let depth = 1;
  let end = open + 1;
  while (end < source.length && depth > 0) {
    if (source[end] === '{') depth += 1;
    else if (source[end] === '}') depth -= 1;
    end += 1;
  }
  if (depth !== 0) throw new TranslateError(at, `spatial shader ${name}() has an unterminated body.`);
  return { body: source.slice(open + 1, end - 1), whole: source.slice(start, end) };
}

function replaceBuiltin(source: string, name: string, replacement: string): string {
  return source.replace(new RegExp(`\\b${name}\\b`, 'g'), replacement);
}

function splitShaderCallArguments(source: string): string[] {
  const arguments_: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    else if (char === ',' && depth === 0) {
      arguments_.push(source.slice(start, index).trim());
      start = index + 1;
    }
    if (depth < 0) return [];
  }
  if (depth !== 0) return [];
  arguments_.push(source.slice(start).trim());
  return arguments_;
}

/** Lower Godot's explicit base-mip sample while preserving an arbitrary coordinate expression. */
function lowerBaseMipTextureLod(
  source: string,
  uniformTypes: ReadonlyMap<string, string>,
  at: string,
): string {
  let output = '';
  let cursor = 0;
  const declaration = /\btextureLod\s*\(/g;
  while (true) {
    declaration.lastIndex = cursor;
    const match = declaration.exec(source);
    if (match?.index === undefined) {
      output += source.slice(cursor);
      return output;
    }
    const open = source.indexOf('(', match.index);
    let depth = 1;
    let end = open + 1;
    while (end < source.length && depth > 0) {
      if (source[end] === '(') depth += 1;
      else if (source[end] === ')') depth -= 1;
      end += 1;
    }
    if (depth !== 0) {
      throw new TranslateError(at, 'spatial shader textureLod call has an unterminated argument list.');
    }
    const args = splitShaderCallArguments(source.slice(open + 1, end - 1));
    const sampler = args[0];
    const coordinates = args[1];
    const mip = args[2];
    if (
      args.length !== 3 || sampler === undefined || coordinates === undefined || mip === undefined ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(sampler) ||
      uniformTypes.get(sampler) !== 'sampler2D' ||
      !/^[+]?0(?:\.0*)?$/.test(mip)
    ) {
      throw new TranslateError(
        at,
        'spatial shader textureLod is carried only for a declared sampler2D at exact mip level 0.',
      );
    }
    output += source.slice(cursor, match.index) + `texture2D(${sampler}, ${coordinates})`;
    cursor = end;
  }
}

function isVectorSwizzle(source: string, index: number, token: string): boolean {
  let receiverEnd = index - 1;
  while (receiverEnd >= 0 && /\s/.test(source[receiverEnd]!)) receiverEnd -= 1;
  if (source[receiverEnd] !== '.') return false;
  return /^(?:[xyzw]{1,4}|[rgba]{1,4}|[stpq]{1,4})$/.test(token);
}

function assertStageIdentifiers(
  source: string,
  uniforms: ReadonlySet<string>,
  builtins: ReadonlySet<string>,
  at: string,
  name: string,
): void {
  const locals = new Set(
    [...source.matchAll(/\b(?:bool|int|float|vec[234]|mat[234])\s+([A-Za-z_][A-Za-z0-9_]*)/g)]
      .map((match) => match[1]!),
  );
  const language = new Set([
    'bool', 'int', 'float', 'vec2', 'vec3', 'vec4', 'ivec2', 'mat2', 'mat3', 'mat4',
    'if', 'else', 'return', 'normalize', 'fract', 'mix', 'texture', 'textureLod', 'inverse', 'distance', 'length',
    'dFdx', 'dFdy', 'smoothstep', 'min', 'max', 'clamp',
  ]);
  for (const match of source.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    const token = match[0];
    if (uniforms.has(token) || locals.has(token) || builtins.has(token) || language.has(token)) continue;
    if (match.index !== undefined && isVectorSwizzle(source, match.index, token)) continue;
    throw new TranslateError(at, `spatial shader ${name}() identifier ${token} is outside the carried language.`);
  }
}

/**
 * Compile the retained unshaded spatial language used by authored outline passes. Anything beyond
 * the explicit stage/builtin set refuses before a browser shader can become plausibly wrong.
 */
export function compileGodotSpatialShader(shader: AuthoredShaderResource): CompiledShaderBackend {
  const clean = stripComments(shader.code);
  const directives = [...clean.matchAll(DIRECTIVE)];
  const shaderTypes = directives
    .filter((entry) => entry[1] === 'shader_type')
    .map((entry) => entry[2]?.trim());
  if (shaderTypes.length !== 1 || shaderTypes[0] !== 'spatial') {
    throw new TranslateError(
      shader.resPath,
      `Three ShaderMaterial requires exactly shader_type spatial; found ${shaderTypes.join(', ') || 'none'}.`,
    );
  }
  const modes = directives
    .filter((entry) => entry[1] === 'render_mode')
    .flatMap((entry) => entry[2]?.split(',').map((mode) => mode.trim()) ?? []);
  for (const mode of modes) {
    if (!ALLOWED_RENDER_MODES.has(mode)) {
      throw new TranslateError(shader.resPath, `spatial shader render_mode ${mode} is unsupported.`);
    }
  }
  const standardLit = !modes.includes('unshaded');

  const uniformLines: string[] = [];
  const uniformNames = new Set<string>();
  const uniformTypes = new Map<string, string>();
  const samplers: CompiledShaderSampler[] = [];
  for (const declaration of clean.matchAll(UNIFORM)) {
    const type = declaration[1]!;
    const name = declaration[2]!;
    const hint = declaration[3]?.trim();
    const hints = hint?.split(',').map((entry) => entry.trim()).filter(Boolean) ?? [];
    if (hints.some((entry) => ![
      'hint_color',
      'source_color',
      'hint_depth_texture',
      'hint_default_white',
      'repeat_disable',
      'filter_nearest',
      'filter_linear',
    ].includes(entry))) {
      throw new TranslateError(shader.resPath, `spatial shader uniform ${name} hint ${hint} is unsupported.`);
    }
    const samplerHints = hints.filter((entry) => [
      'hint_depth_texture',
      'hint_default_white',
      'repeat_disable',
      'filter_nearest',
      'filter_linear',
    ].includes(entry));
    if (samplerHints.length > 0 && type !== 'sampler2D') {
      throw new TranslateError(shader.resPath, `spatial shader uniform ${name} uses sampler hint ${samplerHints[0]} on non-sampler type ${type}.`);
    }
    if (hints.includes('filter_nearest') && hints.includes('filter_linear')) {
      throw new TranslateError(shader.resPath, `spatial shader uniform ${name} redefines its sampler filter.`);
    }
    if (type === 'sampler2D' && (
      hints.includes('hint_default_white') ||
      hints.includes('filter_nearest') ||
      hints.includes('filter_linear') ||
      hints.includes('repeat_disable')
    )) {
      samplers.push({
        name,
        ...(hints.includes('hint_default_white') ? { default: 'white' as const } : {}),
        ...(hints.includes('filter_nearest')
          ? { filter: 'nearest' as const }
          : hints.includes('filter_linear')
            ? { filter: 'linear' as const }
            : {}),
        ...(hints.includes('repeat_disable') ? { repeat: 'disabled' as const } : {}),
      });
    }
    uniformNames.add(name);
    uniformTypes.set(name, type);
    uniformLines.push(`uniform ${type} ${name};`);
  }
  const varyingLines: string[] = [];
  for (const declaration of clean.matchAll(VARYING)) {
    uniformNames.add(declaration[2]!);
    varyingLines.push(`varying ${declaration[1]!} ${declaration[2]!};`);
  }

  const vertexDeclarations = clean.match(/\bvoid\s+vertex\s*\(\s*\)/g) ?? [];
  if (vertexDeclarations.length > 1) {
    throw new TranslateError(shader.resPath, 'spatial shader declares more than one vertex() stage.');
  }
  const vertexStage = vertexDeclarations.length === 0 ? undefined : stage(clean, 'vertex', shader.resPath);
  const fragmentStage = stage(clean, 'fragment', shader.resPath);
  let residue = clean
    .replace(DIRECTIVE, '\n')
    .replace(UNIFORM, '\n')
    .replace(VARYING, '\n')
    .replace(vertexStage?.whole ?? '', '\n')
    .replace(fragmentStage.whole, '\n')
    .trim();
  if (residue !== '' && !standardLit) {
    throw new TranslateError(shader.resPath, 'spatial shader contains declarations outside the carried directives, uniforms, vertex(), and fragment() stages.');
  }
  if (standardLit && vertexStage !== undefined) {
    throw new TranslateError(shader.resPath, 'lit spatial shader vertex() mutation is outside the standard-material patch seam.');
  }
  for (const declaration of residue.matchAll(/\b(?:bool|int|float|vec[234]|mat[234])\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    if (declaration[1] !== undefined) uniformNames.add(declaration[1]);
  }

  const textureSizes = new Map<string, string>();
  const lowerTextureSizes = (source: string, stageName: string): string => {
    const lowered = source.replace(
      /\btextureSize\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*0\s*\)/g,
      (_call, sampler: string) => {
        if (uniformTypes.get(sampler) !== 'sampler2D') {
          throw new TranslateError(
            shader.resPath,
            `spatial shader ${stageName} textureSize requires a declared sampler2D; found ${sampler}.`,
          );
        }
        let generated = textureSizes.get(sampler);
        if (generated === undefined) {
          generated = `godotTextureSize_${sampler}`;
          if (uniformNames.has(generated)) {
            throw new TranslateError(
              shader.resPath,
              `spatial shader textureSize compiler uniform ${generated} collides with an authored identifier.`,
            );
          }
          textureSizes.set(sampler, generated);
          uniformNames.add(generated);
          uniformLines.push(`uniform vec2 ${generated};`);
        }
        return `ivec2(${generated})`;
      },
    );
    if (/\btextureSize\s*\(/.test(lowered)) {
      throw new TranslateError(
        shader.resPath,
        `spatial shader ${stageName} textureSize is carried only for a declared sampler2D and literal mip level 0.`,
      );
    }
    return lowered;
  };
  const vertexStageBody = lowerTextureSizes(vertexStage?.body ?? '', 'vertex');
  const fragmentStageBody = lowerTextureSizes(fragmentStage.body, 'fragment');
  residue = lowerTextureSizes(residue, 'helper');

  const forbidden = [
    'LIGHT', 'EMISSION', 'METALLIC', 'ROUGHNESS', 'SPECULAR', 'RIM', 'CLEARCOAT',
    'DEPTH', 'SCREEN_TEXTURE', 'DEPTH_TEXTURE', 'INSTANCE_CUSTOM', 'TIME',
  ];
  for (const builtin of forbidden) {
    if (new RegExp(`\\b${builtin}\\b`).test(`${vertexStageBody}\n${fragmentStageBody}`)) {
      throw new TranslateError(shader.resPath, `spatial shader builtin ${builtin} is unsupported.`);
    }
  }
  if (vertexStage !== undefined) {
    assertStageIdentifiers(
      vertexStageBody,
      uniformNames,
      new Set(['PROJECTION_MATRIX', 'MODELVIEW_MATRIX', 'VIEWPORT_SIZE', 'POSITION', 'VERTEX', 'NORMAL']),
      shader.resPath,
      'vertex',
    );
  }
  assertStageIdentifiers(
    fragmentStageBody,
    uniformNames,
    new Set(['ALBEDO', 'ALPHA', 'UV', 'SCREEN_UV', 'INV_VIEW_MATRIX', 'PROJECTION_MATRIX']),
    shader.resPath,
    'fragment',
  );

  const authoredPosition = /\bPOSITION\s*=/.test(vertexStageBody);
  let vertexBody = vertexStageBody;
  vertexBody = replaceBuiltin(vertexBody, 'PROJECTION_MATRIX', 'projectionMatrix');
  vertexBody = replaceBuiltin(vertexBody, 'MODELVIEW_MATRIX', 'modelViewMatrix');
  vertexBody = replaceBuiltin(vertexBody, 'VIEWPORT_SIZE', 'godotViewportSize');
  vertexBody = replaceBuiltin(vertexBody, 'POSITION', 'gl_Position');
  vertexBody = replaceBuiltin(vertexBody, 'VERTEX', 'godotVertex');
  vertexBody = replaceBuiltin(vertexBody, 'NORMAL', 'normal');
  vertexBody = `vec3 godotVertex = position;\n${vertexBody}${authoredPosition ? '' : '\ngl_Position = projectionMatrix * modelViewMatrix * vec4(godotVertex, 1.0);'}`;

  let fragmentBody = fragmentStageBody;
  fragmentBody = lowerBaseMipTextureLod(fragmentBody, uniformTypes, shader.resPath);
  fragmentBody = replaceBuiltin(fragmentBody, 'ALBEDO', 'godotAlbedo');
  fragmentBody = replaceBuiltin(fragmentBody, 'ALPHA', 'godotAlpha');
  fragmentBody = replaceBuiltin(fragmentBody, 'UV', 'godotUv');
  fragmentBody = replaceBuiltin(fragmentBody, 'SCREEN_UV', '(gl_FragCoord.xy / godotViewportSize)');
  fragmentBody = replaceBuiltin(fragmentBody, 'INV_VIEW_MATRIX', 'godotInverseViewMatrix');
  fragmentBody = fragmentBody.replace(/\binverse\s*\(\s*PROJECTION_MATRIX\s*\)/g, 'godotInverseProjectionMatrix');
  fragmentBody = replaceBuiltin(fragmentBody, 'PROJECTION_MATRIX', 'godotProjectionMatrix');
  fragmentBody = fragmentBody.replace(/\btexture\s*\(/g, 'texture2D(');
  if (/\b(POSITION|VERTEX|NORMAL|PROJECTION_MATRIX|MODELVIEW_MATRIX|VIEWPORT_SIZE)\b/.test(fragmentBody)) {
    throw new TranslateError(shader.resPath, 'spatial fragment stage references a vertex-only builtin.');
  }

  const uniforms = uniformLines.join('\n');
  const varyings = varyingLines.join('\n');
  if (standardLit) {
    let helpers = residue.replace(/\btexture\s*\(/g, 'texture2D(');
    helpers = replaceBuiltin(helpers, 'UV', 'godotUv');
    if (/\b(?:ALBEDO|ALPHA|VERTEX|NORMAL|POSITION|PROJECTION_MATRIX|MODELVIEW_MATRIX|VIEWPORT_SIZE)\b/.test(helpers)) {
      throw new TranslateError(shader.resPath, 'lit spatial shader helper references a stage-only builtin.');
    }
    return {
      vertex: '',
      fragment: `${uniforms}\n${varyings}\n${helpers}\nvoid godotSpatialFragment(inout vec3 godotAlbedo, inout float godotAlpha, vec2 godotUv) {\n${fragmentBody}\n}`,
      standardMaterialPatch: true,
      usesAlpha: /\bALPHA\b/.test(fragmentStage.body),
      ...(samplers.length > 0 ? { samplers } : {}),
      ...(textureSizes.size > 0
        ? { textureSizes: [...textureSizes].map(([sampler, uniform]) => ({ sampler, uniform })) }
        : {}),
    };
  }
  return {
    vertex: `${uniforms}\n${varyings}\nuniform vec2 godotViewportSize;\nvoid main() {\n${vertexBody}\n}`,
    fragment: `${uniforms}\n${varyings}\nuniform vec2 godotViewportSize;\nuniform mat4 godotProjectionMatrix;\nuniform mat4 godotInverseProjectionMatrix;\nuniform mat4 godotInverseViewMatrix;\nvoid main() {\n  vec3 godotAlbedo = vec3(0.0);\n  float godotAlpha = 1.0;\n${fragmentBody}\n  gl_FragColor = vec4(godotAlbedo, godotAlpha);\n}`,
    usesDepthTexture: [...clean.matchAll(UNIFORM)].some((declaration) => declaration[3]?.split(',').some((entry) => entry.trim() === 'hint_depth_texture')),
    usesViewportSize: /\bVIEWPORT_SIZE\b/.test(vertexStage?.body ?? '') || /\bSCREEN_UV\b/.test(fragmentStage.body),
    usesAlpha: /\bALPHA\b/.test(fragmentStage.body),
    ...(samplers.length > 0 ? { samplers } : {}),
    ...(textureSizes.size > 0
      ? { textureSizes: [...textureSizes].map(([sampler, uniform]) => ({ sampler, uniform })) }
      : {}),
  };
}
