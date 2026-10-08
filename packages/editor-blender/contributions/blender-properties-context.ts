/** Blender's Properties context remains inspectable without a selection.
 * Reuse the same RNA sections and Properties projection as selected objects. */
import { registerNullSubjectProvider } from '@volter/sdk/kit/inspection/null-subject';
import { blenderOutlinerState } from './blender-outliner-model';
import { blenderOutlinerKind } from './blender-outliner-authoring';
import {
  blenderPropertiesState,
  blenderRnaViewFor,
  resolveBlenderSubject,
  writeBlenderRnaProperty,
} from './blender-properties-model';

registerNullSubjectProvider({
  match: ({ adapter }) => resolveBlenderSubject(null, adapter) !== null,
  describe: ({ adapter }) => {
    const subject = resolveBlenderSubject(null, adapter);
    if (subject === null) return null;
    const row = subject.kind === 'object'
      ? [...blenderOutlinerState().byId.values()].find(
          (entry) => entry.struct === 'Object' && entry.object === subject.name,
        )
      : undefined;
    const scenePath = blenderPropertiesState().context?.scene;
    const scene = scenePath ? blenderRnaViewFor(scenePath) : undefined;
    const title = subject.kind === 'object'
      ? subject.name
      : (scene?.kind === 'struct' ? scene.name : null) ?? 'Scene';
    return {
      id: `blender-properties:${JSON.stringify(subject)}`,
      title,
      identity: {
        kindLabel: subject.kind === 'object' ? 'Object' : 'Scene',
        kind: blenderOutlinerKind(row?.icon ?? 'SCENE_DATA'),
        rename: {
          readOnly: subject.kind !== 'object',
          set: async (name: string) => {
            if (subject.kind === 'object' && name.length > 0)
              await writeBlenderRnaProperty(`bpy.data.objects[${JSON.stringify(subject.name)}]`, 'name', name);
          },
        },
      },
      sections: [],
    };
  },
});
