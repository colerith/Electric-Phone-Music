import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mcpRequest,
  parsePreview,
  previewLink,
  publicAddress,
  publicFetch,
  webUrl,
  installWebTools,
} from '../web-tools.js';

test('public network restrictions reject loopback, metadata, private and mapped IPv6 addresses', async () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.2',
    '169.254.169.254',
    '192.168.1.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    '0.0.0.0',
  ])
    assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress('1.1.1.1'), true);
  assert.throws(() => webUrl('file:///etc/passwd'));
  assert.throws(() => webUrl('https://name:secret@example.com'));
  await assert.rejects(publicFetch('http://127.0.0.1/'), /内网/);
  await assert.rejects(publicFetch('http://[::ffff:127.0.0.1]/'), /内网/);
});
test('Open Graph, Twitter and HTML fallbacks handle entities and relative artwork', () => {
  const result = parsePreview(
    '<title>fallback</title><meta property="og:title" content="A &amp; B"><meta name="description" content="short"><meta property="og:image" content="/cover.jpg"><meta property="og:site_name" content="测试站"><link rel="shortcut icon" href="./icon.png">',
    'https://example.com/news/post',
  );
  assert.equal(result.title, 'A & B');
  assert.equal(result.image, 'https://example.com/cover.jpg');
  assert.equal(result.icon, 'https://example.com/news/icon.png');
  assert.equal(result.siteName, '测试站');
  assert.equal(
    parsePreview(
      '<meta name="twitter:title" content="tweet"><meta property="og:image" content="javascript:alert(1)">',
      'https://example.com',
    ).image,
    '',
  );
  assert.equal(parsePreview('<title>plain</title>', 'https://example.com').title, 'plain');
});
test('preview rejects non HTML, failed responses and oversized HTML', async () => {
  await assert.rejects(
    previewLink(
      'https://example.com',
      async () => new Response('pdf', { headers: { 'content-type': 'application/pdf' } }),
    ),
    /预览/,
  );
  await assert.rejects(
    previewLink('https://example.com', async () => new Response('', { status: 403 })),
    /403/,
  );
  await assert.rejects(
    previewLink(
      'https://example.com',
      async () => new Response('x'.repeat(2000001), { headers: { 'content-type': 'text/html' } }),
    ),
    /过大/,
  );
});
test('MCP initializes, negotiates version, follows pagination, parses SSE and closes session', async () => {
  const calls = [];
  const transport = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : {};
    calls.push({ method: options.method, body, headers: { ...options.headers } });
    if (options.method === 'DELETE') return new Response(null, { status: 204 });
    if (body.method === 'initialize')
      return Response.json(
        { jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-03-26' } },
        { headers: { 'mcp-session-id': 'test-session' } },
      );
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const result = body.params.cursor
      ? { tools: [{ name: 'read_url' }] }
      : { tools: [{ name: 'search' }], nextCursor: 'next' };
    return new Response(
      `: ping\r\n\r\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress' })}\r\n\r\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result })}\r\n\r\n`,
      { headers: { 'content-type': 'text/event-stream' } },
    );
  };
  const result = await mcpRequest(
    { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer test' } },
    { method: 'tools/list' },
    transport,
  );
  assert.deepEqual(
    result.tools.map(t => t.name),
    ['search', 'read_url'],
  );
  assert.equal(calls[2].headers['Mcp-Session-Id'], 'test-session');
  assert.equal(calls[2].headers['MCP-Protocol-Version'], '2025-03-26');
  assert.equal(calls.at(-1).method, 'DELETE');
});
test('MCP invokes tool with exact arguments and rejects arbitrary headers', async () => {
  let args;
  const transport = async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (body.method === 'tools/call') args = body.params;
    return Response.json({
      id: body.id,
      result:
        body.method === 'initialize' ? { protocolVersion: '2025-06-18' } : { content: [{ type: 'text', text: 'ok' }] },
    });
  };
  const result = await mcpRequest(
    { url: 'https://example.com/mcp' },
    { method: 'tools/call', name: 'read_url', arguments: { url: 'https://example.org' } },
    transport,
  );
  assert.equal(result.content[0].text, 'ok');
  assert.deepEqual(args, { name: 'read_url', arguments: { url: 'https://example.org' } });
  await assert.rejects(
    mcpRequest({ url: 'https://example.com/mcp', headers: { Cookie: 'secret' } }, { method: 'tools/list' }),
    /请求头/,
  );
});
test('web routes require an authenticated Tavern user', async () => {
  const routes = new Map();
  installWebTools({ post: (path, handler) => routes.set(path, handler) });
  for (const handler of routes.values()) {
    let status;
    const res = {
      set() {
        return this;
      },
      status(value) {
        status = value;
        return this;
      },
      json() {},
    };
    await handler({ body: {} }, res);
    assert.equal(status, 401);
  }
});
