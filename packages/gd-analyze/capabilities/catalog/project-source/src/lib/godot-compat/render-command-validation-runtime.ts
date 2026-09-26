export type RenderValidationSeverity = "info" | "warning" | "error";
export type RenderValidationPassKind = "render" | "compute" | "transfer";

export type RenderValidationCommand =
  | { type: "create_resource"; resourceId: string; usage: readonly string[] }
  | { type: "destroy_resource"; resourceId: string }
  | { type: "begin_pass"; passKind: RenderValidationPassKind; label?: string }
  | { type: "end_pass" }
  | { type: "bind_pipeline"; pipelineId: string; passKind: RenderValidationPassKind; requiredSets?: readonly number[] }
  | { type: "bind_resource_set"; set: number; resourceIds: readonly string[] }
  | { type: "bind_vertex_buffer"; resourceId: string }
  | { type: "bind_index_buffer"; resourceId: string }
  | { type: "draw"; vertexCount: number; instanceCount?: number }
  | { type: "draw_indexed"; indexCount: number; instanceCount?: number }
  | { type: "dispatch"; x: number; y: number; z: number }
  | { type: "copy"; sourceId: string; destinationId: string; byteSize: number }
  | { type: "barrier"; resourceIds: readonly string[] }
  | { type: "push_marker"; label: string }
  | { type: "pop_marker" };

export interface RenderValidationDiagnostic {
  commandIndex: number;
  severity: RenderValidationSeverity;
  code: string;
  message: string;
  resourceId?: string;
  passKind?: RenderValidationPassKind;
}

export interface RenderValidationResult {
  valid: boolean;
  commandCount: number;
  diagnostics: RenderValidationDiagnostic[];
  errors: number;
  warnings: number;
  resourcesCreated: number;
  resourcesDestroyed: number;
  draws: number;
  dispatches: number;
  copies: number;
}

export interface RenderCommandValidationOptions {
  minimumSeverity?: RenderValidationSeverity;
  rejectEmptyPasses?: boolean;
  requireBalancedResources?: boolean;
  maximumMarkerDepth?: number;
  maximumResourceSets?: number;
}

interface ResourceState {
  usage: Set<string>;
  createdAt: number;
  lastBarrierAt: number;
}

const SEVERITY_LEVEL: Record<RenderValidationSeverity, number> = { info: 0, warning: 1, error: 2 };

export class RenderCommandValidationRuntime {
  private readonly minimumSeverity: RenderValidationSeverity;
  private readonly rejectEmptyPasses: boolean;
  private readonly requireBalancedResources: boolean;
  private readonly maximumMarkerDepth: number;
  private readonly maximumResourceSets: number;

  constructor(options: RenderCommandValidationOptions = {}) {
    this.minimumSeverity = options.minimumSeverity ?? "info";
    this.rejectEmptyPasses = options.rejectEmptyPasses ?? false;
    this.requireBalancedResources = options.requireBalancedResources ?? false;
    this.maximumMarkerDepth = options.maximumMarkerDepth ?? 64;
    this.maximumResourceSets = options.maximumResourceSets ?? 8;
  }

  validate(commands: readonly RenderValidationCommand[]): RenderValidationResult {
    const diagnostics: RenderValidationDiagnostic[] = [];
    const resources = new Map<string, ResourceState>();
    const boundSets = new Map<number, string[]>();
    let passKind: RenderValidationPassKind | null = null;
    let pipeline: Extract<RenderValidationCommand, { type: "bind_pipeline" }> | null = null;
    let vertexBuffer: string | null = null;
    let indexBuffer: string | null = null;
    let markerDepth = 0;
    let passCommands = 0;
    let resourcesCreated = 0;
    let resourcesDestroyed = 0;
    let draws = 0;
    let dispatches = 0;
    let copies = 0;

    const report = (index: number, severity: RenderValidationSeverity, code: string, message: string, extra: Partial<RenderValidationDiagnostic> = {}) => {
      if (SEVERITY_LEVEL[severity] >= SEVERITY_LEVEL[this.minimumSeverity]) diagnostics.push({ commandIndex: index, severity, code, message, ...extra });
    };
    const requireResource = (id: string, index: number, usage?: string): ResourceState | null => {
      const resource = resources.get(id);
      if (!resource) {
        report(index, "error", "RESOURCE_NOT_LIVE", `Resource ${id} does not exist or was destroyed`, {
          resourceId: id,
          ...(passKind === null ? {} : { passKind }),
        });
        return null;
      }
      if (usage && !resource.usage.has(usage)) {
        report(index, "error", "RESOURCE_USAGE_MISSING", `Resource ${id} was not created for ${usage}`, {
          resourceId: id,
          ...(passKind === null ? {} : { passKind }),
        });
      }
      return resource;
    };

    commands.forEach((command, index) => {
      if (passKind && command.type !== "end_pass" && command.type !== "push_marker" && command.type !== "pop_marker") passCommands += 1;
      switch (command.type) {
        case "create_resource":
          if (resources.has(command.resourceId)) report(index, "error", "RESOURCE_ALREADY_LIVE", `Resource ${command.resourceId} already exists`, { resourceId: command.resourceId });
          else {
            resources.set(command.resourceId, { usage: new Set(command.usage), createdAt: index, lastBarrierAt: index });
            resourcesCreated += 1;
          }
          break;
        case "destroy_resource":
          if (passKind) report(index, "error", "DESTROY_INSIDE_PASS", "Resources cannot be destroyed inside a pass", { resourceId: command.resourceId, passKind });
          if (requireResource(command.resourceId, index)) {
            resources.delete(command.resourceId);
            resourcesDestroyed += 1;
          }
          break;
        case "begin_pass":
          if (passKind) report(index, "error", "NESTED_PASS", `Cannot begin ${command.passKind} pass inside ${passKind} pass`, { passKind });
          else {
            passKind = command.passKind;
            pipeline = null;
            boundSets.clear();
            vertexBuffer = null;
            indexBuffer = null;
            passCommands = 0;
          }
          break;
        case "end_pass":
          if (!passKind) report(index, "error", "END_WITHOUT_PASS", "No pass is active");
          else if (this.rejectEmptyPasses && passCommands === 0) report(index, "warning", "EMPTY_PASS", `${passKind} pass contains no commands`, { passKind });
          passKind = null;
          pipeline = null;
          boundSets.clear();
          break;
        case "bind_pipeline":
          if (!passKind) report(index, "error", "PIPELINE_OUTSIDE_PASS", "Pipeline binding requires an active pass");
          else if (command.passKind !== passKind) report(index, "error", "PIPELINE_PASS_MISMATCH", `${command.passKind} pipeline cannot be used in ${passKind} pass`, { passKind });
          pipeline = command;
          break;
        case "bind_resource_set":
          if (!Number.isInteger(command.set) || command.set < 0 || command.set >= this.maximumResourceSets) report(index, "error", "INVALID_SET", `Resource set ${command.set} is out of range`);
          for (const id of command.resourceIds) requireResource(id, index);
          boundSets.set(command.set, [...command.resourceIds]);
          break;
        case "bind_vertex_buffer":
          if (requireResource(command.resourceId, index, "vertex")) vertexBuffer = command.resourceId;
          break;
        case "bind_index_buffer":
          if (requireResource(command.resourceId, index, "index")) indexBuffer = command.resourceId;
          break;
        case "draw":
        case "draw_indexed": {
          draws += 1;
          if (passKind !== "render") report(index, "error", "DRAW_OUTSIDE_RENDER_PASS", "Draw requires an active render pass", passKind === null ? {} : { passKind });
          if (!pipeline) report(index, "error", "PIPELINE_NOT_BOUND", "Draw requires a bound pipeline", passKind === null ? {} : { passKind });
          for (const set of pipeline?.requiredSets ?? []) if (!boundSets.has(set)) report(index, "error", "RESOURCE_SET_NOT_BOUND", `Pipeline requires resource set ${set}`);
          if (!vertexBuffer) report(index, "warning", "VERTEX_BUFFER_NOT_BOUND", "Draw has no vertex buffer bound");
          if (command.type === "draw_indexed" && !indexBuffer) report(index, "error", "INDEX_BUFFER_NOT_BOUND", "Indexed draw requires an index buffer");
          const count = command.type === "draw" ? command.vertexCount : command.indexCount;
          if (!Number.isInteger(count) || count < 1) report(index, "error", "EMPTY_DRAW", "Draw count must be positive");
          break;
        }
        case "dispatch":
          dispatches += 1;
          if (passKind !== "compute") report(index, "error", "DISPATCH_OUTSIDE_COMPUTE_PASS", "Dispatch requires an active compute pass", passKind === null ? {} : { passKind });
          if (!pipeline) report(index, "error", "PIPELINE_NOT_BOUND", "Dispatch requires a bound pipeline");
          if (![command.x, command.y, command.z].every((value) => Number.isInteger(value) && value > 0)) report(index, "error", "INVALID_DISPATCH", "Dispatch dimensions must be positive integers");
          break;
        case "copy":
          copies += 1;
          if (passKind && passKind !== "transfer") report(index, "error", "COPY_IN_WRONG_PASS", "Copy requires no pass or a transfer pass", { passKind });
          requireResource(command.sourceId, index, "copy_source");
          requireResource(command.destinationId, index, "copy_destination");
          if (command.sourceId === command.destinationId) report(index, "error", "SELF_COPY", "Copy source and destination must differ");
          if (!Number.isFinite(command.byteSize) || command.byteSize <= 0) report(index, "error", "INVALID_COPY_SIZE", "Copy size must be positive");
          break;
        case "barrier":
          for (const id of command.resourceIds) {
            const resource = requireResource(id, index);
            if (resource) resource.lastBarrierAt = index;
          }
          break;
        case "push_marker":
          markerDepth += 1;
          if (markerDepth > this.maximumMarkerDepth) report(index, "error", "MARKER_DEPTH_EXCEEDED", `Marker depth exceeds ${this.maximumMarkerDepth}`);
          break;
        case "pop_marker":
          if (markerDepth === 0) report(index, "error", "MARKER_UNDERFLOW", "No debug marker is active");
          else markerDepth -= 1;
          break;
      }
    });
    if (passKind) report(commands.length, "error", "UNCLOSED_PASS", `${passKind} pass was not ended`, { passKind });
    if (markerDepth > 0) report(commands.length, "error", "UNCLOSED_MARKERS", `${markerDepth} debug markers were not closed`);
    if (this.requireBalancedResources) {
      for (const id of resources.keys()) report(commands.length, "warning", "RESOURCE_NOT_DESTROYED", `Resource ${id} remains live`, { resourceId: id });
    }
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
    return {
      valid: errors === 0,
      commandCount: commands.length,
      diagnostics,
      errors,
      warnings: diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
      resourcesCreated,
      resourcesDestroyed,
      draws,
      dispatches,
      copies,
    };
  }
}
