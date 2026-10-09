import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const netease = require('@neteasecloudmusicapienhanced/api');
const kugou = require('kugoumusicapi');
const cache = new Map(),
  pending = new Map();
const normalized = value =>
  String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
export function matches(target, row) {
  const title = normalized(row.title),
    wanted = normalized(target.title);
  const artists = value =>
    String(value || '')
      .split(/\s*(?:\/|、|,|&| feat\.?| ft\.?)\s*/i)
      .map(normalized)
      .filter(Boolean);
  const expected = new Set(artists(target.artist));
  return Boolean(title && title === wanted && artists(row.artist).some(name => expected.has(name)));
}

const timed = value => typeof value === 'string' && /\[\d{1,3}:\d{2}(?:[.:]\d+)?\]/.test(value);
async function bounded(action) {
  let timer;
  try {
    return await Promise.race([
      action(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Lyrics timeout')), 6000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function text(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!response.ok) throw Error('Lyrics unavailable');
  const body = await response.text();
  if (body.length > 1000000) throw Error('Lyrics too large');
  return body;
}
export function createLyricsResolver(services = { netease, kugou, text }) {
  return async target => {
    const id = String(target.id || ''),
      source = target.source;
    let neteaseId = source === 'netease' && /^\d+$/.test(id) ? id : '';
    const mid = source === 'qq' && /^[a-zA-Z0-9]{5,40}$/.test(id) ? id : '';
    const candidates = [];
    const lrc = (lyric, source, translation = '', romanization = '') =>
      timed(lyric)
        ? {
            lyric,
            source,
            format: 'lrc',
            translation: timed(translation) ? translation : '',
            romanization: timed(romanization) ? romanization : '',
          }
        : null;
    const fromNetease = async id => {
      const body = (await services.netease.lyric({ id })).body || {};
      return lrc(body.lrc?.lyric, 'netease', body.tlyric?.lyric, body.romalrc?.lyric);
    };
    if (neteaseId) candidates.push(async () => fromNetease(neteaseId));
    if (mid)
      candidates.push(async () => {
        const url = new URL('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg');
        url.search = new URLSearchParams({ songmid: mid, format: 'json', nobase64: '1' }).toString();
        const data = JSON.parse(await services.text(url, { Referer: 'https://y.qq.com/' }));
        const lyric = timed(data.lyric) ? data.lyric : Buffer.from(String(data.lyric || ''), 'base64').toString('utf8');
        const decode = value => (timed(value) ? value : Buffer.from(String(value || ''), 'base64').toString('utf8'));
        return lrc(lyric, 'qq', decode(data.trans), decode(data.roma));
      });
    if (neteaseId || mid)
      candidates.push(async () => {
        const xml = await services.text(
          `https://amll-ttml-db.stevexmh.net/${neteaseId ? 'ncm' : 'qq'}/${encodeURIComponent(neteaseId || mid)}?format=ttml`,
        );
        return /<tt(?:\s|>)/.test(xml) && /<(?:\w+:)?p\b[^>]*\bbegin=/.test(xml)
          ? { lyric: xml, source: 'amll', format: 'ttml' }
          : null;
      });
    if (!neteaseId)
      candidates.push(async () => {
        const response = await services.netease.cloudsearch({
          keywords: `${target.title} ${target.artist}`,
          limit: 5,
          type: 1,
        });
        const song = response.body?.result?.songs?.find(row =>
          matches(target, { title: row.name, artist: (row.ar || row.artists || []).map(a => a.name).join(' / ') }),
        );
        if (!song) return null;
        return fromNetease(song.id);
      });
    candidates.push(async () => {
      const hash = source === 'kugou' && /^[a-f0-9]{32}$/i.test(id) ? id : '';
      const result = await services.kugou.search_lyric({ hash, keywords: `${target.title} ${target.artist}` });
      const rows = result.body?.candidates || result.body?.data?.candidates || [];
      const row = rows.find(row => matches(target, { title: row.song, artist: row.singer }));
      if (!row) return null;
      const result2 = await services.kugou.lyric({ id: row.id, accesskey: row.accesskey, fmt: 'lrc', decode: true });
      return lrc(result2.body?.decodeContent, 'kugou');
    });
    let original = null;
    for (const candidate of candidates) {
      try {
        const result = await bounded(candidate);
        if (result) {
          original ||= result;
          if (
            !target.alternates ||
            result.translation ||
            result.romanization ||
            (result.format === 'ttml' && /translation|romanization/.test(result.lyric))
          )
            return result;
        }
      } catch {
        /* Try the next fixed provider. */
      }
    }
    return original || { lyric: '', format: 'lrc', source: '' };
  };
}
const resolve = createLyricsResolver();
export async function resolveLyrics(target) {
  const key = JSON.stringify([target.source, target.id, target.title, target.artist, Boolean(target.alternates)]);
  const cached = cache.get(key);
  if (cached && cached.until > Date.now()) return cached.value;
  if (pending.has(key)) return pending.get(key);
  const promise = resolve(target)
    .then(value => {
      if (cache.size >= 200) cache.delete(cache.keys().next().value);
      cache.set(key, { value, until: Date.now() + (value.lyric ? 21600000 : 30000) });
      return value;
    })
    .finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}
