import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createNeteaseInitializer, validXeapiKey } from '../netease-init.js';
import { installRoutes } from '../index.js';
const valid = { sk: 'test-sk', publicKey: Buffer.alloc(32, 1).toString('base64') };
test('clean install waits for one shared initialization, restart reuses key and deletion repairs it', async () => {
  let key,
    calls = 0;
  const readKey = async () => key;
  const generate = async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 10));
    key = valid;
  };
  const ensure = createNeteaseInitializer({ readKey, generate });
  await Promise.all([ensure(), ensure(), ensure()]);
  assert.equal(calls, 1);
  assert.ok(validXeapiKey(key));
  await createNeteaseInitializer({ readKey, generate })();
  assert.equal(calls, 1);
  key = null;
  await ensure();
  assert.equal(calls, 2);
});
test('silent upstream failure is detected, rate limited and retried after network recovery', async () => {
  let key,
    calls = 0,
    now = 0;
  const ensure = createNeteaseInitializer({
    readKey: async () => key,
    now: () => now,
    generate: async () => {
      calls++;
      if (calls > 1) key = valid;
    },
  });
  await assert.rejects(ensure(), /初始化失败/);
  await assert.rejects(ensure(), /稍后重试/);
  assert.equal(calls, 1);
  now = 16000;
  await ensure();
  assert.equal(calls, 2);
  assert.equal(validXeapiKey({ sk: 'bad', publicKey: 'short' }), false);
});
test('playback waits for key initialization and returns actionable failure without calling SDK', async t => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { directories: { root: 'test-user' } };
    next();
  });
  let ready = false,
    sdkCalls = 0,
    fail = false;
  installRoutes(app, {
    userState: async () => ({ active: 0 }),
    ensureNeteaseConfig: async () => {
      if (fail) throw Error('private');
      ready = true;
    },
    libraries: {
      netease: {
        song_url_v1: async () => {
          assert.equal(ready, true);
          sdkCalls++;
          return { body: { code: 200, data: [{ url: 'https://example.com/song.mp3' }] } };
        },
      },
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const send = () =>
    fetch(`http://127.0.0.1:${server.address().port}/netease/song/url/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '123', level: 'standard' }),
    });
  assert.equal((await send()).status, 200);
  assert.equal(sdkCalls, 1);
  fail = true;
  const response = await send();
  assert.equal(response.status, 503);
  assert.match((await response.json()).message, /无需重新登录/);
  assert.equal(sdkCalls, 1);
});
