import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import WebSocket from 'ws';
import { createApp } from '../src/server.mjs';
import { loadRoom, saveRoom } from '../src/store.mjs';
import { changeCanvas, validCanvases, withBoard } from '../src/canvases.mjs';
import { applyOperation } from '../src/board.mjs';
import { paletteFingerprint } from '../public/pattern-data.mjs';

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'bead-import-'));
  const app = await createApp({dataDir:dir,port:0,...options});
  await app.start();
  t.after(async () => { await app.close(); await rm(dir,{recursive:true,force:true}); });
  return {app,dir,base:`http://127.0.0.1:${app.address().port}`};
}
function payload(room, overrides = {}) {
  return {requestId:'image-1',name:'图片图纸',width:8,height:8,
    cells:Array.from({length:64},(_,i)=>i===0?'H1':i===63?'A1':null),
    paletteFingerprint:paletteFingerprint(room.board.palette),canvasId:room.activeId,epoch:room.canvasEpoch,
    settings:{width:8,height:8,mode:'smooth',coverage:.5,matte:'#FFFFFF',maxColors:0,
      lockedCodes:[],candidateCodes:null,crop:null},...overrides};
}
async function post(base, room, body, headers = {}) {
  const response = await fetch(base+'/api/import',{method:'POST',headers:{'Content-Type':'application/json',
    Authorization:`Bearer ${room.key}`,...headers},body:typeof body==='string'?body:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
}
async function peer(base,key) {
  const ws = new WebSocket(base.replace('http','ws')+'/ws'), messages = [],waiters = [];
  ws.on('message',raw=>{ const value=JSON.parse(raw); const waiter=waiters.find(w=>w.match(value));
    if(waiter){waiters.splice(waiters.indexOf(waiter),1);clearTimeout(waiter.timer);waiter.resolve(value);}
    else messages.push(value); });
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  const next=match=>{const i=messages.findIndex(match);if(i>=0)return Promise.resolve(messages.splice(i,1)[0]);
    return new Promise((resolve,reject)=>{const waiter={match,resolve,timer:setTimeout(()=>reject(new Error('Missing socket message')),3000)};waiters.push(waiter);});};
  ws.send(JSON.stringify({type:'auth',key}));
  return {ws,messages,next,send:value=>ws.send(JSON.stringify(value))};
}
const command=(room,fields)=>({canvasId:room.activeId,epoch:room.canvasEpoch,expectedRevision:room.board.revision,...fields});
function rawPost(base,room) {
  let req;
  const response=new Promise((resolve,reject)=>{
    req=request(base+'/api/import',{method:'POST',headers:{Authorization:`Bearer ${room.key}`,'Content-Type':'application/json'}},res=>{
      let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);
      res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));
    });req.on('error',reject);req.flushHeaders();
  });
  return {req,response};
}

test('import saves an empty playable canvas once, sharing its exact target guide only in its room',async t=>{
  let saves=0;
  const {app,base,dir}=await fixture(t,{save:async(...args)=>{saves++;return saveRoom(...args);}});
  const other=await app.rooms.create({name:'其他房间',code:'OTHER123'});
  const a=await peer(base,app.room.key),b=await peer(base,app.room.key),c=await peer(base,other.room.key);
  await Promise.all([a.next(m=>m.type==='snapshot'),b.next(m=>m.type==='snapshot'),c.next(m=>m.type==='snapshot')]);
  saves=0;
  const before=structuredClone(app.room), input=payload(app.room);
  const result=await post(base,app.room,input);
  assert.equal(result.status,200);assert.equal(result.body.duplicate,false);assert.equal(saves,1);
  assert.equal(app.room.canvases.length,2);assert.equal(result.body.canvasId,app.room.activeId);
  assert.deepEqual(app.room.canvases[0],before.canvases[0]);
  assert.equal(app.room.board.cells.length,64);
  assert.ok(app.room.board.cells.every(cell=>cell.color===null && cell.revision===0));
  for(const socket of [a,b]){
    const snapshot=await socket.next(m=>m.type==='snapshot');
    assert.equal(snapshot.canvasId,result.body.canvasId);
    assert.deepEqual(snapshot.reference.items,[{code:'A1',count:1},{code:'H1',count:1}]);
    assert.equal(snapshot.reference.total,2);assert.equal(snapshot.reference.colors,2);
    assert.equal(snapshot.reference.requestId,'image-1');
    assert.equal(snapshot.reference.schema,2);assert.equal(snapshot.reference.width,8);assert.equal(snapshot.reference.height,8);
    assert.deepEqual(snapshot.reference.cells,input.cells);
    assert.ok(snapshot.board.cells.every(cell=>cell.color===null));
  }
  assert.equal(other.room.canvases.length,1);assert.equal(c.messages.some(m=>m.type==='snapshot'),false);
  assert.equal((await loadRoom(dir)).activeId,result.body.canvasId);
});

test('failed save leaves memory, disk, library and socket snapshots unchanged and can retry',async t=>{
  let failing=true;
  const {app,base,dir}=await fixture(t,{save:async(...args)=>{if(failing)throw new Error('full');return saveRoom(...args);}});
  const socket=await peer(base,app.room.key);await socket.next(m=>m.type==='snapshot');
  const before=JSON.stringify(app.room),disk=await readFile(join(dir,'room.json'),'utf8'),input=payload(app.room);
  const failed=await post(base,app.room,input);
  assert.equal(failed.status,500);assert.equal(failed.body.code,'save_failed');
  assert.equal(JSON.stringify(app.room),before);assert.equal(await readFile(join(dir,'room.json'),'utf8'),disk);
  assert.equal(socket.messages.some(m=>m.type==='snapshot'),false);
  failing=false;assert.equal((await post(base,app.room,input)).status,200);
});

test('concurrent retry and restart dedupe durably; same id with changed payload conflicts without reselecting old canvas',async t=>{
  let saves=0;
  const {app,base,dir}=await fixture(t,{save:async(...args)=>{saves++;return saveRoom(...args);}});
  const input=payload(app.room),results=await Promise.all([post(base,app.room,input),post(base,app.room,input)]);
  assert.deepEqual(results.map(r=>r.status),[200,200]);
  assert.deepEqual(results.map(r=>r.body.duplicate).sort(),[false,true]);assert.equal(saves,1);
  const imported=app.room.activeId;
  Object.assign(app.room,changeCanvas(app.room,command(app.room,{action:'new',name:'后来的画布',width:8,height:8})).room);
  await saveRoom(dir,app.room);const latest=app.room.activeId;
  assert.equal((await post(base,app.room,input)).body.canvasId,imported);assert.equal(app.room.activeId,latest);
  assert.equal((await post(base,app.room,{...input,name:'不同图纸'})).status,409);
  await app.close();
  const restored=await createApp({dataDir:dir,port:0});t.after(()=>restored.close());await restored.start();
  const retry=await post(`http://127.0.0.1:${restored.address().port}`,restored.room,input);
  assert.equal(retry.body.duplicate,true);assert.equal(restored.room.activeId,latest);assert.equal(restored.room.canvases.length,3);
});

test('ordinary queued edits preserve latest old board, while canvas lifecycle changes reject stale imports',async t=>{
  let entered,release;
  const waiting=new Promise(resolve=>entered=resolve), gate=new Promise(resolve=>release=resolve);
  t.after(()=>release());
  let block=true;
  const {app,base}=await fixture(t,{save:async(...args)=>{if(block){entered();await gate;block=false;}return saveRoom(...args);}});
  const socket=await peer(base,app.room.key);const initial=await socket.next(m=>m.type==='snapshot');
  const input=payload(app.room);
  socket.send({type:'op',requestId:'partner',action:'place',index:1,color:3,expectedRevision:0,canvasId:initial.canvasId,epoch:initial.epoch});
  await waiting;const importing=post(base,app.room,input);release();
  assert.equal((await importing).status,200);assert.equal(app.room.canvases.find(c=>c.id===initial.canvasId).board.cells[1].color,3);
  const stale=payload(app.room,{requestId:'stale'});
  Object.assign(app.room,changeCanvas(app.room,command(app.room,{action:'expand',width:9,height:8})).room);
  const state=JSON.stringify(app.room),result=await post(base,app.room,stale);
  assert.equal(result.status,409);assert.equal(result.body.code,'stale_canvas');assert.equal(JSON.stringify(app.room),state);
});

test('authentication, origin, size, palette, settings and cell validation reject entire requests',async t=>{
  const {app,base}=await fixture(t);const input=payload(app.room),before=JSON.stringify(app.room);
  assert.equal((await post(base,app.room,input,{Authorization:'Bearer '+'0'.repeat(48)})).status,401);
  assert.equal((await post(base,app.room,input,{Origin:'https://elsewhere.example'})).status,403);
  assert.equal((await post(base,app.room,input,{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await post(base,app.room,input,{'Content-Type':'text/plain'})).status,415);
  const tooBig=JSON.stringify({...input,name:'x'.repeat(1024*1024)});
  assert.equal((await post(base,app.room,tooBig)).status,413);
  assert.equal((await post(base,app.room,{...input,paletteFingerprint:'old'})).status,409);
  for(const overrides of [{cells:input.cells.slice(1)},{cells:Array(64).fill('UNKNOWN')},{width:7},
    {cells:Array(64).fill(0)},{name:'x'.repeat(61)},{requestId:''},{epoch:-1},
    {settings:{...input.settings,rawImage:'x'}},{settings:{...input.settings,maxColors:-1}},
    {settings:{...input.settings,crop:{x:0,y:0,width:0,height:1}}},{hex:'#FFFFFF'}]){
    assert.equal((await post(base,app.room,{...input,...overrides})).status,400,JSON.stringify(overrides));
  }
  assert.equal(JSON.stringify(app.room),before);
});

test('reference survives expand, clear backup, switch, save and restart; blank new canvas has none',async t=>{
  const {app,base,dir}=await fixture(t);await post(base,app.room,payload(app.room));
  let room=app.room;const reference=structuredClone(room.canvases.at(-1).reference);
  assert.equal(validCanvases(room),true);
  const color=room.board.palette.findIndex(c=>c.code==='F4');
  room=withBoard(room,applyOperation(room.board,{requestId:'draw',action:'place',index:63,color,expectedRevision:0}).board);
  room=changeCanvas(room,command(room,{action:'expand',width:12,height:10})).room;
  assert.equal(validCanvases(room),true);assert.deepEqual(room.canvases.find(c=>c.id===room.activeId).reference,reference);
  assert.equal(room.board.cells[7*12+7].color,color);
  assert.equal(reference.width,8);assert.equal(reference.height,8);assert.equal(reference.cells.length,64);
  assert.equal(reference.cells[7*8+7],'A1');
  room=changeCanvas(room,command(room,{action:'clear'})).room;
  const backup=room.canvases.at(-1);assert.deepEqual(backup.reference,reference);
  assert.equal(backup.board.cells[7*12+7].color,color);
  assert.ok(room.board.cells.every(c=>c.color===null));assert.deepEqual(room.canvases.find(c=>c.id===room.activeId).reference,reference);
  room=changeCanvas(room,command(room,{action:'new',name:'空画布',width:8,height:8})).room;
  assert.equal(room.canvases.at(-1).reference,undefined);
  room=changeCanvas(room,command(room,{action:'switch',targetId:backup.id})).room;
  await saveRoom(dir,room);room=await loadRoom(dir);
  assert.deepEqual(room.canvases.find(c=>c.id===room.activeId).reference,reference);
  assert.equal(room.board.palette[room.board.cells[7*12+7].color].code,'F4');
  for(const bad of [{...reference,schema:3},{...reference,total:999},
    {...reference,items:[{code:'NOPE',count:2}]},{...reference,settings:{evil:{nested:{}}}},
    {...reference,payloadHash:'bad'},{...reference,items:[...reference.items,reference.items[0]]}]){
    const corrupted={...room,canvases:room.canvases.map(c=>c.id===room.activeId?{...c,reference:bad}:c)};
    assert.equal(validCanvases(corrupted),false);
  }
});

test('a target guide leaves cells placeable, supports arbitrary color and erase, and survives reconnect and restart',async t=>{
  const {app,base,dir}=await fixture(t);const input=payload(app.room);await post(base,app.room,input);
  const a=await peer(base,app.room.key),b=await peer(base,app.room.key);
  const initial=await a.next(m=>m.type==='snapshot');await b.next(m=>m.type==='snapshot');
  const red=initial.board.palette.findIndex(c=>c.code==='F4');
  a.send({type:'op',requestId:'draw-target',action:'place',index:0,color:red,expectedRevision:0,
    canvasId:initial.canvasId,epoch:initial.epoch});
  const placed=await b.next(m=>m.type==='patch' && m.requestId==='draw-target');
  assert.equal(placed.cell.color,red);assert.equal(app.room.canvases.at(-1).reference.cells[0],'H1');
  b.send({type:'op',requestId:'erase-target',action:'erase',index:0,expectedRevision:1,
    canvasId:initial.canvasId,epoch:initial.epoch});
  const erased=await a.next(m=>m.type==='patch' && m.requestId==='erase-target');
  assert.equal(erased.cell.color,null);assert.equal(app.room.canvases.at(-1).reference.cells[0],'H1');
  const reconnect=await peer(base,app.room.key),snapshot=await reconnect.next(m=>m.type==='snapshot');
  assert.deepEqual(snapshot.reference.cells,input.cells);assert.equal(snapshot.board.cells[0].color,null);
  await app.close();
  const restored=await createApp({dataDir:dir,port:0});t.after(()=>restored.close());await restored.start();
  const fresh=await peer(`http://127.0.0.1:${restored.address().port}`,restored.room.key);
  const restarted=await fresh.next(m=>m.type==='snapshot');
  assert.deepEqual(restarted.reference,snapshot.reference);assert.equal(restarted.board.cells[0].color,null);
});

test('stored guide validates dimensions, cells and exact target counts without changing schema 1 boards',async t=>{
  const {app,base,dir}=await fixture(t);await post(base,app.room,payload(app.room));
  const current=app.room.canvases.at(-1),reference=structuredClone(current.reference);
  assert.equal(reference.schema,2);
  const malformed=[
    {...reference,width:7}, {...reference,width:9}, {...reference,height:256,cells:Array(8*256).fill(null)},
    {...reference,width:9,cells:[...reference.cells,...Array(8).fill(null)],settings:{...reference.settings,width:9}},
    {...reference,cells:reference.cells.slice(1)}, {...reference,cells:reference.cells.map((c,i)=>i===0?'NOPE':c)},
    {...reference,cells:reference.cells.map((c,i)=>i===0?1:c)}, {...reference,cells:Array(64).fill(null)},
    {...reference,items:[{code:'A1',count:2}],colors:1,total:2}, {...reference,unexpected:[]},
    {...reference,settings:{...reference.settings,width:9}},
  ];
  for(const bad of malformed){
    const corrupted={...app.room,canvases:app.room.canvases.map(c=>c.id===current.id?{...c,reference:bad}:c)};
    assert.equal(validCanvases(corrupted),false,JSON.stringify(bad));
    await assert.rejects(saveRoom(dir,corrupted),/拼豆数据无效/);
  }
  const {width,height,cells,...legacyReference}=reference;legacyReference.schema=1;
  const red=current.board.palette.findIndex(c=>c.code==='F4');
  const filled=applyOperation(current.board,{requestId:'legacy-fill',action:'place',index:0,color:red,expectedRevision:0}).board;
  const legacy=withBoard({...app.room,canvases:app.room.canvases.map(c=>c.id===current.id?{...c,reference:legacyReference}:c)},filled);
  assert.equal(validCanvases(legacy),true);await saveRoom(dir,legacy);
  const restored=await loadRoom(dir);
  assert.deepEqual(restored.canvases.at(-1).reference,legacyReference);
  assert.equal(restored.board.cells[0].color,red);
});

test('4K export remains the actual empty work after guide import',async t=>{
  const {app,base}=await fixture(t);
  const exportPNG=async()=>{const res=await fetch(base+'/api/export',{method:'POST',headers:{Authorization:`Bearer ${app.room.key}`}});
    assert.equal(res.status,200);return Buffer.from(await res.arrayBuffer());};
  const before=await exportPNG();await post(base,app.room,payload(app.room));
  assert.deepEqual(await exportPNG(),before);
  assert.equal(app.room.canvases.at(-1).reference.total,2);assert.ok(app.room.board.cells.every(cell=>cell.color===null));
});

test('all empty pattern is valid, and legacy boards remain valid with no reference migration',async t=>{
  const {app,base}=await fixture(t);const legacy=structuredClone(app.room);
  assert.equal(validCanvases(legacy),true);assert.equal(legacy.canvases[0].reference,undefined);
  assert.equal((await post(base,app.room,payload(app.room,{cells:Array(64).fill(null)}))).status,200);
  assert.equal(app.room.canvases.at(-1).reference.total,0);assert.deepEqual(app.room.canvases.at(-1).reference.items,[]);
});

test('streamed bodies are size bounded and incomplete uploads time out without changing artwork',async t=>{
  const {app,base}=await fixture(t);const before=JSON.stringify(app.room);
  const oversized=rawPost(base,app.room);
  oversized.req.write(Buffer.alloc(1024*1024,32));oversized.req.end(' ');
  assert.equal((await oversized.response).status,413);
  const stalled=rawPost(base,app.room);stalled.req.write('{');
  assert.equal((await stalled.response).status,408);stalled.req.destroy();
  assert.equal(JSON.stringify(app.room),before);
});

test('slow import save does not block another room; concurrent waiting imports are bounded',async t=>{
  let entered,release,blockedKey;
  const waiting=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  t.after(()=>release());
  const {app,base}=await fixture(t,{save:async(dir,room)=>{if(room.key===blockedKey){entered();await gate;}return saveRoom(dir,room);}});
  const other=await app.rooms.create({name:'并行房间',code:'PARALLEL1'});
  blockedKey=app.room.key;const input=payload(app.room);
  const first=post(base,app.room,input);await waiting;
  const independent=await post(base,other.room,payload(other.room));
  assert.equal(independent.status,200);assert.equal(app.room.canvases.length,1);
  let rejected=0,allRejected;
  const rejects=new Promise(resolve=>allRejected=resolve);
  const extras=Array.from({length:6},()=>post(base,app.room,input).then(result=>{
    if(result.status===429 && ++rejected===3)allRejected();return result;
  }));
  await rejects;release();
  const results=await Promise.all([first,...extras]);
  assert.equal(results.filter(result=>result.status===429).length,3);
  assert.equal(results.filter(result=>result.status===200).length,4);
  assert.equal(app.room.canvases.length,2);
  assert.equal((await post(base,app.room,payload(app.room,{requestId:'after-limit'}))).status,200);
});

test('shutdown aborts an incomplete body and drains an already saving import before resolving',async t=>{
  let entered,release;
  const waiting=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  t.after(()=>release());
  const {app,base,dir}=await fixture(t,{save:async(...args)=>{entered();await gate;return saveRoom(...args);}});
  const incomplete=rawPost(base,app.room);incomplete.req.write('{');
  const importing=post(base,app.room,payload(app.room));await waiting;
  let closed=false;const closing=app.close().then(()=>closed=true);
  assert.equal((await incomplete.response).status,503);incomplete.req.destroy();
  assert.equal(closed,false);assert.equal(app.room.canvases.length,1);
  release();await closing;
  assert.equal((await importing).status,200);assert.equal((await loadRoom(dir)).canvases.length,2);
});
