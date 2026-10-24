import test from 'node:test';
import assert from 'node:assert/strict';
import { sheetTiles, sheetSnapshot, sheetTileModel, fitCodeFont } from '../public/pattern-sheet.mjs';

test('256 squared tiles cover each global coordinate once, including nonmultiple edges', () => {
  const tiles=sheetTiles(256,256); assert.equal(tiles.length,16);
  assert.deepEqual(tiles[0],{index:0,x:0,y:0,width:64,height:64});
  assert.deepEqual(tiles.at(-1),{index:15,x:192,y:192,width:64,height:64});
  const seen=new Set();
  for(const tile of sheetTiles(130,65)) for(let y=tile.y;y<tile.y+tile.height;y++) for(let x=tile.x;x<tile.x+tile.width;x++) { const id=y*130+x; assert.equal(seen.has(id),false); seen.add(id); }
  assert.equal(seen.size,130*65);
  assert.deepEqual(sheetTiles(130,65).at(-1),{index:5,x:128,y:64,width:2,height:1});
});
test('immutable export captures code/null cells and counts white beads separately from empty cells', () => {
  const pattern={width:8,height:8,cells:Array(64).fill(null)}; pattern.cells[0]='H1'; pattern.cells[63]='LEGACY-WHITE-24';
  const palette=[{code:'H1',hex:'#FFFFFF'},{code:'LEGACY-WHITE-24',hex:'#EEEEEE',legacy:true}];
  const snapshot=sheetSnapshot(pattern,palette,'测试/图'); pattern.cells[0]=null; palette[0].hex='#000000';
  const model=sheetTileModel(snapshot,sheetTiles(8,8)[0]);
  assert.equal(model.cellSize,32); assert.equal(model.stats.total,2); assert.equal(model.stats.colors,2);
  assert.equal(model.cells[0].code,'H1'); assert.equal(model.cells[0].hex,'#FFFFFF'); assert.equal(model.cells[1].code,null);
  assert.equal(model.cells.at(-1).code,'LEGACY-WHITE-24');
  assert.deepEqual(model.rowLabels,[1,2,3,4,5,6,7,8]);
  assert.deepEqual(model.columnLabels,[1,2,3,4,5,6,7,8]);
  assert.equal(Object.isFrozen(snapshot.cells),true);
});
test('tile statistics are local, global material counts stay separate, long labels fit a fixed 32px cell', () => {
  const cells=Array(65*8).fill(null); cells[0]='H1'; cells[64]='H1';
  const snapshot=sheetSnapshot({width:65,height:8,cells},[{code:'H1',hex:'#FFFFFF'}],'wide');
  const second=sheetTileModel(snapshot,sheetTiles(65,8)[1]);
  assert.equal(second.stats.total,1); assert.equal(snapshot.stats.total,2);
  assert.deepEqual(second.columnLabels,[65]);
  assert.ok(fitCodeFont('LEGACY-WHITE-24',32) < fitCodeFont('H1',32));
  assert.ok(fitCodeFont('LEGACY-WHITE-24',32)>0);
  assert.throws(()=>sheetSnapshot({width:8,height:8,cells:[null]},[]),/格数/);
  assert.throws(()=>sheetSnapshot({width:8,height:8,cells:Array(64).fill('missing')},[]),/色号/);
});
