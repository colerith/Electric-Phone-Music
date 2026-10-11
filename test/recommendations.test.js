import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { qqNewSongs } from '../recommendations.js';
import { installRoutes } from '../index.js';
test('QQ recommendations validate upstream and cap the public list', async () => {
  const result = await qqNewSongs(async (url, options) => {
    assert.equal(new URL(url).hostname, 'u.y.qq.com');
    assert.equal(JSON.parse(options.body).new_song.method, 'get_new_song_info');
    return Response.json({code:0,new_song:{code:0,data:{songlist:Array.from({length:50},()=>({mid:'song'}))}}});
  });
  assert.equal(result.data.list.length,30);
  await assert.rejects(qqNewSongs(async()=>Response.json({code:1})), /unavailable/);
});
test('recommendations route requires user and remains allowlisted', async t => {
  const app=express(); app.use(express.urlencoded({extended:false}));
  app.use((req,_res,next)=>{if(req.headers['x-user'])req.user={directories:{root:'test'}};next()});
  const state={secret:'test',active:0,relay:{}};
  installRoutes(app,{userState:async()=>state,qqNewSongs:async()=>({code:200,data:{list:[{mid:'song'}]}})});
  const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const send=(route,user=true,body='')=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',...(user?{'x-user':'test'}:{})},body});
  assert.equal((await send('/qq/new/songs',false)).status,401);
  const response=await send('/qq/new/songs');
  assert.equal(response.status,200);assert.equal((await response.json()).data.list[0].mid,'song');
  assert.equal((await send('/qq/new/songs',true,'url=https://example.com')).status,400);
  assert.equal(state.active,0);
});
