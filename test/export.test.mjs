import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync, crc32 } from 'node:zlib';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExportManager } from '../src/export.mjs';
import { createBoard, applyOperation } from '../src/board.mjs';
import { createApp } from '../src/server.mjs';
import { loadRoom } from '../src/store.mjs';
import legacyPalette from './fixtures/legacy-palette.json' with {type:'json'};

function decode(png) {
  assert.deepEqual([...png.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
  let offset = 8, header, data = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset+4, offset+8);
    const chunk = png.subarray(offset+8, offset+8+length);
    assert.equal(png.readUInt32BE(offset+8+length), crc32(png.subarray(offset+4, offset+8+length)), `${type} checksum`);
    if (type === 'IHDR') header = chunk;
    if (type === 'IDAT') data.push(chunk);
    offset += 12 + length;
  }
  assert.equal(header.readUInt32BE(0), 4096);
  assert.equal(header.readUInt32BE(4), 4096);
  assert.equal(header[8], 8); assert.equal(header[9], 2);
  const raw = inflateSync(Buffer.concat(data));
  assert.equal(raw.length, 4096 * (4096*3+1));
  return (x, y) => [...raw.subarray(y * (4096*3+1) + 1 + x*3, y * (4096*3+1) + 4 + x*3)];
}

test('real 4K PNG captures exact colors and remains immutable during later edits', async () => {
  const manager = new ExportManager();
  const initial = createBoard();
  const red = initial.palette.findIndex(c => c.code === 'F4');
  const board = applyOperation(initial, { requestId:'p',action:'place',index:0,color:red,expectedRevision:0 }).board;
  const pending = manager.render(board);
  board.cells[0].color = 11;
  const pixel = decode(await pending);
  assert.deepEqual(pixel(0,0), [252,40,60]);
  assert.deepEqual(pixel(63,63), [252,40,60]);
  assert.deepEqual(pixel(64,0), [255,255,255]);
  assert.deepEqual(pixel(4095,4095), [255,255,255]);
});

test('rectangular non-divisor canvas exports square cells centered on a 4K white image', async () => {
  const board = createBoard(80, 96);
  const red = board.palette.findIndex(c => c.code === 'F4');
  board.cells[0].color = red;
  board.cells[board.cells.length-1].color = red;
  const pixel = decode(await new ExportManager().render(board));
  assert.deepEqual(pixel(0,0),[255,255,255]);
  assert.deepEqual(pixel(342,0),[252,40,60]);
  assert.deepEqual(pixel(383,42),[252,40,60]);
  assert.deepEqual(pixel(384,42),[255,255,255]);
  assert.deepEqual(pixel(3754,4095),[252,40,60]);
  assert.deepEqual(pixel(4095,4095),[255,255,255]);
});

test('one export at a time is enforced and the next export can run after completion', async () => {
  const manager = new ExportManager();
  const first = manager.render(createBoard());
  await assert.rejects(manager.render(createBoard()), error => error.code === 'export_busy');
  await first;
  assert.ok((await manager.render(createBoard())).length > 100);
});

test('4K export preserves old exact RGB beside the last MARD extension color', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bead-palette-export-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const cells = Array.from({length:4096}, (_, index) => ({color:index === 0 ? 5 : null,revision:index === 0 ? 1 : 0}));
  await writeFile(join(dir,'room.json'), JSON.stringify({schema:1,key:'a'.repeat(48),board:{size:64,palette:legacyPalette,cells,revision:1}}));
  const {board} = await loadRoom(dir);
  const result = applyOperation(board, {requestId:'mard',action:'place',index:1,color:290,expectedRevision:0});
  const pixel = decode(await new ExportManager().render(result.board));
  assert.deepEqual(pixel(32,32), [233,78,98]);
  assert.deepEqual(pixel(96,32), [171,145,192]);
  assert.deepEqual(pixel(160,32), [255,255,255]);
});

test('HTTP 4K export requires the room key and leaves the room responsive and unchanged', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bead-export-'));
  const app = await createApp({ dataDir: dir, port: 0 });
  await app.start();
  t.after(async () => { await app.close(); await rm(dir,{recursive:true,force:true}); });
  const base = `http://127.0.0.1:${app.address().port}`;
  assert.equal((await fetch(base+'/api/export', {method:'POST'})).status, 401);
  const image = fetch(base+'/api/export', {method:'POST',headers:{Authorization:`Bearer ${app.room.key}`}});
  assert.equal((await fetch(base+'/api/health')).status, 200);
  const response = await image;
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type'), /image\/png/);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.match(response.headers.get('Content-Disposition'), /4096/);
  decode(Buffer.from(await response.arrayBuffer()));
  assert.equal(app.room.board.revision, 0);
});
