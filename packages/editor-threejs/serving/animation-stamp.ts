/**
 * `@volter/editor-threejs`'s server half: the ANIMATION STAMP over the project's served modules.
 *
 * THE GAME REGISTERS NOTHING (ARCHITECTURE.md rule 4). A module animates with three's own API
 * (`new THREE.AnimationMixer(model)`, `mixer.clipAction(clip).play()`) or drei's
 * (`useAnimations(animations, ref)`); in the editor's served graph only, each of those call sites
 * is wrapped so the mixer it makes reports itself (`animation-live-module.ts`). The editor's
 * animation instruments drive the mixer the game made instead of minting a second writer over
 * the same skeleton. A standalone build never passes through this plugin.
 */

import { relative, sep } from 'node:path';
import ts from 'typescript';
import type { Plugin } from 'vite';
import { ANIMATION_LIVE_MODULE_ID, animationLiveModuleSource } from './animation-live-module';

/** The kit services this plugin reads (`@volter/editor-sdk/session/project-serving`), by shape. */
export interface AnimationServingServices {
  readonly projectRoots: () => ReadonlySet<string>;
  readonly currentProjectRoot: () => string | undefined;
}

const VIRTUAL_ID = `\0${ANIMATION_LIVE_MODULE_ID}`;
const NODE_MODULES = /[\\/]node_modules[\\/]/;
const SCRIPT = /\.[cm]?[jt]sx?$/;

function isMixerConstruction(node: ts.Node): node is ts.NewExpression {
  if (!ts.isNewExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === 'AnimationMixer';
  return ts.isPropertyAccessExpression(callee) && callee.name.text === 'AnimationMixer';
}

function isUseAnimations(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useAnimations';
}

/** Wrap every mixer a module makes; `null` when it makes none. */
export function stampAnimation(code: string, file: string, relativeFile: string): string | null {
  if (!code.includes('AnimationMixer') && !code.includes('useAnimations')) return null;
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, kind);
  const sites: { start: number; end: number; wrapper: '__vgaiMixer' | '__vgaiAnimations' }[] = [];
  const visit = (node: ts.Node): void => {
    if (isMixerConstruction(node)) sites.push({ start: node.getStart(source), end: node.getEnd(), wrapper: '__vgaiMixer' });
    else if (isUseAnimations(node)) sites.push({ start: node.getStart(source), end: node.getEnd(), wrapper: '__vgaiAnimations' });
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (sites.length === 0) return null;
  let out = code;
  for (const site of [...sites].sort((a, b) => b.start - a.start)) {
    const { line, character } = source.getLineAndCharacterOfPosition(site.start);
    const key = `${relativeFile}:${line + 1}:${character + 1}`;
    out = `${out.slice(0, site.start)}${site.wrapper}(${out.slice(site.start, site.end)}, ${JSON.stringify(key)})${out.slice(site.end)}`;
  }
  return `import { __vgaiMixer, __vgaiAnimations } from ${JSON.stringify(ANIMATION_LIVE_MODULE_ID)};\n${out}`;
}

export function animationStampPlugin(services: AnimationServingServices): Plugin {
  let serverRoot = process.cwd();
  const isProjectFile = (file: string): boolean => {
    if (NODE_MODULES.test(file) || !SCRIPT.test(file)) return false;
    const roots = [...services.projectRoots(), services.currentProjectRoot()].filter((root): root is string => !!root);
    return roots.some((root) => file.startsWith(root + sep) || file.startsWith(root + '/'));
  };
  return {
    name: 'vgai-three-animation',
    enforce: 'pre',
    resolveId(id) {
      return id === ANIMATION_LIVE_MODULE_ID ? VIRTUAL_ID : null;
    },
    load(id) {
      return id === VIRTUAL_ID ? animationLiveModuleSource : null;
    },
    configureServer(server) {
      serverRoot = server.config.root;
    },
    transform(code, id) {
      if (id.startsWith('\0')) return null;
      const file = id.split('?')[0] ?? id;
      if (!isProjectFile(file)) return null;
      const root = services.currentProjectRoot() ?? serverRoot;
      const stamped = stampAnimation(code, file, relative(root, file).split(sep).join('/'));
      return stamped === null ? null : { code: stamped, map: null };
    },
  };
}
