/**
 * `@volter/editor-react`'s server half (`package.json#vgai.serving`, the project-serving door in
 * `@volter/editor-sdk/session/project-serving`): the JSX identity stamp and the `/__ui-source/*`
 * authoring routes over a project's React and React Three Fiber source, and the source answers
 * the kit's region decision, validation and Content index ask of a JSX lane.
 */

import type { ProjectServingModule } from '@volter/editor-sdk/session/project-serving';
import { analyzeR3fComponentContracts, builtinR3fContractsForSource, sourceDialectEvidence } from '../src/source/oid-transform';
import { r3fAuthoringDiagnostics } from '../src/source/r3f-project-contracts';
import { uiOidPlugin } from './ui-oid-plugin';

export const servingPlugins: ProjectServingModule['servingPlugins'] = (services) => [uiOidPlugin(services)];

export { sourceDialectEvidence };

export const sourceDiagnostics: ProjectServingModule['sourceDiagnostics'] = (code, file, options) =>
  r3fAuthoringDiagnostics(code, file, options);

export const componentContracts: ProjectServingModule['componentContracts'] = (source, path) =>
  analyzeR3fComponentContracts(source, path, builtinR3fContractsForSource(source, path));
