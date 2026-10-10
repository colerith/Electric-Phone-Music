import { createHash } from 'node:crypto';
/** QQ catalog search, fixed upstream only. No session token or arbitrary proxy target. */
export async function searchQQ(keyword, fetcher = fetch) {
  const response = await fetcher('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'okhttp/3.14.9', Cookie: 'tmeLoginType=-1;' },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      comm: { ct: 11, cv: '1003006', v: '1003006', tmeAppID: 'qqmusiclight', uid: '0' },
      search: {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicLite',
        param: {
          query: keyword.slice(0, 60),
          search_type: 0,
          num_per_page: 20,
          page_num: 1,
          remoteplace: 'search.android.keyboard',
          highlight: 0,
          nqc_flag: 0,
          page_id: 1,
          grp: 1,
          search_id: String(Date.now()),
        },
      },
    }),
  });
  if (!response.ok) throw new Error('QQ search unavailable');
  const raw = await response.json();
  const songs = raw.search?.data?.body?.item_song;
  if (raw.code !== 0 || raw.search?.code !== 0 || !Array.isArray(songs)) throw new Error('QQ search unavailable');
  return { response: { data: { song: { list: songs.slice(0, 20) } } } };
}

/** Public anonymous KuGou catalog; authenticated SDK search remains available for signed-in accounts. */
export async function searchKugou(keyword, fetcher = fetch) {
  const time = Date.now();
  const md5 = text => createHash('md5').update(text).digest('hex');
  const params = new URLSearchParams({
    keyword,
    page: '1',
    pagesize: '20',
    platform: 'AndroidFilter',
    sorttype: '0',
    iscorrection: '1',
    appid: '3116',
    clientver: '11070',
    clienttime: String(Math.floor(time / 1000)),
    userid: '0',
    token: '',
    uuid: '-',
    dfid: '-',
    mid: md5(String(time)),
  });
  params.sort();
  const salt = 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA';
  params.set('signature', md5(salt + [...params].map(([k, v]) => `${k}=${v}`).join('') + salt));
  const response = await fetcher(`https://complexsearch.kugou.com/v2/search/song?${params}`, {
    signal: AbortSignal.timeout(8000),
    headers: {
      'User-Agent': 'Android14-1070-11070-201-0-SearchSong-wifi',
      'KG-Rec': '1',
      'KG-RC': '1',
      'KG-CLIENTTIMEMS': String(time),
      mid: params.get('mid'),
      'x-router': 'complexsearch.kugou.com',
    },
  });
  if (!response.ok) throw new Error('KuGou search unavailable');
  const raw = await response.json();
  if (![0, 200].includes(Number(raw.error_code ?? 0)) || !Array.isArray(raw.data?.lists))
    throw new Error('KuGou search unavailable');
  return raw;
}
