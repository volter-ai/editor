/**
 * The kit's side of the project-serving door (`@volter/editor-sdk/session/project-serving`):
 * the server capabilities a serving module may use, built from the kit's own region decision,
 * write recording and collaboration record, and the loader that asks each composed
 * package's `vgai.serving` module for its plugins.
 */

import { realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  ProjectServingModule,
  ProjectServingServices,
  ServingCollaboration,
} from '@volter/editor-sdk/session/project-serving';
import { CollaborationConflictError, collaborationSession } from './collaboration-session';
import {
  importersFromModuleGraph,
  reportOidSurfaceDiagnostics,
  resolveOidSurface,
} from './project-root-surface';
import {
  editorChromeStampBoundary,
  type HmrInvalidationGraph,
  staleModuleWarning,
  stampHmrInvalidation,
} from './project-script-hmr';
import type { Request, Response } from 'express';
import type { EditorServerRouter } from './editor-server';
import { isProjectOwnedRelativePath, projectFileIndex } from './project-file-scan';
import { createProjectOutputWriter, projectOutputMediaType } from './project-output-writer';
import { allowCrossOriginFrameEmbedding, isCanonicalPathInside } from './server-utils';
import { adoptSourceAnalysis } from './source-analysis';
import { PROJECT_SESSION_WRITE_OPERATION } from './support/project/provenance';
import {
  findVendoredTarget,
  settleVendoredWrite,
  writeRecordedVendoredFile,
} from './vendored-lock-recorder';

/**
 * The path `findVendoredTarget` must judge, symlinks resolved. `realpathSync` requires the path
 * to exist, and a write may name a file that does not exist yet, so its directory is resolved.
 */
function realpathForWrite(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    try {
      return join(realpathSync(dirname(file)), basename(file));
    } catch {
      return file;
    }
  }
}

export function createProjectServingServices(options: {
  engineRoot: string;
  projectRoots: () => ReadonlySet<string>;
  currentProjectRoot: () => string | undefined;
  /** The editor router's write pair, bound once the router exists. */
  projectMutations: () => EditorServerRouter['projectMutations'] | null;
}): ProjectServingServices {
  const { engineRoot } = options;
  // The editor's own writes invalidate the modules they replace; the stamp is bounded at the
  // editor's chrome so an edit to project code never re-evaluates the editor.
  let graph: HmrInvalidationGraph | null = null;
  let stampBoundary: ((moduleFile: string) => boolean) | undefined;
  const invalidate = (file: string): void => {
    if (!graph) return;
    const warning = staleModuleWarning(file, stampHmrInvalidation(graph, file, undefined, stampBoundary));
    if (warning) console.warn(warning);
  };
  return {
    engineRoot,
    projectRoots: options.projectRoots,
    currentProjectRoot: options.currentProjectRoot,
    surfaceOf(file, code, moduleGraph, projectRoot) {
      const decision = resolveOidSurface(
        file,
        code,
        importersFromModuleGraph(moduleGraph as Parameters<typeof importersFromModuleGraph>[0]),
        projectRoot,
      );
      return {
        attribute: decision.attribute,
        ...(decision.surface ? { surface: decision.surface } : {}),
        report: () => reportOidSurfaceDiagnostics(decision),
      };
    },
    bindModuleGraph(moduleGraph, projectRoot) {
      graph = moduleGraph as HmrInvalidationGraph;
      stampBoundary = editorChromeStampBoundary(engineRoot, projectRoot);
    },
    writeSource(file, code) {
      const target = findVendoredTarget(realpathForWrite(file), engineRoot);
      if (!target) {
        writeFileSync(file, code);
        invalidate(file);
        return;
      }
      settleVendoredWrite(target);
      const result = writeRecordedVendoredFile(target, Buffer.from(code, 'utf8'), 'editor source edit');
      if (!result.ok) {
        // Refused loudly rather than written unrecorded: a lock that already disagrees with its
        // folder is not a base anything may record onto.
        throw new Error(`vendored source write refused for ${target.id}/${target.rel}: ${result.error}`);
      }
      invalidate(file);
    },
    settleSource(file) {
      const target = findVendoredTarget(realpathForWrite(file), engineRoot);
      // Settling replaces the file's content, so the modules served from it are stale.
      if (target && settleVendoredWrite(target)) invalidate(file);
    },
    collaboration(projectRoot): ServingCollaboration {
      const session = collaborationSession(projectRoot);
      return {
        revision: () => session.snapshot().revision,
        assertSourceMutation: (authorId, expectedRevision, resources) =>
          session.assertSourceMutation(authorId, expectedRevision, resources),
        recordSourceMutation: (input) => session.recordSourceMutation(input) ?? null,
      };
    },
    isCollaborationConflict: (error) => error instanceof CollaborationConflictError,
    async commitProjectMutation(request, resources) {
      const mutations = options.projectMutations();
      if (!mutations) throw new Error('The editor server is not serving yet, so nothing can be written.');
      const revision = await mutations.commit(
        request as Request,
        resources.map(({ path, content }) => ({
          path,
          content: content instanceof Uint8Array && !Buffer.isBuffer(content) ? Buffer.from(content) : content,
        })),
      );
      return revision ? { revision: revision.revision } : null;
    },
    answerProjectMutationError(response, error) {
      const mutations = options.projectMutations();
      if (!mutations) throw error;
      mutations.answerError(response as Response, error);
    },
    async writeProjectOutput(write) {
      const root = options.currentProjectRoot();
      if (root === undefined) throw new Error('No project is open, so there is nowhere to record the output.');
      const mediaType = projectOutputMediaType(write.path);
      const written = await createProjectOutputWriter(root, {
        operationName: PROJECT_SESSION_WRITE_OPERATION,
        operationSource: write.source,
        session: write.session,
        ...(write.inputs && write.inputs.length > 0 ? { inputs: [...write.inputs] } : {}),
      }).write([
        { path: write.path, content: Buffer.from(write.content), role: 'asset', ...(mediaType ? { mediaType } : {}) },
      ]);
      return { provenanceOperationId: written.provenanceOperationId ?? null };
    },
    async projectFileIndex() {
      const root = options.currentProjectRoot();
      return root === undefined ? [] : projectFileIndex(root);
    },
    isProjectOwnedPath: (path) => isProjectOwnedRelativePath(path),
    isCanonicalPathInside: (parent, child) => isCanonicalPathInside(parent, child),
    allowCrossOriginFrameEmbedding: (response) => allowCrossOriginFrameEmbedding(response),
  };
}

/** The plugins every serving module in `files` contributes, in composition order. */
export async function loadServingPlugins(
  files: readonly string[],
  services: ProjectServingServices,
): Promise<unknown[]> {
  const plugins: unknown[] = [];
  for (const file of files) {
    const module = (await import(pathToFileURL(file).href)) as Partial<ProjectServingModule>;
    if (typeof module.servingPlugins !== 'function') {
      throw new Error(`${file} is declared as vgai.serving but exports no servingPlugins(services).`);
    }
    plugins.push(...module.servingPlugins(services));
    adoptSourceAnalysis(module);
  }
  return plugins;
}
