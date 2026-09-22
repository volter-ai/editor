/** Native GLSL document helpers. GLSL remains the artifact; these functions
 * only describe it for Asset Lab and never serialize a VGAI shader shape. */

export type ShaderStage = 'vertex' | 'fragment';

export interface ShaderUniformDescriptor {
  readonly name: string;
  readonly type: string;
  readonly arraySize?: number | undefined;
  readonly stages: readonly ShaderStage[];
}

export interface ShaderDiagnostic {
  readonly stage: ShaderStage | 'program';
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly line?: number | undefined;
  readonly column?: number | undefined;
}

const VERTEX_SUFFIXES = ['.vert', '.vert.glsl'] as const;
const FRAGMENT_SUFFIXES = ['.frag', '.frag.glsl'] as const;

function cleanPath(path: string): string {
  return path.split(/[?#]/, 1)[0]!.toLowerCase();
}

export function shaderStageFromPath(path: string, source = ''): ShaderStage {
  const clean = cleanPath(path);
  if (VERTEX_SUFFIXES.some((suffix) => clean.endsWith(suffix))) return 'vertex';
  if (FRAGMENT_SUFFIXES.some((suffix) => clean.endsWith(suffix))) return 'fragment';
  return /\bgl_Position\b/.test(source) ? 'vertex' : 'fragment';
}

/** Conventional sibling only. A standalone `.glsl` file stays standalone. */
export function shaderCompanionPath(path: string): string | null {
  const clean = path.split(/[?#]/, 1)[0]!;
  if (/\.vert\.glsl$/i.test(clean)) return clean.replace(/\.vert\.glsl$/i, '.frag.glsl');
  if (/\.frag\.glsl$/i.test(clean)) return clean.replace(/\.frag\.glsl$/i, '.vert.glsl');
  if (/\.vert$/i.test(clean)) return clean.replace(/\.vert$/i, '.frag');
  if (/\.frag$/i.test(clean)) return clean.replace(/\.frag$/i, '.vert');
  return null;
}

function withoutComments(source: string): string {
  // Preserve newlines so reflection never perturbs source-line diagnostics.
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');
}

function declarations(source: string, stage: ShaderStage): ShaderUniformDescriptor[] {
  const result: ShaderUniformDescriptor[] = [];
  const pattern =
    /\buniform\s+(?:(?:lowp|mediump|highp)\s+)?([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(?:\[\s*(\d+)\s*\])?\s*;/g;
  for (const match of withoutComments(source).matchAll(pattern)) {
    const type = match[1];
    const name = match[2];
    if (!type || !name) continue;
    const arraySize = match[3] ? Number.parseInt(match[3], 10) : undefined;
    result.push({ name, type, ...(arraySize ? { arraySize } : {}), stages: [stage] });
  }
  return result;
}

export function reflectShaderUniforms(
  vertexSource: string,
  fragmentSource: string,
): ShaderUniformDescriptor[] {
  const reflected = new Map<string, ShaderUniformDescriptor>();
  for (const uniform of [
    ...declarations(vertexSource, 'vertex'),
    ...declarations(fragmentSource, 'fragment'),
  ]) {
    const current = reflected.get(uniform.name);
    if (!current) {
      reflected.set(uniform.name, uniform);
      continue;
    }
    reflected.set(uniform.name, {
      ...current,
      stages: [...new Set([...current.stages, ...uniform.stages])],
    });
  }
  return [...reflected.values()];
}

export function parseShaderDiagnostics(
  log: string,
  stage: ShaderDiagnostic['stage'],
): ShaderDiagnostic[] {
  const diagnostics = log
    .split('\n')
    .map((line) => parseDiagnosticLine(line.trim(), stage))
    .filter((diagnostic): diagnostic is ShaderDiagnostic => diagnostic !== null);
  if (diagnostics.length === 0 && log.trim()) {
    diagnostics.push({ stage, severity: 'error', message: log.trim() });
  }
  return diagnostics;
}

function parseDiagnosticLine(
  text: string,
  stage: ShaderDiagnostic['stage'],
): ShaderDiagnostic | null {
  if (!text) return null;
  const colon = text.match(/^(ERROR|WARNING):\s*\d+:(\d+)(?::|\((\d+)\):)\s*(.*)$/i);
  if (colon) {
    return {
      stage,
      severity: colon[1]!.toLowerCase() === 'warning' ? 'warning' : 'error',
      line: Number.parseInt(colon[2]!, 10),
      ...(colon[3] ? { column: Number.parseInt(colon[3], 10) } : {}),
      message: colon[4] || text,
    };
  }
  const paren = text.match(/^\d+:(\d+)\((\d+)\):\s*(?:(error|warning)\s*:?)?\s*(.*)$/i);
  if (!paren) return null;
  return {
    stage,
    severity: paren[3]?.toLowerCase() === 'warning' ? 'warning' : 'error',
    line: Number.parseInt(paren[1]!, 10),
    column: Number.parseInt(paren[2]!, 10),
    message: paren[4] || text,
  };
}

/** Reset driver-reported lines after Three's injected ShaderMaterial prefix. */
export function previewShaderSource(source: string): string {
  return `#line 1\n${source}`;
}

export const FALLBACK_VERTEX_SHADER = `varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const FALLBACK_FRAGMENT_SHADER = `varying vec2 vUv;

void main() {
  gl_FragColor = vec4(vUv, 0.55, 1.0);
}`;
