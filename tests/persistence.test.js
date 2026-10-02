import test from 'node:test';
import assert from 'node:assert/strict';
import { readStored, writeStored, parseRoom, newRoomToken, checkCloudConfig, CloudStore } from '../src/persistence.js';
const config = { supabaseUrl: 'https://example.supabase.co', supabaseKey: 'sb_publishable_test' };
test('room links require the full unguessable capability', () => {
  const first = newRoomToken(); const second = newRoomToken();
  assert.match(first, /^[a-f0-9]{64}$/); assert.notEqual(first, second);
  assert.equal(parseRoom('#room=' + first), first);
  assert.equal(parseRoom('#room=hello'), null);
});
test('corrupt or denied browser storage does not crash restore', () => {
  assert.equal(readStored({ getItem() { return '{'; } }, 'game'), null);
  assert.equal(readStored({ getItem() { throw new Error('denied'); } }, 'game'), null);
  assert.equal(writeStored({ setItem() { throw new Error('full'); } }, 'game', {}), false);
});
test('server secrets are rejected and HTTPS is required', () => {
  assert.throws(() => checkCloudConfig({ ...config, supabaseKey: 'sb_secret_test' }));
  const jwt = 'a.' + btoa(JSON.stringify({ role: 'service_role' })) + '.signature';
  assert.throws(() => checkCloudConfig({ ...config, supabaseKey: jwt }));
  assert.throws(() => checkCloudConfig({ ...config, supabaseUrl: 'http://example.com' }));
  assert.equal(checkCloudConfig({ ...config, supabaseUrl: config.supabaseUrl + '/' }).supabaseUrl, config.supabaseUrl);
});
test('publishable keys use apikey and saves carry expected revision', async () => {
  let captured;
  const store = new CloudStore(config, async (url, args) => {
    captured = { url, ...args }; return { ok: true, json: async () => ({ revision: 8, state: {} }) };
  });
  await store.save('a'.repeat(64), 7, { id: 'game' });
  assert.equal(captured.headers.apikey, config.supabaseKey);
  assert.equal(captured.headers.Authorization, undefined);
  assert.equal(JSON.parse(captured.body).p_expected_revision, 7);
  assert.match(captured.url, /\/rpc\/save_game$/);
});
test('conflicts are exposed to the caller rather than retried with stale state', async () => {
  let calls = 0;
  const store = new CloudStore(config, async () => { calls++; return { ok: false, json: async () => ({ code: '40001', message: 'revision_conflict' }) }; });
  await assert.rejects(store.save('a'.repeat(64), 0, {}), error => error.code === '40001');
  assert.equal(calls, 1);
});
