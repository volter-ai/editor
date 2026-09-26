export interface RenderShaderSourceLocation {
  file: string;
  line: number;
  column: number;
}

export interface RenderShaderGeneratedRange {
  generatedLine: number;
  generatedColumnStart: number;
  generatedColumnEnd: number;
  source: RenderShaderSourceLocation;
}

export interface RenderShaderCompilerDiagnostic {
  severity: "info" | "warning" | "error";
  message: string;
  generatedLine?: number;
  generatedColumn?: number;
  code?: string;
}

export interface RenderShaderMappedDiagnostic extends RenderShaderCompilerDiagnostic {
  source: RenderShaderSourceLocation | null;
}

function cloneLocation(location: RenderShaderSourceLocation): RenderShaderSourceLocation {
  return { ...location };
}

export class RenderShaderSourceMapRuntime {
  private readonly ranges = new Map<number, RenderShaderGeneratedRange[]>();

  add(range: RenderShaderGeneratedRange): void {
    if (!Number.isInteger(range.generatedLine) || range.generatedLine < 1
      || !Number.isInteger(range.generatedColumnStart) || range.generatedColumnStart < 1
      || !Number.isInteger(range.generatedColumnEnd) || range.generatedColumnEnd < range.generatedColumnStart) {
      throw new Error("Generated shader source range is invalid");
    }
    if (!range.source.file || !Number.isInteger(range.source.line) || range.source.line < 1
      || !Number.isInteger(range.source.column) || range.source.column < 1) {
      throw new Error("Original shader source location is invalid");
    }
    const ranges = this.ranges.get(range.generatedLine) ?? [];
    if (ranges.some((existing) => existing.generatedColumnStart < range.generatedColumnEnd
      && range.generatedColumnStart < existing.generatedColumnEnd)) {
      throw new Error(`Shader source map range overlaps on generated line ${range.generatedLine}`);
    }
    ranges.push({ ...range, source: cloneLocation(range.source) });
    ranges.sort((a, b) => a.generatedColumnStart - b.generatedColumnStart);
    this.ranges.set(range.generatedLine, ranges);
  }

  addLineMapping(generatedLine: number, source: RenderShaderSourceLocation): void {
    this.add({ generatedLine, generatedColumnStart: 1, generatedColumnEnd: Number.MAX_SAFE_INTEGER, source });
  }

  lookup(generatedLine: number, generatedColumn = 1): RenderShaderSourceLocation | null {
    const ranges = this.ranges.get(generatedLine);
    if (!ranges) return null;
    const exact = ranges.find((range) => generatedColumn >= range.generatedColumnStart && generatedColumn < range.generatedColumnEnd);
    if (!exact) return null;
    return {
      file: exact.source.file,
      line: exact.source.line,
      column: exact.source.column + Math.max(0, generatedColumn - exact.generatedColumnStart),
    };
  }

  mapDiagnostic(diagnostic: RenderShaderCompilerDiagnostic): RenderShaderMappedDiagnostic {
    const source = diagnostic.generatedLine === undefined
      ? null
      : this.lookup(diagnostic.generatedLine, diagnostic.generatedColumn ?? 1);
    return { ...diagnostic, source };
  }

  mapDiagnostics(diagnostics: readonly RenderShaderCompilerDiagnostic[]): RenderShaderMappedDiagnostic[] {
    return diagnostics.map((diagnostic) => this.mapDiagnostic(diagnostic));
  }

  compose(parent: RenderShaderSourceMapRuntime): RenderShaderSourceMapRuntime {
    const composed = new RenderShaderSourceMapRuntime();
    for (const ranges of this.ranges.values()) {
      for (const range of ranges) {
        const parentLocation = parent.lookup(range.source.line, range.source.column);
        composed.add({ ...range, source: parentLocation ?? cloneLocation(range.source) });
      }
    }
    return composed;
  }

  offsetLines(offset: number): RenderShaderSourceMapRuntime {
    if (!Number.isInteger(offset)) throw new Error("Shader source map line offset must be an integer");
    const shifted = new RenderShaderSourceMapRuntime();
    for (const ranges of this.ranges.values()) {
      for (const range of ranges) {
        const generatedLine = range.generatedLine + offset;
        if (generatedLine >= 1) shifted.add({ ...range, generatedLine, source: cloneLocation(range.source) });
      }
    }
    return shifted;
  }

  entries(): RenderShaderGeneratedRange[] {
    return [...this.ranges.values()].flat().map((range) => ({ ...range, source: cloneLocation(range.source) }));
  }

  clear(): void {
    this.ranges.clear();
  }
}
