import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../server/managed-account-defaults.ts', import.meta.url), 'utf8');
function defaults(env) {
  const module = { exports: {} };
  const script = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(script, { module, exports: module.exports, process: { env } });
  module.exports.configureManagedAccountDefaults();
  return env;
}

test('managed OAuth defaults to the client registered by auth.videogame.ai', () => {
  const env = defaults({});
  assert.equal(env.VOLTER_OAUTH_CLIENT_ID, 'vgai-editor');
  assert.equal(env.VOLTER_AUTH_URL, 'https://auth.videogame.ai');
  assert.equal(env.VOLTER_ACCOUNT_URL, env.VOLTER_AUTH_URL);
  assert.equal(env.VOLTER_OAUTH_ISSUER_URL, env.VOLTER_AUTH_URL);
});

test('managed account defaults preserve explicit client and endpoint overrides', () => {
  const env = defaults({ VOLTER_AUTH_URL: 'https://auth.example.test', VOLTER_OAUTH_CLIENT_ID: 'self-hosted-editor' });
  assert.equal(env.VOLTER_OAUTH_CLIENT_ID, 'self-hosted-editor');
  assert.equal(env.VOLTER_ACCOUNT_URL, 'https://auth.example.test');
  assert.equal(env.VOLTER_OAUTH_ISSUER_URL, 'https://auth.example.test');
});
