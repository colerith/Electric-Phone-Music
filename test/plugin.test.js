import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { installRoutes, routes, exit } from '../index.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('pinned SDKs implement every advertised library route', () => {
 for (const provider of ['netease','kugou']) {
  const sdk = require(provider === 'netease' ? '@neteasecloudmusicapienhanced/api' : 'kugoumusicapi');
  for (const route of routes[provider]) assert.equal(typeof sdk[route.slice(1).replaceAll('/','_')], 'function', provider + route);
 }
});
test('authenticated, allowlisted routes, credentials and errors are isolated', async t => {
 const app = express(); app.use(express.urlencoded({ extended: false, limit: '32kb' }));
 app.use((req,res,next) => { if(req.headers['x-test-user']) req.user={directories:{root:req.headers['x-test-user']}}; next(); });
 const states = new Map(); const calls=[];
 installRoutes(app, {
  userState: async root => { if(!states.has(root)) states.set(root,{secret:root,active:0,relay:{}}); return states.get(root); },
  libraries: { netease: { login_qr_key: async p => { calls.push(p); return {body:{code:200,data:{unikey:'key'}},cookie:['MUSIC_U=private']}; }, login_status: async()=>{throw Error('secret must never be returned');} } },
  qq: async (req, env) => { calls.push({url:req.url,env}); return Response.json({code:200,data:{profile:{nickname:env.QQ_SESSION_SECRET}}}); },
 });
 const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
 t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}`;
 const send=(route,params={},user='one')=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',...(user?{'x-test-user':user}:{})},body:new URLSearchParams(params)});
 assert.equal((await fetch(base+'/health')).status,401);
 assert.equal((await send('/netease/login/qr/key',{},'')).status,401);
 assert.equal((await send('/netease/send/text')).status,404);
 assert.equal((await send('/netease/login/qr/key',{proxy:'http://127.0.0.1'})).status,400);
 let response=await send('/netease/login/qr/key',{cookie:'old'});
 assert.equal(response.headers.get('set-cookie'),null);
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.deepEqual((await response.json()).cookie,['MUSIC_U=private']);
 assert.equal(calls[0].cookie,'old');
 response=await send('/netease/login/status');assert.equal(response.status,502);
 assert.ok(!(await response.text()).includes('secret'));
 for(const user of ['one','two']) {
  response=await send('/qq/login/status',{cookie:'qqmusic_session=private'},user);
  assert.equal((await response.json()).data.profile.nickname,user);
 }
 assert.notEqual(states.get('one'),states.get('two'));
 states.get('one').active=6;
 assert.equal((await send('/netease/login/qr/key')).status,429);
 await exit();
});
