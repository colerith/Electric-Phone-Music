import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { installRoutes } from '../index.js';
import { searchQQ, searchKugou } from '../search.js';
test('QQ search sends bounded fixed catalog request and rejects malformed upstream data', async () => {
  const result = await searchQQ('x'.repeat(200), async (url, options) => {
    assert.equal(url, 'https://u.y.qq.com/cgi-bin/musicu.fcg');
    const body = JSON.parse(options.body);
    assert.equal(body.search.param.query.length, 60);
    assert.equal(body.search.param.num_per_page, 20);
    assert(!options.headers.Cookie.includes('qqmusic_session'));
    return Response.json({ code: 0, search: { code: 0, data: { body: { item_song: [{ mid: 'song' }] } } } });
  });
  assert.equal(result.response.data.song.list[0].mid, 'song');
  await assert.rejects(() => searchQQ('x', async () => Response.json({ code: 0 })), /unavailable/);
});
test('search routes require a user, bound query/page size, and never allow target override', async t => {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    if (req.headers['x-user']) req.user = { directories: { root: 'test' } };
    next();
  });
  const calls = [];
  const state = { active: 0 };
  installRoutes(app, {
    userState: async () => state,
    libraries: {
      netease: {
        cloudsearch: async p => {
          calls.push(p);
          return { body: { code: 200, result: { songs: [] } } };
        },
      },
      kugou: {
        search: async p => {
          calls.push(p);
          return { status: 1, data: { lists: [] } };
        },
      },
    },
    searchQQ: async keyword => {
      calls.push({ keyword });
      return { response: { data: { song: { list: [] } } } };
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(() => new Promise(r => server.close(r)));
  const send = (route, p, user = true) =>
    fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(user ? { 'x-user': 'yes' } : {}) },
      body: new URLSearchParams(p),
    });
  assert.equal((await send('/netease/cloudsearch', { keywords: 'hi' }, false)).status, 401);
  assert.equal((await send('/netease/cloudsearch', { keywords: 'x'.repeat(201) })).status, 400);
  assert.equal((await send('/netease/cloudsearch', { keywords: 'hi', proxy: 'bad' })).status, 400);
  for (const [route, p] of [
    ['/netease/cloudsearch', { keywords: 'hi', limit: 999, page: 50 }],
    ['/kugou/search', { keywords: 'hi', pagesize: 999, cookie: 'token=test' }],
    ['/qq/getSearchByKey', { key: 'hi' }],
  ])
    assert.equal((await send(route, p)).status, 200);
  assert.equal(calls[0].limit, 20);
  assert.equal(calls[0].page, 1);
  assert.equal(calls[1].pagesize, 20);
  assert.equal(calls[2].keyword, 'hi');
  assert.equal(state.active, 0);
});

test('anonymous KuGou search has a fixed signed target, bounded size, and validated payload', async () => {
  const raw = await searchKugou('test', async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://complexsearch.kugou.com');
    assert.equal(parsed.searchParams.get('keyword'), 'test');
    assert.equal(parsed.searchParams.get('pagesize'), '20');
    assert.match(parsed.searchParams.get('signature'), /^[a-f0-9]{32}$/);
    assert.equal(parsed.searchParams.get('userid'), '0');
    assert(options.signal);
    return Response.json({ error_code: 0, data: { lists: [{ FileHash: 'hash' }] } });
  });
  assert.equal(raw.data.lists[0].FileHash, 'hash');
  await assert.rejects(() => searchKugou('test', async () => Response.json({ error_code: 152 })), /unavailable/);
});
