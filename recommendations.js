/** Public QQ new releases; no account credentials or arbitrary upstream URL. */
export async function qqNewSongs(fetcher = fetch) {
  const response = await fetcher('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: 'https://y.qq.com/' },
    signal: AbortSignal.timeout(12000),
    body: JSON.stringify({ comm: { ct: 24, cv: 0 }, new_song: {
      module: 'newsong.NewSongServer', method: 'get_new_song_info', param: { type: 5 },
    } }),
  });
  if (!response.ok) throw Error('QQ recommendations unavailable');
  const data = await response.json();
  const rows = data.new_song?.data?.songlist;
  if (data.code !== 0 || data.new_song?.code !== 0 || !Array.isArray(rows)) throw Error('QQ recommendations unavailable');
  return { code: 200, data: { list: rows.slice(0, 30) } };
}
