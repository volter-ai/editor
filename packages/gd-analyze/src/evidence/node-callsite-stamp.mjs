// The game editor's callsite stamp, reproduced for every proof mount: its source transform gives
// each component callsite in a served scene `__vgaiOid` and `__vgaiLabel` props. The emitted
// scenes are JSX (compat itself calls `createElement`), so every compat component a scene calls (a `Godot*` function; those with no native root excepted) is called here
// with them, and the mount fails unless each such component's native root ends up holding its
// `__vgaiOid` (the editor's forwarding convention) and nothing throws.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOTLESS = new Set(['GodotMain', 'GodotProjectStartup', 'GodotPlaced', 'GodotSpawnHost']);
const stamped = new Set();
const received = new Set();

function watch(three) {
  const proto = three?.Object3D?.prototype;
  if (proto === undefined || Object.getOwnPropertyDescriptor(proto, '__vgaiOid') !== undefined) return;
  Object.defineProperty(proto, '__vgaiOid', {
    configurable: true,
    get() {
      return this.__vgaiOidValue;
    },
    set(value) {
      this.__vgaiOidValue = value;
      received.add(value);
    },
  });
}

try {
  watch(require('three'));
  watch(await import('three'));
} catch {
  // A mount without three stamps nothing.
}

function stampedProps(type, props) {
  if (typeof type !== 'function' || !/^Godot[A-Z]/u.test(type.name) || ROOTLESS.has(type.name)) return props;
  const oid = `callsite:${type.name}`;
  stamped.add(oid);
  return { ...props, __vgaiOid: oid, __vgaiLabel: type.name };
}

for (const runtime of ['react/jsx-runtime', 'react/jsx-dev-runtime']) {
  const module = require(runtime);
  for (const name of ['jsx', 'jsxs', 'jsxDEV']) {
    const original = module[name];
    if (typeof original !== 'function') continue;
    module[name] = (type, props, ...rest) => original(type, stampedProps(type, props), ...rest);
  }
}

process.on('exit', (code) => {
  if (code !== 0) return;
  const missing = [...stamped].filter((oid) => !received.has(oid));
  if (missing.length > 0) {
    process.stderr.write(`callsite stamp: no native root holds ${missing.join(', ')}\n`);
    process.exitCode = 1;
    process.reallyExit(1);
  }
});
