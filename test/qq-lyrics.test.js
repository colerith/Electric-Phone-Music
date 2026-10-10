import test from 'node:test';
import assert from 'node:assert/strict';
import { qqLyricTracks, lyricText } from '../qq-lyrics.js';
test('QQ translation uses numeric song ID and fixed modern endpoint', async () => {
  const calls = [];
  const result = await qqLyricTracks(
    { id: 'known-mid', songId: '12345', title: 'Test', artist: 'Artist' },
    async (url, init) => {
      assert.equal(url, 'https://u.y.qq.com/cgi-bin/musicu.fcg');
      const body = JSON.parse(init.body);
      calls.push(body);
      assert.equal(body.request.method, 'GetPlayLyricInfo');
      assert.equal(body.request.param.songID, 12345);
      assert.equal(body.request.param.trans, 1);
      assert.equal(body.request.param.crypt, 0);
      return Response.json({
        code: 0,
        request: {
          code: 0,
          data: {
            lyric: '1234abcdef',
            trans: Buffer.from('[00:02.10]测试译文').toString('base64'),
            roma: '1234abcdef',
          },
        },
      });
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(result.translation, '[00:02.10]测试译文');
  assert.equal(result.lyric, '');
  assert.equal(result.romanization, '');
  assert.equal(lyricText('[00:02.10]明文译文'), '[00:02.10]明文译文');
});
test('legacy cached QQ tracks resolve numeric identity by exact mid', async () => {
  let count = 0;
  const result = await qqLyricTracks({ id: 'same-mid', title: 'Same title', artist: 'Artist' }, async (_url, init) => {
    const req = JSON.parse(init.body).request;
    if (count++ === 0) {
      assert.equal(req.param.song_mid, 'same-mid');
      return Response.json({ code: 0, request: { code: 0, data: { track_info: { mid: 'same-mid', id: 42 } } } });
    }
    assert.equal(req.param.songID, 42);
    return Response.json({ code: 0, request: { code: 0, data: { trans: '[00:01]译文' } } });
  });
  assert.equal(result.translation, '[00:01]译文');
  await assert.rejects(
    qqLyricTracks({ id: 'wanted' }, async () =>
      Response.json({ code: 0, request: { code: 0, data: { track_info: { mid: 'different', id: 42 } } } }),
    ),
    /identity mismatch/,
  );
});
