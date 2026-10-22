import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBoard, applyOperation, isValidBoard } from '../src/board.mjs';
import { initializeCanvases, changeCanvas } from '../src/canvases.mjs';
import { saveRoom, loadRoom } from '../src/store.mjs';
import { lineCells, stepCell } from '../public/interaction.mjs';

const initial = () => initializeCanvases({ schema:1, key:'a'.repeat(48), board:applyOperation(createBoard(), {
  requestId:'seed', action:'place', index:65, color:290, expectedRevision:0 }).board });
const command = (room, values) => ({canvasId:room.activeId,epoch:room.canvasEpoch,expectedRevision:room.board.revision,...values});
test('rectangular expansion preserves coordinates and rejects shrinking or oversized dimensions', () => {
  const room=initial();
  const next=changeCanvas(room,command(room,{action:'expand',width:80,height:96})).room;
  assert.equal(next.board.cells[81].color,290);
  assert.equal(next.board.cells[65].color,null);
  assert.equal(next.board.cells.length,80*96);
  assert.ok(isValidBoard(next.board));
  assert.equal(room.board.cells[65].color,290);
  for(const [width,height] of [[63,64],[64,257],[7,64],[64.5,80]])
    assert.equal(changeCanvas(room,command(room,{action:'expand',width,height})).ok,false);
});
test('clear saves a recoverable exact backup; new and previous canvases survive disk restart', async t => {
  const dir=await mkdtemp(join(tmpdir(),'bead-library-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  let room=initial(); const originalId=room.activeId;
  room=changeCanvas(room,command(room,{action:'clear'})).room;
  assert.ok(room.board.cells.every(c=>c.color===null));
  const backup=room.canvases.find(c=>c.id!==originalId);
  assert.equal(backup.board.cells[65].color,290);
  room=changeCanvas(room,command(room,{action:'new',name:'新作品',width:24,height:40})).room;
  await saveRoom(dir,room); room=await loadRoom(dir);
  assert.equal(room.canvases.length,3);
  assert.equal(room.board.width,24); assert.equal(room.board.height,40);
  room=changeCanvas(room,command(room,{action:'switch',targetId:backup.id})).room;
  assert.equal(room.board.cells[65].color,290);
  await saveRoom(dir,room);
  assert.equal((await loadRoom(dir)).board.cells[65].color,290);
});
test('stale dialog context cannot clear or expand another canvas', () => {
  const room=initial(), old=command(room,{action:'clear'});
  const next=changeCanvas(room,command(room,{action:'new',name:'B',width:64,height:64})).room;
  assert.equal(changeCanvas(next,old).code,'stale_canvas');
});
test('continuous lines fill crossed cells and directional movement never wraps edges', () => {
  assert.deepEqual(lineCells(0,7,8),[0,1,2,3,4,5,6,7]);
  assert.deepEqual(lineCells(0,63,8),[0,9,18,27,36,45,54,63]);
  assert.deepEqual(lineCells(63,0,8),[63,54,45,36,27,18,9,0]);
  assert.deepEqual(lineCells(null,5,8),[]);
  assert.equal(stepCell(7,'d',8,12),null);
  assert.equal(stepCell(8,'a',8,12),null);
  assert.equal(stepCell(0,'w',8,12),null);
  assert.equal(stepCell(95,'s',8,12),null);
  assert.equal(stepCell(17,'w',8,12),9);
  assert.equal(stepCell(17,'s',8,12),25);
});
