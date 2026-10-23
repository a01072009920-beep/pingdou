import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source=(await readFile(new URL('../public/workspace.mjs',import.meta.url),'utf8')).replace(/^export /gm,'');
function harness({narrow=true, saved=null, broken=false, allow=true}={}) {
  const nodes=new Map(), memory=new Map(saved ? [['bead-workspace-v1',JSON.stringify(saved)]]:[]);
  const get=id=>{
    if(!nodes.has(id))nodes.set(id,{hidden:false,attributes:{},handlers:{},textContent:'',focused:false,
      classList:{values:new Set(),toggle(name,value){value?this.values.add(name):this.values.delete(name);}},
      addEventListener(name,fn){this.handlers[name]=fn;},setAttribute(k,v){this.attributes[k]=v;},focus(){this.focused=true;}});
    return nodes.get(id);
  };
  const query={matches:narrow,addEventListener(name,fn){this.change=fn;}};
  const context=vm.createContext({document:{getElementById:get},matchMedia:()=>query,
    localStorage:{getItem:k=>{if(broken)throw Error();return memory.get(k)??null;},setItem:(k,v)=>{if(broken)throw Error();memory.set(k,v);}},
    beforeLayout:()=>allow});
  vm.runInContext(source+'\nvar workspace=initWorkspace({beforeLayout});',context);
  return {get,memory,query,click:id=>get(id).handlers.click()};
}
test('phone starts collapsed; toggling keeps explicit preference after rotation and refresh',()=>{
  const h=harness();assert.equal(h.get('palette-panel').hidden,true);
  h.click('palette-toggle');assert.equal(h.get('palette-panel').hidden,false);
  assert.equal(h.get('palette-toggle').attributes['aria-expanded'],'true');
  h.query.matches=false;h.query.change();h.query.matches=true;h.query.change();
  assert.equal(h.get('palette-panel').hidden,false);
  const restored=harness({saved:JSON.parse(h.memory.get('bead-workspace-v1'))});
  assert.equal(restored.get('palette-panel').hidden,false);
  restored.click('palette-close');assert.equal(restored.get('palette-panel').hidden,true);
  assert.equal(restored.get('palette-toggle').focused,true);
});
test('desktop shows palette; focus leaves a reachable exit, with storage failure allowed',()=>{
  const h=harness({narrow:false,broken:true});assert.equal(h.get('palette-panel').hidden,false);
  h.click('focus-toggle');assert.equal(h.get('app-root').classList.values.has('focus-mode'),true);
  assert.equal(h.get('focus-toggle').textContent,'退出专注');
  h.click('focus-toggle');assert.equal(h.get('app-root').classList.values.has('focus-mode'),false);
});
test('changing panels during an active gesture is refused instead of moving its target',()=>{
  const h=harness({allow:false});h.click('palette-toggle');h.click('focus-toggle');
  assert.equal(h.get('palette-panel').hidden,true);
  assert.equal(h.get('app-root').classList.values.has('focus-mode'),false);
});
