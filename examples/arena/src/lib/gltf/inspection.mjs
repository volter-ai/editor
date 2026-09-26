import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

function parseGlb(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67) {
    throw new Error('Invalid GLB header');
  }
  const version = bytes.readUInt32LE(4);
  if (version !== 2) throw new Error(`Unsupported GLB version ${version}; expected 2`);
  const declaredLength = bytes.readUInt32LE(8);
  if (declaredLength !== bytes.length) {
    throw new Error(`GLB length mismatch: header=${declaredLength}, file=${bytes.length}`);
  }
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkLength = bytes.readUInt32LE(offset);
    const chunkType = bytes.readUInt32LE(offset + 4);
    offset += 8;
    if (offset + chunkLength > bytes.length) throw new Error('GLB chunk exceeds file length');
    if (chunkType === 0x4e4f534a) {
      return JSON.parse(
        bytes
          .subarray(offset, offset + chunkLength)
          .toString('utf8')
          .trim(),
      );
    }
    offset += chunkLength;
  }
  throw new Error('GLB has no JSON chunk');
}

function nodeName(doc, index) {
  return doc.nodes?.[index]?.name || `node_${index}`;
}

function parentIndex(doc) {
  const parents = new Map();
  for (let i = 0; i < (doc.nodes?.length ?? 0); i++) {
    for (const child of doc.nodes[i]?.children ?? []) parents.set(child, i);
  }
  return parents;
}

function externalUris(doc) {
  const uris = [...(doc.buffers ?? []), ...(doc.images ?? [])]
    .map((item) => item.uri)
    .filter((uri) => typeof uri === 'string' && !uri.startsWith('data:'));
  return [...new Set(uris)];
}

function animationSummary(doc, animation, index) {
  let duration = 0;
  const targetPaths = {};
  const targets = new Set();
  for (const channel of animation.channels ?? []) {
    const path = channel.target?.path ?? 'unknown';
    targetPaths[path] = (targetPaths[path] ?? 0) + 1;
    if (Number.isInteger(channel.target?.node)) targets.add(nodeName(doc, channel.target.node));
    const sampler = animation.samplers?.[channel.sampler];
    const accessor = doc.accessors?.[sampler?.input];
    const end = accessor?.max?.[0];
    if (Number.isFinite(end)) duration = Math.max(duration, end);
  }
  return {
    index,
    name: animation.name || `animation_${index}`,
    duration,
    channels: animation.channels?.length ?? 0,
    targetPaths,
    targetNodes: [...targets].sort(),
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: One linear report assembly keeps the emitted evidence fields auditable together.
export function inspectGltfDocument(doc, filePath = '<memory>', byteLength = 0) {
  const parents = parentIndex(doc);
  const skins = (doc.skins ?? []).map((skin, index) => {
    const joints = skin.joints ?? [];
    const jointSet = new Set(joints);
    const roots = joints.filter((joint) => !jointSet.has(parents.get(joint)));
    return {
      index,
      name: skin.name || `skin_${index}`,
      jointCount: joints.length,
      roots: (skin.skeleton === undefined ? roots : [skin.skeleton]).map((joint) =>
        nodeName(doc, joint),
      ),
      inverseBindMatrices: skin.inverseBindMatrices !== undefined,
      joints: joints.map((joint) => nodeName(doc, joint)),
    };
  });
  const animations = (doc.animations ?? []).map((animation, index) =>
    animationSummary(doc, animation, index),
  );
  const warnings = [];
  if (skins.length === 0) warnings.push('No skins found');
  for (const skin of skins) {
    if (!skin.inverseBindMatrices) warnings.push(`${skin.name}: no inverseBindMatrices accessor`);
    if (skin.jointCount === 0) warnings.push(`${skin.name}: no joints`);
  }
  for (const animation of animations) {
    if (animation.duration <= 0) warnings.push(`${animation.name}: non-positive/unknown duration`);
    if (animation.channels === 0) warnings.push(`${animation.name}: no channels`);
  }

  return {
    file: filePath,
    bytes: byteLength,
    assetVersion: doc.asset?.version,
    generator: doc.asset?.generator,
    counts: {
      scenes: doc.scenes?.length ?? 0,
      nodes: doc.nodes?.length ?? 0,
      meshes: doc.meshes?.length ?? 0,
      primitives: (doc.meshes ?? []).reduce((sum, mesh) => sum + (mesh.primitives?.length ?? 0), 0),
      skins: skins.length,
      animations: animations.length,
      materials: doc.materials?.length ?? 0,
      textures: doc.textures?.length ?? 0,
      images: doc.images?.length ?? 0,
    },
    externalDependencies: externalUris(doc),
    skins,
    animations,
    warnings,
  };
}

export async function inspectGltfFile(path) {
  const filePath = resolve(path);
  const bytes = await readFile(filePath);
  const doc =
    extname(filePath).toLowerCase() === '.glb'
      ? parseGlb(bytes)
      : JSON.parse(bytes.toString('utf8'));
  return inspectGltfDocument(doc, filePath, bytes.length);
}

export function missingRequiredClips(report, requiredClips) {
  const names = new Set(report.animations.map((clip) => clip.name));
  return requiredClips.filter((name) => !names.has(name));
}
