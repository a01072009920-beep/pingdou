import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createApp } from '../src/server.mjs';
import { saveRoom } from '../src/store.mjs';

export async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'bead-server-'));
  const app = await createApp({ dataDir: dir, port: 0, ...options });
  await app.start();
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  return { app, dir, base: `http://127.0.0.1:${app.address().port}` };
}

export async function peer(base, key) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
  const messages = [], waiters = [];
  ws.on('message', text => {
    const msg = JSON.parse(text.toString());
    const waiter = waiters.find(w => w.predicate(msg));
    if (waiter) { waiters.splice(waiters.indexOf(waiter), 1); clearTimeout(waiter.timer); waiter.resolve(msg); }
    else messages.push(msg);
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const next = predicate => {
    const i = messages.findIndex(predicate);
    if (i >= 0) return Promise.resolve(messages.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timer: setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); reject(new Error('Expected server message did not arrive')); }, 3000) };
      waiters.push(waiter);
    });
  };
  const send = message => ws.send(JSON.stringify(message));
  if (key !== undefined) send({ type: 'auth', key });
  return { ws, next, send, messages };
}

const op = (requestId, index, color = 5, expectedRevision = 0, action = 'place') => ({ type: 'op', requestId, index, color, expectedRevision, action });

test('both HTTP entry pages serve their stylesheet, bootstrap and all application modules with correct MIME types', async t => {
  const {base} = await fixture(t);
  for (const path of ['/', '/index.html']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    const html = await response.text();
    const resources = [...html.matchAll(/(?:src|href)="(\.\/[^\"]+)"/g)].map(match => new URL(match[1], base + path));
    assert.equal(resources.length, 2);
    for (const resource of resources) {
      const asset = await fetch(resource);
      assert.equal(asset.status, 200, resource.pathname);
      assert.match(asset.headers.get('content-type'), resource.pathname.endsWith('.css') ? /text\/css/ : /text\/javascript/);
      assert.ok((await asset.text()).length > 0);
    }
  }
  for (const path of ['/app.mjs','/interaction.mjs','/sync-state.mjs','/palette.mjs']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /text\/javascript/);
  }
});

test('last MARD extension color syncs between peers and survives a restart without index truncation', async t => {
  const {app, base, dir} = await fixture(t);
  const a = await peer(base, app.room.key), b = await peer(base, app.room.key);
  const [snapshot] = await Promise.all([a.next(m => m.type === 'snapshot'), b.next(m => m.type === 'snapshot')]);
  assert.equal(snapshot.board.palette.length, 291);
  assert.equal(snapshot.board.palette[290].code, 'ZG8');
  a.send(op('extension', 0, 290));
  for (const message of await Promise.all([a.next(m => m.type === 'patch'), b.next(m => m.type === 'patch')])) {
    assert.equal(message.cell.color, 290);
  }
  await app.close();
  const restored = await createApp({dataDir:dir,port:0});
  t.after(() => restored.close());
  assert.equal(restored.room.board.palette[restored.room.board.cells[0].color].hex, '#AB91C0');
  assert.equal(restored.room.board.revision, 1);
});

test('solo client can immediately place; acknowledged bead survives server restart', async t => {
  const { app, base, dir } = await fixture(t);
  const a = await peer(base, app.room.key);
  assert.equal((await a.next(m => m.type === 'snapshot')).online, 1);
  a.send(op('solo', 9));
  assert.equal((await a.next(m => m.type === 'patch')).cell.color, 5);
  await app.close();
  const restored = await createApp({ dataDir: dir, port: 0 });
  await restored.start();
  t.after(() => restored.close());
  assert.deepEqual(restored.room.board.cells[9], { color: 5, revision: 1 });
});

test('two clients compete for one empty cell: exactly one placement succeeds', async t => {
  const { app, base } = await fixture(t);
  const a = await peer(base, app.room.key), b = await peer(base, app.room.key);
  await Promise.all([a.next(m => m.type === 'snapshot'), b.next(m => m.type === 'snapshot')]);
  a.send(op('A', 10, 4)); b.send(op('B', 10, 11));
  const [rA, rB] = await Promise.all([
    a.next(m => m.requestId === 'A' && ['patch','rejected'].includes(m.type)),
    b.next(m => m.requestId === 'B' && ['patch','rejected'].includes(m.type)),
  ]);
  assert.deepEqual([rA.type, rB.type].sort(), ['patch', 'rejected']);
  assert.equal(app.room.board.revision, 1);
});

test('both windows see changes; either can erase and recolor only after erasing', async t => {
  const { app, base } = await fixture(t);
  const a = await peer(base, app.room.key), b = await peer(base, app.room.key);
  await Promise.all([a.next(m => m.type === 'snapshot'), b.next(m => m.type === 'snapshot')]);
  a.send(op('first', 3, 2));
  await Promise.all([a.next(m => m.type === 'patch'), b.next(m => m.type === 'patch')]);
  b.send(op('cover', 3, 4, 1));
  assert.equal((await b.next(m => m.type === 'rejected')).code, 'occupied');
  b.send(op('erase', 3, 0, 1, 'erase'));
  assert.equal((await a.next(m => m.type === 'patch')).cell.color, null);
  await b.next(m => m.type === 'patch');
  b.send(op('new', 3, 4, 2));
  assert.equal((await a.next(m => m.type === 'patch')).cell.color, 4);
  a.send(op('late-erase', 3, 0, 1, 'erase'));
  assert.equal((await a.next(m => m.type === 'rejected')).code, 'stale');
});

test('failed durable save rejects the change without broadcasting or mutating room', async t => {
  const { app, base } = await fixture(t, { save: async () => { throw new Error('disk unavailable'); } });
  const a = await peer(base, app.room.key);
  await a.next(m => m.type === 'snapshot');
  a.send(op('fail', 0));
  assert.equal((await a.next(m => m.type === 'rejected')).code, 'save_failed');
  assert.deepEqual(app.room.board.cells[0], { color: null, revision: 0 });
  assert.equal(a.messages.some(m => m.type === 'patch'), false);
});

test('a client joining during persistence receives old snapshot followed by committed patch', async t => {
  let release, entered;
  const enteredPromise = new Promise(resolve => entered = resolve);
  const gate = new Promise(resolve => release = resolve);
  const { app, base } = await fixture(t, { save: async (dir, room) => { entered(); await gate; await saveRoom(dir, room); } });
  const a = await peer(base, app.room.key);
  await a.next(m => m.type === 'snapshot');
  a.send(op('pending', 8));
  await enteredPromise;
  const b = await peer(base, app.room.key);
  assert.equal((await b.next(m => m.type === 'snapshot')).board.cells[8].color, null);
  release();
  assert.equal((await b.next(m => m.type === 'patch')).cell.color, 5);
});

test('invalid key and unauthenticated writes never expose a snapshot', async t => {
  const { app, base } = await fixture(t);
  const wrong = await peer(base, '0'.repeat(48));
  assert.equal((await wrong.next(m => m.type === 'error')).code, 'unauthorized');
  assert.equal(wrong.messages.some(m => m.type === 'snapshot'), false);
  const anon = await peer(base);
  anon.send(op('anon', 0));
  assert.equal((await anon.next(m => m.type === 'error')).code, 'unauthorized');
  assert.equal(app.room.board.revision, 0);
});

test('malformed JSON and oversized frames cannot crash the service or modify the board', async t => {
  const { app, base } = await fixture(t);
  const a = await peer(base, app.room.key);
  await a.next(m => m.type === 'snapshot');
  a.ws.send('{broken');
  assert.equal((await a.next(m => m.type === 'error')).code, 'invalid');
  a.ws.send('a'.repeat(5000));
  await new Promise(resolve => a.ws.once('close', resolve));
  assert.equal((await fetch(base + '/api/health')).status, 200);
  assert.equal(app.room.board.revision, 0);
  assert.equal((await fetch(base + '/data/room.json')).status, 404);
});

test('concurrent placements in different cells both persist, without rejecting unrelated revisions', async t => {
  const {app,base,dir}=await fixture(t);
  const a=await peer(base,app.room.key), b=await peer(base,app.room.key);
  await Promise.all([a.next(m=>m.type==='snapshot'),b.next(m=>m.type==='snapshot')]);
  a.send(op('left',63,0)); b.send(op('right',4095,23));
  await Promise.all([
    a.next(m=>m.type==='patch'&&m.requestId==='left'),
    b.next(m=>m.type==='patch'&&m.requestId==='right'),
  ]);
  assert.deepEqual(app.room.board.cells[63],{color:0,revision:1});
  assert.deepEqual(app.room.board.cells[4095],{color:23,revision:1});
  assert.equal(app.room.board.revision,2);
  await app.close();
  const reopened=await createApp({dataDir:dir,port:0});
  t.after(()=>reopened.close());
  assert.equal(reopened.room.board.cells[63].color,0);
  assert.equal(reopened.room.board.cells[4095].color,23);
});

test('empty erase acknowledges without writing, advancing revisions or blocking later placement', async t => {
  const {app,base}=await fixture(t,{save:async()=>{throw new Error('empty erase must not write');}});
  const a=await peer(base,app.room.key);
  await a.next(m=>m.type==='snapshot');
  a.send(op('empty',4095,0,0,'erase'));
  const reply=await a.next(m=>m.type==='unchanged');
  assert.equal(reply.requestId,'empty');
  assert.deepEqual(reply.cell,{color:null,revision:0});
  assert.equal(reply.revision,0);
  assert.equal(app.room.board.revision,0);
});

test('non-ASCII authentication text cannot trigger a timing comparison error', async t => {
  const {app,base}=await fixture(t);
  const bad=await peer(base,'豆'.repeat(48));
  assert.equal((await bad.next(m=>m.type==='error')).code,'unauthorized');
  assert.equal((await fetch(base+'/api/health')).status,200);
  assert.equal(app.room.board.revision,0);
});

test('cross-origin WebSocket upgrades and encoded private-file paths are refused', async t => {
  const {base}=await fixture(t);
  const ws=new WebSocket(base.replace('http','ws')+'/ws',{origin:'https://unrelated.example'});
  const response=await new Promise((resolve,reject)=>{
    ws.on('unexpected-response',(_req,res)=>{res.resume();resolve(res.statusCode);ws.terminate();});
    ws.on('error',()=>{});
    ws.on('open',()=>{ws.terminate();reject(new Error('Cross-origin connection was accepted'));});
  });
  assert.equal(response,403);
  for(const path of ['/data/room.json','/..%2fdata%2froom.json','/src/server.mjs']) {
    assert.equal((await fetch(base+path)).status,404);
  }
});


test('canvas commands synchronize peers, reject old strokes, and restore backup after restart', async t => {
  const {app,base,dir}=await fixture(t);
  const a=await peer(base,app.room.key), b=await peer(base,app.room.key);
  let current=await a.next(m=>m.type==='snapshot'); await b.next(m=>m.type==='snapshot');
  a.send({...op('seed',65,290),canvasId:current.canvasId,epoch:current.epoch});
  await a.next(m=>m.type==='patch'); await b.next(m=>m.type==='patch');
  const old=current;
  a.send({type:'canvas',requestId:'grow',action:'expand',canvasId:current.canvasId,epoch:current.epoch,expectedRevision:1,width:80,height:96});
  current=await a.next(m=>m.requestId==='grow'); const other=await b.next(m=>m.requestId==='grow');
  assert.equal(other.board.cells[81].color,290); assert.equal(current.board.height,96);
  b.send({...op('late',66),canvasId:old.canvasId,epoch:old.epoch});
  assert.equal((await b.next(m=>m.requestId==='late')).code,'stale_canvas');
  a.send({type:'canvas',requestId:'clear',action:'clear',canvasId:current.canvasId,epoch:current.epoch,expectedRevision:current.board.revision});
  current=await a.next(m=>m.requestId==='clear'); await b.next(m=>m.requestId==='clear');
  assert.ok(current.board.cells.every(c=>c.color===null));
  const backupId=current.canvases.find(c=>c.id!==current.canvasId).id;
  await app.close();
  const restored=await createApp({dataDir:dir,port:0});t.after(()=>restored.close());await restored.start();
  const c=await peer('http://127.0.0.1:'+restored.address().port,restored.room.key);
  current=await c.next(m=>m.type==='snapshot');
  c.send({type:'canvas',requestId:'restore',action:'switch',targetId:backupId,canvasId:current.canvasId,epoch:current.epoch,expectedRevision:current.board.revision});
  const result=await c.next(m=>m.requestId==='restore');
  assert.equal(result.board.cells[81].color,290);
});

test('failed canvas save leaves current artwork and library unchanged', async t=>{
  const {app,base}=await fixture(t,{save:async()=>{throw new Error('disk full');}});
  const a=await peer(base,app.room.key);const current=await a.next(m=>m.type==='snapshot');
  a.send({type:'canvas',requestId:'fail-new',action:'new',name:'不会保存',width:80,height:96,canvasId:current.canvasId,epoch:current.epoch,expectedRevision:0});
  assert.equal((await a.next(m=>m.requestId==='fail-new')).code,'save_failed');
  assert.equal(app.room.canvases.length,1);assert.equal(app.room.activeId,current.canvasId);
});
