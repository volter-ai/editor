/** The game's adapter module lives beside `volter.project.json`, by contract.
 *
 *  IN A MODULE OF ITS OWN, with no imports, because the CLI reads it: the launcher's adapter check
 *  (`editor-core/server/project-adapter-required.ts`) imported it from `ui-source/adapter-region-includes`,
 *  which imports `typescript`, and the CLI bundle then carried TypeScript and died on start
 *  ("Dynamic require of "fs" is not supported"). */
export const ADAPTER_MODULE_FILENAME = 'editor/volter.adapter.ts';
