#!/usr/bin/env node
// The site's machine as a real 3D asset: asset/cyclotron-machine.obj (+ .mtl)
// and asset/cyclotron-machine.parts.json.
//
// Same scene as the drawings (machine-scene.mjs), poster (assembled) state.
// Every visible mesh is baked into world space, so the site's own proportions
// are kept, including the hybrid machine's 1.4x vertical stretch (root.scale.y)
// that the poster shows. Y is up, as in three.js; units are the site's.
//
// One OBJ object per scene part, named by part id. Faces carry a material by
// role, for the renderer to dress:
//   accent  parts the page swaps in (PARTS REPLACED/ADDED, 28-31)
//   metal   fasteners: bolts and nuts (six-sided cylinders), washers
//   trim    small or thin pieces: ticks, hands, strips, fins, thin rings, wires
//   body    everything else
//
// Usage: node export-asset.mjs [--out asset] [--site <model-editor>]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMachine, visibleMeshes, partOf } from './machine-scene.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const SITE = path.resolve(arg('site', path.join(HERE, '..', 'sites-home', 'model-editor')));
const OUT = path.resolve(arg('out', path.join(HERE, 'asset')));

const { THREE, site, assemblyOrder, pose } = await loadMachine(SITE);
const scene = pose(0);
const meshes = visibleMeshes(scene);
const ACCENT = new Set(site.PARTS.filter(p => p[3] !== 'STOCK').map(p => p[0]));

function role(o) {
  const g = o.geometry, p = g.parameters || {}, part = partOf(o);
  if ((g.type === 'CylinderGeometry' && p.radialSegments === 6) || (g.type === 'TorusGeometry' && p.radius < .2)) return 'metal';
  if (ACCENT.has(part)) return 'accent';
  if (g.type === 'TorusGeometry' && p.tube <= .06) return 'trim';
  if (g.type === 'TubeGeometry' && p.radius < .1) return 'trim';
  const box = new THREE.Box3().setFromObject(o), s = box.getSize(new THREE.Vector3());
  const radius = s.length() / 2, thin = Math.min(s.x, s.y, s.z);
  if (radius < .32 || (thin < .1 && radius < .8)) return 'trim';
  return 'body';
}

// Part ids in assembly order (core first), then any others.
const ids = [...new Set(meshes.map(partOf))];
ids.sort((a, b) => { const i = assemblyOrder.indexOf(a), j = assemblyOrder.indexOf(b); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j) || a.localeCompare(b); });

const lines = ['# Cyclotron machine, from sites-home/model-editor/src/assembly/scene.mjs (poster state).',
  '# Y up, site units, world transforms baked (includes the 1.4x vertical stretch).', 'mtllib cyclotron-machine.mtl'];
let vBase = 1, nBase = 1, faces = 0;
const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
const stats = {}, roles = {};
const f6 = x => (Math.abs(x) < 5e-7 ? 0 : x).toFixed(5).replace(/\.?0+$/, '');
let min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
for (const id of ids) {
  lines.push(`o ${id}`);
  const list = meshes.filter(o => partOf(o) === id);
  // Group faces by role inside the object so each material is one run.
  for (const r of ['body', 'trim', 'accent', 'metal']) {
    const group = list.filter(o => role(o) === r); if (!group.length) continue;
    lines.push(`usemtl ${r}`);
    roles[r] = (roles[r] || 0) + group.length;
    for (const o of group) {
      const g = o.geometry, pos = g.attributes.position, nor = g.attributes.normal, index = g.index;
      nm.getNormalMatrix(o.matrixWorld);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); min.min(v); max.max(v);
        lines.push(`v ${f6(v.x)} ${f6(v.y)} ${f6(v.z)}`);
      }
      for (let i = 0; i < pos.count; i++) {
        n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
        lines.push(`vn ${f6(n.x)} ${f6(n.y)} ${f6(n.z)}`);
      }
      const count = index ? index.count : pos.count, at = k => (index ? index.getX(k) : k);
      for (let k = 0; k < count; k += 3) {
        const a = at(k), b = at(k + 1), c = at(k + 2);
        if (a === b || b === c || a === c) continue;
        lines.push(`f ${a + vBase}//${a + nBase} ${b + vBase}//${b + nBase} ${c + vBase}//${c + nBase}`);
        faces++;
      }
      vBase += pos.count; nBase += pos.count;
    }
  }
  stats[id] = list.length;
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'cyclotron-machine.obj'), lines.join('\n') + '\n');
const hex = h => [1, 3, 5].map(i => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(4)).join(' ');
fs.writeFileSync(path.join(OUT, 'cyclotron-machine.mtl'), [
  ['body', '#f7f6f1', ''], ['trim', '#16252c', ''], ['accent', '#d8eb6a', 'Ke ' + hex('#d8eb6a')], ['metal', '#9aa3a8', 'Pm 1'],
].map(([name, kd, extra]) => `newmtl ${name}\nKd ${hex(kd)}\nNs 200\n${extra}\n`).join('\n'));

// Part map: id -> accent, names from the site's manifests.
const src = fs.readFileSync(path.join(SITE, 'src', 'assembly', 'scene.mjs'), 'utf8');
const rows = Object.fromEntries([...src.matchAll(/\{id:'(\d+)',section:'(\w+)',title:'([^']+)'/g)].map(m => [m[1], { section: m[2], title: m[3] }]));
const manifest = Object.fromEntries(site.PARTS.map(p => [p[0], { name: p[1], module: p[2], status: p[3] }]));
const parts = Object.fromEntries(ids.map(id => [id, { accent: ACCENT.has(id), meshes: stats[id], ...(manifest[id] || {}), ...(rows[id] && !manifest[id] ? { name: rows[id].title, status: rows[id].section } : {}) }]));
const r3 = x => Math.round(x * 1000) / 1000;
fs.writeFileSync(path.join(OUT, 'cyclotron-machine.parts.json'), JSON.stringify({
  source: 'sites-home/model-editor/src/assembly/scene.mjs, poster (assembled) state',
  upAxis: 'Y', units: 'site units', verticalStretch: 1.4,
  bounds: { min: min.toArray().map(r3), max: max.toArray().map(r3) },
  materials: { body: '#f7f6f1', trim: '#16252c', accent: '#d8eb6a', metal: '#9aa3a8' },
  roles, assemblyOrder: ids, parts,
}, null, 1) + '\n');
console.log(`${ids.length} parts, ${meshes.length} meshes, ${faces} triangles; roles ${JSON.stringify(roles)}`);
console.log(`bounds ${min.toArray().map(r3)} .. ${max.toArray().map(r3)}`);
console.log(`${path.join(OUT, 'cyclotron-machine.obj')}: ${fs.statSync(path.join(OUT, 'cyclotron-machine.obj')).size} bytes`);
