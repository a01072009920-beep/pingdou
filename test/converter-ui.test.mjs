import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversionRunner, createImportDraft } from '../public/converter-ui.mjs';
import { converterDOM } from './helpers/converter-dom.mjs';

test('only the latest conversion worker may publish progress or results; cancel releases it',()=>{
  const workers=[],results=[],progress=[],errors=[];
  const runner=createConversionRunner({makeWorker:()=>{const worker={postMessage(value){this.input=value;},terminate(){this.stopped=true;}};workers.push(worker);return worker;},
    onResult:value=>results.push(value),onProgress:value=>progress.push(value),onError:value=>errors.push(value)});
  runner.run({image:{width:8,height:8},settings:{width:8},palette:[]});
  const old=workers[0],oldId=old.input.id;
  runner.run({image:{width:16,height:8},settings:{width:8},palette:[]});
  assert.equal(old.stopped,true);
  old.onmessage({data:{id:oldId,type:'result',result:{cells:['old']}}});
  assert.equal(results.length,0);
  workers[1].onmessage({data:{id:workers[1].input.id,type:'progress',progress:.5}});
  workers[1].onmessage({data:{id:workers[1].input.id,type:'result',result:{cells:['new']}}});
  assert.deepEqual(results,[{cells:['new']}]);assert.deepEqual(progress,[.5]);
  runner.run({image:{},settings:{},palette:[]});runner.cancel();
  workers[2].onmessage({data:{id:workers[2].input.id,type:'error',message:'late'}});
  assert.equal(errors.length,0);assert.equal(workers[2].stopped,true);
});

test('runner reuses cache only for the same source image object and clear releases it',()=>{
  const workers=[];
  const runner=createConversionRunner({makeWorker:()=>{
    const worker={postMessage(input){this.input=input;},terminate(){}};workers.push(worker);return worker;
  },onResult(){}});
  const firstImage={width:8,height:8,data:new Uint8ClampedArray(256)},secondImage={width:8,height:8,data:new Uint8ClampedArray(256)};
  const input=image=>({image,settings:{width:8,height:8},palette:[]});
  const finish=cache=>{const worker=workers.at(-1);worker.onmessage({data:{id:worker.input.id,type:'result',result:{cells:[],cache}}});};
  const firstCache={sampleKey:'first-source',sampled:[[255,255,255]]};
  runner.run(input(firstImage));assert.equal(workers.at(-1).input.cache,null);
  finish(firstCache);
  runner.run(input(firstImage));
  assert.strictEqual(workers.at(-1).input.cache,firstCache,'same-image parameter changes receive the completed sampling cache');
  finish(firstCache);
  runner.run(input(secondImage));
  assert.equal(workers.at(-1).input.cache,null,'equal dimensions cannot identify another image as the cached source');
  finish({sampleKey:'second-source',sampled:[[0,0,0]]});
  runner.clear();runner.run(input(secondImage));
  assert.equal(workers.at(-1).input.cache,null,'clearing the draft releases its source cache');
});

test('import retries retain payload identity and immutable cells; changed intent receives a new id',()=>{
  let n=0;const draft=createImportDraft(()=>`id-${++n}`);
  const body={canvasId:'one',epoch:0,cells:['A5'],settings:{mode:'nearest'}};
  const first=draft.prepare(body);body.cells[0]='F4';
  assert.equal(first.cells[0],'A5');
  assert.deepEqual(draft.current(),first);
  const retry=draft.current();retry.epoch=9;
  assert.equal(draft.current().epoch,0,'a newer snapshot cannot mutate the unresolved import context');
  assert.equal(draft.prepare({...body,cells:['A5']}).requestId,first.requestId);
  assert.notEqual(draft.prepare(body).requestId,first.requestId);
  const second=draft.prepare(body);draft.clear();assert.notEqual(draft.prepare(body).requestId,second.requestId);
});

test('a second touch during crop selection cannot leave the previous preview importable',async t=>{
  const h=await converterDOM(t),importButton=h.byText('导入为待拼图纸'),sheetButton=h.byText('导出本地图纸');
  assert.equal(importButton.disabled,false,'the initial completed preview is importable');
  await h.byText('原图 / 裁剪').emit('click');
  await h.surface.emit('pointerdown',{pointerId:1,clientX:50,clientY:50,pointerType:'touch'});
  await h.surface.emit('pointermove',{pointerId:1,clientX:250,clientY:250,pointerType:'touch'});
  await h.surface.emit('pointerdown',{pointerId:2,clientX:100,clientY:100,pointerType:'touch'});
  await h.surface.emit('pointerup',{pointerId:1,pointerType:'touch'});
  await h.surface.emit('pointerup',{pointerId:2,pointerType:'touch'});
  assert.deepEqual(['x','y','width','height'].map(key=>h.byId(`crop-${key}`).value),['1','1','4','4']);
  assert.equal(importButton.disabled,true,'the visible crop no longer matches the completed preview');
  assert.equal(sheetButton.disabled,true,'local export also requires conversion of the new crop');
  await importButton.emit('click');
  assert.equal(h.imports.length,0,'an obsolete preview must never be submitted');
  const result=await h.complete();
  assert.deepEqual(result.settings.crop,{x:1,y:1,width:4,height:4});
  assert.equal(importButton.disabled,false,'generating the selected crop restores import');
});

test('an unfinished numeric crop edit cannot import the previous completed preview',async t=>{
  const h=await converterDOM(t),importButton=h.byText('导入为待拼图纸'),field=h.byId('crop-width');
  assert.equal(importButton.disabled,false);
  field.value=''; // Number inputs expose an empty string for blank or bad input.
  await field.emit('input');
  assert.equal(importButton.disabled,true,'editing a crop must invalidate the previous result before blur');
  await importButton.emit('click');
  assert.equal(h.imports.length,0,'an incomplete crop cannot submit an older whole-image result');
});
