/** Exact Godot canvas_item fragment subset emitted as a native Pixi Filter program. */

import type { AuthoredShaderResource, CompiledShaderBackend } from './authored-shader-material';
import { TranslateError } from './model';

const PIXI_FILTER_VERTEX = `
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}`;

const DIRECTIVES = /(?:^|\n)\s*(shader_type|render_mode)\s+([^;]+);/g;
const UNIFORM = /(?:^|\n)\s*(?:(?:global|instance)\s+)?uniform\s+([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*[^=;]+)?(?:\s*=\s*[^;]+)?\s*;/g;
const ALLOWED_UNIFORM_TYPES = new Set([
  'bool', 'int', 'float', 'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4',
  'mat3', 'mat4', 'sampler2D',
]);
// Godot 3.6 `RasterizerStorageGLES2::_update_shader` maps `unshaded` to the canvas material's
// LIGHT_MODE_UNSHADED. The compiled fragment program itself is unchanged; godot-compat's retained
// canvas-light owner consumes the mode and excludes the item from lighting. Keep every other mode
// loud until its exact backend behavior is carried.
const ALLOWED_RENDER_MODES = new Set(['blend_mix', 'blend_add', 'unshaded']);

function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ''))
    .replace(/\/\/[^\n\r]*/g, '');
}

function replaceBuiltin(source: string, name: string, replacement: string): string {
  return source.replace(new RegExp(`\\b${name}\\b`, 'g'), replacement);
}

/**
 * Compile only the measured canvas fragment language. Unsupported stages, render modes, storage
 * qualifiers, and renderer builtins fail at translation time instead of producing plausible GLSL.
 */
export function compileGodotCanvasShader(shader: AuthoredShaderResource): CompiledShaderBackend {
  const clean = stripComments(shader.code);
  const shaderTypes = [...clean.matchAll(DIRECTIVES)]
    .filter((entry) => entry[1] === 'shader_type')
    .map((entry) => entry[2]?.trim());
  if (shaderTypes.length !== 1 || shaderTypes[0] !== 'canvas_item') {
    throw new TranslateError(
      shader.resPath,
      `CanvasItem ShaderMaterial requires exactly shader_type canvas_item; found ${shaderTypes.join(', ') || 'none'}.`,
    );
  }
  if (/\bvoid\s+(vertex|light)\s*\(/.test(clean)) {
    throw new TranslateError(shader.resPath, 'canvas shader vertex/light stages are not carried by the Pixi Filter compiler.');
  }
  const fragmentDeclarations = clean.match(/\bvoid\s+fragment\s*\(\s*\)/g) ?? [];
  if (fragmentDeclarations.length !== 1) {
    throw new TranslateError(shader.resPath, 'canvas shader must declare exactly one parameterless fragment() stage.');
  }
  for (const directive of clean.matchAll(DIRECTIVES)) {
    if (directive[1] !== 'render_mode') continue;
    for (const raw of directive[2]?.split(',') ?? []) {
      const mode = raw.trim();
      if (!ALLOWED_RENDER_MODES.has(mode)) {
        throw new TranslateError(shader.resPath, `canvas shader render_mode ${mode} is unsupported.`);
      }
    }
  }
  for (const declaration of clean.matchAll(UNIFORM)) {
    const type = declaration[1]!;
    if (!ALLOWED_UNIFORM_TYPES.has(type)) {
      throw new TranslateError(shader.resPath, `canvas shader uniform type ${type} is unsupported.`);
    }
  }
  const forbidden = [
    'NORMAL', 'NORMAL_MAP', 'NORMAL_MAP_DEPTH', 'VERTEX', 'LIGHT', 'LIGHT_COLOR', 'LIGHT_VEC',
    'SHADOW_COLOR', 'POINT_COORD', 'INSTANCE_CUSTOM', 'AT_LIGHT_PASS', 'SPECULAR_SHININESS',
  ];
  for (const builtin of forbidden) {
    if (new RegExp(`\\b${builtin}\\b`).test(clean)) {
      throw new TranslateError(shader.resPath, `canvas shader builtin ${builtin} is unsupported.`);
    }
  }

  let body = clean
    .replace(DIRECTIVES, '\n')
    .replace(UNIFORM, (_whole, type: string, name: string) => `\nuniform ${type} ${name};`)
    .replace(/\bvoid\s+fragment\s*\(\s*\)/, 'void godotFragment(inout vec4 godotColor, vec2 godotUv, vec2 godotScreenUv, float godotTime)');
  body = replaceBuiltin(body, 'TEXTURE_PIXEL_SIZE', 'uInputSize.zw');
  body = replaceBuiltin(body, 'SCREEN_TEXTURE', 'godotScreenTexture');
  body = replaceBuiltin(body, 'SCREEN_UV', 'godotScreenUv');
  body = replaceBuiltin(body, 'TEXTURE', 'uTexture');
  body = replaceBuiltin(body, 'UV', 'godotUv');
  body = replaceBuiltin(body, 'COLOR', 'godotColor');
  body = replaceBuiltin(body, 'TIME', 'godotTime');

  const usesTime = /\bTIME\b/.test(clean);
  const usesScreenTexture = /\bSCREEN_TEXTURE\b/.test(clean);
  const usesScreenUv = /\bSCREEN_UV\b/.test(clean);
  const fragment = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uOutputTexture;
${usesScreenTexture ? 'uniform sampler2D godotScreenTexture;' : ''}
${usesTime ? 'uniform float godotTime;' : ''}
${body}
void main(void) {
  vec4 godotColor = texture(uTexture, vTextureCoord);
  vec2 godotScreenUv = ${usesScreenUv ? 'vec2(gl_FragCoord.x / uOutputTexture.x, 1.0 - gl_FragCoord.y / uOutputTexture.y)' : 'vTextureCoord'};
  godotFragment(godotColor, vTextureCoord, godotScreenUv, ${usesTime ? 'godotTime' : '0.0'});
  finalColor = godotColor;
}`;
  return {
    vertex: PIXI_FILTER_VERTEX,
    fragment,
    ...(usesTime ? { usesTime: true } : {}),
    ...(usesScreenTexture ? { usesScreenTexture: true } : {}),
  };
}
