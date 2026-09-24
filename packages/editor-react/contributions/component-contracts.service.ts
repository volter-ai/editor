/**
 * The component-contract analyzer, registered for the browser (a `workspace.service`
 * contribution): what the kit's Content index reads when it indexes a project from storage,
 * with no session server to ask (`@volter/editor-sdk/source-analysis`). The session's server
 * registers the same analyzer through this package's `vgai.serving` module.
 */

import { registerComponentContractAnalyzer } from '@volter/editor-sdk/source-analysis';
import { analyzeR3fComponentContracts, builtinR3fContractsForSource } from '../src/source/oid-transform';

export const point = 'workspace.service';

export function start(): () => void {
  registerComponentContractAnalyzer((source, path) =>
    analyzeR3fComponentContracts(source, path, builtinR3fContractsForSource(source, path)),
  );
  return () => registerComponentContractAnalyzer(null);
}
