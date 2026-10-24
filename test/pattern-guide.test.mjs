import test from 'node:test';
import assert from 'node:assert/strict';
import { guideCode, hasGuide, guidePattern } from '../public/pattern-guide.mjs';
import { createBoard } from '../src/board.mjs';

const guide=()=>({schema:2,width:8,height:8,cells:Array.from({length:64},(_,i)=>i===0?'F4':i===63?'H1':null)});
test('template source coordinates stay fixed when the playable board is expanded',()=>{
  const reference=guide();
  assert.equal(hasGuide(reference),true);
  assert.equal(guideCode(reference,0,12),'F4');
  assert.equal(guideCode(reference,7*12+7,12),'H1');
  for(const index of [8,63,7*12+8,8*12,12*10-1])assert.equal(guideCode(reference,index,12),null);
  assert.equal(guideCode({schema:1,items:[]},0,12),null);
  assert.equal(hasGuide({...reference,cells:[]}),false);
});
test('guide sheet uses full target colors, while a regular or legacy canvas uses actual beads',()=>{
  const board=createBoard(12,10),reference=guide();
  const snapshot=guidePattern(board,reference);
  assert.deepEqual([snapshot.width,snapshot.height],[12,10]);
  assert.equal(snapshot.cells[0],'F4');assert.equal(snapshot.cells[7*12+7],'H1');
  assert.equal(snapshot.cells.filter(Boolean).length,2);
  board.cells[0].color=0;reference.cells[0]='B7';
  assert.equal(snapshot.cells[0],'F4','export captures an independent target snapshot');
  assert.equal(guidePattern(board,null).cells[0],'A1');
  assert.equal(guidePattern(board,{schema:1,items:[]}).cells[0],'A1');
  assert.equal(board.cells.slice(1).every(cell=>cell.color===null),true);
});
