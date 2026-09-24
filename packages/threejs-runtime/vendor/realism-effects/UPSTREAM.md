# realism-effects compatibility fork

This directory vendors the published `realism-effects@1.1.2` distribution
(MIT license) so `@vgai/threejs-runtime` remains installable as a self-contained source
package. The upstream package still imports Three's removed
`WebGLMultipleRenderTargets` API and has no release compatible with Three r180.

VGAI's fork contains only the mechanical r180 MRT migration:

- `WebGLMultipleRenderTargets(width, height, count, options)` becomes
  `WebGLRenderTarget(width, height, { ...options, count })`.
- MRT attachment access moves from `.texture[index]` to `.textures[index]`.

Upstream repository: <https://github.com/0beqz/realism-effects>

Upstream package/version: `realism-effects@1.1.2`

Remove this fork when an upstream release supports Three r180 or newer and the
isolated packed-engine consumer proof passes against it.
