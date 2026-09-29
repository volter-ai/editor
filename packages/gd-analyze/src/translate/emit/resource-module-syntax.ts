/**
 * A preloaded resource document's module (`TargetGodotResourceModulePlan`): the resource made once
 * at module level, as a scene declares its shared materials, and exported as the Godot resource the
 * scripts hold (the plan's `handle` of it); its images load as the
 * module does (`godot_compressed_texture_2d_load`, tracked by the loader, so the scenes mount once
 * they have arrived).
 */
import { TARGET_TS_SYNTAX_VERSION, type TargetTsSourceFile } from '../code/target-ts-syntax';
import type { TargetGodotResourceModulePlan } from '../data/scene-document-plan';
import { familyEmission, familyImports, familyResourceModuleLocal, type FamilyEmission, useCompat } from './scene-family-elements';

export function resourceModuleSourceFile(module: TargetGodotResourceModulePlan): TargetTsSourceFile {
  const emission: FamilyEmission = { ...familyEmission(module.targetPath, module.resources), moduleLevel: true };
  emission.taken.add(module.exportName);
  const local = familyResourceModuleLocal(emission, module.key);
  const handle = useCompat(emission, module.handle.module, module.handle.exportName);
  return {
    syntaxVersion: TARGET_TS_SYNTAX_VERSION,
    sourcePath: module.targetPath,
    statements: [
      ...familyImports(emission),
      ...emission.statics,
      { kind: 'variable-statement', declaration: 'const', name: module.exportName, initializer: { kind: 'call-expression', callee: { kind: 'identifier-expression', name: handle }, arguments: [{ kind: 'identifier-expression', name: local }] }, modifiers: ['export'] },
    ],
  };
}
