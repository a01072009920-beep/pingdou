import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeManualCodes, mergeColorBox, createManualColorStore, createColorBox } from '../public/color-box.mjs';

const palette = [{code:'A2',hex:'#AAAAAA'},{code:'A10',hex:'#BBBBBB'},{code:'B1',hex:'#CCCCCC'},{code:'ZG1',hex:'#EEEEEE'},{code:'OLD',hex:'#FFFFFF',legacy:true}];
test('manual codes are deduplicated, valid, sorted by MARD groups and retain palette indices', () => {
  assert.deepEqual(normalizeManualCodes(['ZG1','A10','A2','A10','OLD','NOPE'],palette), ['A2','A10','ZG1']);
  const entries = mergeColorBox({palette,cells:[{color:1},{color:1},{color:null},{color:0}],reference:{items:[{code:'A10',count:7},{code:'A2',count:2}]},manualCodes:['B1','A10']});
  assert.deepEqual(entries.map(e => [e.code,e.index,e.manual,e.referenceCount,e.currentCount]), [['A2',0,false,2,1],['A10',1,true,7,2],['B1',2,true,null,0]]);
});
test('current edited use does not rewrite imported reference counts or add unrelated colors', () => {
  const reference = {items:[{code:'A2',count:10}]};
  const entries = mergeColorBox({palette,cells:[{color:2},{color:null}],reference,manualCodes:[]});
  assert.equal(entries.length,1);
  assert.equal(entries[0].referenceCount,10);
  assert.equal(entries[0].currentCount,0);
  assert.deepEqual(reference,{items:[{code:'A2',count:10}]});
});
test('personal colors stay isolated by browser room and canvas and survive new store instances', () => {
  const map=new Map(); const storage={getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};
  const store=createManualColorStore({storage});
  store.set('room/one','canvas one',['B1','A2','A2'],palette);
  store.set('room/two','canvas one',['A10'],palette);
  assert.deepEqual(store.get('room/one','canvas one',palette),['A2','B1']);
  assert.deepEqual(store.get('room/one','canvas two',palette),[]);
  assert.deepEqual(store.get('room/two','canvas one',palette),['A10']);
  assert.deepEqual(createManualColorStore({storage}).get('room/one','canvas one',palette),['A2','B1']);
});
test('unavailable and corrupt storage leave working session colors and notify once', () => {
  let warnings=0; const storage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
  const store=createManualColorStore({storage,onUnavailable:()=>warnings++});
  assert.deepEqual(store.get('one','a',palette),[]);
  assert.deepEqual(store.set('one','a',['A2'],palette),['A2']);
  assert.deepEqual(store.get('one','a',palette),['A2']);
  store.set('two','b',['B1'],palette);
  assert.equal(warnings,1);
  const corrupt=createManualColorStore({storage:{getItem:()=>'{bad',setItem(){}},onUnavailable:()=>warnings++});
  assert.deepEqual(corrupt.get('one','a',palette),[]);
  assert.equal(warnings,2);
});

function withColorBoxDOM({saved=null,narrow=false,broken=false},check) {
  const keys=['document','localStorage','matchMedia'],previous=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const values=new Map(saved===null?[]:[['pingdou:color-box-expanded',saved]]);
  class Element {
    children=[];handlers={};open=false;classList={add(){}};
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=children;}
    addEventListener(name,handler){this.handlers[name]=handler;}
  }
  try {
    Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>new Element()}});
    Object.defineProperty(globalThis,'matchMedia',{configurable:true,value:()=>({matches:narrow})});
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
      getItem:key=>{if(broken)throw Error('unavailable');return values.get(key)??null;},
      setItem:(key,value)=>{if(broken)throw Error('unavailable');values.set(key,value);},
    }});
    const root=new Element();createColorBox({root,onSelect(){}});
    check(root.children[0],values);
  }finally{
    for(const key of keys){const descriptor=previous.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  }
}
test('the color box starts collapsed on every screen, including unavailable storage',()=>{
  for(const options of [{narrow:false},{narrow:true},{narrow:false,broken:true},{saved:'invalid'}])
    withColorBoxDOM(options,details=>assert.equal(details.open,false));
});
test('the color box preserves explicit open and closed choices and remembers user toggles',()=>{
  for(const narrow of [false,true])for(const saved of ['true','false'])
    withColorBoxDOM({narrow,saved},(details,values)=>{
      assert.equal(details.open,saved==='true');
      details.open=!details.open;details.handlers.toggle();
      assert.equal(values.get('pingdou:color-box-expanded'),String(details.open));
    });
});
