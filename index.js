import { searchQQ, searchKugou } from './search.js';
import { resolveLyrics } from './lyrics.js';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { handleRequest } from '@yakult-green-tea/qq-music-api/serverless';
import { createRelay } from './relay.js';
const require = createRequire(import.meta.url);
const netease = require('@neteasecloudmusicapienhanced/api');
const kugou = require('kugoumusicapi');

export const info = { id: 'electric-phone-music', name: '电波手机音乐服务', description: '网易云、QQ、酷狗账号与歌单' };
const common = ['/login/qr/key', '/login/qr/create', '/login/qr/check', '/user/playlist'];
export const routes = {
  netease: [
    ...common,
    '/cloudsearch',
    '/login/status',
    '/vip/info',
    '/playlist/track/all',
    '/song/url/v1',
    '/lyric',
    '/logout',
  ],
  kugou: [
    ...common,
    '/search',
    '/user/detail',
    '/user/vip/detail',
    '/playlist/track/all',
    '/song/url',
    '/register/dev',
  ],
  qq: [
    ...common,
    '/getSearchByKey',
    '/login/status',
    '/login/channels',
    '/user/playlist-detail',
    '/getSongListDetail',
    '/getMusicPlay',
    '/logout',
  ],
};
// No arbitrary proxy URLs, network options, uploads or write-to-playlist endpoints.
const allowed = new Set([
  'keywords',
  'timestamp',
  'cookie',
  'key',
  'qrimg',
  'channel',
  'qrcode',
  'userid',
  'uid',
  'id',
  'limit',
  'offset',
  'pagesize',
  'page',
  'tid',
  'dirid',
  'disstid',
  'songmid',
  'quality',
  'hash',
  'level',
]);
const users = new Map();
async function userState(root) {
  if (!users.has(root))
    users.set(
      root,
      (async () => {
        const directory = path.join(root, 'electric-phone-music');
        await mkdir(directory, { recursive: true });
        const filename = path.join(directory, 'session-secret');
        try {
          await writeFile(filename, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
        } catch (e) {
          if (e.code !== 'EEXIST') throw e;
        }
        const secret = (await readFile(filename, 'utf8')).trim();
        if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('Invalid session secret');
        return { secret, relay: createRelay(), active: 0 };
      })().catch(error => {
        users.delete(root);
        throw error;
      }),
    );
  return users.get(root);
}
export function installRoutes(router, dependencies = {}) {
  const stateFor = dependencies.userState || userState;
  const libraries = dependencies.libraries || { netease, kugou };
  const qq = dependencies.qq || handleRequest;
  router.get('/health', (req, res) => {
    if (!req.user?.directories?.root) return res.status(401).json({ message: '请先登录酒馆' });
    res.set('Cache-Control', 'no-store').json({ id: info.id, version: '0.4.1', providers: ['netease', 'qq', 'kugou'] });
  });
  router.post('/lyrics', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.user?.directories?.root) return res.status(401).json({ message: '请先登录酒馆' });
    const { source, id, title, artist } = req.body || {};
    if (
      !['netease', 'qq', 'kugou', 'other'].includes(source) ||
      [id, title, artist].some(value => typeof value !== 'string' || value.length > 200)
    )
      return res.status(400).json({ message: '歌词查询参数无效' });
    const state = await stateFor(req.user.directories.root).catch(() => null);
    if (!state) return res.status(503).json({ message: '歌词服务暂不可用' });
    if (state.active >= 6) return res.status(429).json({ message: '音乐请求过多' });
    state.active++;
    try {
      res.json(await resolveLyrics({ source, id, title, artist, alternates: req.body?.alternates === true }));
    } catch {
      res.status(502).json({ message: '歌词暂不可用' });
    } finally {
      state.active--;
    }
  });
  router.post('/:provider/*', async (req, res) => {
    const provider = req.params.provider;
    const endpoint = '/' + req.params[0];
    res.set('Cache-Control', 'no-store');
    if (!req.user?.directories?.root) return res.status(401).json({ message: '请先登录酒馆' });
    if (!routes[provider]?.includes(endpoint)) return res.status(404).json({ message: '不支持的音乐接口' });
    const params = {};
    for (const [key, value] of Object.entries(req.body || {})) {
      if (!allowed.has(key) || !['string', 'number', 'boolean'].includes(typeof value) || String(value).length > 20000)
        return res.status(400).json({ message: '无效的音乐请求参数' });
      params[key] = value;
    }
    if (['/cloudsearch', '/getSearchByKey', '/search'].includes(endpoint)) {
      const keyword = provider === 'qq' ? params.key : params.keywords;
      if (typeof keyword !== 'string' || !keyword.trim() || keyword.length > 200)
        return res.status(400).json({ message: '搜索关键词应为 1–200 个字符' });
      params.limit = 20;
      if (provider === 'kugou') {
        delete params.limit;
        params.pagesize = 20;
      }
      params.page = 1;
      params.offset = 0;
    }
    let state;
    try {
      state = await stateFor(req.user.directories.root);
      if (state.active >= 6) return res.status(429).json({ message: '音乐请求过多，请稍后再试' });
      state.active++;
      try {
        if (
          provider === 'kugou' &&
          endpoint === '/search' &&
          !/(?:^|;)\s*token=[^;]+/.test(String(params.cookie || ''))
        )
          return res.json(await (dependencies.searchKugou || searchKugou)(params.keywords));
        if (provider === 'qq' && endpoint === '/getSearchByKey')
          return res.json(await (dependencies.searchQQ || searchQQ)(params.key));
        if (provider === 'qq') {
          const url = new URL(endpoint, 'https://electric-phone.invalid');
          for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
          const upstream = await qq(new Request(url), { QQ_SESSION_SECRET: state.secret }, { qqRelay: state.relay });
          return res.status(upstream.status).json(await upstream.json());
        }
        const method = endpoint.slice(1).replaceAll('/', '_');
        const result = await libraries[provider][method](params);
        const body = result.body || result;
        // Return login cookies as JSON only; never set music cookies on the SillyTavern origin.
        return res.status(200).json({ ...body, ...(result.cookie ? { cookie: result.cookie } : {}) });
      } finally {
        state.active--;
      }
    } catch {
      // Upstream errors may contain account credentials: do not log or echo them.
      if (!res.headersSent) res.status(502).json({ message: '音乐平台暂时无法连接，请稍后重试' });
    }
  });
}
export async function init(router) {
  installRoutes(router);
}
export async function exit() {
  await Promise.all(
    [...users.values()].map(async pending => {
      try {
        await (await pending).relay.dispose();
      } catch {}
    }),
  );
  users.clear();
}
