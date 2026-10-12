import { lookup } from 'node:dns/promises';
import { Agent, fetch } from 'undici';
import ipaddr from 'ipaddr.js';
import { load } from 'cheerio';

export function publicAddress(address) {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}
export function webUrl(value, base) {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 8192)
    throw Error('仅支持无用户名密码的 HTTP(S) 地址');
  return url;
}
// Validate and pin DNS at connection time, including each redirect. Never forward Tavern credentials.
const dispatcher = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      lookup(hostname, { all: true })
        .then(rows => {
          if (!rows.length || rows.some(row => !publicAddress(row.address))) throw Error('不允许访问本机或内网地址');
          if (options.all) callback(null, rows);
          else callback(null, rows[0].address, rows[0].family);
        })
        .catch(error => callback(error));
    },
  },
});
export async function publicFetch(value, init = {}, redirects = 4) {
  let url = webUrl(value);
  for (let i = 0; i <= redirects; i++) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (ipaddr.isValid(host) && !publicAddress(host)) throw Error('不允许访问本机或内网地址');
    const response = await fetch(url, { ...init, dispatcher, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    await response.body?.cancel();
    if (!response.headers.get('location') || i === redirects) throw Error('网页重定向过多');
    const next = webUrl(response.headers.get('location'), url);
    if (init.method && init.method !== 'GET') throw Error('MCP 地址发生重定向，请填写最终地址');
    url = next;
  }
}
async function limitedText(response, limit = 2_000_000) {
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let text = '',
    size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > limit) throw Error('响应内容过大');
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
export function parsePreview(html, url) {
  const $ = load(html);
  let structured = {};
  $('script[type="application/ld+json"]')
    .slice(0, 8)
    .each((_, element) => {
      try {
        const raw = $(element).text();
        if (raw.length > 100000) return;
        const value = JSON.parse(raw);
        const items = Array.isArray(value) ? value : value['@graph'] || [value];
        const article = items.find(
          item => item && /Article|NewsArticle|BlogPosting|VideoObject|Product/i.test(String(item['@type'])),
        );
        if (article && !structured.headline && !structured.name) structured = article;
      } catch {
        /* Invalid structured data does not invalidate the public HTML metadata. */
      }
    });
  const meta = (...names) => {
    for (const name of names) {
      const value = $(`meta[property="${name}"],meta[name="${name}"]`).first().attr('content');
      if (value?.trim()) return value.trim();
    }
    return '';
  };
  const asset = value => {
    try {
      return typeof value === 'string' && value ? webUrl(value, url).href : '';
    } catch {
      return '';
    }
  };
  const text = value => (typeof value === 'string' ? value : '');
  const picture = Array.isArray(structured.image) ? structured.image[0] : structured.image;
  return {
    url,
    title: (
      meta('og:title', 'twitter:title') ||
      text(structured.headline) ||
      text(structured.name) ||
      $('title').first().text() ||
      new URL(url).hostname
    ).slice(0, 240),
    description: (meta('og:description', 'twitter:description', 'description') || text(structured.description)).slice(
      0,
      500,
    ),
    image: asset(
      meta('og:image', 'twitter:image', 'twitter:image:src') || (typeof picture === 'string' ? picture : picture?.url),
    ),
    siteName: (meta('og:site_name') || new URL(url).hostname).slice(0, 100),
    icon: asset($('link[rel~="icon"]').first().attr('href')),
  };
}
export async function previewLink(url, fetcher = publicFetch) {
  webUrl(url);
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(12000),
    headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'ElectricPhone/1.0 LinkPreview' },
  });
  if (!response.ok) throw Error(`网页返回 HTTP ${response.status}`);
  if (!/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type') || ''))
    throw Error('此链接没有网页预览');
  return parsePreview(await limitedText(response), response.url || url);
}
async function rpcResponse(response, id) {
  if (!response.ok) throw Error(`MCP 返回 HTTP ${response.status}`);
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const data = JSON.parse(await limitedText(response));
    if (data.id !== id) throw Error('MCP 响应 ID 不匹配');
    if (data.error) throw Error(`MCP 错误 ${data.error.code ?? ''}`);
    return data.result;
  }
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '',
    size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw Error('MCP 事件流提前结束');
      size += value.byteLength;
      if (size > 2_000_000) throw Error('MCP 响应过大');
      buffer += decoder.decode(value, { stream: true });
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const event = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const raw = event
          .split(/\r?\n/)
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trimStart())
          .join('\n');
        if (!raw) continue;
        const data = JSON.parse(raw);
        if (data.id !== id) continue;
        if (data.error) throw Error(`MCP 错误 ${data.error.code ?? ''}`);
        return data.result;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
export async function mcpRequest(config, operation, fetcher = publicFetch) {
  const url = webUrl(config?.url).href;
  if (!['tools/list', 'tools/call'].includes(operation?.method)) throw Error('不支持的 MCP 操作');
  const headers = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' };
  for (const [key, value] of Object.entries(config.headers || {})) {
    if (
      !/^(authorization|x-api-key|api-key|default_parameters)$/i.test(key) ||
      typeof value !== 'string' ||
      /[\r\n]/.test(value) ||
      value.length > 4096
    )
      throw Error('不支持的认证请求头');
    headers[key] = value;
  }
  let id = 0;
  const signal = AbortSignal.timeout(30000);
  const request = async (method, params, notify = false) => {
    const current = ++id;
    const response = await fetcher(url, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({ jsonrpc: '2.0', ...(notify ? {} : { id: current }), method, params }),
    });
    if (method === 'initialize' && response.headers.get('mcp-session-id'))
      headers['Mcp-Session-Id'] = response.headers.get('mcp-session-id');
    if (notify) {
      await response.body?.cancel();
      if (!response.ok) throw Error('MCP 初始化通知失败');
      return;
    }
    return rpcResponse(response, current);
  };
  try {
    const init = await request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'electric-phone', version: '1.0.0' },
    });
    if (!['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'].includes(init?.protocolVersion))
      throw Error('MCP 协议版本不兼容');
    headers['MCP-Protocol-Version'] = init.protocolVersion;
    await request('notifications/initialized', {}, true);
    if (operation.method === 'tools/list') {
      const tools = [];
      let cursor;
      for (let page = 0; page < 10; page++) {
        const result = await request('tools/list', cursor ? { cursor } : {});
        tools.push(...(result.tools || []));
        cursor = result.nextCursor;
        if (!cursor) return { tools };
      }
      throw Error('工具列表分页过多');
    }
    if (
      typeof operation.name !== 'string' ||
      !operation.name ||
      !operation.arguments ||
      typeof operation.arguments !== 'object' ||
      Array.isArray(operation.arguments)
    )
      throw Error('工具名称或参数无效');
    return await request('tools/call', { name: operation.name, arguments: operation.arguments });
  } finally {
    if (headers['Mcp-Session-Id'])
      await fetcher(url, { method: 'DELETE', headers, signal: AbortSignal.timeout(2000) })
        .then(r => r.body?.cancel())
        .catch(() => {});
  }
}
export function installWebTools(router) {
  const active = new Map();
  for (const [route, action] of [
    ['/web/preview', body => previewLink(body.url)],
    ['/mcp/request', body => mcpRequest(body.config, body.operation)],
  ]) {
    router.post(route, async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const user = req.user?.directories?.root;
      if (!user) return res.status(401).json({ message: '请先登录酒馆' });
      if ((active.get(user) || 0) >= 4) return res.status(429).json({ message: '网页工具请求过多，请稍后重试' });
      if (JSON.stringify(req.body || {}).length > 50000) return res.status(400).json({ message: '工具请求过大' });
      active.set(user, (active.get(user) || 0) + 1);
      try {
        res.json(await action(req.body || {}));
      } catch (error) {
        res
          .status(502)
          .json({
            message:
              /HTTP \d+|MCP 错误 -?\d+/.exec(String(error.message))?.[0] ||
              '请求失败，请检查地址、API Key、网络或网站访问限制',
          });
      } finally {
        const count = active.get(user) - 1;
        if (count) active.set(user, count);
        else active.delete(user);
      }
    });
  }
}
