/** Fixed QQ lyric endpoint. Protocol fields are kept transient; no encoded resource is persisted. */
const endpoint = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
export function lyricText(value) {
  if (typeof value !== 'string' || value.length > 1000000) return '';
  const timed = s => /\[\d{1,3}:\d{2}(?:[.:]\d+)?\]/.test(s);
  if (timed(value)) return value;
  if (/^[A-Za-z0-9+/\s]+={0,2}$/.test(value)) {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    if (timed(decoded)) return decoded;
  }
  // crypt=0 can leave the original/romanization encrypted. Never render ciphertext as lyrics.
  return '';
}
export async function qqLyricTracks(target, fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5500);
  const request = async (module, method, param) => {
    const response = await fetcher(endpoint, {
      method: 'POST',
      signal: controller.signal,
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'okhttp/3.14.9', Cookie: 'tmeLoginType=-1;' },
      body: JSON.stringify({
        comm: {
          ct: 11,
          cv: '1003006',
          v: '1003006',
          os_ver: '15',
          phonetype: '24122RKC7C',
          tmeAppID: 'qqmusiclight',
          nettype: 'NETWORK_WIFI',
          udid: '0',
          uid: '0',
        },
        request: { module, method, param },
      }),
    });
    if (!response.ok) throw Error('QQ lyric request failed');
    const text = await response.text();
    if (text.length > 2000000) throw Error('QQ lyric response too large');
    const raw = JSON.parse(text);
    if (raw.code !== 0 || raw.request?.code !== 0) throw Error('QQ lyric response unavailable');
    return raw.request.data;
  };
  try {
    let songId = /^\d{1,16}$/.test(String(target.songId || '')) ? Number(target.songId) : 0;
    if (!Number.isSafeInteger(songId)) songId = 0;
    if (!songId) {
      const detail = await request('music.pf_song_detail_svr', 'get_song_detail_yqq', {
        song_type: 0,
        song_mid: target.id,
        song_id: 0,
      });
      const song = detail?.track_info;
      if (String(song?.mid || '') !== target.id || !Number.isSafeInteger(Number(song?.id)))
        throw Error('QQ song identity mismatch');
      songId = Number(song.id);
    }
    const encode = value => Buffer.from(String(value || ''), 'utf8').toString('base64');
    const data = await request('music.musichallSong.PlayLyricInfo', 'GetPlayLyricInfo', {
      songID: songId,
      songName: encode(target.title),
      singerName: encode(target.artist),
      albumName: '',
      interval: 0,
      crypt: 0,
      qrc: 0,
      trans: 1,
      roma: 1,
      lrc_t: 0,
      qrc_t: 0,
      trans_t: 0,
      roma_t: 0,
      ct: 19,
      cv: 2111,
      type: 0,
    });
    return {
      lyric: lyricText(data?.lyric),
      translation: lyricText(data?.trans),
      romanization: lyricText(data?.roma),
      format: 'lrc',
      source: 'qq',
    };
  } finally {
    clearTimeout(timer);
  }
}
