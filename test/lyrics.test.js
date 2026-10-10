import test from 'node:test';
import assert from 'node:assert/strict';
import { createLyricsResolver, matches } from '../lyrics.js';
test('matching rejects same-title songs from different artists', () => {
  assert.equal(matches({ title: 'Song', artist: 'Alice' }, { title: 'Song', artist: 'Bob' }), false);
  assert.equal(matches({ title: 'Song!', artist: 'Alice' }, { title: 'song', artist: 'Alice / Bob' }), true);
});
test('exact platform lyrics first, AMLL fallback, no unrelated search result', async () => {
  const target = { id: '123', source: 'netease', title: 'Song', artist: 'Alice' };
  let fallback = 0;
  const services = {
    netease: { lyric: async () => ({ body: { lrc: { lyric: '[00:01]test' } } }) },
    kugou: {},
    text: async () => {
      fallback++;
      return '<tt><p begin="00:01.00">test</p></tt>';
    },
  };
  assert.equal((await createLyricsResolver(services)(target)).source, 'netease');
  assert.equal(fallback, 0);
  services.netease.lyric = async () => ({ body: {} });
  assert.equal((await createLyricsResolver(services)(target)).source, 'amll');
  const resolver = createLyricsResolver({
    netease: {
      cloudsearch: async () => ({ body: { result: { songs: [{ id: 1, name: 'Song', ar: [{ name: 'Bob' }] }] } } }),
      lyric: async () => {
        throw Error('wrong candidate fetched');
      },
    },
    kugou: { search_lyric: async () => ({ body: { candidates: [] } }) },
    text: async () => '',
  });
  assert.equal((await resolver({ ...target, source: 'other' })).lyric, '');
});
test('Kugou candidate search and decoded timed lyrics fallback', async () => {
  const resolve = createLyricsResolver({
    netease: {
      cloudsearch: async () => {
        throw Error('offline');
      },
    },
    text: async () => '',
    kugou: {
      search_lyric: async () => ({
        body: { candidates: [{ id: 1, accesskey: 'key', song: 'Song', singer: 'Alice' }] },
      }),
      lyric: async params => {
        assert.equal(params.fmt, 'lrc');
        assert.equal(params.decode, true);
        return { body: { decodeContent: '[00:02]test' } };
      },
    },
  });
  assert.equal(
    (await resolve({ source: 'kugou', id: 'a'.repeat(32), title: 'Song', artist: 'Alice' })).source,
    'kugou',
  );
});

test('translation and romanization retain their own timestamps', async () => {
  const resolver = createLyricsResolver({
    netease: {
      lyric: async () => ({
        body: {
          lrc: { lyric: '[00:01]Hello' },
          tlyric: { lyric: '[00:01]你好' },
          romalrc: { lyric: '[00:01]hello' },
        },
      }),
    },
    kugou: {},
    text: async () => '',
  });
  const result = await resolver({ source: 'netease', id: '1', alternates: true });
  assert.equal(result.translation, '[00:01]你好');
  assert.equal(result.romanization, '[00:01]hello');
});

test('romanization alone does not stop requested translation fallback',async()=>{
 const result=await createLyricsResolver({
  netease:{},kugou:{},text:async()=>JSON.stringify({lyric:'[00:01]original',roma:'[00:01]romaji'}),
  qqLyricTracks:async()=>({lyric:'',translation:'[00:01]译文',romanization:'',source:'qq',format:'lrc'}),
 })({source:'qq',id:'songmid123',songId:'123',alternates:true,alternate:'translation'});
 assert.equal(result.translation,'[00:01]译文');assert.equal(result.lyric,'[00:01]original');
});
