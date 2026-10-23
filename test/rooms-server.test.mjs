import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createApp } from '../src/server.mjs';
import { saveRoom } from '../src/store.mjs';
import { ExportManager } from '../src/export.mjs';

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'bead-multi-'));
  const app = await createApp({dataDir:dir, port:0, ...options});
  await app.start();
  t.after(async () => {await app.close(); await rm(dir,{recursive:true,force:true});});
  const base = `http://127.0.0.1:${app.address().port}`;
  const post = async (path, body, headers = {}) => {
    const response = await fetch(base + path, {method:'POST', headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
    const text=await response.text();
    return {status:response.status, body:response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : {message:text}, headers:response.headers};
  };
  const create = async (name, code) => {
    const r = await post('/api/rooms',{name,code}); assert.equal(r.status,201); return r.body;
  };
  return {app, dir, base, post, create};
}
async function peer(t, base, key) {
  const ws = new WebSocket(base.replace('http','ws')+'/ws');
  const messages = [], waiters = [];
  ws.on('message', raw => {
    const msg=JSON.parse(raw);
    const i=waiters.findIndex(w=>w.predicate(msg));
    if(i<0)messages.push(msg); else {const w=waiters.splice(i,1)[0];clearTimeout(w.timer);w.resolve(msg);}
  });
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  t.after(()=>ws.terminate());
  const next=predicate=>{
    const i=messages.findIndex(predicate);if(i>=0)return Promise.resolve(messages.splice(i,1)[0]);
    return new Promise((resolve,reject)=>{const w={predicate,resolve};w.timer=setTimeout(()=>reject(new Error('Missing message')),3000);waiters.push(w);});
  };
  const send=message=>ws.send(JSON.stringify(message));
  send({type:'auth',key});
  const snapshot=await next(m=>m.type==='snapshot');
  return {send,next,messages,snapshot};
}
const op=(id,index=0)=>({type:'op',requestId:id,index,action:'place',color:5,expectedRevision:0});

test('HTTP creates and joins independent rooms; sockets isolate presence, beads and canvas changes', async t => {
  const f=await fixture(t), a=await f.create('一号','ROOM-AAA'), b=await f.create('二号','ROOM-BBB');
  const joined=await f.post('/api/rooms/join',{code:'room-aaa'});
  assert.equal(joined.status,200);assert.equal(joined.body.key,a.key);
  const pa=await peer(t,f.base,a.key), pa2=await peer(t,f.base,a.key), pb=await peer(t,f.base,b.key);
  assert.equal(pa2.snapshot.online,2);assert.equal(pb.snapshot.online,1);
  assert.equal(pa.snapshot.room.id,a.room.id);assert.equal(pb.snapshot.room.name,'二号');
  pa.send({...op('only-a'),roomId:b.room.id});
  await pa.next(m=>m.type==='patch');await pa2.next(m=>m.type==='patch');
  pb.send({type:'sync'});const unchanged=await pb.next(m=>m.type==='snapshot');
  assert.equal(unchanged.board.cells[0].color,null);assert.equal(unchanged.online,1);
  assert.equal(pb.messages.some(m=>m.type==='patch'),false);
  pa.send({type:'canvas',requestId:'new-canvas',action:'new',canvasId:pa.snapshot.canvasId,epoch:pa.snapshot.epoch,expectedRevision:1,name:'新图',width:80,height:80});
  const next=await pa2.next(m=>m.type==='snapshot');assert.equal(next.canvases.length,2);
  pb.send({type:'sync'});assert.equal((await pb.next(m=>m.type==='snapshot')).canvases.length,1);
  await f.app.close();
  const restored=await createApp({dataDir:f.dir,port:0});t.after(()=>restored.close());
  assert.equal(restored.rooms.join('ROOM-AAA').room.canvases.length,2);
  assert.equal(restored.rooms.join('ROOM-BBB').room.board.revision,0);
});

test('one room waiting for durable save never blocks another room', async t => {
  let release, entered;
  const gate=new Promise(r=>release=r), started=new Promise(r=>entered=r);
  const f=await fixture(t,{save:async (dir,room)=>{
    if(room.roomMeta?.name==='慢' && room.board.revision===1){entered();await gate;}
    await saveRoom(dir,room);
  }});
  t.after(release);
  const a=await f.create('慢','SLOWROOM'),b=await f.create('快','FASTROOM');
  const pa=await peer(t,f.base,a.key),pb=await peer(t,f.base,b.key);
  pa.send(op('slow'));await started;
  pb.send(op('fast'));assert.equal((await pb.next(m=>m.type==='patch')).requestId,'fast');
  assert.equal(pa.messages.some(m=>m.type==='patch'),false);
  release();await pa.next(m=>m.type==='patch');
});

test('export uses authenticated room even when caller names another room', async t => {
  const f=await fixture(t), a=await f.create('A','EXPORT-A'),b=await f.create('B','EXPORT-B');
  const pa=await peer(t,f.base,a.key);pa.send(op('color'));await pa.next(m=>m.type==='patch');
  const response=await fetch(f.base+'/api/export',{method:'POST',headers:{Authorization:`Bearer ${b.key}`,'Content-Type':'application/json'},body:JSON.stringify({roomId:a.room.id})});
  assert.equal(response.status,200);
  const exporter=new ExportManager();t.after(()=>exporter.close());
  const expected=await exporter.render(f.app.rooms.byKey(b.key).room.board);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),expected);
  const denied=await fetch(f.base+'/api/export',{method:'POST',headers:{Authorization:'Bearer '+ '0'.repeat(48)}});
  assert.equal(denied.status,401);
});

test('room APIs reject duplicate invites, cross-origin and oversized input, and keep legacy authentication', async t => {
  const f=await fixture(t);
  const first=await f.create('room','SAMECODE');
  assert.equal((await f.post('/api/rooms',{name:'copy',code:'samecode'})).status,409);
  const denied=await f.post('/api/rooms/join',{code:'WRONG123'});
  assert.equal(denied.status,401);assert.equal(denied.body.key,undefined);
  assert.equal((await f.post('/api/rooms',{name:'other',code:'OTHER123'},{Origin:'https://unrelated.example'})).status,403);
  assert.equal((await f.post('/api/rooms',{name:'x'.repeat(5000),code:'OTHER123'})).status,413);
  const set=await f.post('/api/rooms/invite',{code:'LEGACY88'},{Authorization:`Bearer ${f.app.room.key}`});
  assert.equal(set.status,200);assert.equal(set.body.key,f.app.room.key);
  assert.equal((await f.post('/api/rooms/invite',{code:'OTHER123'},{Authorization:`Bearer ${first.key}`})).status,401);
  const legacy=await peer(t,f.base,f.app.room.key);assert.equal(legacy.snapshot.room.id,'legacy');
  assert.equal((await f.post('/api/rooms/join',{code:'LEGACY88'})).body.key,f.app.room.key);
});

test('failed room saves return an error without issuing credentials', async t => {
  const f=await fixture(t,{save:async()=>{throw new Error('disk unavailable');}});
  const created=await f.post('/api/rooms',{name:'room',code:'FAILROOM'});
  assert.equal(created.status,500);assert.equal(created.body.key,undefined);
  assert.equal((await f.post('/api/rooms/join',{code:'FAILROOM'})).status,401);
});

test('repeated attempts are limited per browser without blocking a second browser behind the same proxy',async t=>{
  const f=await fixture(t);
  const first=await f.post('/api/rooms/join',{code:'MISSING1'});
  const cookie=first.headers.get('set-cookie').split(';')[0];
  let result;
  for(let i=0;i<40;i++)result=await f.post('/api/rooms/join',{code:'MISSING1'},{Cookie:cookie});
  assert.equal(result.status,429);
  assert.equal((await f.post('/api/rooms/join',{code:'MISSING1'})).status,401);
});
