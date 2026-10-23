import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source=(await readFile(new URL('../public/rooms.mjs',import.meta.url),'utf8')).replace(/^export /gm,'');
function harness({locked=false, saved=null, brokenStorage=false}={}) {
  const nodes=new Map(), requests=[], entered=[], notices=[], memory=new Map(saved ? [['bead-room-session-v1',JSON.stringify(saved)]] : []);
  const get=id=>{
    if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',hidden:false,open:false,disabled:false,handlers:{},
      classList:{toggle(){},add(){},remove(){}},setAttribute(){},focus(){},select(){},
      addEventListener(name,fn){this.handlers[name]=fn;},showModal(){this.open=true;},close(){this.open=false;}});
    return nodes.get(id);
  };
  const context=vm.createContext({document:{getElementById:get},location:{origin:'https://test.example',hostname:'test.example',hash:''},
    history:{replaceState(){}},crypto:{getRandomValues:a=>a.fill(3)},Uint8Array,
    sessionStorage:{getItem:k=>{if(brokenStorage)throw Error();return memory.get(k)??null;},setItem:(k,v)=>{if(brokenStorage)throw Error();memory.set(k,v);},removeItem:k=>memory.delete(k)},
    navigator:{clipboard:{writeText:async()=>{}}},
    fetch:async(path,init)=>{requests.push({path,...init});return context.response;},
    onEnter:s=>entered.push(s),canSwitch:()=>!locked,notify:m=>notices.push(m)});
  context.response={ok:true,json:async()=>({key:'a'.repeat(48),room:{id:'one',name:'房间一',hasInvite:true}})};
  vm.runInContext(source+'\nvar ui=createRoomUI({onEnter,canSwitch,notify});',context);
  const submit=id=>get(id).handlers.submit({preventDefault(){}});
  return {get,context,requests,entered,notices,memory,submit,ui:context.ui};
}

test('failed joining preserves the current session and displays the server error',async()=>{
  const h=harness({saved:{key:'b'.repeat(48),code:'CURRENT1',room:{id:'old',name:'旧房间',hasInvite:true}}});
  h.ui.restore();h.ui.open();h.get('room-input').value='WRONG123';
  h.context.response={ok:false,json:async()=>({message:'邀请码不正确'})};
  await h.submit('join-form');
  assert.equal(h.entered.length,0);assert.equal(h.get('join-error').textContent,'邀请码不正确');
  assert.equal(JSON.parse(h.memory.get('bead-room-session-v1')).room.id,'old');
  assert.equal(h.get('join-dialog').open,true);
});

test('pending artwork prevents creating or switching rooms',async()=>{
  const h=harness({locked:true});h.get('room-input').value='JOIN1234';
  await h.submit('join-form');
  h.get('room-create-name').value='新房间';h.get('room-create-code').value='CREATE12';
  await h.submit('room-create-form');
  assert.equal(h.requests.length,0);assert.equal(h.entered.length,0);
});

test('created room normalizes invite, restores on refresh, and storage failure does not prevent joining',async()=>{
  const h=harness();h.get('room-create-name').value='新房间';h.get('room-create-code').value=' friendly ';
  await h.submit('room-create-form');
  assert.equal(h.requests[0].path,'/api/rooms');
  assert.deepEqual(JSON.parse(h.requests[0].body),{name:'新房间',code:'FRIENDLY'});
  assert.equal(h.entered[0].code,'FRIENDLY');
  const refresh=harness({saved:JSON.parse(h.memory.get('bead-room-session-v1'))});
  assert.equal(refresh.ui.restore().key,'a'.repeat(48));
  const denied=harness({brokenStorage:true});denied.get('room-input').value='FRIENDLY';
  await denied.submit('join-form');assert.equal(denied.entered.length,1);
});

test('recovering an invite cannot accidentally switch to a different room',async()=>{
  const h=harness({saved:{key:'b'.repeat(48),code:'',room:{id:'old',name:'旧房间',hasInvite:true}}});
  h.ui.restore();h.ui.showInvite();h.get('invite-code-input').value='FRIENDLY';
  await h.submit('invite-code-form');
  assert.equal(h.entered.length,0);assert.equal(h.get('invite-error').textContent.includes('不是当前房间'),true);
  assert.equal(JSON.parse(h.memory.get('bead-room-session-v1')).key,'b'.repeat(48));
});

test('legacy link takes precedence over a different remembered session without exposing its key in invite copy',()=>{
  const h=harness({saved:{key:'b'.repeat(48),code:'CURRENT1',room:{id:'old',name:'旧房间',hasInvite:true}}});
  h.context.location.hash='#'+'a'.repeat(48);
  assert.equal(h.ui.restore().key,'a'.repeat(48));
  h.ui.showInvite();assert.equal(h.get('invite-url').value,'https://test.example/');
  assert.equal(h.get('invite-code-value').value.includes('a'.repeat(48)),false);
});
